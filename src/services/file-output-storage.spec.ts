// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupOperationStorage, createOutputSink, releaseProcessedResult } from './file-output-storage'
import type { FileCompressionResult } from './file-compression-types'

class MockFile {
  kind = 'file'
  bytes = new Uint8Array()
  lastModified = Date.now()
  closed = false
  partialWrites = false
  sync = true
  async getFile() { return new File([this.bytes], 'opfs', { lastModified: this.lastModified }) }
  createSyncAccessHandle = async () => ({
    write: (bytes: Uint8Array, { at }: { at: number }) => {
      const size = this.partialWrites ? Math.min(2, bytes.length) : bytes.length
      const output = new Uint8Array(Math.max(this.bytes.length, at + size))
      output.set(this.bytes)
      output.set(bytes.subarray(0, size), at)
      this.bytes = output
      return size
    },
    flush: vi.fn(),
    close: () => { this.closed = true },
  })
  createWritable = async () => ({
    write: async (bytes: Uint8Array) => {
      const output = new Uint8Array(this.bytes.length + bytes.length)
      output.set(this.bytes)
      output.set(bytes, this.bytes.length)
      this.bytes = output
    },
    close: async () => { this.closed = true },
    abort: async () => { this.closed = true },
  })
}
class MockDirectory {
  kind = 'directory'
  contents = new Map<string, MockDirectory | MockFile>()
  useAsync = false
  partialWrites = false
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MockDirectory> {
    if (!this.contents.has(name) && options?.create) {
      const directory = new MockDirectory()
      directory.useAsync = this.useAsync
      directory.partialWrites = this.partialWrites
      this.contents.set(name, directory)
    }
    const entry = this.contents.get(name)
    if (!(entry instanceof MockDirectory)) throw new DOMException('missing', 'NotFoundError')
    return entry
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFile> {
    if (!this.contents.has(name) && options?.create) {
      const file = new MockFile()
      file.partialWrites = this.partialWrites
      if (this.useAsync) Object.defineProperty(file, 'createSyncAccessHandle', { value: undefined })
      this.contents.set(name, file)
    }
    const entry = this.contents.get(name)
    if (!(entry instanceof MockFile)) throw new DOMException('missing', 'NotFoundError')
    return entry
  }
  async removeEntry(name: string, options?: { recursive?: boolean }) {
    const entry = this.contents.get(name)
    if (!entry) throw new DOMException('missing', 'NotFoundError')
    if (entry instanceof MockDirectory && entry.contents.size && !options?.recursive) throw new DOMException('not empty', 'InvalidModificationError')
    this.contents.delete(name)
  }
  async *entries(): AsyncIterableIterator<[string, MockFile | MockDirectory]> { yield* this.contents.entries() }
}
function mockStorage(useAsync = false, partialWrites = false) {
  const root = new MockDirectory()
  root.useAsync = useAsync
  root.partialWrites = partialWrites
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } })
  return root
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('large file output storage', () => {
  it('uses a bounded memory fallback and snapshots caller-owned bytes', async () => {
    vi.stubGlobal('navigator', {})
    const sink = await createOutputSink({ operationId: 'memory' }, 'file', 'image/test')
    const bytes = Uint8Array.of(1, 2, 3)
    await sink.write(bytes)
    bytes.fill(0)
    expect(sink.size).toBe(3)
    const output = await sink.finish()
    expect(output.type).toBe('image/test')
    expect(output.storageKey).toBeUndefined()
    expect(new Uint8Array(await output.blob.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))
    await expect(sink.write(bytes)).rejects.toThrow('关闭')
    await expect(sink.finish()).rejects.toThrow('关闭')
  })

  it('rejects large output without OPFS before allocating the bytes', async () => {
    vi.stubGlobal('navigator', {})
    const sink = await createOutputSink({ operationId: 'memory-limit' }, 'file', '')
    const huge = { length: 64 * 1024 ** 2 + 1, slice: vi.fn() } as unknown as Uint8Array
    await expect(sink.write(huge)).rejects.toThrow('64 MiB')
    expect(huge.slice).not.toHaveBeenCalled()
    await sink.abort()
    await expect(sink.finish()).rejects.toThrow('关闭')
    await expect(cleanupOperationStorage('missing')).resolves.toBeUndefined()
  })

  for (const asyncWrite of [false, true]) {
    it(`writes through ${asyncWrite ? 'createWritable' : 'SyncAccessHandle'} with no aggregate memory buffer`, async () => {
      const root = mockStorage(asyncWrite, true)
      const sink = await createOutputSink({ operationId: 'disk' }, 'result.txt', 'text/plain')
      await sink.write(Uint8Array.of(1, 2, 3, 4, 5))
      await sink.write(Uint8Array.of(6, 7))
      expect(sink.size).toBe(7)
      const output = await sink.finish()
      expect(output.storageKey).toMatch(/^op-disk\/out-/)
      expect(new Uint8Array(await output.blob.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3, 4, 5, 6, 7))
      const own = await root.getDirectoryHandle('btools-file-outputs')
      expect((await own.getDirectoryHandle('op-disk')).contents.size).toBe(1)
      await cleanupOperationStorage('disk')
      expect(own.contents.has('op-disk')).toBe(false)
    })
  }

  it('aborts and removes partial files without touching unrelated storage', async () => {
    const root = mockStorage()
    await root.getDirectoryHandle('unrelated', { create: true })
    const sink = await createOutputSink({ operationId: 'cancel' }, 'file', '')
    await sink.write(Uint8Array.of(1, 2))
    await sink.abort()
    await sink.abort()
    expect(root.contents.has('unrelated')).toBe(true)
    const own = await root.getDirectoryHandle('btools-file-outputs')
    expect(own.contents.has('op-cancel')).toBe(false)
    await expect(createOutputSink({ operationId: '../unrelated' }, 'file', '')).rejects.toThrow('标识')
  })

  it('keeps active downloads alive for 60 seconds and releases each result only once', async () => {
    vi.useFakeTimers()
    const root = mockStorage()
    const sink = await createOutputSink({ operationId: 'release' }, 'file', '')
    await sink.write(Uint8Array.of(9))
    const output = await sink.finish()
    const own = await root.getDirectoryHandle('btools-file-outputs')
    const result = { outputs: [output], textOutput: output } as FileCompressionResult
    releaseProcessedResult(result)
    await vi.advanceTimersByTimeAsync(59999)
    expect(own.contents.has('op-release')).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(own.contents.has('op-release')).toBe(false)
    releaseProcessedResult(undefined)
  })

  it('only expires old tool-owned files with known timestamps and leaves concurrent empty operation folders', async () => {
    const root = mockStorage()
    const own = await root.getDirectoryHandle('btools-file-outputs', { create: true })
    const old = await own.getDirectoryHandle('op-old', { create: true })
    const stale = await old.getFileHandle('out-old', { create: true })
    stale.lastModified = Date.now() - 2 * 24 * 60 * 60 * 1000
    await own.getDirectoryHandle('op-concurrent', { create: true })
    await own.getDirectoryHandle('unrelated', { create: true })
    const sink = await createOutputSink({ operationId: 'new' }, 'file', '')
    expect(own.contents.has('op-old')).toBe(false)
    expect(own.contents.has('op-concurrent')).toBe(true)
    expect(own.contents.has('unrelated')).toBe(true)
    await sink.abort()
  })

  it('retries cancellation deletion after a terminated worker releases its OPFS lock', async () => {
    vi.useFakeTimers()
    const root = mockStorage()
    const own = await root.getDirectoryHandle('btools-file-outputs', { create: true })
    await own.getDirectoryHandle('op-retry', { create: true })
    const original = own.removeEntry.bind(own)
    const remove = vi.spyOn(own, 'removeEntry')
      .mockRejectedValueOnce(new DOMException('locked', 'NoModificationAllowedError'))
      .mockRejectedValueOnce(new DOMException('locked', 'NoModificationAllowedError'))
      .mockImplementation(original)
    const cleanup = cleanupOperationStorage('retry')
    await vi.advanceTimersByTimeAsync(250)
    await cleanup
    expect(remove).toHaveBeenCalledTimes(3)
    expect(own.contents.has('op-retry')).toBe(false)
  })
})
