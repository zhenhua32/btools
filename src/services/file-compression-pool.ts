import { compressChunk } from './file-compression-chunk'
import type { CompressionChunkRequest, CompressionChunkResponse, CompressionChunkResult } from './file-compression-chunk'
import { FileChunkCodec } from './file-chunk-codec'
import { MAX_ARCHIVE_BYTES } from './file-compression-types'
import type { TextEncoding } from './text-compression-types'

interface Pending {
  index: number
  sourceBytes: number
  maxRecordBytes: number
  resolve: (result: CompressionChunkResult) => void
  reject: (error: Error) => void
}
interface Slot { worker: Worker; pending?: Pending }

/** Canonical encoding expansion plus a conservative fixed-record overhead. */
function maximumRecordBytes(encoding: TextEncoding): number {
  let payload: number
  switch (encoding) {
    case 'base32768': payload = 3 * Math.ceil(MAX_ARCHIVE_BYTES * 8 / 15); break
    case 'base65536': payload = 4 * Math.ceil(MAX_ARCHIVE_BYTES / 2); break
    case 'base64': case 'base64url': payload = 4 * Math.ceil(MAX_ARCHIVE_BYTES / 3); break
    case 'base91': payload = 2 * Math.ceil(MAX_ARCHIVE_BYTES * 8 / 13) + 2; break
    default: throw new Error('不支持的文本编码')
  }
  return payload + 16384
}

export function compressionAbortError(): DOMException { return new DOMException('文件处理已取消', 'AbortError') }
export function checkCompressionAbort(signal?: AbortSignal): void { if (signal?.aborted) throw compressionAbortError() }

/** One task per reusable worker. The caller bounds the complete running + waiting output window. */
export class FileCompressionPool {
  private readonly slots: Slot[] = []
  private stopped?: Error
  private inlineCodec?: FileChunkCodec
  private readonly onAbort = () => this.terminate(compressionAbortError())

  constructor(size: number, private readonly signal?: AbortSignal,
    workerFactory = () => new Worker(new URL('./file-compression-chunk.worker.ts', import.meta.url), { type: 'module' })) {
    checkCompressionAbort(signal)
    signal?.addEventListener('abort', this.onAbort, { once: true })
    try {
      // Node codec tests have no browser Worker. Browser jobs always use child workers, including 1 concurrency.
      if (typeof Worker === 'undefined') { this.inlineCodec = new FileChunkCodec(); return }
      for (let index = 0; index < size; index++) {
        const slot: Slot = { worker: workerFactory() }
        this.slots.push(slot)
        slot.worker.onmessage = ({ data }: MessageEvent<CompressionChunkResponse>) => {
          if (this.stopped || !slot.pending) return
          const pending = slot.pending
          if (!data?.success) { this.terminate(new Error(data?.error || '压缩分块处理失败')); return }
          const result = data.result
          if (!result || result.index !== pending.index || !(result.bytes instanceof Uint8Array) ||
            !(result.bytes.buffer instanceof ArrayBuffer) || result.bytes.byteOffset !== 0 || result.bytes.byteLength !== result.bytes.buffer.byteLength ||
            !result.bytes.byteLength || result.bytes.byteLength > pending.maxRecordBytes ||
            !Number.isSafeInteger(result.characters) || result.characters < 0 || result.characters > result.bytes.byteLength ||
            result.sourceBytes !== pending.sourceBytes || !Number.isInteger(result.sourceCrc) || result.sourceCrc < 0 || result.sourceCrc > 0xffffffff) {
            this.terminate(new Error('压缩分块返回的数据无效')); return
          }
          slot.pending = undefined
          pending.resolve(result)
        }
        slot.worker.onerror = (event) => {
          event.preventDefault?.()
          this.terminate(new Error('压缩工作线程加载或运行失败'))
        }
        slot.worker.onmessageerror = () => this.terminate(new Error('压缩工作线程数据传输失败'))
      }
    } catch (error) {
      this.terminate(error instanceof Error ? error : new Error('无法创建压缩工作线程'))
      throw this.stopped
    }
  }

  run(request: CompressionChunkRequest): Promise<CompressionChunkResult> {
    if (this.stopped) return Promise.reject(this.stopped)
    checkCompressionAbort(this.signal)
    if (!this.slots.length) return compressChunk(request, this.inlineCodec)
    const slot = this.slots.find((candidate) => !candidate.pending)
    if (!slot) return Promise.reject(new Error('压缩工作线程已满'))
    return new Promise((resolve, reject) => {
      slot.pending = { index: request.index, sourceBytes: request.bytes.byteLength, maxRecordBytes: maximumRecordBytes(request.encoding), resolve, reject }
      try { slot.worker.postMessage(request, [request.bytes.buffer]) }
      catch (error) { this.terminate(error instanceof Error ? error : new Error('压缩分块传输失败')) }
    })
  }

  terminate(error: Error = compressionAbortError()): void {
    if (this.stopped) return
    this.stopped = error
    this.signal?.removeEventListener('abort', this.onAbort)
    this.inlineCodec?.dispose()
    this.inlineCodec = undefined
    for (const slot of this.slots) {
      slot.worker.onmessage = null
      slot.worker.onerror = null
      slot.worker.onmessageerror = null
      slot.worker.terminate()
      slot.pending?.reject(error)
      slot.pending = undefined
    }
  }
}
