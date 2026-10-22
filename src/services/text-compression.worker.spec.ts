/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_UPLOAD_BYTES } from './file-stream-types'
import type { FileCompressionResult } from './file-compression-types'
import type { CompressionRequest } from './text-compression-rpc'

const { compressTextMock, decompressTextMock, compressFileMock, decompressFileMock, isContainerMock, decompressContainerMock, cleanupMock } = vi.hoisted(() => ({
  compressTextMock: vi.fn(),
  decompressTextMock: vi.fn(),
  compressFileMock: vi.fn(),
  decompressFileMock: vi.fn(),
  isContainerMock: vi.fn(),
  decompressContainerMock: vi.fn(),
  cleanupMock: vi.fn(),
}))

vi.mock('./text-compression', () => ({
  compressText: compressTextMock,
  decompressText: decompressTextMock,
}))
vi.mock('./file-text-container', () => ({
  compressFileToText: compressFileMock,
  decompressTextContainer: decompressContainerMock,
  isTextContainer: isContainerMock,
}))
vi.mock('./file-native-stream', () => ({
  decompressNativeFile: decompressFileMock,
}))
vi.mock('./file-output-storage', () => ({
  cleanupOperationStorage: cleanupMock,
}))

describe('compression worker file requests', () => {
  const scope = {
    onmessage: null as ((event: MessageEvent<CompressionRequest>) => Promise<void>) | null,
    postMessage: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    isContainerMock.mockResolvedValue(false)
    cleanupMock.mockResolvedValue(undefined)
    vi.stubGlobal('self', scope)
    await import('./text-compression.worker')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('passes files to the chunk reader without loading the entire file', async () => {
    const bytes = Uint8Array.of(0, 128, 255, 192, 128)
    const file = new File([bytes], '二进制.bin', { type: 'application/octet-stream' })
    const result: FileCompressionResult = {
      algorithm: 'brotli',
      files: [{ name: '二进制.bin.br', bytes: Uint8Array.of(1, 2, 3) }],
      originalBytes: bytes.length,
      compressedBytes: 3,
      byteRatio: 3 / bytes.length,
    }
    compressFileMock.mockResolvedValueOnce(result)
    const readWholeFile = vi.spyOn(file, 'arrayBuffer')
    await scope.onmessage!(new MessageEvent('message', {
      data: { operation: 'compress-file', file, algorithm: 'brotli', encoding: 'base32768', operationId: 'test-compress' },
    }))
    expect(compressFileMock).toHaveBeenCalledWith(file, 'brotli', 'base32768', {
      operationId: 'test-compress', onProgress: expect.any(Function),
    })
    expect(readWholeFile).not.toHaveBeenCalled()
    expect(scope.postMessage).toHaveBeenCalledWith(
      { success: true, result }, [result.files[0]!.bytes.buffer],
    )
    expect(compressTextMock).not.toHaveBeenCalled()
  })

  it('passes auto detection through and returns each extracted file buffer', async () => {
    const file = new File([Uint8Array.of(80, 75, 3, 4)], 'archive.zip')
    const result: FileCompressionResult = {
      algorithm: 'zip',
      files: [
        { name: 'a.bin', bytes: Uint8Array.of(0, 255) },
        { name: 'b.txt', bytes: Uint8Array.of(65) },
      ],
      originalBytes: 3, compressedBytes: 4, byteRatio: 4 / 3,
    }
    decompressFileMock.mockResolvedValueOnce(result)
    await scope.onmessage!(new MessageEvent('message', {
      data: { operation: 'decompress-file', file, algorithm: 'auto', operationId: 'test-unzip' },
    }))
    expect(decompressFileMock).toHaveBeenCalledWith(file, 'auto', {
      operationId: 'test-unzip', onProgress: expect.any(Function),
    })
    expect(scope.postMessage).toHaveBeenCalledWith(
      { success: true, result }, result.files.map((entry) => entry.bytes.buffer),
    )
  })

  it('rejects an oversized file before reading it into memory', async () => {
    const arrayBuffer = vi.fn()
    const file = { name: 'large.bin', size: MAX_UPLOAD_BYTES + 1, arrayBuffer } as unknown as File
    await scope.onmessage!(new MessageEvent('message', {
      data: { operation: 'compress-file', file, algorithm: 'brotli', encoding: 'base32768', operationId: 'test-too-large' },
    }))
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(compressFileMock).not.toHaveBeenCalled()
    expect(scope.postMessage).toHaveBeenCalledWith({
      success: false, error: '文件大小超出限制，请选择较小的文件',
    })
  })

  it('automatically recognizes the new pure-text file container', async () => {
    const file = new File(['BTF2:header\n'], 'archive.txt')
    isContainerMock.mockResolvedValue(true)
    const result: FileCompressionResult = {
      algorithm: 'brotli', files: [], outputs: [{ name: 'original.bin', type: 'application/octet-stream', blob: new Blob(['original']) }],
      originalBytes: 8, compressedBytes: 12, byteRatio: 1.5,
    }
    decompressContainerMock.mockResolvedValue(result)
    await scope.onmessage!(new MessageEvent('message', {
      data: { operation: 'decompress-file', file, algorithm: 'auto', operationId: 'test-container' },
    }))
    expect(decompressContainerMock).toHaveBeenCalledWith(file, {
      operationId: 'test-container', onProgress: expect.any(Function),
    })
    expect(decompressFileMock).not.toHaveBeenCalled()
    expect(scope.postMessage).toHaveBeenCalledWith({ success: true, result }, [])
  })
})
