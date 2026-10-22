// @vitest-environment node
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { deflateSync, gzipSync, zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compressFile, decompressFile } from './file-compression'
import {
  DEFAULT_FILE_ALGORITHM, FILE_ALGORITHM_OPTIONS, MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRIES, MAX_FILE_BYTES,
} from './file-compression-types'
import type { CompressionFile } from './file-compression-types'

vi.mock('../../node_modules/brotli-wasm/pkg.web/brotli_wasm.js', async () => {
  const { createRequire: requireFactory } = await import('node:module')
  return { ...requireFactory(import.meta.url)('brotli-wasm'), default: async () => undefined }
})
vi.mock('../../node_modules/@bokuweb/zstd-wasm/dist/web/index.web.js', async () => {
  const { createRequire: requireFactory } = await import('node:module')
  const zstd = requireFactory(import.meta.url)('@bokuweb/zstd-wasm')
  return { ...zstd, init: () => zstd.init() }
})

const require = createRequire(import.meta.url)
const lzma = require('lzma') as {
  compress: (bytes: Uint8Array, level: number) => number[]
}
const decoderSource = readFileSync(new URL('../../third_party/lzma/lzma-file-decoder.js', import.meta.url), 'utf8')

// Execute the actual vendored binary decoder in an isolated classic-worker
// context. The upstream encoder and both WASM codecs also remain real.
class LzmaWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  readonly binaryDecoder: boolean
  constructor(url: string) { this.binaryDecoder = String(url).includes('lzma-file-decoder') }
  postMessage(data: { action: number; data: Uint8Array; mode: number; cbn: number }) {
    if (this.binaryDecoder) {
      const context = createContext({
        onmessage: null, setTimeout,
        postMessage: (message: unknown) => {
          if (!this.terminated) this.onmessage?.({ data: message } as MessageEvent)
        },
      })
      runInContext(decoderSource, context)
      context.onmessage({ data })
    } else setTimeout(() => {
      try {
        const result = lzma.compress(data.data, data.mode)
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

const allBytes = Uint8Array.from({ length: 256 }, (_, index) => index)
const utf8 = new TextEncoder().encode('\ufeff 中文与 emoji 🌍\r\n\0Binary adjacent text')
function file(bytes: Uint8Array, name = '图片🌏.bin'): CompressionFile { return { name, bytes } }
function copyAndSet32(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = bytes.slice()
  new DataView(copy.buffer).setUint32(offset, value, true)
  return copy
}
function centralOffset(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(bytes.length - 6, true)
}

describe('file compression', () => {
  it('defaults to a standard Brotli file with binary byte metrics', async () => {
    const result = await compressFile(file(utf8))
    expect(result.algorithm).toBe(DEFAULT_FILE_ALGORITHM)
    expect(result.files[0].name).toBe('图片🌏.bin.br')
    expect(result.originalBytes).toBe(utf8.length)
    expect(result.compressedBytes).toBe(result.files[0].bytes.length)
    expect(result.byteRatio).toBe(result.compressedBytes / utf8.length)
  })

  for (const { value: algorithm } of FILE_ALGORITHM_OPTIONS) {
    for (const [label, bytes] of [
      ['all 256 byte values', allBytes],
      ['Unicode and NUL bytes', utf8],
      ['empty files', new Uint8Array()],
      ['non-canonical UTF-8 bytes', Uint8Array.of(0xc0, 0x80, 0xed, 0xa0, 0x80, 0xe0, 0x80, 0x81)],
    ] as const) {
      it(`round trips ${label} using ${algorithm} without any text conversion`, async () => {
        const compressed = await compressFile(file(bytes), algorithm)
        const result = await decompressFile(compressed.files[0])
        expect(result.algorithm).toBe(algorithm)
        expect(result.files).toHaveLength(1)
        expect(result.files[0].name).toBe('图片🌏.bin')
        expect(result.files[0].bytes).toEqual(bytes)
        expect(result.originalBytes).toBe(bytes.length)
        expect(result.compressedBytes).toBe(compressed.compressedBytes)
        expect(result.byteRatio).toBe(bytes.length ? compressed.compressedBytes / bytes.length : null)
        expect(result.files[0].bytes.buffer).not.toBe(compressed.files[0].bytes.buffer)
      })
    }
    it(`rejects truncated ${algorithm} files`, async () => {
      const compressed = await compressFile(file(allBytes), algorithm)
      const value = compressed.files[0]
      await expect(decompressFile({ ...value, bytes: value.bytes.subarray(0, 6) })).rejects.toThrow()
    })
  }

  it('allows manual Brotli/DEFLATE decompression when a file lost its suffix', async () => {
    for (const algorithm of ['brotli', 'deflate'] as const) {
      const compressed = (await compressFile(file(allBytes), algorithm)).files[0]
      await expect(decompressFile({ ...compressed, name: 'download' })).rejects.toThrow('手动')
      const result = await decompressFile({ ...compressed, name: 'download' }, algorithm)
      expect(result.files[0].name).toBe('download.unpacked')
      expect(result.files[0].bytes).toEqual(allBytes)
    }
  })

  it('detects ZIP, Gzip, Zstd and plausible LZMA headers without a filename', async () => {
    for (const algorithm of ['zip', 'gzip', 'zstd', 'lzma'] as const) {
      const compressed = (await compressFile(file(allBytes), algorithm)).files[0]
      const result = await decompressFile({ ...compressed, name: 'download' })
      expect(result.algorithm).toBe(algorithm)
      expect(result.files[0].bytes).toEqual(allBytes)
    }
  })

  it('supports Gzip concatenated members and verifies every member checksum', async () => {
    const first = gzipSync(utf8)
    const last = gzipSync(allBytes)
    const bytes = new Uint8Array(first.length + last.length)
    bytes.set(first); bytes.set(last, first.length)
    const result = await decompressFile(file(bytes, 'data.tgz'))
    expect(result.files[0].name).toBe('data.tar')
    expect(result.files[0].bytes).toEqual(Uint8Array.from([...utf8, ...allBytes]))
    bytes[first.length - 8] ^= 1
    await expect(decompressFile(file(bytes, 'data.gz'))).rejects.toThrow('校验')
  })

  it('rejects Gzip CRC or size corruption', async () => {
    const bytes = gzipSync(allBytes)
    for (const offset of [bytes.length - 8, bytes.length - 4]) {
      const damaged = bytes.slice(); damaged[offset] ^= 1
      await expect(decompressFile(file(damaged, 'data.gz'))).rejects.toThrow('校验')
    }
  })

  it('accepts a bounded Zstandard frame with unknown content size', async () => {
    const compressed = (await compressFile(file(utf8), 'zstd')).files[0].bytes
    expect(compressed[4] & 0xe0).toBe(0x20)
    const unknown = compressed.slice()
    unknown[4] &= ~0x20
    unknown[5] = 0 // 1 KiB window replaces the single-segment content size.
    expect((await decompressFile(file(unknown, 'data.zst'))).files[0].bytes).toEqual(utf8)
  })

  it('preserves bytes in LZMA streams with an unknown original length', async () => {
    const bytes = (await compressFile(file(allBytes), 'lzma')).files[0].bytes
    bytes.fill(255, 5, 13)
    expect((await decompressFile(file(bytes, 'data.lzma'))).files[0].bytes).toEqual(allBytes)
  })

  it('rejects truncated LZMA data even if the decoder could synthesize the declared output length', async () => {
    const bytes = Uint8Array.of(93, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 32, 5, 156, 255, 255)
    await expect(decompressFile(file(bytes, 'truncated.lzma'))).rejects.toThrow('损坏')
    const complete = (await compressFile(file(Uint8Array.of(64, 22)), 'lzma')).files[0]
    expect((await decompressFile(complete)).files[0].bytes).toEqual(Uint8Array.of(64, 22))
  })

  it('supports standard known-length LZMA streams without an EOS marker', async () => {
    const empty = Uint8Array.of(93, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    expect((await decompressFile(file(empty, 'empty.lzma'))).files[0].bytes).toEqual(new Uint8Array())
    const codec = require('lzma').LZMA() as { disableEndMark?: boolean; compress: typeof lzma.compress }
    try {
      codec.disableEndMark = true
      const bytes = Uint8Array.from(codec.compress(allBytes, 9))
      expect((await decompressFile(file(bytes, 'no-eos.lzma'))).files[0].bytes).toEqual(allBytes)
    } finally { delete codec.disableEndMark }
    await expect(decompressFile(file(Uint8Array.from([...empty, 7]), 'extra.lzma'))).rejects.toThrow()
  })

  it('extracts ZIP files with Unicode names, skipping directories and removing paths', async () => {
    const bytes = zipSync({ 'nested/': new Uint8Array(), 'nested/你好🌏.txt': utf8,
      '../../unsafe.bin': allBytes, 'empty': new Uint8Array() })
    const result = await decompressFile(file(bytes, 'files.zip'))
    expect(result.files.map(({ name }) => name)).toEqual(['你好🌏.txt', 'unsafe.bin', 'empty'])
    expect(result.files.map(({ bytes: value }) => value)).toEqual([utf8, allBytes, new Uint8Array()])
    expect(result.originalBytes).toBe(utf8.length + allBytes.length)
  })

  it('supports stored entries and empty ZIP archives', async () => {
    const stored = zipSync({ 'stored.bin': allBytes }, { level: 0 })
    expect((await decompressFile(file(stored))).files[0].bytes).toEqual(allBytes)
    const empty = await decompressFile(file(zipSync({}), 'empty.zip'))
    expect(empty.files).toEqual([])
    expect(empty.byteRatio).toBeNull()
  })

  it('preserves special JavaScript property names as ZIP filenames', async () => {
    const compressed = (await compressFile(file(allBytes, '__proto__'), 'zip')).files[0]
    const result = await decompressFile(compressed)
    expect(result.files[0].name).toBe('__proto__')
    expect(result.files[0].bytes).toEqual(allBytes)
  })

  it('checks ZIP CRC and declared sizes', async () => {
    const bytes = zipSync({ 'stored.bin': allBytes }, { level: 0 })
    const central = centralOffset(bytes)
    await expect(decompressFile(file(copyAndSet32(bytes, central + 16, 0)))).rejects.toThrow('校验')
    await expect(decompressFile(file(copyAndSet32(bytes, central + 24, allBytes.length + 1)))).rejects.toThrow()
  })

  it('rejects encrypted/unsupported ZIP entries before decompression', async () => {
    const bytes = zipSync({ 'file': allBytes })
    const central = centralOffset(bytes)
    const encrypted = bytes.slice(); encrypted[central + 8] |= 1
    await expect(decompressFile(file(encrypted))).rejects.toThrow('加密')
    const unsupported = bytes.slice(); unsupported[central + 10] = 99
    await expect(decompressFile(file(unsupported))).rejects.toThrow('压缩方式')
  })

  it('checks ZIP entry count and aggregate declared sizes before decompression', async () => {
    const tooMany = zipSync(Object.fromEntries(Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, index) => [String(index), new Uint8Array()])))
    await expect(decompressFile(file(tooMany))).rejects.toThrow('条目')
    const bytes = zipSync({ 'file': allBytes })
    const large = copyAndSet32(bytes, centralOffset(bytes) + 24, MAX_FILE_BYTES + 1)
    await expect(decompressFile(file(large))).rejects.toThrow('8 MiB')
  })

  it('rejects oversized file input and compressed uploads', async () => {
    await expect(compressFile(file(new Uint8Array(MAX_FILE_BYTES + 1)))).rejects.toThrow('8 MiB')
    await expect(decompressFile(file(new Uint8Array(MAX_ARCHIVE_BYTES + 1)))).rejects.toThrow('16 MiB')
  })

  it('bounds raw DEFLATE, Gzip and Brotli output while streaming', async () => {
    const expanded = new Uint8Array(MAX_FILE_BYTES + 1)
    const brotli = require('brotli-wasm') as { compress: (bytes: Uint8Array, options: { quality: number }) => Uint8Array }
    for (const [name, bytes] of [['data.deflate', deflateSync(expanded)], ['data.gz', gzipSync(expanded)],
      ['data.br', brotli.compress(expanded, { quality: 1 })]] as const) {
      await expect(decompressFile(file(bytes, name))).rejects.toThrow('8 MiB')
    }
  })

  it('rejects forged LZMA dictionary/size and Zstd output allocation headers', async () => {
    const lzmaBytes = (await compressFile(file(allBytes), 'lzma')).files[0].bytes
    await expect(decompressFile(file(copyAndSet32(lzmaBytes, 1, 0x7fffffff), 'data.lzma'))).rejects.toThrow('字典')
    await expect(decompressFile(file(copyAndSet32(lzmaBytes, 5, MAX_FILE_BYTES + 1), 'data.lzma'))).rejects.toThrow('8 MiB')
    const zstd = (await compressFile(file(utf8), 'zstd')).files[0].bytes
    const forged = new Uint8Array(zstd.length + 3)
    forged.set(zstd.subarray(0, 5)); forged[4] = 0xa0
    new DataView(forged.buffer).setUint32(5, MAX_FILE_BYTES + 1, true)
    forged.set(zstd.subarray(6), 9)
    await expect(decompressFile(file(forged, 'data.zst'))).rejects.toThrow('8 MiB')
  })

  it('rejects unknown formats, empty compressed uploads and unsupported algorithms', async () => {
    await expect(decompressFile(file(Uint8Array.of(1, 2, 3), 'unknown'))).rejects.toThrow('无法识别')
    await expect(decompressFile(file(new Uint8Array()))).rejects.toThrow('损坏')
    await expect(compressFile(file(allBytes), 'unknown' as never)).rejects.toThrow('不支持')
    await expect(decompressFile(file(allBytes), 'unknown' as never)).rejects.toThrow('不支持')
  })
})
