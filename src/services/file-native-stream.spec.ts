// @vitest-environment node
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { brotliCompressSync, deflateRawSync, gzipSync } from 'node:zlib'
import { zipSync } from 'fflate'
import { Decompress as ZstdDecompress } from 'fzstd'
import xxhash from 'xxhash-wasm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { decompressNativeFile } from './file-native-stream'
import { loadZstd } from './text-compression'
import type { FileCompressionAlgorithm } from './file-compression-types'
import { MAX_EXPANDED_BYTES, MAX_TEXT_ARCHIVE_BYTES } from './file-stream-types'

vi.mock('../../node_modules/brotli-wasm/pkg.web/brotli_wasm.js', async () => {
  const { createRequire } = await import('node:module')
  return { ...createRequire(import.meta.url)('brotli-wasm'), default: async () => undefined }
})
vi.mock('../../node_modules/@bokuweb/zstd-wasm/dist/web/index.web.js', async () => {
  const { createRequire } = await import('node:module')
  const zstd = createRequire(import.meta.url)('@bokuweb/zstd-wasm')
  return { ...zstd, init: () => zstd.init() }
})

const require = createRequire(import.meta.url)
const lzma = require('lzma') as { compress: (bytes: Uint8Array, level: number) => number[] }
const source = readFileSync(new URL('../../third_party/lzma/lzma-stream-decoder.js', import.meta.url), 'utf8')
class SlicedFile extends File {
  maxRead = 0
  constructor(readonly data: Uint8Array, name: string) { super([data], name) }
  override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole input must not be buffered') }
  override slice(start = 0, end = this.size, type?: string): Blob {
    this.maxRead = Math.max(this.maxRead, end - start)
    const data = this.data.subarray(start, end)
    return Object.assign(new Blob([data], { type }), { syncBytes: data })
  }
}
class StreamingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  context: ReturnType<typeof createContext>
  constructor() {
    this.context = createContext({
      onmessage: null, setTimeout, Uint8Array,
      FileReaderSync: class {
        readAsArrayBuffer(blob: Blob & { syncBytes: Uint8Array }) { return blob.syncBytes.slice().buffer }
      },
      postMessage: (data: unknown) => setTimeout(() => {
        if (!this.terminated) this.onmessage?.({ data } as MessageEvent)
      }, 0),
    })
    runInContext(source, this.context)
  }
  postMessage(data: unknown) { setTimeout(() => { if (!this.terminated) this.context.onmessage({ data }) }, 0) }
  terminate() { this.terminated = true }
}
beforeAll(() => vi.stubGlobal('Worker', StreamingWorker))
afterAll(() => vi.unstubAllGlobals())

const binary = Uint8Array.from({ length: 1024 }, (_, index) => index & 255)
let sequence = 0
const context = () => ({ operationId: `native-test-${++sequence}` })
async function compress(data: Uint8Array, algorithm: FileCompressionAlgorithm): Promise<Uint8Array> {
  if (algorithm === 'brotli') return brotliCompressSync(data)
  if (algorithm === 'gzip') return gzipSync(data)
  if (algorithm === 'deflate') return deflateRawSync(data)
  if (algorithm === 'zip') return zipSync({ 'binary.bin': data })
  if (algorithm === 'zstd') return (await loadZstd()).compress(data)
  return Uint8Array.from(lzma.compress(data, 1))
}
async function decode(data: Uint8Array, algorithm: FileCompressionAlgorithm) {
  const extensions = { brotli: 'br', zstd: 'zst', lzma: 'lzma', deflate: 'deflate', gzip: 'gz', zip: 'zip' }
  const file = new SlicedFile(data, `binary.bin.${extensions[algorithm]}`)
  const result = await decompressNativeFile(file, 'auto', context())
  expect(result.files).toEqual([])
  expect(result.outputs).toHaveLength(1)
  expect(result.algorithm).toBe(algorithm)
  expect(file.maxRead).toBeLessThanOrEqual(65557)
  return new Uint8Array(await result.outputs![0].blob.arrayBuffer())
}
function join(...chunks: Uint8Array[]): Uint8Array { return Uint8Array.from(Buffer.concat(chunks)) }

