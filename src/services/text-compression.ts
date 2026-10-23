import { deflateSync, gzipSync, Gunzip, Inflate } from 'fflate'
import { compressToUint8Array } from 'lz-string'
import { decodeBytes, encodeBytes } from './text-encodings'
import {
  ALGORITHM_OPTIONS, DEFAULT_ALGORITHM, DEFAULT_ENCODING, ENCODING_OPTIONS,
  getTextMetrics, MAX_COMPRESSED_BYTES, MAX_ENCODED_CHARACTERS, MAX_TEXT_BYTES,
} from './text-compression-types'
import type { CompressionAlgorithm, CompressionResult, TextEncoding } from './text-compression-types'

const ALGORITHM_CODES: Record<CompressionAlgorithm, string> = {
  brotli: 'b', zstd: 'z', lzma: 'l', deflate: 'd', gzip: 'g', 'lz-string': 's',
}
const ENCODING_CODES: Record<TextEncoding, string> = {
  base32768: 'u', base65536: 'v', base64url: 'c', base64: 'b', base91: 'n',
}
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const CORRUPTED = '压缩文本损坏、不完整，或格式不受支持'

type BrotliModule = typeof import('../../node_modules/brotli-wasm/pkg.web/brotli_wasm.js')
type ZstdModule = typeof import('../../node_modules/@bokuweb/zstd-wasm/dist/web/index.web.js')
let brotliPromise: Promise<BrotliModule> | undefined
let zstdPromise: Promise<ZstdModule> | undefined

export async function loadBrotli(): Promise<BrotliModule> {
  brotliPromise ??= (async () => {
    const [brotli, { default: wasmUrl }] = await Promise.all([
      import('../../node_modules/brotli-wasm/pkg.web/brotli_wasm.js'),
      import('../../node_modules/brotli-wasm/pkg.web/brotli_wasm_bg.wasm?url'),
    ])
    await brotli.default(wasmUrl)
    return brotli
  })().catch((error) => { brotliPromise = undefined; throw error })
  return brotliPromise
}

export async function loadZstd(): Promise<ZstdModule> {
  zstdPromise ??= (async () => {
    const [zstd, { default: wasmUrl }] = await Promise.all([
      import('../../node_modules/@bokuweb/zstd-wasm/dist/web/index.web.js'),
      import('../../node_modules/@bokuweb/zstd-wasm/dist/web/zstd.wasm?url'),
    ])
    await zstd.init(wasmUrl)
    return zstd
  })().catch((error) => { zstdPromise = undefined; throw error })
  return zstdPromise
}

function validateUnicode(text: string): void {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('文本包含无效的 Unicode 字符')
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('文本包含无效的 Unicode 字符')
    }
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

function checksum(bytes: Uint8Array): string {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

function assertSize(actual: number, expected: number): void {
  if (actual > expected || actual > MAX_TEXT_BYTES) throw new Error('解压大小超出限制或与记录不符')
}

function createResult(text: string, originalText: string, compressedText: string,
  algorithm: CompressionAlgorithm, encoding: TextEncoding): CompressionResult {
  const original = getTextMetrics(originalText)
  const compressed = getTextMetrics(compressedText)
  return {
    text, algorithm, encoding, original, compressed,
    characterRatio: original.characters ? compressed.characters / original.characters : null,
    byteRatio: original.utf8Bytes ? compressed.utf8Bytes / original.utf8Bytes : null,
  }
}

async function runLzma(action: 1 | 2, bytes: Uint8Array, timeoutMs = 120_000): Promise<Uint8Array> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 32 * 60_000) throw new Error('LZMA 超时设置无效')
  // The upstream LZMA file installs a global onmessage handler. Keep it in its
  // own classic worker so that it cannot replace this tool's worker protocol.
  const { default: workerUrl } = await import('lzma/src/lzma_worker.js?url')
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl)
    const finish = (error?: Error, result?: Uint8Array) => {
      clearTimeout(timeout)
      worker.terminate()
      if (error) reject(error)
      else resolve(result!)
    }
    const timeout = setTimeout(() => finish(new Error('LZMA 处理超时，请缩短文本或降低并发后重试')), timeoutMs)
    worker.onerror = () => finish(new Error('LZMA 加载或运行失败'))
    worker.onmessage = ({ data }) => {
      if (data?.action !== action || data.cbn !== 1) return
      if (data.error) { finish(new Error('LZMA 处理失败，数据可能损坏')); return }
      // LZMA-JS returns a JS string for its supported UTF-8 subset, and a signed
      // byte array otherwise. We always compress UTF-8 bytes rather than its
      // legacy string encoding to preserve NUL, emoji and BOM exactly.
      if (typeof data.result === 'string') finish(undefined, encoder.encode(data.result))
      else if (Array.isArray(data.result) || data.result instanceof Uint8Array) {
        finish(undefined, Uint8Array.from(data.result))
      } else finish(new Error(CORRUPTED))
    }
    worker.postMessage({ action, cbn: 1, data: bytes, mode: 9 })
  })
}

