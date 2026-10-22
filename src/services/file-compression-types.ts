import type { ProcessedFile, TextFileOutput } from './file-stream-types'

export type FileCompressionAlgorithm = 'brotli' | 'zstd' | 'lzma' | 'deflate' | 'gzip' | 'zip'
export type FileDecompressionAlgorithm = FileCompressionAlgorithm | 'auto'

export const FILE_ALGORITHM_OPTIONS: { label: string; value: FileCompressionAlgorithm }[] = [
  { label: 'Brotli（.br）', value: 'brotli' },
  { label: 'Zstandard（.zst）', value: 'zstd' },
  { label: 'LZMA（.lzma）', value: 'lzma' },
  { label: 'DEFLATE（.deflate）', value: 'deflate' },
  { label: 'Gzip（.gz）', value: 'gzip' },
  { label: 'ZIP（.zip）', value: 'zip' },
]
export const FILE_DECOMPRESSION_OPTIONS: { label: string; value: FileDecompressionAlgorithm }[] = [
  { label: '自动检测', value: 'auto' },
  ...FILE_ALGORITHM_OPTIONS,
]
export const DEFAULT_FILE_ALGORITHM: FileCompressionAlgorithm = 'brotli'
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
export const MAX_TOTAL_FILE_BYTES = 8 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 200

export interface CompressionFile {
  name: string
  bytes: Uint8Array
  type?: string
}

export interface FileCompressionResult {
  algorithm: FileCompressionAlgorithm
  files: CompressionFile[]
  /** Disk-backed large-file results. Buffered APIs continue returning files. */
  outputs?: ProcessedFile[]
  textOutput?: TextFileOutput
  /** Size of the original, uncompressed file(s), in either operation. */
  originalBytes: number
  compressedBytes: number
  byteRatio: number | null
}
