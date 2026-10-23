import { compressChunk } from './file-compression-chunk'
import type { CompressionChunkRequest, CompressionChunkResponse } from './file-compression-chunk'

self.onmessage = async ({ data }: MessageEvent<CompressionChunkRequest>) => {
  try {
    const result = await compressChunk(data)
    const response: CompressionChunkResponse = { success: true, result }
    self.postMessage(response, { transfer: [result.bytes.buffer] })
  } catch (error) {
    const response: CompressionChunkResponse = { success: false, error: error instanceof Error ? error.message : '压缩分块处理失败' }
    self.postMessage(response)
  }
}
