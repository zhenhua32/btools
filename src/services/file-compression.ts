import { Gunzip, Inflate, strFromU8, zipSync } from 'fflate'
import { compressBinaryBytes, loadBrotli, loadZstd } from './text-compression'
import {
  DEFAULT_FILE_ALGORITHM, FILE_ALGORITHM_OPTIONS, MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRIES,
  MAX_FILE_BYTES, MAX_TOTAL_FILE_BYTES,
} from './file-compression-types'
import type {
  CompressionFile, FileCompressionAlgorithm, FileCompressionResult, FileDecompressionAlgorithm,
} from './file-compression-types'

const CORRUPTED = '压缩文件损坏、不完整，或格式不受支持'
const OUTPUT_LIMIT = '解压后的文件总大小不能超过 8 MiB'
const EXTENSIONS: Record<FileCompressionAlgorithm, string> = {
  brotli: '.br', zstd: '.zst', lzma: '.lzma', deflate: '.deflate', gzip: '.gz', zip: '.zip',
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

function updateCrc(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return crc
}
function crc32(bytes: Uint8Array): number { return (updateCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0 }
function read16(bytes: Uint8Array, offset: number): number { return bytes[offset] | bytes[offset + 1] << 8 }
function read32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0
}
function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}
function assertOutputSize(size: number, limit = MAX_TOTAL_FILE_BYTES): void {
  if (size > limit) throw new Error(OUTPUT_LIMIT)
}

/** Downloads never use archive paths, drive letters or control characters. */
function safeName(name: string, fallback = 'file.bin'): string {
  const basename = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim()
  return basename && basename !== '.' && basename !== '..' ? basename : fallback
}
function restoredName(name: string, algorithm: FileCompressionAlgorithm): string {
  if (algorithm === 'gzip' && /\.tgz$/i.test(name)) return safeName(name.replace(/\.tgz$/i, '.tar'))
  const suffixes = algorithm === 'zstd' ? ['.zstd', '.zst'] : [EXTENSIONS[algorithm]]
  const suffix = suffixes.find((value) => name.toLowerCase().endsWith(value))
  return safeName(suffix ? name.slice(0, -suffix.length) : `${name}.unpacked`)
}
function concatenate(chunks: Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}
function createResult(algorithm: FileCompressionAlgorithm, files: CompressionFile[],
  originalBytes: number, compressedBytes: number): FileCompressionResult {
  return { algorithm, files, originalBytes, compressedBytes, byteRatio: originalBytes ? compressedBytes / originalBytes : null }
}

function lzmaHeaderSize(bytes: Uint8Array): number | null {
  if (bytes.length < 18 || bytes[0] >= 225 || bytes[13] !== 0) throw new Error(CORRUPTED)
  if (read32(bytes, 1) > 32 * 1024 * 1024) throw new Error('LZMA 字典大小不能超过 32 MiB')
  if (bytes.subarray(5, 13).every((byte) => byte === 255)) return null
  const size = read32(bytes, 5) + read32(bytes, 9) * 2 ** 32
  if (!Number.isSafeInteger(size)) throw new Error(OUTPUT_LIMIT)
  assertOutputSize(size)
  return size
}

function detectAlgorithm(input: CompressionFile): FileCompressionAlgorithm {
  const bytes = input.bytes
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return 'zip'
  if (startsWith(bytes, [0x1f, 0x8b])) return 'gzip'
  if (startsWith(bytes, [0x28, 0xb5, 0x2f, 0xfd])) return 'zstd'
  const lowerName = input.name.toLowerCase()
  for (const option of FILE_ALGORITHM_OPTIONS) {
    if (lowerName.endsWith(EXTENSIONS[option.value])) return option.value
  }
  if (lowerName.endsWith('.zstd')) return 'zstd'
  if (lowerName.endsWith('.tgz')) return 'gzip'
  // LZMA-Alone has no magic number. A complete, plausible header can identify
  // it; raw Brotli and raw DEFLATE require a suffix or a manual selection.
  try { lzmaHeaderSize(bytes); return 'lzma' } catch { /* Try no other raw codecs. */ }
  throw new Error('无法识别文件格式，请手动选择解压算法；Brotli 和 DEFLATE 需要对应的文件后缀')
}

