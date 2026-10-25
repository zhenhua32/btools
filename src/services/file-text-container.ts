import { decompressFile } from './file-compression'
import { characters, checksum, crcHex, updateCrc } from './file-compression-chunk'
import { combineCrc32 } from './file-compression-crc'
import { checkCompressionAbort, FileCompressionPool } from './file-compression-pool'
import { orderedCompressionChunks } from './file-compression-scheduler'
import { FILE_ALGORITHM_OPTIONS, MAX_ARCHIVE_BYTES } from './file-compression-types'
import type { FileCompressionAlgorithm, FileCompressionResult } from './file-compression-types'
import { createOutputSink } from './file-output-storage'
import {
  DEFAULT_FILE_CONCURRENCY, FILE_CHUNK_BYTES, MAX_EXPANDED_BYTES, MAX_TEXT_ARCHIVE_BYTES, MAX_UPLOAD_BYTES, validateFileConcurrency,
} from './file-stream-types'
import type { FileOperationContext, TextPart } from './file-stream-types'
import { ENCODING_OPTIONS } from './text-compression-types'
import type { TextEncoding } from './text-compression-types'
import { decodeBytes, encodeBytes } from './text-encodings'

const encoder = new TextEncoder()
const CORRUPTED = '文件压缩文本损坏、不完整，或校验失败'
const MAX_RECORD_BYTES = MAX_ARCHIVE_BYTES * 3 + 16384
function integer(text: string, maximum: number): number {
  if (!/^(0|[1-9a-z][0-9a-z]{0,7})$/.test(text)) throw new Error(CORRUPTED)
  const value = Number.parseInt(text, 36)
  if (!Number.isSafeInteger(value) || value > maximum) throw new Error(CORRUPTED)
  return value
}
function safeName(value: string): string {
  const name = value.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim()
  return name && name !== '.' && name !== '..' ? name : 'file.bin'
}
function validateChoices(algorithm: string, encoding: string): void {
  if (!FILE_ALGORITHM_OPTIONS.some((option) => option.value === algorithm) ||
    !ENCODING_OPTIONS.some((option) => option.value === encoding)) throw new Error('压缩算法或文本编码不受支持')
}

/** ASCII magic is checked independently of filename; no full-file text read. */
export async function isTextContainer(file: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  return bytes.length === 5 && bytes[0] === 66 && bytes[1] === 84 && bytes[2] === 70 && bytes[3] === 50 && bytes[4] === 58
}

