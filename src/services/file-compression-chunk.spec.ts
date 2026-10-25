// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { compressFile } from './file-compression'
import { characters, checksum, compressChunk } from './file-compression-chunk'
import { encodeBytes } from './text-encodings'
import { ENCODING_OPTIONS } from './text-compression-types'

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
    expect(result.bytes.buffer.byteLength).toBe(result.bytes.byteLength)
    expect(result.sourceCrc).toBe(0x352441c2)
    expect(result.sourceBytes).toBe(3)
  })

  it.each(ENCODING_OPTIONS.map(({ value }) => value))('keeps the entire canonical record identical for %s with an injected codec', async (encoding) => {
    const input = new TextEncoder().encode('chunk\u0000🌏')
    const compressed = Uint8Array.from({ length: 513 }, (_, index) => (index * 197) & 255)
    const compressor = { compress: vi.fn(async () => compressed) }
    const result = await compressChunk({ index: 5, bytes: input, algorithm: 'gzip', encoding }, compressor)
    const expected = `C:5:${input.length.toString(36)}:${compressed.length.toString(36)}:${checksum(input)}:${checksum(compressed)}:${encodeBytes(compressed, encoding)}\n`
    expect(result.bytes).toEqual(new TextEncoder().encode(expected))
    expect(result.characters).toBe(characters(expected))
    expect(result.bytes.buffer.byteLength).toBe(result.bytes.byteLength)
    expect(result.sourceCrc).toBe(Number.parseInt(checksum(input), 16))
    expect(result.sourceBytes).toBe(input.length)
    expect(compressor.compress).toHaveBeenCalledWith(input, 'gzip', { lzmaTimeoutMs: undefined })
  })

  it('counts Unicode code points without counting surrogate pairs twice', () => {
    expect(characters('a🌏𐀀中')).toBe(4)
  })
})
