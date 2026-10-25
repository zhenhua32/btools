// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checksum, combineCrc32, crcHex, updateCrc } from './file-compression-crc'

const encoder = new TextEncoder()
const finalCrc = (bytes: Uint8Array) => (updateCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0

// Independent bit-at-a-time IEEE reference; no lookup table or combine matrices.
function referenceCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

describe('BTF2 IEEE CRC32', () => {
  it('retains standard vectors and streamed raw-state updates', () => {
    const input = encoder.encode('123456789')
    expect(checksum(input)).toBe('cbf43926')
    expect(checksum(new Uint8Array())).toBe('00000000')
    const state = updateCrc(updateCrc(0xffffffff, input.subarray(0, 4)), input.subarray(4))
    expect(crcHex(state)).toBe('cbf43926')
    expect(updateCrc(state, new Uint8Array())).toBe(state)
  })

  it('matches the independent reference on byte views with offsets', () => {
    const storage = Uint8Array.from({ length: 1027 }, (_, index) => (index * 113 + (index >>> 2)) & 255)
    for (const length of [0, 1, 2, 7, 8, 9, 31, 127, 255, 1024]) {
      const view = storage.subarray(3, 3 + length)
      expect(finalCrc(view)).toBe(referenceCrc(view))
    }
  })

  it('combines blocks in source order with empty and uneven boundaries', () => {
    const input = Uint8Array.from({ length: 1027 }, (_, index) => (index * 103 + (index >>> 3)) & 255)
    for (const split of [0, 1, 2, 7, 8, 15, 16, 255, 512, 1026, 1027]) {
      const first = input.subarray(0, split), second = input.subarray(split)
      expect(combineCrc32(finalCrc(first), finalCrc(second), second.length)).toBe(referenceCrc(input))
    }
    let combined = 0
    for (let offset = 0; offset < input.length; offset += 31) {
      const block = input.subarray(offset, offset + 31)
      combined = combineCrc32(combined, finalCrc(block), block.length)
    }
    expect(combined).toBe(referenceCrc(input))
  })

  it('handles a 1 GiB length without 32-bit length truncation', () => {
    // Fixed values independently checked with Node zlib.crc32 streaming 1 MiB zero buffers.
    // Repeated doubling computes a valid CRC for a virtual 1 GiB all-zero file.
    let crc = finalCrc(Uint8Array.of(0)), length = 1
    while (length < 1024 ** 3) { crc = combineCrc32(crc, crc, length); length *= 2 }
    expect(crc.toString(16)).toBe('5b64c2b0')
    // Crossing 2**32 also exercises cached matrix powers above 32-bit lengths.
    const twoGiB = combineCrc32(crc, crc, length)
    const fourGiB = combineCrc32(twoGiB, twoGiB, length * 2)
    expect(combineCrc32(fourGiB, fourGiB, length * 4)).toBe(0x41d912ff)
  })

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid block length %s', (length) => {
    expect(() => combineCrc32(0, 0, length)).toThrow(RangeError)
  })

  it('rejects malformed finalized CRC values', () => {
    for (const value of [-1, 2 ** 32, 1.5, NaN, Infinity]) {
      expect(() => combineCrc32(value, 0, 1)).toThrow(RangeError)
      expect(() => combineCrc32(0, value, 1)).toThrow(RangeError)
    }
  })
})
