import { compressFile } from './file-compression'
import type { FileCompressionAlgorithm } from './file-compression-types'
import { MAX_ARCHIVE_BYTES } from './file-compression-types'
import { loadFileBrotliEncoder } from './file-brotli'
import type { FileBrotliEncoder } from './file-brotli'
import { FILE_CHUNK_BYTES } from './file-stream-types'
import { loadZstd } from './text-compression'

export interface FileChunkCompressor {
  compress(bytes: Uint8Array, algorithm: FileCompressionAlgorithm, options?: { lzmaTimeoutMs?: number }): Promise<Uint8Array>
}

type ZstdModule = Awaited<ReturnType<typeof loadZstd>>
const emptyDictionary = new Uint8Array(0)

/** Operation-owned in Node, worker-owned in browsers; never share across JS agents. */
export class FileChunkCodec implements FileChunkCompressor {
  private disposed = false
  private brotli?: Promise<FileBrotliEncoder>
  private zstd?: Promise<ZstdModule>
  private zstdModule?: ZstdModule
  private zstdContext = 0

  private assertOpen(): void {
    if (this.disposed) throw new DOMException('文件处理已取消', 'AbortError')
  }

  async compress(bytes: Uint8Array, algorithm: FileCompressionAlgorithm,
    options: { lzmaTimeoutMs?: number } = {}): Promise<Uint8Array> {
    this.assertOpen()
    if (bytes.byteLength > FILE_CHUNK_BYTES) throw new Error('文件分块不能超过 4 MiB')
    let compressed: Uint8Array
    switch (algorithm) {
      case 'brotli': {
        const encoder = await (this.brotli ??= loadFileBrotliEncoder().catch((error) => { this.brotli = undefined; throw error }))
        this.assertOpen()
        compressed = encoder.compress(bytes)
        break
      }
      case 'zstd': {
        const codec = await (this.zstd ??= loadZstd().catch((error) => { this.zstd = undefined; throw error }))
        this.assertOpen()
        this.zstdModule = codec
        if (!this.zstdContext) {
          this.zstdContext = codec.createCCtx()
          if (!this.zstdContext) throw new Error('Zstandard 压缩上下文分配失败')
        }
        try { compressed = codec.compressUsingDict(this.zstdContext, bytes, emptyDictionary, 19) }
        catch (error) { this.releaseZstdContext(); throw error }
        break
      }
      default: {
        // Retain the original ZIP filename/timestamp and all other codec settings.
        const result = await compressFile({ name: 'chunk.bin', bytes }, algorithm, options)
        this.assertOpen()
        compressed = result.files[0].bytes
      }
    }
    if (compressed.byteLength > MAX_ARCHIVE_BYTES) throw new Error('压缩分块不能超过 16 MiB')
    return compressed
  }

  private releaseZstdContext(): void {
    const context = this.zstdContext
    this.zstdContext = 0
    if (context) {
      // Cancellation and cleanup must keep rejecting/terminating the other jobs
      // even if a damaged native context cannot be explicitly released.
      try { this.zstdModule?.freeCCtx(context) } catch { /* Worker termination reclaims its heap. */ }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.releaseZstdContext()
    this.brotli = undefined
    this.zstd = undefined
    this.zstdModule = undefined
  }
}
