export type CompressionAlgorithm = 'brotli' | 'zstd' | 'lzma' | 'deflate' | 'gzip' | 'lz-string'
export type TextEncoding = 'base32768' | 'base65536' | 'base64url' | 'base64' | 'base91'

export const ALGORITHM_OPTIONS: { label: string; value: CompressionAlgorithm }[] = [
  { label: 'Brotli（等级 11）', value: 'brotli' },
  { label: 'Zstandard（等级 19）', value: 'zstd' },
  { label: 'LZMA（等级 9）', value: 'lzma' },
  { label: 'DEFLATE（等级 9）', value: 'deflate' },
  { label: 'Gzip（等级 9）', value: 'gzip' },
  { label: 'LZ-String', value: 'lz-string' },
]

export const ENCODING_OPTIONS: { label: string; value: TextEncoding }[] = [
  { label: 'Base32768 · Unicode 紧凑', value: 'base32768' },
  { label: 'Base65536 · Unicode 紧凑', value: 'base65536' },
  { label: 'Base64url · URL 安全', value: 'base64url' },
  { label: 'Base64 · 通用', value: 'base64' },
  { label: 'Base91 · ASCII 紧凑', value: 'base91' },
]

export const DEFAULT_ALGORITHM: CompressionAlgorithm = 'brotli'
export const DEFAULT_ENCODING: TextEncoding = 'base32768'
export const MAX_TEXT_BYTES = 8 * 1024 * 1024
export const MAX_COMPRESSED_BYTES = 16 * 1024 * 1024
export const MAX_ENCODED_CHARACTERS = 24 * 1024 * 1024

export interface TextMetrics {
  /** Unicode code points; emoji sequences may contain more than one code point. */
  characters: number
  utf8Bytes: number
}

export interface CompressionResult {
  text: string
  algorithm: CompressionAlgorithm
  encoding: TextEncoding
  original: TextMetrics
  compressed: TextMetrics
  characterRatio: number | null
  byteRatio: number | null
}

export function getTextMetrics(text: string): TextMetrics {
  let characters = 0
  for (const _character of text) characters++
  return { characters, utf8Bytes: new TextEncoder().encode(text).byteLength }
}
