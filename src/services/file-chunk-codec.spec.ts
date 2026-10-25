// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compressFile } from './file-compression'
import { FileChunkCodec } from './file-chunk-codec'
import { loadFileBrotliEncoder } from './file-brotli'
import { loadZstd } from './text-compression'
import { FILE_CHUNK_BYTES } from './file-stream-types'

vi.mock('./file-compression', () => ({ compressFile: vi.fn() }))
vi.mock('./file-brotli', () => ({ loadFileBrotliEncoder: vi.fn() }))
vi.mock('./text-compression', () => ({ loadZstd: vi.fn() }))

const input = Uint8Array.of(1, 2, 3)
const output = Uint8Array.of(4, 5, 6)
const zstd = { createCCtx: vi.fn(() => 17), freeCCtx: vi.fn(), compressUsingDict: vi.fn(() => output) }
beforeEach(() => {
  vi.resetAllMocks()
  zstd.createCCtx.mockReturnValue(17)
  zstd.compressUsingDict.mockReturnValue(output)
  vi.mocked(loadZstd).mockResolvedValue(zstd as unknown as Awaited<ReturnType<typeof loadZstd>>)
  vi.mocked(loadFileBrotliEncoder).mockResolvedValue({ compress: () => output })
  vi.mocked(compressFile).mockResolvedValue({ algorithm: 'gzip', files: [{ name: 'chunk.gz', bytes: output }], originalBytes: 3, compressedBytes: 3, byteRatio: 1 })
})

describe('worker-owned file codec sessions', () => {
  it('reuses one Zstd context at level 19 without a dictionary and frees it once', async () => {
    const codec = new FileChunkCodec()
    await expect(codec.compress(input, 'zstd')).resolves.toBe(output)
    await codec.compress(input, 'zstd')
    expect(loadZstd).toHaveBeenCalledOnce()
    expect(zstd.createCCtx).toHaveBeenCalledOnce()
    expect(zstd.compressUsingDict).toHaveBeenNthCalledWith(1, 17, input, new Uint8Array(0), 19)
    expect(zstd.compressUsingDict).toHaveBeenNthCalledWith(2, 17, input, new Uint8Array(0), 19)
    codec.dispose(); codec.dispose()
    expect(zstd.freeCCtx).toHaveBeenCalledExactlyOnceWith(17)
    await expect(codec.compress(input, 'zstd')).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('frees a failed native context and allocates a fresh one on retry', async () => {
    zstd.compressUsingDict.mockImplementationOnce(() => { throw new Error('compression failed') })
    const codec = new FileChunkCodec()
    await expect(codec.compress(input, 'zstd')).rejects.toThrow('compression failed')
    expect(zstd.freeCCtx).toHaveBeenCalledExactlyOnceWith(17)
    await codec.compress(input, 'zstd')
    expect(zstd.createCCtx).toHaveBeenCalledTimes(2)
    codec.dispose()
    expect(zstd.freeCCtx).toHaveBeenCalledTimes(2)
  })

  it('rejects a null context without compressing or freeing a null pointer', async () => {
    zstd.createCCtx.mockReturnValue(0)
    const codec = new FileChunkCodec()
    await expect(codec.compress(input, 'zstd')).rejects.toThrow('分配失败')
    codec.dispose()
    expect(zstd.compressUsingDict).not.toHaveBeenCalled()
    expect(zstd.freeCCtx).not.toHaveBeenCalled()
  })

  it('does not mask a codec error if native context cleanup also fails', async () => {
    zstd.compressUsingDict.mockImplementationOnce(() => { throw new Error('compression failed') })
    zstd.freeCCtx.mockImplementationOnce(() => { throw new Error('cleanup failed') })
    const codec = new FileChunkCodec()
    await expect(codec.compress(input, 'zstd')).rejects.toThrow('compression failed')
    expect(() => codec.dispose()).not.toThrow()
    expect(zstd.freeCCtx).toHaveBeenCalledOnce()
  })

  it.each(['brotli', 'zstd'] as const)('retries %s initialization after failure', async (algorithm) => {
    const loader = algorithm === 'brotli' ? vi.mocked(loadFileBrotliEncoder) : vi.mocked(loadZstd)
    loader.mockRejectedValueOnce(new Error('initialization failed'))
    const codec = new FileChunkCodec()
    await expect(codec.compress(input, algorithm)).rejects.toThrow('initialization failed')
    await expect(codec.compress(input, algorithm)).resolves.toBe(output)
    expect(loader).toHaveBeenCalledTimes(2)
    codec.dispose()
  })

  it('does not allocate a Zstd context if disposed while loading', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof loadZstd>>) => void
    vi.mocked(loadZstd).mockReturnValue(new Promise((done) => { resolve = done }))
    const codec = new FileChunkCodec()
    const pending = codec.compress(input, 'zstd')
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    codec.dispose()
    resolve(zstd as unknown as Awaited<ReturnType<typeof loadZstd>>)
    await rejection
    expect(zstd.createCCtx).not.toHaveBeenCalled()
  })

  it('does not retain or use a Brotli instance resolved after disposal', async () => {
    const compress = vi.fn(() => output)
    let resolve!: (value: { compress: typeof compress }) => void
    vi.mocked(loadFileBrotliEncoder).mockReturnValue(new Promise((done) => { resolve = done }))
    const codec = new FileChunkCodec()
    const pending = codec.compress(input, 'brotli')
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    codec.dispose(); resolve({ compress })
    await rejection
    expect(compress).not.toHaveBeenCalled()
  })

  it('retains ZIP naming/quality and forwards LZMA timeouts', async () => {
    const codec = new FileChunkCodec()
    await codec.compress(input, 'zip')
    await codec.compress(input, 'lzma', { lzmaTimeoutMs: 1920000 })
    expect(compressFile).toHaveBeenNthCalledWith(1, { name: 'chunk.bin', bytes: input }, 'zip', {})
    expect(compressFile).toHaveBeenNthCalledWith(2, { name: 'chunk.bin', bytes: input }, 'lzma', { lzmaTimeoutMs: 1920000 })
    codec.dispose()
  })

  it('rejects oversized input before any codec initialization', async () => {
    const codec = new FileChunkCodec()
    await expect(codec.compress(new Uint8Array(FILE_CHUNK_BYTES + 1), 'brotli')).rejects.toThrow('4 MiB')
    expect(loadFileBrotliEncoder).not.toHaveBeenCalled()
    codec.dispose()
  })
})
