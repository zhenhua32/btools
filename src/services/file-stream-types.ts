import type { TextEncoding } from './text-compression-types'

/** Large files are sliced into bounded codec inputs; never increase the buffered codec limits. */
export const MAX_UPLOAD_BYTES = 1024 ** 3
export const MAX_TEXT_ARCHIVE_BYTES = 3 * 1024 ** 3 + 1024 ** 2
export const MAX_EXPANDED_BYTES = 1024 ** 3
export const FILE_CHUNK_BYTES = 4 * 1024 ** 2

export type FileCompressionConcurrency = 1 | 2 | 4 | 8 | 16
export const FILE_CONCURRENCY_OPTIONS: { label: string; value: FileCompressionConcurrency }[] =
  ([1, 2, 4, 8, 16] as const).map((value) => ({ label: `${value} 并发`, value }))
export const DEFAULT_FILE_CONCURRENCY: FileCompressionConcurrency = 4

export function validateFileConcurrency(value: unknown): asserts value is FileCompressionConcurrency {
  if (!FILE_CONCURRENCY_OPTIONS.some((option) => option.value === value)) {
    throw new Error('压缩并发数仅支持 1、2、4、8、16')
  }
}

export interface FileOperationProgress {
  stage: string
  completed: number
  total: number
}

export interface FileOperationContext {
  operationId: string
  onProgress?: (progress: FileOperationProgress) => void
  concurrency?: FileCompressionConcurrency
  signal?: AbortSignal
}

export interface ProcessedFile {
  name: string
  type: string
  blob: Blob
  /** Relative path inside the tool's private OPFS output directory. */
  storageKey?: string
}

export interface TextPart {
  /** UTF-8 byte offset and length, directly usable with Blob.slice(). */
  offset: number
  size: number
  characters: number
}

export interface TextFileOutput extends ProcessedFile {
  encoding: TextEncoding
  characters: number
  /** Concatenating every part in order reproduces the complete text archive. */
  parts: TextPart[]
}
