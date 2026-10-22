// @vitest-environment node
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FILE_ALGORITHM_OPTIONS } from './file-compression-types'
import { compressFileToText, decompressTextContainer, isTextContainer } from './file-text-container'
import { FILE_CHUNK_BYTES, MAX_EXPANDED_BYTES, MAX_TEXT_ARCHIVE_BYTES, MAX_UPLOAD_BYTES } from './file-stream-types'
import { ENCODING_OPTIONS } from './text-compression-types'

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
const lzma = require('lzma') as { compress: (bytes: Uint8Array, level: number) => number[] }
const decoderSource = readFileSync(new URL('../../third_party/lzma/lzma-file-decoder.js', import.meta.url), 'utf8')
class LzmaWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  readonly binaryDecoder: boolean
  constructor(url: string) { this.binaryDecoder = String(url).includes('lzma-file-decoder') }
  postMessage(data: { action: number; data: Uint8Array; mode: number; cbn: number }) {
    if (this.binaryDecoder) {
      const context = createContext({ onmessage: null, setTimeout, postMessage: (message: unknown) => {
        if (!this.terminated) this.onmessage?.({ data: message } as MessageEvent)
      } })
      runInContext(decoderSource, context)
      context.onmessage({ data })
    } else setTimeout(() => {
      try {
        const result = lzma.compress(data.data, data.mode)
        if (!this.terminated) this.onmessage?.({ data: { ...data, result } } as MessageEvent)
      } catch (error) { this.onmessage?.({ data: { ...data, error } } as MessageEvent) }
    }, 0)
  }
  terminate() { this.terminated = true }
}
beforeAll(() => vi.stubGlobal('Worker', LzmaWorker))
afterAll(() => vi.unstubAllGlobals())

