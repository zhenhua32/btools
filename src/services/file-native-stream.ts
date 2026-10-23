import { Inflate, strFromU8 } from 'fflate'
import { Decompress as ZstdDecompress } from 'fzstd'
import xxhash from 'xxhash-wasm'
import { loadBrotli } from './text-compression'
import { FILE_ALGORITHM_OPTIONS, MAX_ARCHIVE_ENTRIES } from './file-compression-types'
import type { FileCompressionAlgorithm, FileCompressionResult, FileDecompressionAlgorithm } from './file-compression-types'
import { MAX_EXPANDED_BYTES, MAX_TEXT_ARCHIVE_BYTES } from './file-stream-types'
import type { FileOperationContext, ProcessedFile } from './file-stream-types'
import { cleanupOperationStorage, createOutputSink } from './file-output-storage'

const CORRUPTED = '压缩文件损坏、不完整，或格式不受支持'
const OUTPUT_LIMIT = '解压后的文件总大小不能超过 1 GiB'
const INPUT_CHUNK = 16 * 1024
const MAX_WINDOW = 64 * 1024 * 1024
const EXTENSIONS: Record<FileCompressionAlgorithm, string[]> = {
  brotli: ['.br'], zstd: ['.zst', '.zstd'], lzma: ['.lzma'], deflate: ['.deflate'], gzip: ['.gz', '.tgz'], zip: ['.zip'],
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})
function crcUpdate(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return crc
}
function u16(bytes: Uint8Array, offset: number): number { return bytes[offset] | bytes[offset + 1] << 8 }
function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0
}
function checkSize(size: number, limit = MAX_EXPANDED_BYTES): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > limit) throw new Error(OUTPUT_LIMIT)
}
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim()
  return base && base !== '.' && base !== '..' ? base : 'file.bin'
}
function restoredName(name: string, algorithm: FileCompressionAlgorithm): string {
  if (algorithm === 'gzip' && /\.tgz$/i.test(name)) return safeName(name.replace(/\.tgz$/i, '.tar'))
  const suffix = EXTENSIONS[algorithm].find((value) => name.toLowerCase().endsWith(value))
  return safeName(suffix ? name.slice(0, -suffix.length) : `${name}.unpacked`)
}
async function read(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(start) || start < 0 || start + length > blob.size) throw new Error(CORRUPTED)
  const bytes = new Uint8Array(await blob.slice(start, start + length).arrayBuffer())
  if (bytes.length !== length) throw new Error(CORRUPTED)
  return bytes
}
function report(context: FileOperationContext, completed: number, total: number): void {
  context.signal?.throwIfAborted()
  context.onProgress?.({ stage: '正在解压文件', completed, total })
  context.signal?.throwIfAborted()
}
function lzmaSize(header: Uint8Array): number | null {
  if (header.length < 18 || header[0] >= 225 || header[13] !== 0) throw new Error(CORRUPTED)
  if (u32(header, 1) > MAX_WINDOW) throw new Error('LZMA 字典大小不能超过 64 MiB')
  if (header.subarray(5, 13).every((byte) => byte === 255)) return null
  const size = u32(header, 5) + u32(header, 9) * 2 ** 32
  checkSize(size)
  return size
}
async function detect(file: File): Promise<FileCompressionAlgorithm> {
  const head = await read(file, 0, Math.min(file.size, 18))
  if (u32(head, 0) === 0x04034b50 || u32(head, 0) === 0x06054b50) return 'zip'
  if (head[0] === 31 && head[1] === 139) return 'gzip'
  const magic = u32(head, 0)
  if (magic === 0xfd2fb528 || (magic & 0xfffffff0) >>> 0 === 0x184d2a50) return 'zstd'
  for (const option of FILE_ALGORITHM_OPTIONS) {
    if (EXTENSIONS[option.value].some((extension) => file.name.toLowerCase().endsWith(extension))) return option.value
  }
  try { lzmaSize(head); return 'lzma' } catch { /* Raw formats need a suffix. */ }
  throw new Error('无法识别文件格式，请手动选择解压算法；Brotli 和 DEFLATE 需要对应的文件后缀')
}

type Write = (bytes: Uint8Array) => Promise<void>
type InflateState = { s: { f?: number; l?: unknown; p: number }; p: Uint8Array }

