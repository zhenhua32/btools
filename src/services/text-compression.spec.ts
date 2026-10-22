// @vitest-environment node
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compressText, decompressText } from './text-compression'
import {
  ALGORITHM_OPTIONS, DEFAULT_ALGORITHM, DEFAULT_ENCODING, ENCODING_OPTIONS,
  getTextMetrics, MAX_TEXT_BYTES,
} from './text-compression-types'
import { decodeBytes, encodeBytes } from './text-encodings'
import type { TextEncoding } from './text-compression-types'

// Use the packages' real Node WASM builds in unit tests. Only their browser
// initializers/fetch paths are substituted, never compression or decompression.
vi.mock('../../node_modules/brotli-wasm/pkg.web/brotli_wasm.js', async () => {
  const { createRequire: requireFactory } = await import('node:module')
  const brotli = requireFactory(import.meta.url)('brotli-wasm')
  return { ...brotli, default: async () => undefined }
})
vi.mock('../../node_modules/@bokuweb/zstd-wasm/dist/web/index.web.js', async () => {
  const { createRequire: requireFactory } = await import('node:module')
  const zstd = requireFactory(import.meta.url)('@bokuweb/zstd-wasm')
  return { ...zstd, init: () => zstd.init() }
})

const lzma = createRequire(import.meta.url)('lzma') as {
  compress: (input: Uint8Array, level: number) => number[]
  decompress: (input: Uint8Array) => string | number[]
}

class LzmaWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  postMessage(data: { action: number; data: Uint8Array; mode: number; cbn: number }) {
    setTimeout(() => {
      try {
        const result = data.action === 1 ? lzma.compress(data.data, data.mode) : lzma.decompress(data.data)
        if (!this.terminated) this.onmessage?.({ data: { ...data, result } } as MessageEvent)
      } catch (error) {
        if (!this.terminated) this.onmessage?.({ data: { ...data, error } } as MessageEvent)
      }
    }, 0)
  }
  terminate() { this.terminated = true }
}

beforeAll(() => vi.stubGlobal('Worker', LzmaWorker))
afterAll(() => vi.unstubAllGlobals())

