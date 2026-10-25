// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { brotliDecompressSync } from 'node:zlib'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createFileBrotliEncoder } from './file-brotli'
import type { FileBrotliEncoder } from './file-brotli'
import { FILE_CHUNK_BYTES } from './file-stream-types'

const wasm = Uint8Array.from(readFileSync(new URL('../../third_party/brotli/brotli-file-encoder.wasm', import.meta.url)))
const reference = createRequire(import.meta.url)('brotli-wasm') as { compress(bytes: Uint8Array, options: { quality: number }): Uint8Array }
let encoder: FileBrotliEncoder
beforeAll(async () => { encoder = await createFileBrotliEncoder(wasm) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('bundled file Brotli encoder', () => {
  it('matches the recorded binary and dependency-lock hashes', () => {
    const info = JSON.parse(readFileSync(new URL('../../third_party/brotli/build-info.json', import.meta.url), 'utf8'))
    const lock = readFileSync(new URL('../../third_party/brotli/Cargo.lock', import.meta.url))
    expect(createHash('sha256').update(wasm).digest('hex')).toBe(info.wasmSha256)
    expect(createHash('sha256').update(lock).digest('hex')).toBe(info.cargoLockSha256)
    expect(info.rustc).toMatch(/^rustc 1\.85\.1 /)
    expect(info.profile).toContain('opt-level=3')
  })

  const random = new Uint8Array(65536)
  let state = 0x19a5f32
  for (let index = 0; index < random.length; index++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; random[index] = state }
  const largest = Uint8Array.from({ length: FILE_CHUNK_BYTES }, (_, index) => index % 251)
  it.each([
    ['empty', new Uint8Array(0)],
    ['single byte', Uint8Array.of(0)],
    ['Unicode/BOM/NUL', new TextEncoder().encode('\ufeff中文🌏\0\r\n'.repeat(500))],
    ['high entropy nonzero offset', random.subarray(11, 65000)],
    ['maximum block', largest],
  ] as const)('keeps exact level-11 bytes and independently round trips %s', (_name, input) => {
    const compressed = encoder.compress(input)
    expect(compressed).toEqual(reference.compress(input, { quality: 11 }))
    expect(Buffer.compare(brotliDecompressSync(compressed), Buffer.from(input))).toBe(0)
    expect(compressed.buffer).toBeInstanceOf(ArrayBuffer)
    expect(compressed.byteOffset).toBe(0)
    expect(compressed.buffer.byteLength).toBe(compressed.byteLength)
  })

  it('returns owned output that survives later calls and can be transferred', () => {
    const input = new TextEncoder().encode('copyable binary output '.repeat(300))
    const first = encoder.compress(input)
    const expected = first.slice()
    encoder.compress(largest)
    expect(first).toEqual(expected)
    const transferred = structuredClone(first, { transfer: [first.buffer] })
    expect(first.byteLength).toBe(0)
    expect(transferred).toEqual(expected)
    expect(encoder.compress(input)).toEqual(expected)
  })

  it('rejects oversized blocks before entering the native encoder', () => {
    expect(() => encoder.compress(new Uint8Array(FILE_CHUNK_BYTES + 1))).toThrow('4 MiB')
  })

  it('rejects truncated binaries, unexpected imports and a missing ABI', async () => {
    await expect(createFileBrotliEncoder(wasm.subarray(0, 127))).rejects.toThrow()
    const importedFunction = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 7, 1, 1, 109, 1, 102, 0, 0)
    await expect(createFileBrotliEncoder(importedFunction)).rejects.toThrow('外部依赖')
    await expect(createFileBrotliEncoder(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0))).rejects.toThrow('接口无效')
  })

  it.each(['network', 'http', 'compile', 'abi'] as const)('can retry initialization after a %s failure', async (failure) => {
    vi.resetModules()
    const fetcher = vi.fn()
    if (failure === 'network') fetcher.mockRejectedValueOnce(new Error('network failed'))
    if (failure === 'http') fetcher.mockResolvedValueOnce(new Response(null, { status: 500 }))
    if (failure === 'compile') fetcher.mockResolvedValueOnce(new Response(Uint8Array.of(1, 2, 3)))
    if (failure === 'abi') fetcher.mockResolvedValueOnce(new Response(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)))
    fetcher.mockImplementation(async () => new Response(wasm))
    vi.stubGlobal('fetch', fetcher)
    const { loadFileBrotliEncoder } = await import('./file-brotli')
    await expect(loadFileBrotliEncoder()).rejects.toThrow()
    const [a, b] = await Promise.all([loadFileBrotliEncoder(), loadFileBrotliEncoder()])
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(a).not.toBe(b)
    const input = random.subarray(0, 1024)
    expect(a.compress(input)).toEqual(b.compress(input))
  })
})