/** Public fflate callbacks provide output; state is inspected only to locate the
 * end of the raw stream before a gzip trailer, or to reject trailing ZIP data. */
async function inflateRange(blob: Blob, start: number, end: number, write: Write,
  context: FileOperationContext, remainder = false): Promise<number> {
  let chunks: Uint8Array[] = []
  const stream = new Inflate((chunk) => { if (chunk.length) chunks.push(chunk) })
  let position = start
  while (position < end) {
    const input = await read(blob, position, Math.min(INPUT_CHUNK, end - position))
    position += input.length
    stream.push(input, !remainder && position === end)
    const pending = chunks
    chunks = []
    for (const chunk of pending) await write(chunk)
    report(context, position, blob.size)
    const state = stream as unknown as InflateState
    if (state.s.f && !state.s.l) {
      const consumed = position - state.p.length + (state.s.p ? 1 : 0)
      if (!remainder && consumed !== end) throw new Error(CORRUPTED)
      return consumed
    }
  }
  throw new Error(CORRUPTED)
}

async function brotliFile(file: File, write: Write, context: FileOperationContext): Promise<void> {
  const brotli = await loadBrotli()
  const stream = new brotli.DecompressStream()
  let position = 0
  try {
    while (position < file.size) {
      const input = await read(file, position, Math.min(65536, file.size - position))
      let offset = 0
      while (true) {
        const result = stream.decompress(input.subarray(offset), 65536)
        let code: number
        try {
          offset += result.input_offset
          code = result.code
          if (result.buf.length) await write(result.buf.slice())
        } finally { result.free() }
        report(context, position + offset, file.size)
        if (code === brotli.BrotliStreamResultCode.ResultSuccess) {
          if (position + offset !== file.size) throw new Error(CORRUPTED)
          return
        }
        if (code === brotli.BrotliStreamResultCode.NeedsMoreInput) {
          if (offset !== input.length) throw new Error(CORRUPTED)
          break
        }
        if (code !== brotli.BrotliStreamResultCode.NeedsMoreOutput) throw new Error(CORRUPTED)
      }
      position += input.length
    }
    throw new Error(CORRUPTED)
  } finally { stream.free() }
}

async function gzipHeader(file: File, start: number): Promise<number> {
  const header = await read(file, start, 10)
  if (header[0] !== 31 || header[1] !== 139 || header[2] !== 8 || (header[3] & 0xe0)) throw new Error(CORRUPTED)
  let position = start + 10
  let crc = crcUpdate(0xffffffff, header)
  const advance = async (length: number) => {
    if (position - start + length > 1024 * 1024) throw new Error('Gzip 文件头不能超过 1 MiB')
    const bytes = await read(file, position, length)
    crc = crcUpdate(crc, bytes)
    position += length
    return bytes
  }
  if (header[3] & 4) { const bytes = await advance(2); await advance(u16(bytes, 0)) }
  for (const flag of [8, 16]) {
    if (!(header[3] & flag)) continue
    let found = false
    while (!found) {
      const bytes = await read(file, position, Math.min(4096, file.size - position))
      if (!bytes.length) throw new Error(CORRUPTED)
      const nul = bytes.indexOf(0)
      await advance(nul < 0 ? bytes.length : nul + 1)
      found = nul >= 0
    }
  }
  if (header[3] & 2) {
    if (u16(await read(file, position, 2), 0) !== ((crc ^ 0xffffffff) & 65535)) throw new Error('Gzip 文件头校验失败')
    position += 2
  }
  return position
}
async function gzipFile(file: File, write: Write, context: FileOperationContext): Promise<void> {
  let position = 0
  while (position < file.size) {
    const start = await gzipHeader(file, position)
    let crc = 0xffffffff
    let size = 0
    const end = await inflateRange(file, start, file.size, async (bytes) => {
      crc = crcUpdate(crc, bytes)
      size += bytes.length
      await write(bytes)
    }, context, true)
    const trailer = await read(file, end, 8)
    if (u32(trailer, 0) !== ((crc ^ 0xffffffff) >>> 0) || u32(trailer, 4) !== size) throw new Error('Gzip 校验失败，文件可能损坏')
    position = end + 8
  }
}

