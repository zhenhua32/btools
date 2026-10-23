import { compressFile } from './file-compression'
import type { FileCompressionAlgorithm } from './file-compression-types'
import type { TextEncoding } from './text-compression-types'
import { encodeBytes } from './text-encodings'

const encoder = new TextEncoder()
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

export function updateCrc(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return crc
}
export function crcHex(crc: number): string { return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0') }
export function checksum(bytes: Uint8Array): string { return crcHex(updateCrc(0xffffffff, bytes)) }
export function characters(text: string): number {
  let count = 0
  for (const _character of text) count++
  return count
}

export interface CompressionChunkRequest {
  index: number
  bytes: Uint8Array
  algorithm: FileCompressionAlgorithm
  encoding: TextEncoding
  /** Keep the original per-block budget per CPU contender; the pool remains immediately cancellable. */
  lzmaTimeoutMs?: number
}
export interface CompressionChunkResult {
  index: number
  bytes: Uint8Array<ArrayBuffer>
  characters: number
}
export type CompressionChunkResponse = { success: true; result: CompressionChunkResult } | { success: false; error: string }

/** Exactly the original BTF2 C record; compression, encoding and per-block checks stay off the coordinator. */
export async function compressChunk({ index, bytes, algorithm, encoding, lzmaTimeoutMs }: CompressionChunkRequest): Promise<CompressionChunkResult> {
  const result = await compressFile({ name: 'chunk.bin', bytes }, algorithm, { lzmaTimeoutMs })
  const compressed = result.files[0].bytes
  const record = `C:${index.toString(36)}:${bytes.length.toString(36)}:${compressed.length.toString(36)}:${checksum(bytes)}:${checksum(compressed)}:${encodeBytes(compressed, encoding)}\n`
  return { index, bytes: encoder.encode(record), characters: characters(record) }
}
