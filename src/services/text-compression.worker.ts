import { compressText, decompressText } from './text-compression'
import type { CompressionRequest, CompressionResponse } from './text-compression-rpc'

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<CompressionRequest>) => void) | null
  postMessage: (message: CompressionResponse) => void
}

workerScope.onmessage = async (event) => {
  try {
    const request = event.data
    const result = request.operation === 'compress'
      ? await compressText(request.input, request.algorithm, request.encoding)
      : await decompressText(request.input)
    workerScope.postMessage({ success: true, result })
  } catch (error) {
    workerScope.postMessage({
      success: false,
      error: error instanceof Error ? error.message : '文本处理失败，请检查输入后重试',
    })
  }
}
