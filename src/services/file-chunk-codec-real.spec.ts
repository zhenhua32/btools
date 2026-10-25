// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { FileChunkCodec } from './file-chunk-codec'
import { compressFile, decompressFile } from './file-compression'

vi.mock('./file-brotli', async (actual) => {
  const module = await actual<typeof import('./file-brotli')>()
  return { ...module, loadFileBrotliEncoder: () => module.createFileBrotliEncoder(Uint8Array.from(readFileSync(new URL('../../third_party/brotli/brotli-file-encoder.wasm', import.meta.url)))) }
})
vi.mock('../../node_modules/brotli-wasm/pkg.web/brotli_wasm.js', async () => {
  const { createRequire: factory } = await import('node:module')
  return { ...factory(import.meta.url)('brotli-wasm'), default: async () => undefined }
})
vi.mock('../../node_modules/@bokuweb/zstd-wasm/dist/web/index.web.js', async () => {
  const { createRequire: factory } = await import('node:module')
  const zstd = factory(import.meta.url)('@bokuweb/zstd-wasm')
  return { ...zstd, init: () => zstd.init() }
})

describe('real file chunk codec compatibility', () => {
  const referenceZstd = createRequire(import.meta.url)('@bokuweb/zstd-wasm')
  it.each(['brotli', 'zstd', 'gzip', 'deflate', 'zip'] as const)('matches the original %s bytes across reused sessions', async (algorithm) => {
    const codec = new FileChunkCodec()
    const first = new TextEncoder().encode('\ufeff中文🌍\0BTF2 data\r\n'.repeat(2000))
    const second = Uint8Array.from({ length: 32000 }, (_, index) => (index * 11 + (index >>> 4)) & 255).subarray(3)
    try {
      for (const input of [first, second, first]) {
        const compressed = await codec.compress(input, algorithm)
        const reference = await compressFile({ name: 'chunk.bin', bytes: input }, algorithm)
        expect(compressed).toEqual(reference.files[0].bytes)
        if (algorithm === 'zstd') expect(compressed).toEqual(referenceZstd.compress(input, 19))
        const restored = await decompressFile({ name: 'chunk.bin', bytes: compressed }, algorithm)
        expect(restored.files[0].bytes).toEqual(input)
      }
    } finally { codec.dispose() }
  })
})
