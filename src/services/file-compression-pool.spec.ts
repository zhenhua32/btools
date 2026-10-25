// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompressionChunkRequest, CompressionChunkResponse } from './file-compression-chunk'
import { FileCompressionPool } from './file-compression-pool'
import { FileChunkCodec } from './file-chunk-codec'

class ControlledWorker {
  static all: ControlledWorker[] = []
  onmessage: ((event: MessageEvent<CompressionChunkResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  request?: CompressionChunkRequest
  transfer?: Transferable[]
  terminated = false
  constructor() { ControlledWorker.all.push(this) }
  postMessage(request: CompressionChunkRequest, transfer: Transferable[]) { this.request = request; this.transfer = transfer }
  terminate() { this.terminated = true }
  complete() {
    this.onmessage?.({ data: { success: true, result: { index: this.request!.index, bytes: Uint8Array.of(42), characters: 1,
      sourceCrc: 0xffffffff, sourceBytes: this.request!.bytes.byteLength } } } as MessageEvent<CompressionChunkResponse>)
  }
}
const request = (index: number): CompressionChunkRequest => ({ index, bytes: Uint8Array.of(index), algorithm: 'gzip', encoding: 'base32768' })

beforeEach(() => { ControlledWorker.all = []; vi.stubGlobal('Worker', ControlledWorker) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('reusable file compression worker pool', () => {
  it('transfers input buffers, routes out-of-order replies and reuses idle workers', async () => {
    const pool = new FileCompressionPool(2)
    const firstRequest = request(0)
    const first = pool.run(firstRequest)
    const second = pool.run(request(1))
    expect(ControlledWorker.all).toHaveLength(2)
    expect(ControlledWorker.all[0].transfer).toEqual([firstRequest.bytes.buffer])
    ControlledWorker.all[1].complete()
    expect((await second).index).toBe(1)
    const third = pool.run(request(2))
    expect(ControlledWorker.all[1].request!.index).toBe(2)
    ControlledWorker.all[1].complete()
    ControlledWorker.all[0].complete()
    expect((await first).index).toBe(0)
    expect((await third).index).toBe(2)
    pool.terminate()
    expect(ControlledWorker.all.every((worker) => worker.terminated)).toBe(true)
  })

  it('never assigns two outstanding tasks to a slot', async () => {
    const pool = new FileCompressionPool(1)
    const first = pool.run(request(0))
    await expect(pool.run(request(1))).rejects.toThrow('已满')
    expect(ControlledWorker.all[0].request!.index).toBe(0)
    ControlledWorker.all[0].complete()
    await first
    pool.terminate()
  })

  it('immediately terminates every worker and rejects every pending task on abort', async () => {
    const controller = new AbortController()
    const pool = new FileCompressionPool(4, controller.signal)
    const pending = Promise.allSettled([pool.run(request(0)), pool.run(request(1))])
    controller.abort()
    expect(ControlledWorker.all.every((worker) => worker.terminated)).toBe(true)
    for (const result of await pending) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') expect(result.reason.name).toBe('AbortError')
    }
    await expect(pool.run(request(2))).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each(['runtime', 'response', 'message', 'malformed', 'missing result'] as const)('fails all workers on a %s error', async (kind) => {
    const pool = new FileCompressionPool(2)
    const pending = Promise.allSettled([pool.run(request(0)), pool.run(request(1))])
    const worker = ControlledWorker.all[1]
    if (kind === 'runtime') worker.onerror?.({ preventDefault() {} } as ErrorEvent)
    if (kind === 'message') worker.onmessageerror?.()
    if (kind === 'response') worker.onmessage?.({ data: { success: false, error: 'codec failed' } } as MessageEvent<CompressionChunkResponse>)
    if (kind === 'malformed') worker.onmessage?.({ data: { success: true, result: { index: 9, bytes: Uint8Array.of(1), characters: 1 } } } as MessageEvent<CompressionChunkResponse>)
    if (kind === 'missing result') worker.onmessage?.({ data: { success: true } } as MessageEvent<CompressionChunkResponse>)
    expect(ControlledWorker.all.every((candidate) => candidate.terminated)).toBe(true)
    expect((await pending).every((result) => result.status === 'rejected')).toBe(true)
  })

  it('cleans up previously created workers when initialization fails', () => {
    let created = 0
    expect(() => new FileCompressionPool(4, undefined, () => {
      if (++created === 3) throw new Error('worker construction failed')
      return new ControlledWorker() as unknown as Worker
    })).toThrow('worker construction failed')
    expect(ControlledWorker.all).toHaveLength(2)
    expect(ControlledWorker.all.every((worker) => worker.terminated)).toBe(true)
  })

  it('cleans up the whole pool on synchronous postMessage failure', async () => {
    const pool = new FileCompressionPool(2)
    ControlledWorker.all[0].postMessage = () => { throw new Error('transfer failed') }
    await expect(pool.run(request(0))).rejects.toThrow('transfer failed')
    expect(ControlledWorker.all.every((worker) => worker.terminated)).toBe(true)
  })

  it.each([
    { sourceCrc: -1 }, { sourceCrc: 0x100000000 }, { sourceCrc: 1.5 }, { sourceCrc: undefined },
    { sourceBytes: 0 }, { sourceBytes: 2 }, { characters: 2 },
    { bytes: new Uint8Array(2).subarray(0, 1) }, { bytes: new Uint8Array(27 * 1024 ** 2) },
  ])('rejects invalid source/record metadata: %o', async (changes) => {
    const pool = new FileCompressionPool(1)
    const job = pool.run(request(0))
    const rejection = expect(job).rejects.toThrow('数据无效')
    ControlledWorker.all[0].onmessage?.({ data: { success: true, result: {
      index: 0, bytes: Uint8Array.of(42), characters: 1, sourceCrc: 0, sourceBytes: 1, ...changes,
    } } } as MessageEvent<CompressionChunkResponse>)
    await rejection
    expect(ControlledWorker.all[0].terminated).toBe(true)
  })

  it('validates the original length after the input buffer has been transferred and detached', async () => {
    const pool = new FileCompressionPool(1)
    const worker = ControlledWorker.all[0]
    worker.postMessage = (message, transfer) => {
      worker.request = structuredClone(message, { transfer: transfer as ArrayBuffer[] })
    }
    const input = request(0)
    const job = pool.run(input)
    expect(input.bytes.byteLength).toBe(0)
    worker.complete()
    expect((await job).sourceBytes).toBe(1)
    pool.terminate()
  })

  it('reuses and disposes the operation-owned codec when browser Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    const dispose = vi.spyOn(FileChunkCodec.prototype, 'dispose')
    const compress = vi.spyOn(FileChunkCodec.prototype, 'compress')
    const pool = new FileCompressionPool(4)
    expect((await pool.run(request(0))).sourceBytes).toBe(1)
    expect((await pool.run(request(1))).sourceBytes).toBe(1)
    expect(compress.mock.instances[0]).toBe(compress.mock.instances[1])
    expect(dispose).not.toHaveBeenCalled()
    pool.terminate()
    pool.terminate()
    expect(dispose).toHaveBeenCalledOnce()
    await expect(pool.run(request(2))).rejects.toMatchObject({ name: 'AbortError' })
  })
})
