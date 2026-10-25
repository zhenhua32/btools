import { encodeBytes } from './text-encodings'
import type { TextEncoding } from './text-compression-types'

// Base32768 5.0.1 repertoire, Copyright (c) 2021 qntm, MIT.
// https://github.com/qntm/base32768 — license: third_party/base32768/LICENSE
// Keep the canonical alphabet, MSB-first packing and all-one terminal padding.
const BASE32768_RANGES = [
  'ҠҿԀԟڀڿݠޟ߀ߟကဟႠႿᄀᅟᆀᆟᇠሿበቿዠዿጠጿᎠᏟᐠᙟᚠᛟកសᠠᡟᣀᣟᦀᦟ᧠᧿ᨠᨿᯀᯟᰀᰟᴀᴟ⇠⇿⋀⋟⍀⏟␀␟─❟➀➿⠀⥿⦠⦿⨠⩟⪀⪿⫠⭟ⰀⰟⲀⳟⴀⴟⵀⵟ⺠⻟㇀㇟㐀䶟䷀龿ꀀꑿ꒠꒿ꔀꗿꙀꙟꚠꛟ꜀ꝟꞀꞟꡀꡟ',
  'ƀƟɀʟ',
]

function packedRepertoire(ranges: string): Uint32Array {
  const points = Array.from(ranges, (character) => character.codePointAt(0)!)
  const size = points.reduce((sum, point, index) => index % 2 ? sum + point - points[index - 1] + 1 : sum, 0)
  const table = new Uint32Array(size)
  let index = 0
  for (let pair = 0; pair < points.length; pair += 2) {
    for (let point = points[pair]; point <= points[pair + 1]; point++) {
      // High byte is UTF-8 width, the remaining bytes contain the encoded BMP code point.
      table[index++] = point < 0x800
        ? (2 << 24) | ((0xc0 | (point >>> 6)) << 8) | (0x80 | (point & 63))
        : (3 << 24) | ((0xe0 | (point >>> 12)) << 16) | ((0x80 | ((point >>> 6) & 63)) << 8) | (0x80 | (point & 63))
    }
  }
  return table
}

let base32768Tables: Uint32Array[] | undefined
const encoder = new TextEncoder()

export interface EncodedFilePayload {
  /** This internal view may have unused trailing buffer capacity; records copy only its byteLength. */
  bytes: Uint8Array<ArrayBuffer>
  characters: number
}

/** Emit the canonical Base32768 UTF-8 payload without constructing a large JS string. */
export function encodeBase32768Utf8(input: Uint8Array): EncodedFilePayload {
  const characters = Math.ceil(input.length * 8 / 15)
  const output = new Uint8Array(characters * 3)
  const [primary, secondary] = base32768Tables ??= BASE32768_RANGES.map(packedRepertoire)
  let buffer = 0
  let bits = 0
  let offset = 0
  for (let index = 0; index < input.length; index++) {
    buffer = (buffer << 8) | input[index]
    bits += 8
    if (bits >= 15) {
      bits -= 15
      const packed = primary[(buffer >>> bits) & 32767]
      if (packed >>> 24 === 3) output[offset++] = packed >>> 16
      output[offset++] = packed >>> 8
      output[offset++] = packed
      buffer &= (1 << bits) - 1
    }
  }
  if (bits) {
    const width = bits <= 7 ? 7 : 15
    const padding = width - bits
    const value = (buffer << padding) | ((1 << padding) - 1)
    const packed = (width === 7 ? secondary : primary)[value]
    if (packed >>> 24 === 3) output[offset++] = packed >>> 16
    output[offset++] = packed >>> 8
    output[offset++] = packed
  }
  return { bytes: output.subarray(0, offset), characters }
}

export function encodeFilePayload(bytes: Uint8Array, encoding: TextEncoding): EncodedFilePayload {
  if (encoding === 'base32768') return encodeBase32768Utf8(bytes)
  const text = encodeBytes(bytes, encoding)
  let characters = 0
  for (const _character of text) characters++
  return { bytes: encoder.encode(text), characters }
}
