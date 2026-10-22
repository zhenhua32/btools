/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressFile, compressText, decompressFile, decompressText } from './text-compression-client'
import type { CompressionResult } from './text-compression-types'
import type { FileCompressionResult } from './file-compression-types'

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

  it('sends uploaded files without converting binary bytes to text', async () => {
    const file = new File([Uint8Array.of(0, 128, 255)], '数据.bin')
    const pending = compressFile(file)
    const fileResult: FileCompressionResult = {
      algorithm: 'brotli',
      files: [{ name: '数据.bin.br', bytes: Uint8Array.of(0, 255) }],
      originalBytes: 3,
      compressedBytes: 2,
      byteRatio: 2 / 3,
    }
    expect(worker.postMessage).toHaveBeenCalledWith({
      operation: 'compress-file', file, algorithm: 'brotli', encoding: 'base32768', operationId: expect.any(String),
    })
    worker.onmessage!(new MessageEvent('message', { data: { success: true, result: fileResult } }))
    await expect(pending).resolves.toEqual(fileResult)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('automatically identifies uploaded archives unless an algorithm is specified', async () => {
    const file = new File([Uint8Array.of(31, 139, 8)], 'data.gz')
    const pending = decompressFile(file)
    const assertion = expect(pending).rejects.toThrow('文件已损坏')
    expect(worker.postMessage).toHaveBeenCalledWith({
      operation: 'decompress-file', file, algorithm: 'auto', operationId: expect.any(String),
    })
    worker.onmessage!(new MessageEvent('message', {
      data: { success: false, error: '文件已损坏' },
    }))
    await assertion
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('keeps a large file task alive while progress arrives', async () => {
    const onProgress = vi.fn()
    const pending = compressFile(new File(['data'], 'large.bin'), 'gzip', { encoding: 'base64url', onProgress })
    await vi.advanceTimersByTimeAsync(180_000)
    worker.onmessage!(new MessageEvent('message', {
      data: { type: 'progress', progress: { stage: 'compress', completed: 4, total: 8 } },
    }))
    expect(onProgress).toHaveBeenCalledWith({ stage: 'compress', completed: 4, total: 8 })
    expect(worker.terminate).not.toHaveBeenCalled()
    const fileResult: FileCompressionResult = {
      algorithm: 'gzip', files: [], originalBytes: 8, compressedBytes: 4, byteRatio: 0.5,
    }
    worker.onmessage!(new MessageEvent('message', { data: { success: true, result: fileResult } }))
    await expect(pending).resolves.toEqual(fileResult)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('cancels the worker immediately and ignores late results', async () => {
    const controller = new AbortController()
    const pending = compressFile(new File(['data'], 'large.bin'), 'brotli', { signal: controller.signal })
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    expect(worker.terminate).toHaveBeenCalledOnce()
    worker.onmessage!(new MessageEvent('message', { data: { success: true, result } }))
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a worker for an already cancelled file operation', async () => {
    const controller = new AbortController()
    controller.abort()
    const previousWorker = worker
    await expect(compressFile(new File(['data'], 'large.bin'), 'brotli', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(worker).toBe(previousWorker)
  })
})
