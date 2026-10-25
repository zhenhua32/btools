import { compressText, decompressText } from './text-compression'
import { compressFileToText, decompressTextContainer, isTextContainer } from './file-text-container'
import { decompressNativeFile } from './file-native-stream'
import { cleanupOperationStorage } from './file-output-storage'
import { DEFAULT_FILE_CONCURRENCY, MAX_TEXT_ARCHIVE_BYTES, MAX_UPLOAD_BYTES, validateFileConcurrency } from './file-stream-types'
import type { CompressionWorkerRequest, CompressionResponse, CompressionOutput } from './text-compression-rpc'

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<CompressionWorkerRequest>) => void) | null
  postMessage: (message: CompressionResponse, transfer?: Transferable[]) => void
  close: () => void
}
const fileOperations = new Map<string, AbortController>()

workerScope.onmessage = async (event) => {
  const request = event.data
  if (request.operation === 'cancel-file') {
    const controller = fileOperations.get(request.operationId)
    if (controller) controller.abort()
    else workerScope.postMessage({ type: 'cancelled', operationId: request.operationId })
    return
  }
  let controller: AbortController | undefined
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
        const concurrency = request.operation === 'compress-file' ? request.concurrency ?? DEFAULT_FILE_CONCURRENCY : undefined
        if (request.operation === 'compress-file') validateFileConcurrency(concurrency)
        controller = new AbortController()
        fileOperations.set(request.operationId, controller)
        const context = {
          operationId: request.operationId,
          signal: controller.signal,
          ...(concurrency === undefined ? {} : { concurrency }),
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
    if (controller?.signal.aborted) throw new DOMException('已取消处理', 'AbortError')
    // Transfer owned byte buffers rather than copying large file results back
    // to the UI. Text-only requests continue to use ordinary structured clone.
    const transfer = 'files' in result
      ? Array.from(new Set(result.files.map((file) => file.bytes.buffer)))
          .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
      : []
    workerScope.postMessage({ success: true, result }, transfer)
  } catch (error) {
    if ('operationId' in request) await cleanupOperationStorage(request.operationId).catch(() => undefined)
    if (controller?.signal.aborted && 'operationId' in request) {
      workerScope.postMessage({ type: 'cancelled', operationId: request.operationId })
    } else {
      workerScope.postMessage({
        success: false,
        error: error instanceof Error ? error.message : '处理失败，请检查输入后重试',
      })
    }
  } finally {
    if ('operationId' in request && fileOperations.get(request.operationId) === controller) fileOperations.delete(request.operationId)
    // Each client creates a fresh coordinator for one operation. Close its event
    // loop after cleanup and the final response; the client also terminates it.
    // A cancel message must leave the active operation alive until cleanup ends.
    if (!fileOperations.size) workerScope.close()
  }
}
