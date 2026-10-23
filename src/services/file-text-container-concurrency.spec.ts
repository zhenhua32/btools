// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompressionChunkRequest, CompressionChunkResponse } from './file-compression-chunk'
import { compressFileToText } from './file-text-container'
import { FILE_CHUNK_BYTES, MAX_UPLOAD_BYTES } from './file-stream-types'
import * as outputStorage from './file-output-storage'

// This scheduler test avoids codec work and reuses one 4 MiB input buffer even at the 1 GiB boundary.
// Separate real-codec container tests verify every record/checksum and all supported encodings.
vi.mock('./file-compression-chunk', () => ({
  characters: (text: string) => Array.from(text).length,
  checksum: () => '00000000',
  crcHex: () => '00000000',
  updateCrc: (crc: number) => crc,
  compressChunk: vi.fn(),
}))

class ScheduledWorker {
  static all: ScheduledWorker[] = []
  static automatic = false
  static dispatched: number[] = []
  onmessage: ((event: MessageEvent<CompressionChunkResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  request?: CompressionChunkRequest
  terminated = false
  constructor() { ScheduledWorker.all.push(this) }
  postMessage(request: CompressionChunkRequest) {
    this.request = request
    ScheduledWorker.dispatched.push(request.index)
    if (ScheduledWorker.automatic) queueMicrotask(() => this.complete())
  }
  complete() {
    const index = this.request!.index
    this.onmessage?.({ data: { success: true, result: {
      index, bytes: new TextEncoder().encode(`C:${index.toString(36)}\n`), characters: 3 + index.toString(36).length,
    } } } as MessageEvent<CompressionChunkResponse>)
  }
  terminate() { this.terminated = true }
}
const block = new Uint8Array(FILE_CHUNK_BYTES)
function virtualFile(size: number) {
  return { size, name: 'virtual.bin', type: '', slice: vi.fn((start: number, end: number) => ({
    arrayBuffer: async () => end - start === block.length ? block.buffer : block.buffer.slice(0, end - start),
  })) } as unknown as File
}
async function tick() { for (let index = 0; index < 24; index++) await Promise.resolve() }
beforeEach(() => {
  ScheduledWorker.all = []; ScheduledWorker.dispatched = []; ScheduledWorker.automatic = false
  vi.stubGlobal('Worker', ScheduledWorker)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('ordered bounded compression scheduling', () => {
  it('keeps running plus out-of-order records bounded when the first block is slow', async () => {
    const input = virtualFile(FILE_CHUNK_BYTES * 6)
    const job = compressFileToText(input, 'gzip', 'base32768', { operationId: 'scheduler', concurrency: 4 })
    await tick()
    expect(ScheduledWorker.dispatched).toEqual([0, 1, 2, 3])
    for (const worker of ScheduledWorker.all.slice(1)) worker.complete()
    await tick()
    expect(ScheduledWorker.dispatched).toEqual([0, 1, 2, 3])
    expect(input.slice).toHaveBeenCalledTimes(4)
    ScheduledWorker.automatic = true
    ScheduledWorker.all[0].complete()
    const output = (await job).textOutput!
    expect((await output.blob.text()).split('\n').slice(1, -2)).toEqual(['C:0', 'C:1', 'C:2', 'C:3', 'C:4', 'C:5'])
    expect(output.parts).toHaveLength(6)
    expect(ScheduledWorker.all.every((worker) => worker.terminated)).toBe(true)
  })

  it.each([1, 2, 4, 8, 16] as const)('streams all 256 blocks at the 1 GiB boundary with %i reusable workers', async (concurrency) => {
    ScheduledWorker.automatic = true
    const input = virtualFile(MAX_UPLOAD_BYTES)
    const output = (await compressFileToText(input, 'gzip', 'base32768', { operationId: 'scheduler', concurrency })).textOutput!
    expect(ScheduledWorker.all).toHaveLength(concurrency)
    expect(ScheduledWorker.dispatched).toEqual(Array.from({ length: 256 }, (_, index) => index))
    expect(input.slice).toHaveBeenCalledTimes(256)
    expect(input.slice).toHaveBeenLastCalledWith(MAX_UPLOAD_BYTES - FILE_CHUNK_BYTES, MAX_UPLOAD_BYTES)
    expect(output.parts).toHaveLength(256)
    expect(output.parts.reduce((sum, part) => sum + part.size, 0)).toBe(output.blob.size)
    expect(ScheduledWorker.all.every((worker) => worker.terminated)).toBe(true)
  })

  it('stops reading and terminates every nested worker on cancellation', async () => {
    const originalCreateSink = outputStorage.createOutputSink
    const abort = vi.fn()
    vi.spyOn(outputStorage, 'createOutputSink').mockImplementation(async (...args) => {
      const sink = await originalCreateSink(...args)
      return { ...sink, get size() { return sink.size }, abort: async () => { abort(); await sink.abort() } }
    })
    const controller = new AbortController()
    const input = virtualFile(MAX_UPLOAD_BYTES)
    const job = compressFileToText(input, 'gzip', 'base32768', { operationId: 'scheduler', concurrency: 4, signal: controller.signal })
    const rejection = expect(job).rejects.toMatchObject({ name: 'AbortError' })
    await tick()
    controller.abort()
    expect(ScheduledWorker.all.every((worker) => worker.terminated)).toBe(true)
    await rejection
    expect(abort).toHaveBeenCalledOnce()
    expect(input.slice).toHaveBeenCalledTimes(4)
  })

  it('cleans up all workers and stops reading if a codec fails out of order', async () => {
    const input = virtualFile(MAX_UPLOAD_BYTES)
    const job = compressFileToText(input, 'gzip', 'base32768', { operationId: 'scheduler', concurrency: 4 })
    const rejection = expect(job).rejects.toThrow('codec failed')
    await tick()
    ScheduledWorker.all[2].onmessage?.({ data: { success: false, error: 'codec failed' } } as MessageEvent<CompressionChunkResponse>)
    await rejection
    expect(ScheduledWorker.all.every((worker) => worker.terminated)).toBe(true)
    expect(input.slice).toHaveBeenCalledTimes(4)
  })

  it('aborts the output and terminates running workers when a disk write fails', async () => {
    const originalCreateSink = outputStorage.createOutputSink
    const abort = vi.fn()
    vi.spyOn(outputStorage, 'createOutputSink').mockImplementation(async (...args) => {
      const sink = await originalCreateSink(...args)
      let writes = 0
      return { ...sink, get size() { return sink.size },
        write: async (bytes: Uint8Array) => {
          if (++writes > 1) throw new Error('disk full')
          await sink.write(bytes)
        },
        abort: async () => { abort(); await sink.abort() },
      }
    })
    ScheduledWorker.automatic = true
    const input = virtualFile(MAX_UPLOAD_BYTES)
    await expect(compressFileToText(input, 'gzip', 'base32768', { operationId: 'scheduler', concurrency: 4 })).rejects.toThrow('disk full')
    expect(abort).toHaveBeenCalledOnce()
    expect(ScheduledWorker.all.every((worker) => worker.terminated)).toBe(true)
    expect(input.slice).toHaveBeenCalledTimes(4)
  })

  it('scales the LZMA chunk budget, reports real completed bytes while busy and clears its heartbeat on cancel', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const progress = vi.fn()
    const input = virtualFile(FILE_CHUNK_BYTES * 3)
    const job = compressFileToText(input, 'lzma', 'base32768', {
      operationId: 'scheduler', concurrency: 2, signal: controller.signal, onProgress: progress,
    })
    const rejection = expect(job).rejects.toMatchObject({ name: 'AbortError' })
    await tick()
    expect(ScheduledWorker.all.map((worker) => worker.request!.lzmaTimeoutMs)).toEqual([240000, 240000])
    await vi.advanceTimersByTimeAsync(10000)
    expect(progress).toHaveBeenLastCalledWith({ stage: '正在压缩并编码', completed: 0, total: input.size })
    ScheduledWorker.all[0].complete()
    await tick()
    await vi.advanceTimersByTimeAsync(10000)
    expect(progress).toHaveBeenLastCalledWith({ stage: '正在压缩并编码', completed: FILE_CHUNK_BYTES, total: input.size })
    controller.abort()
    await rejection
    const calls = progress.mock.calls.length
    await vi.advanceTimersByTimeAsync(30000)
    expect(progress).toHaveBeenCalledTimes(calls)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a heartbeat or change codec timeouts for other algorithms', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const job = compressFileToText(virtualFile(FILE_CHUNK_BYTES), 'gzip', 'base32768', {
      operationId: 'scheduler', concurrency: 16, signal: controller.signal,
    })
    const rejection = expect(job).rejects.toMatchObject({ name: 'AbortError' })
    await tick()
    expect(ScheduledWorker.all[0].request!.lzmaTimeoutMs).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    controller.abort()
    await rejection
  })
})
