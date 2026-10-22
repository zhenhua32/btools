import type { TextEncoding } from './text-compression-types'

/** Large files are sliced into bounded codec inputs; never increase the buffered codec limits. */
export const MAX_UPLOAD_BYTES = 1024 ** 3
export const MAX_TEXT_ARCHIVE_BYTES = 3 * 1024 ** 3 + 1024 ** 2
export const MAX_EXPANDED_BYTES = 1024 ** 3
export const FILE_CHUNK_BYTES = 4 * 1024 ** 2

export interface FileOperationProgress {
  stage: string
  completed: number
  total: number
}

export interface FileOperationContext {
  operationId: string
  onProgress?: (progress: FileOperationProgress) => void
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