async function decompressBrotli(bytes: Uint8Array): Promise<Uint8Array> {
  const brotli = await loadBrotli()
  const stream = new brotli.DecompressStream()
  const chunks: Uint8Array[] = []
  let consumed = 0
  let written = 0
  try {
    while (true) {
      const result = stream.decompress(bytes.subarray(consumed), Math.min(65536, MAX_FILE_BYTES - written + 1))
      try {
        const chunk = result.buf
        assertOutputSize(written + chunk.length)
        chunks.push(chunk.slice())
        written += chunk.length
        consumed += result.input_offset
        if (result.code === brotli.BrotliStreamResultCode.ResultSuccess) {
          if (consumed !== bytes.length) throw new Error(CORRUPTED)
          return concatenate(chunks, written)
        }
        if (result.code !== brotli.BrotliStreamResultCode.NeedsMoreOutput ||
          (!chunk.length && !result.input_offset)) throw new Error(CORRUPTED)
      } finally { result.free() }
    }
  } finally { stream.free() }
}

function decompressFlate(bytes: Uint8Array, gzip = false, limit = MAX_FILE_BYTES): Uint8Array {
  const chunks: Uint8Array[] = []
  let written = 0
  let memberSize = 0
  let memberCrc = 0xffffffff
  const stream = gzip ? new Gunzip(ondata) : new Inflate(ondata)
  function ondata(chunk: Uint8Array) {
    assertOutputSize(written + chunk.length, limit)
    chunks.push(chunk)
    written += chunk.length
    memberSize += chunk.length
    if (gzip) memberCrc = updateCrc(memberCrc, chunk)
  }
  const validateTrailer = (end: number) => {
    if (end < 18 || read32(bytes, end - 8) !== ((memberCrc ^ 0xffffffff) >>> 0) ||
      read32(bytes, end - 4) !== memberSize) throw new Error('Gzip 校验失败，文件可能损坏')
    memberSize = 0
    memberCrc = 0xffffffff
  }
  if (gzip) {
    if (bytes.length < 18 || !startsWith(bytes, [0x1f, 0x8b, 8]) || (bytes[3] & 0xe0)) throw new Error(CORRUPTED)
    ;(stream as Gunzip).onmember = validateTrailer
  }
  // Bound each inflate call's temporary output before the callback enforces
  // our aggregate limit, even for files whose headers have forged sizes.
  for (let offset = 0; offset < bytes.length; offset += 64) {
    stream.push(bytes.subarray(offset, offset + 64), offset + 64 >= bytes.length)
  }
  if (gzip) validateTrailer(bytes.length)
  return concatenate(chunks, written)
}

function zstdFrameSize(bytes: Uint8Array): number | null {
  if (bytes.length < 6 || !startsWith(bytes, [0x28, 0xb5, 0x2f, 0xfd])) throw new Error(CORRUPTED)
  const descriptor = bytes[4]
  if (descriptor & 0x18) throw new Error(CORRUPTED)
  const singleSegment = !!(descriptor & 0x20)
  const flag = descriptor >>> 6
  const sizeLength = flag ? 1 << flag : singleSegment ? 1 : 0
  const dictionaryLength = [0, 1, 2, 4][descriptor & 3]
  let offset = 5
  if (!singleSegment) {
    const window = bytes[offset++]
    const base = 2 ** (10 + (window >>> 3))
    if (base + base / 8 * (window & 7) > 32 * 1024 * 1024) throw new Error('Zstandard 窗口大小不能超过 32 MiB')
  }
  if (offset + dictionaryLength + sizeLength > bytes.length) throw new Error(CORRUPTED)
  if (bytes.subarray(offset, offset + dictionaryLength).some((byte) => byte !== 0)) throw new Error('不支持需要外部字典的 Zstandard 文件')
  offset += dictionaryLength
  let size: number | null = sizeLength ? 0 : null
  for (let index = 0; index < sizeLength; index++) size! += bytes[offset + index] * 2 ** (8 * index)
  if (sizeLength === 2) size! += 256
  if (size !== null) assertOutputSize(size)
  offset += sizeLength
  // Only one ordinary frame is accepted. Checking block boundaries also stops
  // hidden concatenated frames from requesting unchecked decoder resources.
  while (true) {
    if (offset + 3 > bytes.length) throw new Error(CORRUPTED)
    const header = bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16
    const kind = (header >>> 1) & 3
    if (kind === 3) throw new Error(CORRUPTED)
    offset += 3 + (kind === 1 ? 1 : header >>> 3)
    if (offset > bytes.length) throw new Error(CORRUPTED)
    if (header & 1) break
  }
  if (descriptor & 4) offset += 4
  if (offset !== bytes.length) throw new Error('Zstandard 文件损坏或包含不支持的多帧数据')
  return size
}

