import type {
  CompressionAlgorithm,
  CompressionResult,
  TextEncoding,
} from './text-compression-types'
import type {
  FileCompressionAlgorithm,
  FileCompressionResult,
  FileDecompressionAlgorithm,
} from './file-compression-types'
import type { FileOperationProgress } from './file-stream-types'

export type CompressionRequest =
  | { operation: 'compress'; input: string; algorithm: CompressionAlgorithm; encoding: TextEncoding }
  | { operation: 'decompress'; input: string }
  | { operation: 'compress-file'; file: File; algorithm: FileCompressionAlgorithm; encoding: TextEncoding; operationId: string }
  | { operation: 'decompress-file'; file: File; algorithm: FileDecompressionAlgorithm; operationId: string }

export type CompressionOutput = CompressionResult | FileCompressionResult

export type CompressionResponse<T extends CompressionOutput = CompressionOutput> =
  | { success: true; result: T }
  | { success: false; error: string }
  | { type: 'progress'; progress: FileOperationProgress }
