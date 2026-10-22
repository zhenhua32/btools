import type {
  CompressionAlgorithm,
  CompressionResult,
  TextEncoding,
} from './text-compression-types'

export type CompressionRequest =
  | { operation: 'compress'; input: string; algorithm: CompressionAlgorithm; encoding: TextEncoding }
  | { operation: 'decompress'; input: string }

export type CompressionResponse =
  | { success: true; result: CompressionResult }
  | { success: false; error: string }
