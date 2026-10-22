import {
  DEFAULT_ALGORITHM,
  DEFAULT_ENCODING,
  type CompressionAlgorithm,
  type CompressionResult,
  type TextEncoding,
} from './text-compression-types'
import type { CompressionRequest, CompressionResponse } from './text-compression-rpc'

// A fresh worker keeps compression off the UI thread and releases codec memory
// after each operation, including failed or excessively long operations.
const OPERATION_TIMEOUT_MS = 120_000

function runOperation(request: CompressionRequest): Promise<CompressionResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./text-compression.worker.ts', import.meta.url), {
        type: 'module',
        name: 'btools-text-compression',
      })
    } catch {
      reject(new Error('无法启动文本压缩，请重新加载工具后重试'))
      return
    }

    const cleanup = () => {
      clearTimeout(timeout)
      worker.terminate()
    }

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('处理超时，请缩短文本或选择更快的压缩算法'))
    }, OPERATION_TIMEOUT_MS)

    worker.onmessage = (event: MessageEvent<CompressionResponse>) => {
      cleanup()
      if (event.data.success) {
        resolve(event.data.result)
      } else {
        reject(new Error(event.data.error))
      }
    }

    worker.onerror = (event) => {
      event.preventDefault()
      cleanup()
      reject(new Error('文本压缩组件加载或执行失败，请重新加载工具后重试'))
    }

    worker.onmessageerror = () => {
      cleanup()
      reject(new Error('无法读取处理结果，请重试'))
    }

    try {
      worker.postMessage(request)
    } catch {
      cleanup()
      reject(new Error('无法发送文本进行处理，请重试'))
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
