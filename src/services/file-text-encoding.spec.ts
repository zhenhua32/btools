// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { encodeBytes } from './text-encodings'
import { ENCODING_OPTIONS } from './text-compression-types'
import { encodeBase32768Utf8, encodeFilePayload } from './file-text-encoding'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function verify(input: Uint8Array) {
  const result = encodeBase32768Utf8(input)
  const expected = encodeBytes(input, 'base32768')
  expect(decoder.decode(result.bytes)).toBe(expected)
  expect(result.bytes).toEqual(encoder.encode(expected))
  expect(result.characters).toBe(Array.from(expected).length)
}

describe('direct UTF-8 Base32768', () => {
  it('preserves every terminal padding width and empty input', () => {
    for (let length = 0; length <= 64; length++) {
      verify(new Uint8Array(length))
      verify(new Uint8Array(length).fill(255))
      verify(Uint8Array.from({ length }, (_, index) => (index * 127 + length) & 255))
    }
  })

  it('preserves all 32768 primary alphabet entries in their original order', () => {
    const input = new Uint8Array(32768 * 15 / 8)
    let bitIndex = 0
    for (let value = 0; value < 32768; value++) {
      for (let bit = 14; bit >= 0; bit--, bitIndex++) input[bitIndex >>> 3] |= ((value >>> bit) & 1) << (7 - (bitIndex & 7))
    }
    const result = encodeBase32768Utf8(input)
    expect(result.characters).toBe(32768)
    verify(input)
  })

  it('preserves every secondary alphabet value and nonzero view offsets', () => {
    // 14 bytes leave exactly 7 terminal bits after the primary 15-bit groups.
    const storage = new Uint8Array(20).fill(195)
    const view = storage.subarray(3, 17)
    for (let value = 0; value < 128; value++) {
      view[view.length - 1] = value
      verify(view)
    }
    for (const length of [127, 128, 129, 1023, 1024, 4095, 4096]) {
      const bytes = Uint8Array.from({ length: length + 6 }, (_, index) => (index * 153 + (index >>> 4)) & 255)
      verify(bytes.subarray(3, 3 + length))
    }
  })

  it.each(ENCODING_OPTIONS.map(({ value }) => value))('preserves %s payload bytes and Unicode character metrics', (encoding) => {
    const input = Uint8Array.from({ length: 259 }, (_, index) => index & 255).subarray(3)
    const text = encodeBytes(input, encoding)
    const result = encodeFilePayload(input, encoding)
    expect(result.bytes).toEqual(encoder.encode(text))
    expect(result.characters).toBe(Array.from(text).length)
  })
})