/** A line is bounded to one compressed block, including UTF-8 sequences split across stream reads. */
async function* lines(file: Blob): AsyncGenerator<string> {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let segments: string[] = []
  let buffered = 0
  let first = true
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      let start = 0
      for (let index = 0; index < value.length; index++) {
        if (value[index] !== 10) continue
        buffered += index - start
        if (buffered > (first ? 16384 : MAX_RECORD_BYTES)) throw new Error(CORRUPTED)
        segments.push(decoder.decode(value.subarray(start, index)))
        const line = segments.join('')
        yield line.endsWith('\r') ? line.slice(0, -1) : line
        first = false
        segments = []
        buffered = 0
        start = index + 1
      }
      buffered += value.length - start
      if (buffered > (first ? 16384 : MAX_RECORD_BYTES)) throw new Error(CORRUPTED)
      segments.push(decoder.decode(value.subarray(start), { stream: true }))
    }
    segments.push(decoder.decode())
    if (buffered || segments.some(Boolean)) {
      const line = segments.join('')
      yield line.endsWith('\r') ? line.slice(0, -1) : line
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** BTF2 stores native compressed blocks as canonical, copyable text records. */
export async function compressFileToText(file: Blob & { name?: string },
  algorithm: FileCompressionAlgorithm, encoding: TextEncoding,
  context: FileOperationContext): Promise<FileCompressionResult> {
  checkCompressionAbort(context.signal)
  validateChoices(algorithm, encoding)
  const concurrency = context.concurrency ?? DEFAULT_FILE_CONCURRENCY
  validateFileConcurrency(concurrency)
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('上传的原始文件不能超过 1 GiB')
  const name = safeName(file.name ?? 'file.bin')
  const type = file.type || 'application/octet-stream'
  if (name.length > 1024 || type.length > 255 || /[\u0000-\u001f\u007f]/.test(type)) throw new Error('文件名或类型过长或无效')
  const count = Math.ceil(file.size / FILE_CHUNK_BYTES)
  const metadata = encodeBytes(encoder.encode(JSON.stringify([name, type])), 'base64url')
  const headerBody = `BTF2:${algorithm}:${encoding}:${file.size.toString(36)}:${count.toString(36)}:${metadata}`
  const header = `${headerBody}:${checksum(encoder.encode(headerBody))}\n`
  const sink = await createOutputSink(context, `${name}.btf.txt`, 'text/plain;charset=utf-8')
  const parts: TextPart[] = []
  let textCharacters = characters(header)
  let crc = 0xffffffff
  let pool: FileCompressionPool | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let completed = 0
  try {
    checkCompressionAbort(context.signal)
    if (count) pool = new FileCompressionPool(Math.min(count, concurrency), context.signal)
    // LZMA-JS blocks can take minutes. Report real completed bytes while waiting so the
    // operation's inactivity watchdog does not confuse active CPU work with a dead worker.
    if (count && algorithm === 'lzma') heartbeat = setInterval(() => {
      if (!context.signal?.aborted) context.onProgress?.({ stage: '正在压缩并编码', completed, total: file.size })
    }, 10000)
    await sink.write(encoder.encode(header))
    const readChunk = async (index: number) => {
      checkCompressionAbort(context.signal)
      const offset = index * FILE_CHUNK_BYTES
      const bytes = new Uint8Array(await file.slice(offset, Math.min(offset + FILE_CHUNK_BYTES, file.size)).arrayBuffer())
      checkCompressionAbort(context.signal)
      if (bytes.length !== Math.min(FILE_CHUNK_BYTES, file.size - offset)) throw new Error('文件读取不完整')
      return { index, bytes, algorithm, encoding,
        lzmaTimeoutMs: algorithm === 'lzma' ? 120000 * concurrency : undefined }
    }
    for await (const result of orderedCompressionChunks({ count, concurrency, signal: context.signal,
      read: readChunk, run: (request) => pool!.run(request), terminate: (error) => pool?.terminate(error) })) {
      checkCompressionAbort(context.signal)
      const { index, bytes: recordBytes, characters: recordCharacters, sourceCrc, sourceBytes } = result
      // Workers already scan their own input once for C records. Combining those
      // finalized CRC32 values retains the exact footer without a serial re-scan.
      crc = combineCrc32((crc ^ 0xffffffff) >>> 0, sourceCrc, sourceBytes) ^ 0xffffffff
      const start = index ? sink.size : 0
      await sink.write(recordBytes)
      checkCompressionAbort(context.signal)
      if (sink.size > MAX_TEXT_ARCHIVE_BYTES) throw new Error('压缩后的文本文件超过大小限制')
      parts.push({ offset: start, size: sink.size - start, characters: recordCharacters + (index ? 0 : characters(header)) })
      textCharacters += recordCharacters
      completed = Math.min((index + 1) * FILE_CHUNK_BYTES, file.size)
      context.onProgress?.({ stage: '正在压缩并编码', completed, total: file.size })
    }
    const footer = `E:${count.toString(36)}:${file.size.toString(36)}:${crcHex(crc)}\n`
    const footerBytes = encoder.encode(footer)
    const footerCharacters = characters(footer)
    checkCompressionAbort(context.signal)
    await sink.write(footerBytes)
    textCharacters += footerCharacters
    if (parts.length) {
      parts[parts.length - 1].size += footerBytes.length
      parts[parts.length - 1].characters += footerCharacters
    } else parts.push({ offset: 0, size: sink.size, characters: textCharacters })
    checkCompressionAbort(context.signal)
    const output = await sink.finish()
    checkCompressionAbort(context.signal)
    context.onProgress?.({ stage: '处理完成', completed: file.size, total: file.size })
    const textOutput = { ...output, encoding, characters: textCharacters, parts }
    return { algorithm, files: [], outputs: [textOutput], textOutput, originalBytes: file.size,
      compressedBytes: output.blob.size, byteRatio: file.size ? output.blob.size / file.size : null }
  } catch (error) {
    pool?.terminate(error instanceof Error ? error : undefined)
    await sink.abort()
    throw error
  } finally {
    if (heartbeat !== undefined) clearInterval(heartbeat)
    pool?.terminate()
  }
}

export async function decompressTextContainer(file: Blob, context: FileOperationContext): Promise<FileCompressionResult> {
  checkCompressionAbort(context.signal)
  if (file.size > MAX_TEXT_ARCHIVE_BYTES) throw new Error('上传的压缩文本文件不能超过 3 GiB')
  const records = lines(file)
  let sink: Awaited<ReturnType<typeof createOutputSink>> | undefined
  try {
    const first = await records.next()
    checkCompressionAbort(context.signal)
    if (first.done) throw new Error(CORRUPTED)
    const header = /^BTF2:([a-z]+):([a-z0-9]+):([^:]+):([^:]+):([A-Za-z0-9_-]+):([0-9a-f]{8})$/.exec(first.value)
    if (!header) throw new Error('无法识别文件压缩文本，请提供包含 BTF2: 前缀的完整结果')
    validateChoices(header[1], header[2])
    const algorithm = header[1] as FileCompressionAlgorithm
    const encoding = header[2] as TextEncoding
    const expected = integer(header[3], MAX_EXPANDED_BYTES)
    const count = integer(header[4], Math.ceil(MAX_EXPANDED_BYTES / FILE_CHUNK_BYTES))
    if (count !== Math.ceil(expected / FILE_CHUNK_BYTES) ||
      checksum(encoder.encode(first.value.slice(0, first.value.lastIndexOf(':')))) !== header[6]) throw new Error(CORRUPTED)
    const metadata: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBytes(header[5], 'base64url')))
    if (!Array.isArray(metadata) || metadata.length !== 2 || typeof metadata[0] !== 'string' ||
      typeof metadata[1] !== 'string' || metadata[0].length > 1024 || metadata[1].length > 255 ||
      /[\u0000-\u001f\u007f]/.test(metadata[1])) throw new Error(CORRUPTED)
    sink = await createOutputSink(context, safeName(metadata[0]), metadata[1] || 'application/octet-stream')
    checkCompressionAbort(context.signal)
    let total = 0
    let crc = 0xffffffff
    for (let index = 0; index < count; index++) {
      checkCompressionAbort(context.signal)
      const next = await records.next()
      checkCompressionAbort(context.signal)
      if (next.done) throw new Error(CORRUPTED)
      // Base91 includes colons, so match only the fixed record fields.
      const record = /^C:([^:]+):([^:]+):([^:]+):([0-9a-f]{8}):([0-9a-f]{8}):([\s\S]*)$/.exec(next.value)
      if (!record || integer(record[1], count) !== index ||
        integer(record[2], FILE_CHUNK_BYTES) !== Math.min(FILE_CHUNK_BYTES, expected - total)) throw new Error(CORRUPTED)
      const compressedSize = integer(record[3], MAX_ARCHIVE_BYTES)
      if (!compressedSize) throw new Error(CORRUPTED)
      const compressed = decodeBytes(record[6], encoding)
      if (compressed.length !== compressedSize || checksum(compressed) !== record[5]) throw new Error(CORRUPTED)
      const decompressed = await decompressFile({ name: 'chunk.bin', bytes: compressed }, algorithm)
      checkCompressionAbort(context.signal)
      if (decompressed.files.length !== 1) throw new Error(CORRUPTED)
      const bytes = decompressed.files[0].bytes
      if (bytes.length !== integer(record[2], FILE_CHUNK_BYTES) || checksum(bytes) !== record[4]) throw new Error(CORRUPTED)
      total += bytes.length
      if (total > expected || total > MAX_EXPANDED_BYTES) throw new Error('解压文件不能超过 1 GiB')
      crc = updateCrc(crc, bytes)
      checkCompressionAbort(context.signal)
      await sink.write(bytes)
      checkCompressionAbort(context.signal)
      context.onProgress?.({ stage: '正在解码并解压', completed: total, total: expected })
    }
    const last = await records.next()
    checkCompressionAbort(context.signal)
    if (last.done || last.value !== `E:${count.toString(36)}:${total.toString(36)}:${crcHex(crc)}` || total !== expected) throw new Error(CORRUPTED)
    for await (const extra of records) {
      checkCompressionAbort(context.signal)
      if (extra.length) throw new Error(CORRUPTED)
    }
    checkCompressionAbort(context.signal)
    const output = await sink.finish()
    checkCompressionAbort(context.signal)
    context.onProgress?.({ stage: '处理完成', completed: total, total })
    return { algorithm, files: [], outputs: [output], originalBytes: total, compressedBytes: file.size,
      byteRatio: total ? file.size / total : null }
  } catch (error) {
    await sink?.abort()
    if (error instanceof Error && error.name === 'AbortError') throw error
    if (error instanceof Error && /超过|存储|64 MiB|OPFS|磁盘|不受支持|无法识别/.test(error.message)) throw error
    throw new Error(CORRUPTED)
  } finally {
    await records.return(undefined).catch(() => undefined)
  }
}
