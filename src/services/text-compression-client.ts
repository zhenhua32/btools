import {
  DEFAULT_ALGORITHM,
  DEFAULT_ENCODING,
  type CompressionAlgorithm,
  type CompressionResult,
  type TextEncoding,
} from './text-compression-types'
import {
  DEFAULT_FILE_ALGORITHM,
  type FileCompressionAlgorithm,
  type FileCompressionResult,
  type FileDecompressionAlgorithm,
} from './file-compression-types'
import type { CompressionOutput, CompressionRequest, CompressionResponse } from './text-compression-rpc'
import type { FileOperationProgress } from './file-stream-types'
import { cleanupOperationStorage, releaseProcessedResult } from './file-output-storage'

// A fresh worker keeps compression off the UI thread and releases codec memory
// after each operation, including failed or excessively long operations.
const OPERATION_TIMEOUT_MS = 120_000
const FILE_IDLE_TIMEOUT_MS = 10 * 60_000

export interface FileProcessingOptions {
  signal?: AbortSignal
  onProgress?: (progress: FileOperationProgress) => void
}

export interface FileCompressionOptions extends FileProcessingOptions {
  encoding?: TextEncoding
}

function runOperation<T extends CompressionOutput>(request: CompressionRequest, options: FileProcessingOptions = {}): Promise<T> {
  const isFile = request.operation === 'compress-file' || request.operation === 'decompress-file'
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('已取消处理', 'AbortError'))
      return
    }
    let worker: Worker
    try {
      worker = new Worker(new URL('./text-compression.worker.ts', import.meta.url), {
        type: 'module',
        name: 'btools-text-compression',
      })
    } catch {
      reject(new Error(`无法启动${isFile ? '文件' : '文本'}压缩，请重新加载工具后重试`))
      return
    }

    let settled = false
    let timeout: ReturnType<typeof setTimeout>
    const cleanup = (removePartial = false) => {
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (removePartial && 'operationId' in request) {
        void cleanupOperationStorage(request.operationId).catch(() => undefined)
      }
    }

    const abort = () => {
      if (settled) return
      cleanup(true)
      reject(new DOMException('已取消处理', 'AbortError'))
    }
    const resetTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        cleanup(true)
        reject(new Error(isFile ? '长时间没有处理进度，请重试或选择更快的算法' : '处理超时，请缩短文本或选择更快的压缩算法'))
      }, isFile ? FILE_IDLE_TIMEOUT_MS : OPERATION_TIMEOUT_MS)
    }
    resetTimeout()
    options.signal?.addEventListener('abort', abort, { once: true })

    worker.onmessage = (event: MessageEvent<CompressionResponse<T>>) => {
      if (settled) return
      if ('type' in event.data && event.data.type === 'progress') {
        resetTimeout()
        try { options.onProgress?.(event.data.progress) } catch { /* UI callbacks cannot interrupt processing. */ }
        return
      }
      if (!('success' in event.data)) return
      cleanup(!event.data.success)
      if (event.data.success) {
        resolve(event.data.result)
      } else {
        reject(new Error(event.data.error))
      }
    }

    worker.onerror = (event) => {
      if (settled) return
      event.preventDefault()
      cleanup(true)
      reject(new Error(`${isFile ? '文件' : '文本'}压缩组件加载或执行失败，请重新加载工具后重试`))
    }

    worker.onmessageerror = () => {
      if (settled) return
      cleanup(true)
      reject(new Error('无法读取处理结果，请重试'))
    }

    try {
      worker.postMessage(request)
    } catch {
      cleanup(true)
      reject(new Error(`无法发送${isFile ? '文件' : '文本'}进行处理，请重试`))
    }
  })
}

export function compressText(
  input: string,
  algorithm: CompressionAlgorithm = DEFAULT_ALGORITHM,
  encoding: TextEncoding = DEFAULT_ENCODING,
): Promise<CompressionResult> {
  return runOperation({ operation: 'compress', input, algorithm, encoding })
}

export function decompressText(input: string): Promise<CompressionResult> {
  return runOperation({ operation: 'decompress', input })
}

export function compressFile(
  file: File,
  algorithm: FileCompressionAlgorithm = DEFAULT_FILE_ALGORITHM,
  options: FileCompressionOptions = {},
): Promise<FileCompressionResult> {
  return runOperation({
    operation: 'compress-file', file, algorithm,
    encoding: options.encoding ?? DEFAULT_ENCODING,
    operationId: crypto.randomUUID(),
  }, options)
}

export function decompressFile(
  file: File,
  algorithm: FileDecompressionAlgorithm = 'auto',
  options: FileProcessingOptions = {},
): Promise<FileCompressionResult> {
  return runOperation({ operation: 'decompress-file', file, algorithm, operationId: crypto.randomUUID() }, options)
}

/** Keep disk-backed results alive for a short download grace period, then release them. */
export async function releaseFileResult(result: FileCompressionResult | null | undefined): Promise<void> {
  releaseProcessedResult(result)
}