let hashPromise: ReturnType<typeof xxhash> | undefined
async function zstdFile(file: File, write: Write, context: FileOperationContext): Promise<void> {
  let position = 0
  let declaredTotal = 0
  while (position < file.size) {
    const magic = u32(await read(file, position, 4), 0)
    if ((magic & 0xfffffff0) >>> 0 === 0x184d2a50) {
      const length = u32(await read(file, position + 4, 4), 0)
      position += 8 + length
      if (position > file.size) throw new Error(CORRUPTED)
      continue
    }
    if (magic !== 0xfd2fb528) throw new Error(CORRUPTED)
    const descriptor = (await read(file, position + 4, 1))[0]
    if (descriptor & 0x18) throw new Error(CORRUPTED)
    const single = !!(descriptor & 0x20)
    const sizeBytes = descriptor >>> 6 ? 1 << (descriptor >>> 6) : single ? 1 : 0
    const dictBytes = [0, 1, 2, 4][descriptor & 3]
    const headerLength = 5 + (single ? 0 : 1) + dictBytes + sizeBytes
    const header = await read(file, position, headerLength)
    let offset = 5
    let window = 0
    if (!single) {
      const value = header[offset++]
      const base = 2 ** (10 + (value >>> 3))
      window = base + base / 8 * (value & 7)
    }
    if (header.subarray(offset, offset + dictBytes).some((byte) => byte)) throw new Error('不支持需要外部字典的 Zstandard 文件')
    offset += dictBytes
    let expected: number | null = sizeBytes ? 0 : null
    for (let index = 0; index < sizeBytes; index++) expected! += header[offset + index] * 2 ** (index * 8)
    if (sizeBytes === 2) expected! += 256
    if (expected !== null) { checkSize(expected); declaredTotal += expected; checkSize(declaredTotal) }
    if (single) window = expected!
    if (window > MAX_WINDOW) throw new Error('Zstandard 窗口大小不能超过 64 MiB')
    const hasher = descriptor & 4 ? (await (hashPromise ??= xxhash())).create64() : null
    let count = 0
    let pending: Uint8Array[] = []
    const decoder = new ZstdDecompress((bytes) => {
      count += bytes.length
      checkSize(count)
      if (bytes.length) { hasher?.update(bytes); pending.push(bytes.slice()) }
    })
    const push = async (bytes: Uint8Array, final: boolean) => {
      decoder.push(bytes, final)
      const chunks = pending
      pending = []
      for (const chunk of chunks) await write(chunk)
    }
    // A tiny RLE block can produce 128 KiB. Feed at most one block before
    // awaiting storage, rather than queueing an entire frame's output.
    let blockStart = position + headerLength
    let input = position
    let checksum: number | null = null
    while (true) {
      const block = await read(file, blockStart, 3)
      const value = block[0] | block[1] << 8 | block[2] << 16
      const kind = (value >>> 1) & 3
      const length = value >>> 3
      if (kind === 3 || length > 131072) throw new Error(CORRUPTED)
      const end = blockStart + 3 + (kind === 1 ? 1 : length)
      if (end > file.size) throw new Error(CORRUPTED)
      while (input < end) {
        const bytes = await read(file, input, Math.min(INPUT_CHUNK, end - input))
        input += bytes.length
        await push(bytes, !!(value & 1) && !hasher && input === end)
      }
      report(context, input, file.size)
      if (value & 1) {
        if (hasher) {
          const trailer = await read(file, input, 4)
          checksum = u32(trailer, 0)
          await push(trailer, true)
          input += 4
        }
        break
      }
      blockStart = end
    }
    if ((expected !== null && expected !== count) || (hasher && Number(hasher.digest() & 0xffffffffn) !== checksum)) throw new Error('Zstandard 校验失败，文件可能损坏')
    position = input
  }
}

