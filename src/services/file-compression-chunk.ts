import { compressFile } from './file-compression'
import type { FileCompressionAlgorithm } from './file-compression-types'
import type { TextEncoding } from './text-compression-types'
import { checksum, updateCrc } from './file-compression-crc'
import { encodeFilePayload } from './file-text-encoding'
import type { FileChunkCompressor } from './file-chunk-codec'

export { checksum, crcHex, updateCrc } from './file-compression-crc'

const encoder = new TextEncoder()
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
  sourceCrc: number
  sourceBytes: number
}
export type CompressionChunkResponse = { success: true; result: CompressionChunkResult } | { success: false; error: string }

/** Exactly the original BTF2 C record; compression, encoding and per-block checks stay off the coordinator. */
export async function compressChunk({ index, bytes, algorithm, encoding, lzmaTimeoutMs }: CompressionChunkRequest,
  compressor?: FileChunkCompressor): Promise<CompressionChunkResult> {
  const sourceBytes = bytes.length
  const sourceCrc = (updateCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0
  const compressed = compressor
    ? await compressor.compress(bytes, algorithm, { lzmaTimeoutMs })
    : (await compressFile({ name: 'chunk.bin', bytes }, algorithm, { lzmaTimeoutMs })).files[0].bytes
  const prefix = `C:${index.toString(36)}:${sourceBytes.toString(36)}:${compressed.length.toString(36)}:${sourceCrc.toString(16).padStart(8, '0')}:${checksum(compressed)}:`
  const prefixBytes = encoder.encode(prefix)
  const payload = encodeFilePayload(compressed, encoding)
  // Transfer only this exact-sized record, never the encoder's unused capacity.
  const output = new Uint8Array(prefixBytes.length + payload.bytes.length + 1)
  output.set(prefixBytes)
  output.set(payload.bytes, prefixBytes.length)
  output[output.length - 1] = 10
  return { index, bytes: output, characters: prefix.length + payload.characters + 1, sourceCrc, sourceBytes }
}
