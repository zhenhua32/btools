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
  static running = 0
  static peakRunning = 0
  onmessage: ((event: MessageEvent<CompressionChunkResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  request?: CompressionChunkRequest
  terminated = false
  pending = false
  constructor() { ScheduledWorker.all.push(this) }
  postMessage(request: CompressionChunkRequest) {
    this.request = request
    this.pending = true
    ScheduledWorker.running++
    ScheduledWorker.peakRunning = Math.max(ScheduledWorker.running, ScheduledWorker.peakRunning)
    ScheduledWorker.dispatched.push(request.index)
    if (ScheduledWorker.automatic) queueMicrotask(() => { if (this.request?.index === request.index) this.complete() })
  }
  complete(bytes?: Uint8Array<ArrayBuffer>) {
    if (!this.pending || this.terminated) return
    this.pending = false
    ScheduledWorker.running--
    const index = this.request!.index
    this.onmessage?.({ data: { success: true, result: {
      index, bytes: bytes ?? new TextEncoder().encode(`C:${index.toString(36)}\n`), characters: 3 + index.toString(36).length,
      sourceCrc: 0, sourceBytes: this.request!.bytes.byteLength,
    } } } as MessageEvent<CompressionChunkResponse>)
  }
  terminate() { this.terminated = true; if (this.pending) ScheduledWorker.running--; this.pending = false }
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
  ScheduledWorker.running = 0; ScheduledWorker.peakRunning = 0
  vi.stubGlobal('Worker', ScheduledWorker)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('ordered bounded compression scheduling', () => {
  it('refills idle slots immediately, then stops at 2C unread/unwritten blocks when the first block is slow', async () => {
    const input = virtualFile(FILE_CHUNK_BYTES * 12)
    const job = compressFileToText(input, 'gzip', 'base32768', { operationId: 'scheduler', concurrency: 4 })
    await tick()
    expect(ScheduledWorker.dispatched).toEqual([0, 1, 2, 3])
    for (let round = 0; round < 4; round++) {
      for (const worker of ScheduledWorker.all.slice(1)) worker.complete()
      await tick()
    }
    expect(ScheduledWorker.dispatched).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(input.slice).toHaveBeenCalledTimes(8)
    expect(ScheduledWorker.peakRunning).toBeLessThanOrEqual(4)
    ScheduledWorker.automatic = true
    ScheduledWorker.all[0].complete()
    const output = (await job).textOutput!
    expect((await output.blob.text()).split('\n').slice(1, -2)).toEqual(Array.from({ length: 12 }, (_, index) => `C:${index.toString(36)}`))
    expect(output.parts).toHaveLength(12)
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
    expect(ScheduledWorker.peakRunning).toBeLessThanOrEqual(concurrency)
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
    // Completed slots can start one source read before the failed write is observed.
    const reads = vi.mocked(input.slice).mock.calls.length
    expect(reads).toBeLessThanOrEqual(8)
    await tick()
    expect(input.slice).toHaveBeenCalledTimes(reads)
  })

  it.each(['cancel', 'codec error'] as const)('awaits the only source read and never dispatches it after %s', async (reason) => {
    let releaseRead!: (buffer: ArrayBuffer) => void
    let readInFlight = false
    const input = virtualFile(MAX_UPLOAD_BYTES)
    vi.mocked(input.slice).mockImplementation((start, end) => ({ arrayBuffer: async () => {
      if (start === FILE_CHUNK_BYTES * 4) {
        readInFlight = true
        return new Promise<ArrayBuffer>((resolve) => { releaseRead = resolve })
      }
      return block.buffer.slice(0, end! - start!)
    } } as Blob))
    const controller = new AbortController()
    const job = compressFileToText(input, 'gzip', 'base32768', { operationId: 'scheduler', concurrency: 4, signal: controller.signal })
    const rejection = reason === 'cancel' ? expect(job).rejects.toMatchObject({ name: 'AbortError' }) : expect(job).rejects.toThrow('codec failed')
    let finished = false
    void job.then(() => { finished = true }, () => { finished = true })
    await tick()
    ScheduledWorker.all[1].complete()
    await tick()
    expect(readInFlight).toBe(true)
    expect(ScheduledWorker.dispatched).toEqual([0, 1, 2, 3])
    if (reason === 'cancel') controller.abort()
    else ScheduledWorker.all[2].onmessage?.({ data: { success: false, error: 'codec failed' } } as MessageEvent<CompressionChunkResponse>)
    await tick()
    expect(ScheduledWorker.all.every((worker) => worker.terminated)).toBe(true)
    expect(finished).toBe(false)
    releaseRead(block.buffer)
    await rejection
    await tick()
    expect(ScheduledWorker.dispatched).toEqual([0, 1, 2, 3])
    expect(input.slice).toHaveBeenCalledTimes(5)
  })

  it('terminates earlier jobs and aborts the output when a refill read fails', async () => {
    const input = virtualFile(MAX_UPLOAD_BYTES)
    vi.mocked(input.slice).mockImplementation((start, end) => ({ arrayBuffer: async () => {
      if (start === FILE_CHUNK_BYTES * 4) throw new Error('read denied')
      return block.buffer.slice(0, end! - start!)
    } } as Blob))
    const job = compressFileToText(input, 'gzip', 'base32768', { operationId: 'scheduler', concurrency: 4 })
    const rejection = expect(job).rejects.toThrow('read denied')
    await tick()
    ScheduledWorker.all[1].complete()
    await rejection
    expect(ScheduledWorker.all.every((worker) => worker.terminated)).toBe(true)
    expect(ScheduledWorker.dispatched).toEqual([0, 1, 2, 3])
    expect(input.slice).toHaveBeenCalledTimes(5)
  })

  it('applies byte backpressure to large out-of-order records before the 2C window fills', async () => {
    const controller = new AbortController()
    const input = virtualFile(FILE_CHUNK_BYTES * 20)
    const job = compressFileToText(input, 'gzip', 'base32768', { operationId: 'scheduler', concurrency: 4, signal: controller.signal })
    const rejection = expect(job).rejects.toMatchObject({ name: 'AbortError' })
    await tick()
    for (const index of [1, 2, 3]) {
      ScheduledWorker.all.find((worker) => worker.request!.index === index)!.complete(new Uint8Array(22 * 1024 ** 2))
      await tick()
    }
    // Three completed 22 MiB records cross the soft 64 MiB threshold. The first
    // two completed slots were refilled; no new read starts after the third.
    expect(ScheduledWorker.dispatched).toEqual([0, 1, 2, 3, 4, 5])
    expect(input.slice).toHaveBeenCalledTimes(6)
    expect(ScheduledWorker.peakRunning).toBeLessThanOrEqual(4)
    controller.abort()
    await rejection
    expect(ScheduledWorker.all.every((worker) => worker.terminated)).toBe(true)
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