async function lzmaFile(file: File, write: Write, context: FileOperationContext): Promise<void> {
  const expected = lzmaSize(await read(file, 0, 18))
  const { default: workerUrl } = await import('../../third_party/lzma/lzma-stream-decoder.js?url')
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(workerUrl)
    let timeout: ReturnType<typeof setTimeout>
    let stopped = false
    const finish = (error?: Error) => {
      if (stopped) return
      stopped = true
      clearTimeout(timeout)
      context.signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(new DOMException('已取消处理', 'AbortError'))
    const touch = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => finish(new Error('LZMA 处理超时')), 90000)
    }
    worker.onerror = () => finish(new Error('LZMA 加载或运行失败'))
    worker.onmessage = async ({ data }) => {
      if (stopped) return
      touch()
      try {
        if (data?.type === 'error') throw new Error(/不能|超过/.test(data.error) ? data.error : CORRUPTED)
        if (data?.type === 'done') {
          if (expected !== null && data.size !== expected) throw new Error(CORRUPTED)
          finish()
        } else if (data?.type === 'chunk') {
          if (!(data.bytes instanceof Uint8Array)) throw new Error(CORRUPTED)
          await write(data.bytes)
          report(context, data.consumed, file.size)
          if (!stopped) worker.postMessage({ type: 'ack' })
        } else if (data?.type === 'progress') report(context, data.consumed, file.size)
      } catch (error) { finish(error instanceof Error ? error : new Error(CORRUPTED)) }
    }
    touch()
    context.signal?.addEventListener('abort', abort, { once: true })
    if (context.signal?.aborted) { abort(); return }
    worker.postMessage({ type: 'start', file, limit: MAX_EXPANDED_BYTES })
  })
}

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '
function zipName(bytes: Uint8Array, flags: number, extra: Uint8Array): string {
  let name = flags & 0x800 ? strFromU8(bytes) : Array.from(bytes, (byte) => byte < 128 ? String.fromCharCode(byte) : CP437[byte - 128]).join('')
  for (let offset = 0; offset < extra.length;) {
    if (offset + 4 > extra.length) throw new Error(CORRUPTED)
    const id = u16(extra, offset)
    const length = u16(extra, offset + 2)
    offset += 4
    if (offset + length > extra.length) throw new Error(CORRUPTED)
    if (id === 0x7075 && length >= 5 && extra[offset] === 1 && u32(extra, offset + 1) === ((crcUpdate(0xffffffff, bytes) ^ 0xffffffff) >>> 0)) {
      name = strFromU8(extra.subarray(offset + 5, offset + length))
    }
    offset += length
  }
  return name
}
interface ZipEntry { name: string; offset: number; size: number; original: number; method: number; crc: number }
async function zipEntries(file: File): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, file.size - 65557)
  const tail = await read(file, tailStart, file.size - tailStart)
  let end = tail.length - 22
  while (end >= 0 && (u32(tail, end) !== 0x06054b50 || end + 22 + u16(tail, end + 20) !== tail.length)) end--
  if (end < 0) throw new Error(CORRUPTED)
  const count = u16(tail, end + 10)
  if (u16(tail, end + 4) || u16(tail, end + 6) || u16(tail, end + 8) !== count) throw new Error('不支持分卷 ZIP 文件')
  const start = u32(tail, end + 16)
  const centralEnd = start + u32(tail, end + 12)
  if (count === 65535 || start === 0xffffffff || u32(tail, end + 12) === 0xffffffff) throw new Error('不支持 ZIP64 文件')
  if (count > MAX_ARCHIVE_ENTRIES) throw new Error(`ZIP 条目数量不能超过 ${MAX_ARCHIVE_ENTRIES}`)
  if (centralEnd !== tailStart + end) throw new Error(CORRUPTED)
  const entries: ZipEntry[] = []
  const ranges: [number, number][] = []
  let position = start
  let total = 0
  for (let index = 0; index < count; index++) {
    const header = await read(file, position, 46)
    if (position + 46 > centralEnd || u32(header, 0) !== 0x02014b50) throw new Error(CORRUPTED)
    const flags = u16(header, 8), method = u16(header, 10), size = u32(header, 20), original = u32(header, 24)
    const nameLength = u16(header, 28), extraLength = u16(header, 30), local = u32(header, 42)
    const next = position + 46 + nameLength + extraLength + u16(header, 32)
    if (next > centralEnd || size === 0xffffffff || original === 0xffffffff || local === 0xffffffff || u16(header, 34)) throw new Error(CORRUPTED)
    if (flags & 0x41) throw new Error('不支持加密的 ZIP 文件，请先移除密码')
    if (method !== 0 && method !== 8) throw new Error('不支持此 ZIP 压缩方式，仅支持存储和 DEFLATE')
    const metadata = await read(file, position + 46, nameLength + extraLength)
    const name = zipName(metadata.subarray(0, nameLength), flags, metadata.subarray(nameLength))
    total += original
    checkSize(total)
    const localHeader = await read(file, local, 30)
    if (local + 30 > start || u32(localHeader, 0) !== 0x04034b50 || u16(localHeader, 6) !== flags || u16(localHeader, 8) !== method || u16(localHeader, 26) !== nameLength) throw new Error(CORRUPTED)
    const localName = await read(file, local + 30, nameLength)
    if (!localName.every((byte, offset) => byte === metadata[offset])) throw new Error(CORRUPTED)
    const offset = local + 30 + nameLength + u16(localHeader, 28)
    if (offset + size > start || (method === 0 && size !== original)) throw new Error(CORRUPTED)
    ranges.push([local, offset + size])
    entries.push({ name, offset, size, original, method, crc: u32(header, 16) })
    position = next
  }
  if (position !== centralEnd) throw new Error(CORRUPTED)
  ranges.sort((a, b) => a[0] - b[0])
  for (let index = 1; index < ranges.length; index++) if (ranges[index][0] < ranges[index - 1][1]) throw new Error(CORRUPTED)
  return entries
}