async function compressBytes(input: Uint8Array, text: string, algorithm: CompressionAlgorithm, lzmaTimeoutMs?: number): Promise<Uint8Array> {
  switch (algorithm) {
    case 'brotli': return (await loadBrotli()).compress(input, { quality: 11 })
    case 'zstd': return (await loadZstd()).compress(input, 19)
    case 'lzma': return runLzma(1, input, lzmaTimeoutMs)
    case 'deflate': return deflateSync(input, { level: 9 })
    case 'gzip': return gzipSync(input, { level: 9, mtime: 0 })
    case 'lz-string': return compressToUint8Array(text)
  }
}

/** Raw standard-format compression, shared with the binary file tool. */
export async function compressBinaryBytes(input: Uint8Array,
  algorithm: Exclude<CompressionAlgorithm, 'lz-string'>,
  options: { lzmaTimeoutMs?: number } = {}): Promise<Uint8Array> {
  return compressBytes(input, '', algorithm, options.lzmaTimeoutMs)
}

async function decompressBrotli(input: Uint8Array, expected: number): Promise<Uint8Array> {
  const brotli = await loadBrotli()
  const stream = new brotli.DecompressStream()
  const output = new Uint8Array(expected)
  let consumed = 0
  let written = 0
  try {
    while (true) {
      const result = stream.decompress(input.subarray(consumed), Math.min(65536, expected - written + 1))
      try {
        const chunk = result.buf
        assertSize(written + chunk.length, expected)
        output.set(chunk, written)
        written += chunk.length
        consumed += result.input_offset
        if (result.code === brotli.BrotliStreamResultCode.ResultSuccess) {
          if (consumed !== input.length || written !== expected) throw new Error(CORRUPTED)
          return output
        }
        if (result.code !== brotli.BrotliStreamResultCode.NeedsMoreOutput ||
          (!chunk.length && !result.input_offset)) throw new Error(CORRUPTED)
      } finally { result.free() }
    }
  } finally { stream.free() }
}

function decompressFlate(input: Uint8Array, expected: number, gzip: boolean): Uint8Array {
  const output = new Uint8Array(expected)
  let written = 0
  const ondata = (chunk: Uint8Array) => {
    assertSize(written + chunk.length, expected)
    output.set(chunk, written)
    written += chunk.length
  }
  const stream = gzip ? new Gunzip(ondata) : new Inflate(ondata)
  // A short compressed chunk bounds the maximum amount a single inflate call
  // can allocate before our output callback enforces the declared length.
  for (let offset = 0; offset < input.length; offset += 64) {
    stream.push(input.subarray(offset, offset + 64), offset + 64 >= input.length)
  }
  if (written !== expected) throw new Error(CORRUPTED)
  return output
}

function assertZstdFrameSize(input: Uint8Array, expected: number): void {
  if (input.length < 6 || input[0] !== 0x28 || input[1] !== 0xb5 || input[2] !== 0x2f || input[3] !== 0xfd) {
    throw new Error(CORRUPTED)
  }
  const descriptor = input[4]
  const singleSegment = (descriptor & 0x20) !== 0
  const flag = descriptor >>> 6
  const sizeLength = flag ? 1 << flag : singleSegment ? 1 : 0
  const dictionaryLength = [0, 1, 2, 4][descriptor & 3]
  const offset = 5 + (singleSegment ? 0 : 1) + dictionaryLength
  if ((descriptor & 0x18) || !sizeLength || offset + sizeLength > input.length) throw new Error(CORRUPTED)
  let size = 0
  for (let index = 0; index < sizeLength; index++) size += input[offset + index] * 2 ** (8 * index)
  if (sizeLength === 2) size += 256
  if (size !== expected) throw new Error('Zstandard 解压大小与记录不符')
}

function assertLzmaFrameSize(input: Uint8Array, expected: number): void {
  if (input.length < 13 || input[0] !== 0x5d) throw new Error(CORRUPTED)
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const dictionarySize = view.getUint32(1, true)
  const size = view.getUint32(5, true) + view.getUint32(9, true) * 2 ** 32
  if (dictionarySize > 32 * 1024 * 1024 || size !== expected) throw new Error('LZMA 解压大小与记录不符')
}

/** LZ-String bitstream decoder with an output limit, compatible with v1.x.
 * Algorithm adapted from lz-string, Copyright (c) 2013 Pieroxy.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * The upstream decoder has no output-size limit; enforce it during decoding.
 */
