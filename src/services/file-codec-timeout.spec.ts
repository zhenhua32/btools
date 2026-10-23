// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressBinaryBytes } from './text-compression'

let workers: IdleCodecWorker[]
class IdleCodecWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { workers.push(this) }
}

describe('LZMA codec deadlines under file concurrency', () => {
  beforeEach(() => {
    workers = []
    vi.useFakeTimers()
    vi.stubGlobal('Worker', IdleCodecWorker)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('retains the original two-minute deadline when no file deadline is specified', async () => {
    const pending = compressBinaryBytes(Uint8Array.of(1), 'lzma')
    const assertion = expect(pending).rejects.toThrow('LZMA 处理超时')
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(120_000)
    await assertion
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows a concurrent file block to finish beyond the original deadline and releases its timer', async () => {
    const pending = compressBinaryBytes(Uint8Array.of(1), 'lzma', { lzmaTimeoutMs: 120_000 * 16 })
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(120_001)
    expect(workers[0]!.terminate).not.toHaveBeenCalled()
    workers[0]!.onmessage!(new MessageEvent('message', { data: { action: 1, cbn: 1, result: [1, -1, 0] } }))
    await expect(pending).resolves.toEqual(Uint8Array.of(1, 255, 0))
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([0, Number.NaN, 32 * 60_000 + 1])('rejects an invalid finite codec deadline: %s', async (lzmaTimeoutMs) => {
    await expect(compressBinaryBytes(Uint8Array.of(1), 'lzma', { lzmaTimeoutMs })).rejects.toThrow('超时设置无效')
    expect(workers).toHaveLength(0)
  })
})