describe('native streamed file decompression', () => {
  it('does not read an already cancelled file', async () => {
    const controller = new AbortController()
    controller.abort()
    const file = new SlicedFile(gzipSync(binary), 'cancelled.gz')
    await expect(decompressNativeFile(file, 'auto', { ...context(), signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(file.maxRead).toBe(0)
  })

  it('stops immediately when cancellation arrives from a progress callback', async () => {
    const controller = new AbortController()
    await expect(decompressNativeFile(new SlicedFile(gzipSync(binary), 'cancelled.gz'), 'auto', {
      ...context(), signal: controller.signal, onProgress: () => controller.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' })
  })

  for (const algorithm of ['brotli', 'zstd', 'lzma', 'deflate', 'gzip', 'zip'] as const) {
    it(`round trips arbitrary bytes using ${algorithm} without buffering input`, async () => {
      expect(await decode(await compress(binary, algorithm), algorithm)).toEqual(binary)
    })
    it(`round trips empty files using ${algorithm}`, async () => {
      expect(await decode(await compress(new Uint8Array(), algorithm), algorithm)).toEqual(new Uint8Array())
    })
    it(`rejects truncated ${algorithm} input`, async () => {
      const bytes = await compress(binary, algorithm)
      await expect(decode(bytes.subarray(0, bytes.length - 8), algorithm)).rejects.toThrow()
    })
  }

  it('streams more than the previous 8 MiB output limit using all native codecs', async () => {
    const data = Uint8Array.from({ length: 9 * 1024 ** 2 }, (_, index) => index & 255)
    for (const algorithm of ['brotli', 'zstd', 'lzma', 'deflate', 'gzip', 'zip'] as const) {
      const output = await decode(await compress(data, algorithm), algorithm)
      expect(output.length).toBe(data.length)
      expect(output.every((value, index) => value === data[index])).toBe(true)
    }
  }, 60000)

  it('validates each concatenated gzip member including checksums', async () => {
    const first = gzipSync(binary), second = gzipSync(Uint8Array.of(1, 2, 3))
    expect(await decode(join(first, second), 'gzip')).toEqual(join(binary, Uint8Array.of(1, 2, 3)))
    const corrupt = join(first, second)
    corrupt[first.length - 8] ^= 1
    await expect(decode(corrupt, 'gzip')).rejects.toThrow('校验失败')
    const badLast = join(first, second)
    badLast[badLast.length - 8] ^= 1
    await expect(decode(badLast, 'gzip')).rejects.toThrow('校验失败')
  })

  it('rejects gzip trailing garbage and corrupted reserved flags', async () => {
    const bytes = gzipSync(binary)
    await expect(decode(join(bytes, Uint8Array.of(1)), 'gzip')).rejects.toThrow()
    bytes[3] |= 0x80
    await expect(decode(bytes, 'gzip')).rejects.toThrow()
  })

  it('rejects trailing raw DEFLATE and Brotli bytes', async () => {
    for (const algorithm of ['deflate', 'brotli'] as const) {
      await expect(decode(join(await compress(binary, algorithm), Uint8Array.of(1)), algorithm)).rejects.toThrow()
    }
  })

  it('validates Zstandard checksums and concatenated frames', async () => {
    const hash = await xxhash()
    const checksummed = async (data: Uint8Array) => {
      const frame = await compress(data, 'zstd')
      frame[4] |= 4
      const trailer = new Uint8Array(4)
      new DataView(trailer.buffer).setUint32(0, Number(hash.h64Raw(data) & 0xffffffffn), true)
      return join(frame, trailer)
    }
    const first = await checksummed(binary), second = await checksummed(Uint8Array.of(3, 2, 1))
    expect(await decode(join(first, second), 'zstd')).toEqual(join(binary, Uint8Array.of(3, 2, 1)))
    const corrupted = first.slice()
    corrupted[corrupted.length - 1] ^= 1
    await expect(decode(corrupted, 'zstd')).rejects.toThrow('校验失败')
  })

  it('rejects oversized Zstandard windows before the decoder allocates them', async () => {
    // Single segment + 4-byte FCS (1 GiB), no blocks needed to hit validation.
    const frame = Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0, 0, 0, 64)
    await expect(decode(frame, 'zstd')).rejects.toThrow('窗口大小不能超过 64 MiB')
  })

  it('drains Zstandard output between tiny RLE blocks instead of buffering a frame', async () => {
    const blocks = 100
    const frame = new Uint8Array(6 + blocks * 4)
    frame.set([0x28, 0xb5, 0x2f, 0xfd, 0, 56]) // 128 KiB window, unknown size.
    for (let index = 0; index < blocks; index++) {
      frame.set([index === blocks - 1 ? 3 : 2, 0, 16, 0x7f], 6 + index * 4)
    }
    let maxOutputPerPush = 0
    const original = ZstdDecompress.prototype.push
    const spy = vi.spyOn(ZstdDecompress.prototype, 'push').mockImplementation(function (this: ZstdDecompress, bytes, final) {
      const handler = this.ondata
      let emitted = 0
      this.ondata = (chunk, last) => { emitted += chunk.length; return handler(chunk, last) }
      try { return original.call(this, bytes, final) }
      finally { this.ondata = handler; maxOutputPerPush = Math.max(maxOutputPerPush, emitted) }
    })
    try {
      const output = await decode(frame, 'zstd')
      expect(output.length).toBe(blocks * 131072)
      expect(output.every((byte) => byte === 0x7f)).toBe(true)
      // fzstd buffers up to 18 header bytes, combining at most three tiny
      // initial blocks. Subsequent pushes emit one block at a time.
      expect(maxOutputPerPush).toBeLessThanOrEqual(3 * 131072)
    } finally { spy.mockRestore() }
  })

  it('accepts known-empty LZMA without an EOS symbol', async () => {
    const bytes = Uint8Array.of(0x5d, 0, 0, 0x80, 0, ...new Array(13).fill(0))
    expect(await decode(bytes, 'lzma')).toEqual(new Uint8Array())
  })

  it('supports unknown-size LZMA and rejects forged known output sizes', async () => {
    const bytes = await compress(binary, 'lzma')
    bytes.fill(255, 5, 13)
    expect(await decode(bytes, 'lzma')).toEqual(binary)
    bytes.fill(0, 5, 13)
    bytes[5] = 1
    await expect(decode(bytes, 'lzma')).rejects.toThrow()
  })

  it('rejects a declared output over 1 GiB before invoking LZMA', async () => {
    const header = Uint8Array.of(0x5d, 0, 0, 0x80, 0, ...new Array(13).fill(0))
    new DataView(header.buffer).setUint32(5, MAX_EXPANDED_BYTES + 1, true)
    await expect(decode(header, 'lzma')).rejects.toThrow('不能超过 1 GiB')
  })

  it('rejects oversized uploads using virtual size without allocation', async () => {
    const file = new SlicedFile(Uint8Array.of(1), 'huge.gz')
    Object.defineProperty(file, 'size', { value: MAX_TEXT_ARCHIVE_BYTES + 1 })
    await expect(decompressNativeFile(file, 'gzip', context())).rejects.toThrow('不能超过 3 GiB')
    expect(file.maxRead).toBe(0)
  })

  it('extracts multiple ZIP entries, removes unsafe paths and validates CRCs', async () => {
    const bytes = zipSync({ '../../a.bin': binary, 'C:\\b.bin': Uint8Array.of(0xc0, 0x80), 'empty/': new Uint8Array() })
    const result = await decompressNativeFile(new SlicedFile(bytes, 'archive.zip'), 'auto', context())
    expect(result.outputs?.map((file) => file.name)).toEqual(['a.bin', 'b.bin'])
    expect(new Uint8Array(await result.outputs![0].blob.arrayBuffer())).toEqual(binary)
    const corrupt = bytes.slice()
    const central = new DataView(corrupt.buffer).getUint32(corrupt.length - 6, true)
    corrupt[central + 16] ^= 1
    await expect(decompressNativeFile(new SlicedFile(corrupt, 'archive.zip'), 'auto', context())).rejects.toThrow('校验失败')
  })
})
