// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { compressFile } from './file-compression'
import { characters, checksum, compressChunk } from './file-compression-chunk'

vi.mock('./file-compression', () => ({ compressFile: vi.fn(async () => ({ files: [{ bytes: Uint8Array.of(1, 2, 3) }] })) }))

describe('parallel BTF2 chunk records', () => {
  it('retains the canonical C record and forwards the optional LZMA timeout', async () => {
    const bytes = new TextEncoder().encode('abc')
    const result = await compressChunk({ index: 36, bytes, algorithm: 'lzma', encoding: 'base64url', lzmaTimeoutMs: 1920000 })
    expect(compressFile).toHaveBeenCalledWith({ name: 'chunk.bin', bytes }, 'lzma', { lzmaTimeoutMs: 1920000 })
    const text = new TextDecoder().decode(result.bytes)
    expect(text).toBe(`C:10:3:3:352441c2:${checksum(Uint8Array.of(1, 2, 3))}:AQID\n`)
    expect(result.characters).toBe(text.length)
    expect(result.index).toBe(36)
    expect(result.bytes.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it('counts Unicode code points without counting surrogate pairs twice', () => {
    expect(characters('a🌏𐀀中')).toBe(4)
  })
})