const inputBytes = Uint8Array.from({ length: 768 }, (_, index) => index % 256)
const file = () => new File([inputBytes], '原图🌏.bin', { type: 'image/test' })
const context = { operationId: 'container-test' }
const asBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
function resignHeader(header: string, replace: (fields: string[]) => void): string {
  const fields = header.split(':')
  fields.pop()
  replace(fields)
  const body = fields.join(':')
  let crc = 0xffffffff
  for (const byte of new TextEncoder().encode(body)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return `${body}:${((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')}`
}

describe('streaming text file container', () => {
  for (const { value: algorithm } of FILE_ALGORITHM_OPTIONS) {
    for (const { value: encoding } of ENCODING_OPTIONS) {
      it(`round trips arbitrary binary bytes via ${algorithm} + ${encoding}`, async () => {
        const progress = vi.fn()
        const compressed = await compressFileToText(file(), algorithm, encoding, { ...context, onProgress: progress })
        const output = compressed.textOutput!
        const text = await output.blob.text()
        expect(text.startsWith(`BTF2:${algorithm}:${encoding}:`)).toBe(true)
        expect(output.name).toBe('原图🌏.bin.btf.txt')
        expect(output.characters).toBe(Array.from(text).length)
        expect(compressed.compressedBytes).toBe(new TextEncoder().encode(text).length)
        expect(compressed.byteRatio).toBe(output.blob.size / inputBytes.length)
        expect(compressed.files).toEqual([])
        expect(await isTextContainer(output.blob)).toBe(true)
        expect(output.parts).toHaveLength(1)
        expect(await output.blob.slice(output.parts[0].offset, output.parts[0].offset + output.parts[0].size).text()).toBe(text)
        const restored = await decompressTextContainer(output.blob, context)
        expect(restored.outputs![0].name).toBe('原图🌏.bin')
        expect(restored.outputs![0].type).toBe('image/test')
        expect(await asBytes(restored.outputs![0].blob)).toEqual(inputBytes)
        expect(restored.originalBytes).toBe(inputBytes.length)
        expect(restored.compressedBytes).toBe(output.blob.size)
        expect(progress).toHaveBeenCalledWith({ stage: '处理完成', completed: inputBytes.length, total: inputBytes.length })
      })
    }
  }

  it('round trips empty originals, while rejecting an empty archive', async () => {
    const result = await compressFileToText(new File([], 'empty'), 'brotli', 'base32768', context)
    expect(result.byteRatio).toBeNull()
    expect(result.textOutput!.parts).toEqual([{ offset: 0, size: result.textOutput!.blob.size, characters: result.textOutput!.characters }])
    const restored = await decompressTextContainer(result.textOutput!.blob, context)
    expect(restored.outputs![0].blob.size).toBe(0)
    await expect(decompressTextContainer(new Blob(), context)).rejects.toThrow()
    expect(await isTextContainer(new Blob())).toBe(false)
  })

  it('splits block reads and exposes complete, non-overlapping copy parts', async () => {
    const bytes = new Uint8Array(FILE_CHUNK_BYTES + 51)
    bytes.fill(43)
    bytes.set([0, 255, 0xc0, 0x80], FILE_CHUNK_BYTES)
    const input = new File([bytes], 'chunked.bin')
    const slice = vi.spyOn(input, 'slice')
    const result = await compressFileToText(input, 'deflate', 'base32768', context)
    expect(slice).toHaveBeenCalledTimes(2)
    expect(slice).toHaveBeenNthCalledWith(1, 0, FILE_CHUNK_BYTES)
    expect(slice).toHaveBeenNthCalledWith(2, FILE_CHUNK_BYTES, bytes.length)
    const output = result.textOutput!
    expect(output.parts).toHaveLength(2)
    expect(output.parts[1].offset).toBe(output.parts[0].size)
    expect(output.parts.reduce((size, part) => size + part.size, 0)).toBe(output.blob.size)
    expect(output.parts.reduce((size, part) => size + part.characters, 0)).toBe(output.characters)
    const copied = await Promise.all(output.parts.map((part) => output.blob.slice(part.offset, part.offset + part.size).text()))
    expect(copied[0].startsWith('BTF2:')).toBe(true)
    expect(copied[1]).toMatch(/\nE:/)
    const restored = await decompressTextContainer(new Blob(copied), context)
    const restoredBytes = await asBytes(restored.outputs![0].blob)
    expect(restoredBytes.length).toBe(bytes.length)
    expect(restoredBytes.every((value, index) => value === bytes[index])).toBe(true)
  })

  it('reads UTF-8 across every byte boundary without using a full-file text read', async () => {
    const output = (await compressFileToText(file(), 'deflate', 'base65536', context)).textOutput!
    const bytes = await asBytes(output.blob)
    const input = new Blob([bytes])
    vi.spyOn(input, 'text').mockRejectedValue(new Error('must not read whole file'))
    vi.spyOn(input, 'arrayBuffer').mockRejectedValue(new Error('must not buffer whole file'))
    vi.spyOn(input, 'stream').mockImplementation(() => {
      let offset = 0
      return new ReadableStream({ pull(controller) {
        if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset))
        else controller.close()
      } })
    })
    const restored = await decompressTextContainer(input, context)
    expect(await asBytes(restored.outputs![0].blob)).toEqual(inputBytes)
  })

  it('accepts exact 1 GiB/3 GiB boundaries without allocating a large buffer', async () => {
    const input = new Blob()
    Object.defineProperty(input, 'size', { value: MAX_UPLOAD_BYTES })
    vi.spyOn(input, 'slice').mockImplementation(() => { throw new Error('bounded file read started') })
    await expect(compressFileToText(input, 'brotli', 'base32768', context)).rejects.toThrow('bounded file read started')
    const oversized = new Blob()
    Object.defineProperty(oversized, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    await expect(compressFileToText(oversized, 'brotli', 'base32768', context)).rejects.toThrow('1 GiB')
    const hugeArchive = new Blob()
    Object.defineProperty(hugeArchive, 'size', { value: MAX_TEXT_ARCHIVE_BYTES + 1 })
    await expect(decompressTextContainer(hugeArchive, context)).rejects.toThrow('3 GiB')
    expect(MAX_EXPANDED_BYTES).toBe(1024 ** 3)
  })

  it('rejects missing/reordered records, corrupted headers, altered checksums and truncation', async () => {
    const text = await (await compressFileToText(file(), 'deflate', 'base64url', context)).textOutput!.blob.text()
    const [header, data, footer] = text.trimEnd().split('\n')
    const mutations = [
      '', header + '\n', `${header}\n${footer}\n`, `${header}\n${data}\n`,
      text.slice(0, -4), text + footer + '\n',
      `${header}\n${data}\n${data}\n${footer}\n`,
      text.replace('BTF2:deflate:', 'BTF2:brotli:'),
      `${header}\n${data.replace(/^C:0:/, 'C:1:')}\n${footer}\n`,
      `${header}\n${data.slice(0, -1)}\n${footer}\n`,
      `${header}\n${data.replace(/:([0-9a-f]{8}):/, ':00000000:')}\n${footer}\n`,
      `${header}\n${data}\n${footer.replace(/:[0-9a-f]{8}$/, ':00000000')}\n`,
    ]
    for (const mutation of mutations) await expect(decompressTextContainer(new Blob([mutation]), context)).rejects.toThrow()
  })

  it('accepts copied text with CRLF or a trimmed final newline', async () => {
    const text = await (await compressFileToText(file(), 'deflate', 'base32768', context)).textOutput!.blob.text()
    for (const copied of [text.trimEnd(), text.replace(/\n/g, '\r\n'), text.replace(/\n/g, '\r\n').trimEnd(), text + '\n']) {
      const restored = await decompressTextContainer(new Blob([copied]), context)
      expect(await asBytes(restored.outputs![0].blob)).toEqual(inputBytes)
    }
  })

  it('bounds unterminated metadata before allocating codec output', async () => {
    await expect(decompressTextContainer(new Blob(['BTF2:' + 'a'.repeat(17000)]), context)).rejects.toThrow()
    await expect(decompressTextContainer(new Blob([Uint8Array.of(0xff, 10)]), context)).rejects.toThrow()
  })

  it('rejects forged totals and non-canonical lengths even with a correctly recomputed header checksum', async () => {
    const text = await (await compressFileToText(file(), 'deflate', 'base64url', context)).textOutput!.blob.text()
    const [header, ...records] = text.split('\n')
    const changes = [
      (fields: string[]) => { fields[3] = (MAX_EXPANDED_BYTES + 1).toString(36) },
      (fields: string[]) => { fields[3] = MAX_EXPANDED_BYTES.toString(36); fields[4] = '74' },
      (fields: string[]) => { fields[4] = '2' },
      (fields: string[]) => { fields[3] = `0${fields[3]}` },
      (fields: string[]) => { fields[4] = '01' },
      (fields: string[]) => { fields[1] = 'unknown' },
      (fields: string[]) => { fields[2] = 'unknown' },
      (fields: string[]) => { fields[5] = 'W10' }, // Valid base64url/JSON, but missing file metadata.
    ]
    for (const change of changes) {
      const forged = `${resignHeader(header, change)}\n${records.join('\n')}`
      await expect(decompressTextContainer(new Blob([forged]), context)).rejects.toThrow()
    }
  })
})