function crc32(bytes: Uint8Array): string {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

function replacePayload(text: string, encoding: TextEncoding, bytes: Uint8Array): string {
  const parts = text.split(':')
  const header = parts.slice(0, 6)
  header[5] = crc32(bytes)
  return header.join(':') + ':' + encodeBytes(bytes, encoding)
}

describe('text compression', () => {
  const sample = '\ufeff  中英混合文本，精确保留\r\nHello 🌏 👩🏽‍💻 e\u0301\0\t\n '.repeat(10)

  it('defaults to Brotli and Base32768 with complete output metrics', async () => {
    const result = await compressText(sample)
    expect(result.algorithm).toBe(DEFAULT_ALGORITHM)
    expect(result.encoding).toBe(DEFAULT_ENCODING)
    expect(result.text).toMatch(/^BT1:b:u:/)
    expect(result.original).toEqual(getTextMetrics(sample))
    expect(result.compressed).toEqual(getTextMetrics(result.text))
    expect(result.characterRatio).toBe(result.compressed.characters / result.original.characters)
    expect(result.byteRatio).toBe(result.compressed.utf8Bytes / result.original.utf8Bytes)
    expect(result.characterRatio).toBeLessThan(1)
  })

  for (const algorithm of ALGORITHM_OPTIONS) {
    for (const encoding of ENCODING_OPTIONS) {
      it(`round trips ${algorithm.value} + ${encoding.value}`, async () => {
        const compressed = await compressText(sample, algorithm.value, encoding.value)
        const restored = await decompressText(compressed.text)
        expect(restored.text).toBe(sample)
        expect(restored.algorithm).toBe(algorithm.value)
        expect(restored.encoding).toBe(encoding.value)
        expect(restored.original).toEqual(compressed.original)
        expect(restored.compressed).toEqual(compressed.compressed)
        expect(restored.characterRatio).toBe(compressed.characterRatio)
      })
    }
    it(`preserves empty input and whitespace with ${algorithm.value}`, async () => {
      const empty = await compressText('', algorithm.value)
      expect(empty.characterRatio).toBeNull()
      expect(empty.byteRatio).toBeNull()
      expect((await decompressText(empty.text)).text).toBe('')
      const spaces = await compressText(' \r\n\t\ufeff ', algorithm.value)
      expect((await decompressText(spaces.text)).text).toBe(' \r\n\t\ufeff ')
    })
    it(`rejects truncated and corrupted ${algorithm.value} payloads`, async () => {
      const result = await compressText(sample, algorithm.value, 'base64url')
      await expect(decompressText(result.text.slice(0, -1))).rejects.toThrow()
      await expect(decompressText(result.text + 'A')).rejects.toThrow()
      const position = result.text.lastIndexOf(':') + 2
      const damaged = result.text.slice(0, position) + (result.text[position] === 'A' ? 'B' : 'A') + result.text.slice(position + 1)
      await expect(decompressText(damaged)).rejects.toThrow()
    })
    it(`limits forged output size before/during ${algorithm.value} decompression`, async () => {
      const result = await compressText('bounded text '.repeat(100), algorithm.value, 'base64url')
      const parts = result.text.split(':')
      parts[3] = '1'
      await expect(decompressText(parts.join(':'))).rejects.toThrow()
    })
  }

  it('rejects unsupported formats, algorithms and encodings', async () => {
    const result = await compressText('test')
    for (const text of ['', 'not compressed', result.text.replace('BT1', 'BT2'), result.text.replace(':b:u:', ':x:u:'), result.text.replace(':b:u:', ':b:x:')]) {
      await expect(decompressText(text)).rejects.toThrow()
    }
    await expect(compressText('test', 'unknown' as never)).rejects.toThrow('不支持')
    await expect(compressText('test', 'brotli', 'unknown' as never)).rejects.toThrow('不支持')
  })

  it('does not trim the encoded payload or accept whitespace around the format', async () => {
    const result = await compressText('original\n')
    await expect(decompressText(' ' + result.text)).rejects.toThrow()
    await expect(decompressText(result.text + '\n')).rejects.toThrow()
  })

  it('rejects unpaired surrogates instead of silently replacing them', async () => {
    await expect(compressText('\ud800')).rejects.toThrow('Unicode')
    await expect(compressText('\udc00')).rejects.toThrow('Unicode')
  })

  it('rejects oversized original input and forged declared lengths', async () => {
    await expect(compressText('a'.repeat(MAX_TEXT_BYTES + 1))).rejects.toThrow('8 MiB')
    await expect(compressText('中'.repeat(Math.floor(MAX_TEXT_BYTES / 3) + 1))).rejects.toThrow('8 MiB')
    const result = await compressText('small')
    const parts = result.text.split(':')
    parts[3] = (MAX_TEXT_BYTES + 1).toString(36)
    await expect(decompressText(parts.join(':'))).rejects.toThrow('8 MiB')
  })

  it('rejects decompressed bytes that are invalid UTF-8 even with valid checksums', async () => {
    const { deflateSync } = await import('fflate')
    const original = Uint8Array.of(0xff, 0xfe)
    const compressed = deflateSync(original)
    const text = `BT1:d:c:2:${crc32(original)}:${crc32(compressed)}:${encodeBytes(compressed, 'base64url')}`
    await expect(decompressText(text)).rejects.toThrow()
  })

  it('checks the original checksum after successful decompression', async () => {
    const result = await compressText('test', 'brotli', 'base64url')
    const parts = result.text.split(':')
    parts[4] = '00000000'
    await expect(decompressText(parts.join(':'))).rejects.toThrow()
  })

  it('rejects excessive LZMA dictionary and Zstd frame allocation requests', async () => {
    for (const algorithm of ['lzma', 'zstd'] as const) {
      const result = await compressText(sample, algorithm, 'base64url')
      const bytes = decodeBytes(result.text.split(':').slice(6).join(':'), 'base64url')
      if (algorithm === 'lzma') bytes.fill(0x7f, 1, 5)
      else bytes[5] = 0xff
      await expect(decompressText(replacePayload(result.text, 'base64url', bytes))).rejects.toThrow()
    }
  })
})

describe('text encodings', () => {
  for (const encoding of ENCODING_OPTIONS) {
    it(`round trips binary edge cases using ${encoding.value}`, () => {
      const bytes = Uint8Array.from({ length: 256 }, (_, index) => index)
      for (const value of [new Uint8Array(), Uint8Array.of(0), Uint8Array.of(255), bytes, bytes.subarray(1)]) {
        expect(decodeBytes(encodeBytes(value, encoding.value), encoding.value)).toEqual(value)
      }
      expect(() => decodeBytes(encodeBytes(bytes, encoding.value) + ' ', encoding.value)).toThrow()
    })
  }
  it('uses conventional Base64 and basE91 known vectors', () => {
    const bytes = new TextEncoder().encode('Hello World!')
    expect(encodeBytes(bytes, 'base64')).toBe('SGVsbG8gV29ybGQh')
    expect(encodeBytes(bytes, 'base91')).toBe('>OwJh>Io0Tv!8PE')
    expect(encodeBytes(Uint8Array.of(251, 255), 'base64url')).toBe('-_8')
  })
  it('rejects non-canonical Base64 padding and invalid characters', () => {
    for (const text of ['A', 'AA=', 'AA===', 'AB==', 'A A=', '====']) expect(() => decodeBytes(text, 'base64')).toThrow()
    for (const text of ['A', 'AB', 'AA==', 'AA+', 'AA/']) expect(() => decodeBytes(text, 'base64url')).toThrow()
  })
  it('counts Unicode code points instead of UTF-16 code units', () => {
    expect(getTextMetrics('a中🌏')).toEqual({ characters: 3, utf8Bytes: 8 })
  })
})
