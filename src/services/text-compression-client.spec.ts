/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressText, decompressText } from './text-compression-client'
import type { CompressionResult } from './text-compression-types'

let worker: FakeWorker

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() {
    worker = this
  }
}

const result: CompressionResult = {
  text: 'compressed',
  algorithm: 'brotli',
  encoding: 'base32768',
  original: { characters: 20, utf8Bytes: 60 },
  compressed: { characters: 10, utf8Bytes: 30 },
  characterRatio: 0.5,
  byteRatio: 0.5,
}

describe('text compression worker client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends the default codec settings and terminates the worker after success', async () => {
    const pending = compressText('原文')
    expect(worker.postMessage).toHaveBeenCalledWith({
      operation: 'compress', input: '原文', algorithm: 'brotli', encoding: 'base32768',
    })
    worker.onmessage!(new MessageEvent('message', { data: { success: true, result } }))
    await expect(pending).resolves.toEqual(result)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves decompression errors and releases the worker', async () => {
    const pending = decompressText('损坏的数据')
    const assertion = expect(pending).rejects.toThrow('校验失败')
    expect(worker.postMessage).toHaveBeenCalledWith({ operation: 'decompress', input: '损坏的数据' })
    worker.onmessage!(new MessageEvent('message', {
      data: { success: false, error: '校验失败' },
    }))
    await assertion
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('rejects a worker loading failure without leaving a pending timeout', async () => {
    const pending = compressText('原文')
    const assertion = expect(pending).rejects.toThrow('加载或执行失败')
    const preventDefault = vi.fn()
    worker.onerror!({ preventDefault } as unknown as ErrorEvent)
    await assertion
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('terminates an unresponsive codec and reports a timeout', async () => {
    const pending = compressText('原文', 'lzma', 'base64url')
    const assertion = expect(pending).rejects.toThrow('处理超时')
    await vi.advanceTimersByTimeAsync(120_000)
    await assertion
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('reports failure to create a worker', async () => {
    vi.stubGlobal('Worker', class {
      constructor() { throw new Error('blocked') }
    })
    await expect(compressText('原文')).rejects.toThrow('无法启动文本压缩')
    expect(vi.getTimerCount()).toBe(0)
  })
})