async function decompressLzma(bytes: Uint8Array): Promise<Uint8Array> {
  const expected = lzmaHeaderSize(bytes)
  // The upstream decoder treats a zero length as unknown. The canonical empty
  // known-length stream may omit EOS and contains only five zero coder bytes.
  if (expected === 0 && bytes.length === 18 && bytes.subarray(13).every((byte) => byte === 0)) return new Uint8Array()
  const { default: workerUrl } = await import('../../third_party/lzma/lzma-file-decoder.js?url')
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl)
    const finish = (error?: Error, result?: Uint8Array) => {
      clearTimeout(timeout)
      worker.terminate()
      if (error) reject(error)
      else resolve(result!)
    }
    const timeout = setTimeout(() => finish(new Error('LZMA 处理超时，请使用更小的文件')), 120000)
    worker.onerror = () => finish(new Error('LZMA 加载或运行失败'))
    worker.onmessage = ({ data }) => {
      if (data?.action !== 2 || data.cbn !== 1) return
      if (data.error) {
        finish(new Error(/8 MiB/.test(String(data.error)) ? OUTPUT_LIMIT : CORRUPTED))
        return
      }
      if (!Array.isArray(data.result) && !(data.result instanceof Uint8Array)) { finish(new Error(CORRUPTED)); return }
      const result = Uint8Array.from(data.result)
      if (result.length > MAX_FILE_BYTES) finish(new Error(OUTPUT_LIMIT))
      else if (expected !== null && result.length !== expected) finish(new Error(CORRUPTED))
      else finish(undefined, result)
    }
    worker.postMessage({ action: 2, cbn: 1, data: bytes })
  })
}

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '
function zipName(bytes: Uint8Array, flags: number, extra: Uint8Array): string {
  let name = flags & 0x800 ? strFromU8(bytes) : Array.from(bytes, (byte) => byte < 128 ? String.fromCharCode(byte) : CP437[byte - 128]).join('')
  for (let offset = 0; offset + 4 <= extra.length;) {
    const id = read16(extra, offset)
    const length = read16(extra, offset + 2)
    offset += 4
    if (offset + length > extra.length) throw new Error(CORRUPTED)
    if (id === 0x7075 && length >= 5 && extra[offset] === 1 && read32(extra, offset + 1) === crc32(bytes)) {
      name = strFromU8(extra.subarray(offset + 5, offset + length))
    }
    offset += length
  }
  return name
}

function decompressZip(bytes: Uint8Array): CompressionFile[] {
  let end = bytes.length - 22
  const minimum = Math.max(0, bytes.length - 65557)
  while (end >= minimum && (read32(bytes, end) !== 0x06054b50 || end + 22 + read16(bytes, end + 20) !== bytes.length)) end--
  if (end < minimum) throw new Error(CORRUPTED)
  const count = read16(bytes, end + 10)
  if (read16(bytes, end + 4) || read16(bytes, end + 6) || read16(bytes, end + 8) !== count) throw new Error('不支持分卷 ZIP 文件')
  if (count === 0xffff || read32(bytes, end + 12) === 0xffffffff || read32(bytes, end + 16) === 0xffffffff) throw new Error('不支持 ZIP64 文件')
  if (count > MAX_ARCHIVE_ENTRIES) throw new Error(`ZIP 条目数量不能超过 ${MAX_ARCHIVE_ENTRIES}`)
  const centralStart = read32(bytes, end + 16)
  const centralEnd = centralStart + read32(bytes, end + 12)
  if (centralEnd !== end) throw new Error(CORRUPTED)
  const entries: { name: string; offset: number; size: number; original: number; method: number; crc: number }[] = []
  let position = centralStart
  let total = 0
  for (let index = 0; index < count; index++) {
    if (position + 46 > centralEnd || read32(bytes, position) !== 0x02014b50) throw new Error(CORRUPTED)
    const flags = read16(bytes, position + 8)
    const method = read16(bytes, position + 10)
    const size = read32(bytes, position + 20)
    const original = read32(bytes, position + 24)
    const nameLength = read16(bytes, position + 28)
    const extraLength = read16(bytes, position + 30)
    const local = read32(bytes, position + 42)
    const next = position + 46 + nameLength + extraLength + read16(bytes, position + 32)
    if (next > centralEnd || size === 0xffffffff || original === 0xffffffff || local === 0xffffffff || read16(bytes, position + 34)) throw new Error(CORRUPTED)
    if (flags & 0x41) throw new Error('不支持加密的 ZIP 文件，请先移除密码')
    if (method !== 0 && method !== 8) throw new Error('不支持此 ZIP 压缩方式，仅支持存储和 DEFLATE')
    const name = zipName(bytes.subarray(position + 46, position + 46 + nameLength), flags,
      bytes.subarray(position + 46 + nameLength, position + 46 + nameLength + extraLength))
    assertOutputSize(original)
    total += original
    assertOutputSize(total)
    if (local + 30 > centralStart || read32(bytes, local) !== 0x04034b50 ||
      read16(bytes, local + 6) !== flags || read16(bytes, local + 8) !== method) throw new Error(CORRUPTED)
    const offset = local + 30 + read16(bytes, local + 26) + read16(bytes, local + 28)
    if (offset + size > centralStart || (method === 0 && size !== original)) throw new Error(CORRUPTED)
    entries.push({ name, offset, size, original, method, crc: read32(bytes, position + 16) })
    position = next
  }
  if (position !== centralEnd) throw new Error(CORRUPTED)
  const files: CompressionFile[] = []
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.offset, entry.offset + entry.size)
    const output = entry.method === 0 ? compressed.slice() : decompressFlate(compressed, false, entry.original)
    if (output.length !== entry.original || crc32(output) !== entry.crc) throw new Error('ZIP 校验失败，文件可能损坏')
    if (!/[\\/]$/.test(entry.name)) files.push({ name: safeName(entry.name), bytes: output, type: 'application/octet-stream' })
  }
  return files
}

