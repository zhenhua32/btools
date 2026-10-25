import { compressChunk } from './file-compression-chunk'
import type { CompressionChunkRequest, CompressionChunkResponse } from './file-compression-chunk'
import { FileChunkCodec } from './file-chunk-codec'

// One reusable Zstd context / Brotli heap per slot. Pool termination (normal,
// failure or cancellation) destroys the worker and reclaims the entire heap.
const codec = new FileChunkCodec()

self.onmessage = async ({ data }: MessageEvent<CompressionChunkRequest>) => {
  try {
    const result = await compressChunk(data, codec)
    const response: CompressionChunkResponse = { success: true, result }
    self.postMessage(response, { transfer: [result.bytes.buffer] })
  } catch (error) {
    const response: CompressionChunkResponse = { success: false, error: error instanceof Error ? error.message : '压缩分块处理失败' }
    self.postMessage(response)
  }
}
