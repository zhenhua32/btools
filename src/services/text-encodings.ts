import * as base32768 from 'base32768'
import * as base65536 from 'base65536'
import type { TextEncoding } from './text-compression-types'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
// Joachim Henke's basE91 alphabet and bit packing (basE91, BSD-3-Clause).
const BASE91 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"'
const BASE91_VALUES = new Map(Array.from(BASE91, (character, index) => [character, index]))

function encodeBase64(bytes: Uint8Array, url: boolean): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 12288) {
    let chunk = ''
    const end = Math.min(offset + 12288, bytes.length)
    for (let i = offset; i < end; i += 3) {
      const a = bytes[i]
      const b = bytes[i + 1] ?? 0
      const c = bytes[i + 2] ?? 0
      chunk += BASE64[a >>> 2] + BASE64[((a & 3) << 4) | (b >>> 4)]
      chunk += i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >>> 6)] : '='
      chunk += i + 2 < bytes.length ? BASE64[c & 63] : '='
    }
    chunks.push(chunk)
  }
  const encoded = chunks.join('')
  return url ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded
}

function decodeBase64(text: string, url: boolean): Uint8Array {
  const valid = url ? /^[A-Za-z0-9_-]*$/ : /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
  if (!valid.test(text) || text.length % 4 === 1) throw new Error('无效的 Base64 文本')
  const normalized = url ? text.replace(/-/g, '+').replace(/_/g, '/') : text.replace(/=+$/, '')
  const bytes = new Uint8Array(Math.floor(normalized.length * 6 / 8))
  let buffer = 0
  let bits = 0
  let offset = 0
  for (const character of normalized) {
    buffer = (buffer << 6) | BASE64.indexOf(character)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[offset++] = (buffer >>> bits) & 255
    }
  }
  return bytes
}

function encodeBase91(bytes: Uint8Array): string {
  const chunks: string[] = []
  let chunk = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer |= byte << bits
    bits += 8
    if (bits > 13) {
      let value = buffer & 8191
      if (value > 88) {
        buffer >>>= 13
        bits -= 13
      } else {
        value = buffer & 16383
        buffer >>>= 14
        bits -= 14
      }
      chunk += BASE91[value % 91] + BASE91[Math.floor(value / 91)]
      if (chunk.length >= 16384) { chunks.push(chunk); chunk = '' }
    }
  }
  if (bits) {
    chunk += BASE91[buffer % 91]
    if (bits > 7 || buffer > 90) chunk += BASE91[Math.floor(buffer / 91)]
  }
  chunks.push(chunk)
  return chunks.join('')
}

function decodeBase91(text: string): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(text.length * 14 / 16))
  let offset = 0
  let buffer = 0
  let bits = 0
  let value = -1
  for (const character of text) {
    const next = BASE91_VALUES.get(character)
    if (next === undefined) throw new Error('无效的 Base91 文本')
    if (value < 0) { value = next; continue }
    value += next * 91
    buffer |= value << bits
    bits += (value & 8191) > 88 ? 13 : 14
    do {
      bytes[offset++] = buffer & 255
      buffer >>>= 8
      bits -= 8
    } while (bits > 7)
    value = -1
  }
  if (value >= 0) bytes[offset++] = (buffer | (value << bits)) & 255
  return bytes.slice(0, offset)
}

export function encodeBytes(bytes: Uint8Array, encoding: TextEncoding): string {
  switch (encoding) {
    case 'base32768': return base32768.encode(bytes)
    case 'base65536': return base65536.encode(bytes)
    case 'base64url': return encodeBase64(bytes, true)
    case 'base64': return encodeBase64(bytes, false)
    case 'base91': return encodeBase91(bytes)
    default: throw new Error('不支持的文本编码')
  }
}

export function decodeBytes(text: string, encoding: TextEncoding): Uint8Array {
  let bytes: Uint8Array
  switch (encoding) {
    case 'base32768': bytes = base32768.decode(text); break
    case 'base65536': bytes = base65536.decode(text); break
    case 'base64url': bytes = decodeBase64(text, true); break
    case 'base64': bytes = decodeBase64(text, false); break
    case 'base91': bytes = decodeBase91(text); break
    default: throw new Error('不支持的文本编码')
  }
  // Reject ignored characters, incomplete groups and non-zero padding bits.
  if (encodeBytes(bytes, encoding) !== text) throw new Error('编码文本损坏或不完整')
  return bytes
}