/** Decode native archives with bounded codec inputs and disk-backed outputs. */
export async function decompressNativeFile(file: File, algorithm: FileDecompressionAlgorithm,
  context: FileOperationContext): Promise<FileCompressionResult> {
  context.signal?.throwIfAborted()
  if (!file.size) throw new Error(CORRUPTED)
  if (file.size > MAX_TEXT_ARCHIVE_BYTES) throw new Error('上传的压缩文件不能超过 3 GiB')
  const selected = algorithm === 'auto' ? await detect(file) : algorithm
  if (!FILE_ALGORITHM_OPTIONS.some((option) => option.value === selected)) throw new Error('不支持的解压算法')
  const outputs: ProcessedFile[] = []
  let total = 0
  try {
    const entries: ZipEntry[] = selected === 'zip' ? await zipEntries(file) : [{
      name: restoredName(file.name, selected), offset: 0, size: file.size, original: -1, method: -1, crc: 0,
    }]
    for (const entry of entries) {
      const directory = /[\\/]$/.test(entry.name)
      const sink = directory ? null : await createOutputSink(context, safeName(entry.name), 'application/octet-stream')
      let size = 0
      let crc = 0xffffffff
      const write: Write = async (bytes) => {
        context.signal?.throwIfAborted()
        checkSize(total + bytes.length)
        if (entry.original >= 0 && size + bytes.length > entry.original) throw new Error(CORRUPTED)
        crc = selected === 'zip' ? crcUpdate(crc, bytes) : crc
        size += bytes.length
        total += bytes.length
        if (directory && bytes.length) throw new Error(CORRUPTED)
        await sink?.write(bytes)
      }
      try {
        if (selected === 'brotli') await brotliFile(file, write, context)
        else if (selected === 'gzip') await gzipFile(file, write, context)
        else if (selected === 'deflate') await inflateRange(file, 0, file.size, write, context)
        else if (selected === 'zstd') await zstdFile(file, write, context)
        else if (selected === 'lzma') await lzmaFile(file, write, context)
        else if (entry.method === 8) await inflateRange(file, entry.offset, entry.offset + entry.size, write, context)
        else for (let offset = entry.offset; offset < entry.offset + entry.size;) {
          const bytes = await read(file, offset, Math.min(65536, entry.offset + entry.size - offset))
          offset += bytes.length
          await write(bytes)
          report(context, offset, file.size)
        }
        if (selected === 'zip' && (size !== entry.original || ((crc ^ 0xffffffff) >>> 0) !== entry.crc)) throw new Error('ZIP 校验失败，文件可能损坏')
        if (sink) outputs.push(await sink.finish())
      } catch (error) { await sink?.abort(); throw error }
    }
    report(context, file.size, file.size)
    return { algorithm: selected, files: [], outputs, originalBytes: total, compressedBytes: file.size, byteRatio: total ? file.size / total : null }
  } catch (error) {
    await cleanupOperationStorage(context.operationId)
    context.signal?.throwIfAborted()
    if (error instanceof Error && /不能|超过|不支持|超时|加载|运行|校验|空间|存储/.test(error.message)) throw error
    throw new Error(CORRUPTED)
  }
}
