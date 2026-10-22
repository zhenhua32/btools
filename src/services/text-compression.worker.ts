import { compressText, decompressText } from './text-compression'
import { compressFileToText, decompressTextContainer, isTextContainer } from './file-text-container'
import { decompressNativeFile } from './file-native-stream'
import { cleanupOperationStorage } from './file-output-storage'
import { MAX_TEXT_ARCHIVE_BYTES, MAX_UPLOAD_BYTES } from './file-stream-types'
import type { CompressionRequest, CompressionResponse, CompressionOutput } from './text-compression-rpc'

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<CompressionRequest>) => void) | null
  postMessage: (message: CompressionResponse, transfer?: Transferable[]) => void
}

workerScope.onmessage = async (event) => {
  const request = event.data
  try {
    let result: CompressionOutput
    switch (request.operation) {
      case 'compress':
        result = await compressText(request.input, request.algorithm, request.encoding)
        break
      case 'decompress':
        result = await decompressText(request.input)
        break
      case 'compress-file':
      case 'decompress-file': {
        const limit = request.operation === 'compress-file' ? MAX_UPLOAD_BYTES : MAX_TEXT_ARCHIVE_BYTES
        if (request.file.size > limit) throw new Error('文件大小超出限制，请选择较小的文件')
        const context = {
          operationId: request.operationId,
          onProgress: (progress: import('./file-stream-types').FileOperationProgress) => {
            workerScope.postMessage({ type: 'progress', progress })
          },
        }
        result = request.operation === 'compress-file'
          ? await compressFileToText(request.file, request.algorithm, request.encoding, context)
          : await isTextContainer(request.file)
            ? await decompressTextContainer(request.file, context)
            : await decompressNativeFile(request.file, request.algorithm, context)
        break
      }
      default:
        throw new Error('不支持的压缩操作')
    }
    // Transfer owned byte buffers rather than copying large file results back
    // to the UI. Text-only requests continue to use ordinary structured clone.
    const transfer = 'files' in result
      ? Array.from(new Set(result.files.map((file) => file.bytes.buffer)))
          .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
      : []
    workerScope.postMessage({ success: true, result }, transfer)
  } catch (error) {
    if ('operationId' in request) await cleanupOperationStorage(request.operationId).catch(() => undefined)
    workerScope.postMessage({
      success: false,
      error: error instanceof Error ? error.message : '处理失败，请检查输入后重试',
    })
  }
}