function decompressLzString(input: Uint8Array, expected: number): Uint8Array {
  if (!input.length || input.length % 2) throw new Error(CORRUPTED)
  let bitOffset = 0
  const read = (count: number) => {
    if (bitOffset + count > input.length * 8) throw new Error(CORRUPTED)
    let value = 0
    for (let index = 0; index < count; index++, bitOffset++) {
      value |= ((input[bitOffset >>> 3] >>> (7 - (bitOffset & 7))) & 1) << index
    }
    return value
  }
  const first = read(2)
  if (first === 2) return new Uint8Array()
  if (first > 1) throw new Error(CORRUPTED)
  let previous = String.fromCharCode(read(first === 0 ? 8 : 16))
  const dictionary: string[] = ['', '', '', previous]
  const chunks = [previous]
  let total = previous.length
  assertSize(total, expected)
  let width = 3
  let enlargeIn = 4
  while (true) {
    let code = read(width)
    if (code === 2) break
    if (code < 2) {
      dictionary.push(String.fromCharCode(read(code === 0 ? 8 : 16)))
      code = dictionary.length - 1
      enlargeIn--
    }
    if (!enlargeIn) { enlargeIn = 2 ** width; width++ }
    const entry = dictionary[code] || (code === dictionary.length ? previous + previous[0] : '')
    if (!entry) throw new Error(CORRUPTED)
    total += entry.length
    assertSize(total, expected)
    chunks.push(entry)
    dictionary.push(previous + entry[0])
    previous = entry
    enlargeIn--
    if (!enlargeIn) { enlargeIn = 2 ** width; width++ }
  }
  const text = chunks.join('')
  validateUnicode(text)
  const output = encoder.encode(text)
  assertSize(output.length, expected)
  return output
}

async function decompressBytes(input: Uint8Array, expected: number, algorithm: CompressionAlgorithm): Promise<Uint8Array> {
  switch (algorithm) {
    case 'brotli': return decompressBrotli(input, expected)
    case 'zstd': {
      // zstd-wasm allocates from the frame's own size. Check that field before
      // calling it, rather than trusting an attacker-controlled allocation.
      assertZstdFrameSize(input, expected)
      return (await loadZstd()).decompress(input, { defaultHeapSize: Math.max(1, expected) })
    }
    case 'lzma': assertLzmaFrameSize(input, expected); return runLzma(2, input)
    case 'deflate': return decompressFlate(input, expected, false)
    case 'gzip': return decompressFlate(input, expected, true)
    case 'lz-string': return decompressLzString(input, expected)
  }
}

export async function compressText(input: string, algorithm: CompressionAlgorithm = DEFAULT_ALGORITHM,
  encoding: TextEncoding = DEFAULT_ENCODING): Promise<CompressionResult> {
  if (!ALGORITHM_OPTIONS.some((option) => option.value === algorithm)) throw new Error('不支持的压缩算法')
  if (!ENCODING_OPTIONS.some((option) => option.value === encoding)) throw new Error('不支持的文本编码')
  if (input.length > MAX_TEXT_BYTES) throw new Error('原文大小不能超过 8 MiB')
  validateUnicode(input)
  const original = encoder.encode(input)
  if (original.length > MAX_TEXT_BYTES) throw new Error('原文大小不能超过 8 MiB')
  const compressed = await compressBytes(original, input, algorithm)
  if (compressed.length > MAX_COMPRESSED_BYTES) throw new Error('压缩结果过大，请缩短文本后重试')
  const header = `BT1:${ALGORITHM_CODES[algorithm]}:${ENCODING_CODES[encoding]}:${original.length.toString(36)}:${checksum(original)}:${checksum(compressed)}:`
  const text = header + encodeBytes(compressed, encoding)
  return createResult(text, input, text, algorithm, encoding)
}

export async function decompressText(input: string): Promise<CompressionResult> {
  if (input.length > MAX_ENCODED_CHARACTERS) throw new Error('压缩文本过大，请缩短文本后重试')
  // Never trim: whitespace/BOM can be significant input, and the encoded body
  // must survive an exact copy. Match only the short, versioned header.
  const match = /^BT1:([a-z]):([a-z]):(0|[1-9a-z][0-9a-z]{0,7}):([0-9a-f]{8}):([0-9a-f]{8}):/.exec(input)
  if (!match) throw new Error('无法识别压缩文本，请粘贴包含 BT1: 前缀的完整结果')
  const algorithm = ALGORITHM_OPTIONS.find((option) => ALGORITHM_CODES[option.value] === match[1])?.value
  const encoding = ENCODING_OPTIONS.find((option) => ENCODING_CODES[option.value] === match[2])?.value
  if (!algorithm || !encoding) throw new Error('压缩算法或文本编码不受支持')
  const expected = Number.parseInt(match[3], 36)
  if (!Number.isSafeInteger(expected) || expected > MAX_TEXT_BYTES) throw new Error('解压大小不能超过 8 MiB')
  const payload = input.slice(match[0].length)
  let output: Uint8Array
  try {
    const compressed = decodeBytes(payload, encoding)
    if (!compressed.length || compressed.length > MAX_COMPRESSED_BYTES || checksum(compressed) !== match[5]) throw new Error(CORRUPTED)
    output = await decompressBytes(compressed, expected, algorithm)
    if (output.length !== expected || checksum(output) !== match[4]) throw new Error(CORRUPTED)
    const text = decoder.decode(output)
    validateUnicode(text)
    return createResult(text, text, input, algorithm, encoding)
  } catch (error) {
    if (error instanceof Error && /限制|大小|超时|加载|运行/.test(error.message)) throw error
    throw new Error(CORRUPTED)
  }
}