export async function compressFile(input: CompressionFile,
  algorithm: FileCompressionAlgorithm = DEFAULT_FILE_ALGORITHM): Promise<FileCompressionResult> {
  if (!FILE_ALGORITHM_OPTIONS.some((option) => option.value === algorithm)) throw new Error('不支持的压缩算法')
  if (input.bytes.length > MAX_FILE_BYTES) throw new Error('上传的原始文件不能超过 8 MiB')
  const name = safeName(input.name)
  // fflate's internal ZIP map is a normal object; avoid its __proto__ setter
  // while retaining the original basename when the archive is extracted.
  const entryName = name === '__proto__' ? './__proto__' : name
  const bytes = algorithm === 'zip'
    ? zipSync({ [entryName]: input.bytes }, { level: 9, mtime: new Date(2020, 0, 1) })
    : await compressBinaryBytes(input.bytes, algorithm)
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('压缩文件不能超过 16 MiB')
  return createResult(algorithm, [{ name: name + EXTENSIONS[algorithm], bytes: bytes.slice(),
    type: algorithm === 'zip' ? 'application/zip' : algorithm === 'gzip' ? 'application/gzip' : 'application/octet-stream' }], input.bytes.length, bytes.length)
}

export async function decompressFile(input: CompressionFile,
  algorithm: FileDecompressionAlgorithm = 'auto'): Promise<FileCompressionResult> {
  if (input.bytes.length > MAX_ARCHIVE_BYTES) throw new Error('上传的压缩文件不能超过 16 MiB')
  if (!input.bytes.length) throw new Error(CORRUPTED)
  const selected = algorithm === 'auto' ? detectAlgorithm(input) : algorithm
  if (!FILE_ALGORITHM_OPTIONS.some((option) => option.value === selected)) throw new Error('不支持的解压算法')
  try {
    let files: CompressionFile[]
    if (selected === 'zip') files = decompressZip(input.bytes)
    else {
      let bytes: Uint8Array
      switch (selected) {
        case 'brotli': bytes = await decompressBrotli(input.bytes); break
        case 'zstd': {
          const expected = zstdFrameSize(input.bytes)
          bytes = (await loadZstd()).decompress(input.bytes, { defaultHeapSize: MAX_FILE_BYTES })
          if (expected !== null && bytes.length !== expected) throw new Error(CORRUPTED)
          break
        }
        case 'lzma': bytes = await decompressLzma(input.bytes); break
        case 'deflate': bytes = decompressFlate(input.bytes); break
        case 'gzip': bytes = decompressFlate(input.bytes, true); break
      }
      assertOutputSize(bytes.length)
      files = [{ name: restoredName(safeName(input.name), selected), bytes: bytes.slice(), type: 'application/octet-stream' }]
    }
    return createResult(selected, files, files.reduce((size, file) => size + file.bytes.length, 0), input.bytes.length)
  } catch (error) {
    if (error instanceof Error && /不能|超过|不支持|超时|加载|运行|校验/.test(error.message)) throw error
    throw new Error(CORRUPTED)
  }
}
