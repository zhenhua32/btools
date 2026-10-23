import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import type { FileCompressionResult } from '@/services/file-compression-types'
import {
  DEFAULT_FILE_CONCURRENCY, FILE_CONCURRENCY_OPTIONS, MAX_TEXT_ARCHIVE_BYTES, MAX_UPLOAD_BYTES,
  type FileCompressionConcurrency, type FileOperationProgress, type TextFileOutput,
} from '@/services/file-stream-types'

const { compressMock, decompressMock, releaseMock } = vi.hoisted(() => ({
  compressMock: vi.fn(), decompressMock: vi.fn(), releaseMock: vi.fn(),
}))
vi.mock('@/services/text-compression-client', () => ({
  compressFile: compressMock, decompressFile: decompressMock, releaseFileResult: releaseMock,
}))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const container = defineComponent({
    setup: (_, { slots }) => () => h('div', [slots.header?.(), slots['header-extra']?.(), slots.default?.()]),
  })
  const select = defineComponent({
    props: ['value', 'options', 'disabled'], emits: ['update:value'],
    setup: (props, { emit }) => () => h('select', {
      value: props.value, disabled: props.disabled,
      onChange: (event: Event) => emit('update:value', props.options.find((option: { value: unknown }) => String(option.value) === (event.target as HTMLSelectElement).value).value),
    }, props.options.map((option: { value: string; label: string }) => h('option', { value: option.value }, option.label))),
  })
  const button = defineComponent({
    props: ['disabled', 'loading'],
    setup: (props, { slots }) => () => h('button', { disabled: props.disabled }, slots.default?.()),
  })
  return { NAlert: container, NButton: button, NCard: container, NSelect: select, NText: container }
})
import FileCompression from './FileCompression.vue'

describe('file compression tool', () => {
  let app: App | undefined
  let host: HTMLDivElement
  let createObjectUrl: ReturnType<typeof vi.fn>
  let revokeObjectUrl: ReturnType<typeof vi.fn>
  let writeText: ReturnType<typeof vi.fn>
  let downloads: { name: string; url: string }[]

  function result(overrides: Partial<FileCompressionResult> = {}): FileCompressionResult {
    const text = 'BTF2:原始字符😀\nEND\n'
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const textOutput: TextFileOutput = {
      name: 'report.pdf.btf2.txt', type: blob.type, blob,
      encoding: 'base32768', characters: [...text].length,
      parts: [{ offset: 0, size: blob.size, characters: [...text].length }],
    }
    return { algorithm: 'brotli', files: [], outputs: [textOutput], textOutput,
      originalBytes: 100, compressedBytes: blob.size, byteRatio: blob.size / 100, ...overrides }
  }
  function restored(overrides: Partial<FileCompressionResult> = {}): FileCompressionResult {
    const blob = new Blob([new Uint8Array([0, 255, 128, 1])], { type: 'application/pdf' })
    return { algorithm: 'brotli', files: [], outputs: [{ name: 'report.pdf', type: blob.type, blob }],
      originalBytes: 4, compressedBytes: 100, byteRatio: 25, ...overrides }
  }
  beforeEach(async () => {
    vi.clearAllMocks()
    host = document.createElement('div')
    document.body.appendChild(host)
    downloads = []
    createObjectUrl = vi.fn(() => 'blob:file-download')
    revokeObjectUrl = vi.fn()
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectUrl, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectUrl, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, url: this.href })
    })
    compressMock.mockResolvedValue(result())
    decompressMock.mockResolvedValue(restored())
    releaseMock.mockResolvedValue(undefined)
    app = createApp(FileCompression)
    app.mount(host)
    await nextTick()
  })
  afterEach(() => {
    app?.unmount()
    app = undefined
    host.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  function button(label: string): HTMLButtonElement {
    return Array.from(host.querySelectorAll('button')).find((element) => element.textContent === label)!
  }
  async function settle() { await nextTick(); await nextTick() }
  async function click(label: string) { button(label).click(); await settle() }
  async function upload(action: 'compress' | 'decompress', file: File) {
    const label = action === 'compress' ? '选择原始文件' : '选择压缩文件'
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    return input
  }
  async function select(label: string, value: string) {
    const input = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
    input.value = value
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
  }
  function readBytes(blob: Blob): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(blob)
    })
  }
  async function startCompression() {
    await upload('compress', new File(['source'], 'report.pdf'))
    await click('压缩文件')
  }

  it('defaults to Brotli + Base32768 with four workers and auto detection and compresses only on request', async () => {
    expect(DEFAULT_FILE_CONCURRENCY).toBe(4)
    expect(Array.from(host.querySelectorAll('select')).map((element) => element.value)).toEqual(['brotli', 'base32768', '4', 'auto'])
    const concurrencySelect = host.querySelector<HTMLSelectElement>('select[aria-label="文件压缩并发"]')!
    expect(Array.from(concurrencySelect.options).map((option) => Number(option.value))).toEqual([1, 2, 4, 8, 16])
    expect(Array.from(concurrencySelect.options).map((option) => option.textContent)).toEqual(FILE_CONCURRENCY_OPTIONS.map((option) => option.label))
    expect(button('压缩文件').disabled).toBe(true)
    const file = new File([new Uint8Array([37, 80, 68, 70, 0, 255])], 'report.pdf', { type: 'application/pdf' })
    const input = await upload('compress', file)
    expect(input.value).toBe('')
    expect(host.querySelector('[data-testid="source-file-info"]')?.textContent).toContain('report.pdf6 字节')
    expect(compressMock).not.toHaveBeenCalled()
    await click('压缩文件')
    expect(compressMock).toHaveBeenCalledWith(file, 'brotli', expect.objectContaining({ encoding: 'base32768', concurrency: 4, signal: expect.any(AbortSignal), onProgress: expect.any(Function) }))
    const summary = host.querySelector('[data-testid="file-compress-result"]')?.textContent
    expect(summary).toContain('压缩文本字符数：15 字符')
    expect(summary).toContain('26.0%')
    expect(summary).not.toContain('字符压缩率')
  })

  it('copies the complete Unicode text exactly and downloads the existing Blob without rebuilding it', async () => {
    const output = result()
    compressMock.mockResolvedValueOnce(output)
    await startCompression()
    await click('复制完整文本')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('BTF2:原始字符😀\nEND\n'))
    await vi.waitFor(() => expect(host.textContent).toContain('完整压缩文本已复制'))
    await click('下载完整文本 .txt')
    expect(downloads).toEqual([{ name: 'report.pdf.btf2.txt', url: 'blob:file-download' }])
    expect(createObjectUrl).toHaveBeenCalledWith(output.textOutput!.blob)
    expect(host.querySelectorAll('a')).toHaveLength(0)
  })

  it('preserves metadata, newlines, emoji and footer when copying consecutive byte-range parts', async () => {
    const pieces = ['BTF2:{"name":"a"}\n漢😀', '\n最後\nEND\n']
    let offset = 0
    const parts = pieces.map((piece) => {
      const part = { offset, size: new Blob([piece]).size, characters: [...piece].length }
      offset += part.size
      return part
    })
    const output = result().textOutput!
    output.blob = new Blob(pieces)
    output.parts = parts
    output.characters = [...pieces.join('')].length
    compressMock.mockResolvedValueOnce(result({ textOutput: output, outputs: [output] }))
    await startCompression()
    await click('复制所选段')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    await select('复制文本分段', '1')
    await click('复制所选段')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText.mock.calls.map((call) => call[0])).toEqual(pieces)
    expect(writeText.mock.calls.map((call) => call[0]).join('')).toBe(pieces.join(''))
    await vi.waitFor(() => expect(host.textContent).toContain('第 2 / 2 段已复制'))
  })

  it('never reads all of a large result for preview or copy and restricts preview to 64 KiB', async () => {
    const wholeText = vi.fn(() => { throw new Error('whole result must not be read') })
    const slice = vi.fn((start: number, end: number) => new Blob([start === 0 && end === 65_536 ? 'preview' : 'selected-part']))
    const output = result().textOutput!
    output.blob = { size: 1024 ** 3, text: wholeText, slice } as unknown as Blob
    output.parts = [{ offset: 123456, size: 77, characters: 50 }]
    compressMock.mockResolvedValueOnce(result({ textOutput: output, outputs: [output] }))
    await startCompression()
    await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="文件压缩文本预览"]')!.value).toBe('preview'))
    expect(button('复制完整文本').disabled).toBe(true)
    await click('复制所选段')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('selected-part'))
    expect(slice).toHaveBeenCalledWith(0, 65_536)
    expect(slice).toHaveBeenCalledWith(123456, 123533)
    expect(wholeText).not.toHaveBeenCalled()
    await click('下载完整文本 .txt')
    expect(createObjectUrl).toHaveBeenCalledWith(output.blob)
  })

  it('automatically decompresses pasted file text and downloads the exact restored bytes', async () => {
    await click('粘贴压缩文本')
    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="粘贴文件压缩文本"]')!
    input.value = 'BTF2:保持\n空白😀\n'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(button('解压文件').disabled).toBe(false)
    await click('解压文件')
    const call = decompressMock.mock.calls[0]!
    expect(call[0]).toBeInstanceOf(File)
    expect(new TextDecoder().decode(await readBytes(call[0]))).toBe('BTF2:保持\n空白😀\n')
    expect(call[1]).toBe('auto')
    expect(call[2]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }))
    await click('下载 report.pdf')
    expect(Array.from(await readBytes(createObjectUrl.mock.calls[0]![0] as Blob))).toEqual([0, 255, 128, 1])
  })

  it('uploads text archives and standard ZIP archives and lists every restored Blob', async () => {
    const textFile = new File(['BTF2:archive'], 'archive.txt')
    await upload('decompress', textFile)
    await click('解压文件')
    expect(decompressMock).toHaveBeenCalledWith(textFile, 'auto', expect.any(Object))
    const zipResult = restored({ algorithm: 'zip', outputs: [
      { name: 'hello.txt', type: 'text/plain', blob: new Blob(['Hi']) },
      { name: 'icon.png', type: 'image/png', blob: new Blob([new Uint8Array([137, 80, 78, 71])]) },
    ] })
    decompressMock.mockResolvedValueOnce(zipResult)
    await upload('decompress', new File(['zip bytes'], 'documents.zip'))
    await click('解压文件')
    expect(host.textContent).toContain('解压完成，共 2 个文件')
    await click('下载 hello.txt')
    await click('下载 icon.png')
    expect(downloads.map((download) => download.name)).toEqual(['hello.txt', 'icon.png'])
  })

  it('supports all algorithm and encoding choices and manual decompression format', async () => {
    await upload('compress', new File(['data'], 'archive.bin'))
    await select('文件压缩算法', 'zip')
    await select('文件文本编码', 'base91')
    await click('压缩文件')
    expect(compressMock).toHaveBeenCalledWith(expect.any(File), 'zip', expect.objectContaining({ encoding: 'base91' }))
    const file = new File(['compressed'], 'unknown')
    await upload('decompress', file)
    await select('文件解压格式', 'deflate')
    await click('解压文件')
    expect(decompressMock).toHaveBeenCalledWith(file, 'deflate', expect.any(Object))
  })

  it.each([1, 2, 4, 8, 16] as FileCompressionConcurrency[])('passes concurrency %i while accepting a 1 GiB source', async (concurrency) => {
    const source = new File(['small'], 'one-gib.bin')
    Object.defineProperty(source, 'size', { value: MAX_UPLOAD_BYTES })
    await upload('compress', source)
    await select('文件压缩并发', String(concurrency))
    expect(button('压缩文件').disabled).toBe(false)
    await click('压缩文件')
    expect(compressMock).toHaveBeenCalledWith(source, 'brotli', expect.objectContaining({ concurrency, encoding: 'base32768' }))
    expect(host.querySelector('[data-testid="file-compress-result"]')).not.toBeNull()
    expect(host.textContent).toContain('相同纯文本格式和压缩参数')
  })

  it('accepts exactly 1 GiB without allocating it and rejects sources or archives over their actual limits', async () => {
    const source = new File(['small'], 'large.bin')
    Object.defineProperty(source, 'size', { value: MAX_UPLOAD_BYTES })
    await upload('compress', source)
    expect(button('压缩文件').disabled).toBe(false)
    await click('压缩文件')
    expect(compressMock).toHaveBeenCalledWith(source, 'brotli', expect.any(Object))
    const oversized = new File(['small'], 'too-large.bin')
    Object.defineProperty(oversized, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    await upload('compress', oversized)
    expect(button('压缩文件').disabled).toBe(true)
    const archive = new File(['small'], 'large.txt')
    Object.defineProperty(archive, 'size', { value: MAX_TEXT_ARCHIVE_BYTES })
    await upload('decompress', archive)
    expect(button('解压文件').disabled).toBe(false)
    const tooLargeArchive = new File(['small'], 'too-large.txt')
    Object.defineProperty(tooLargeArchive, 'size', { value: MAX_TEXT_ARCHIVE_BYTES + 1 })
    await upload('decompress', tooLargeArchive)
    expect(button('解压文件').disabled).toBe(true)
    expect(host.textContent).toContain('文件超过大小限制')
    expect(host.textContent).toContain('1.00 GiB')
  })

  it('shows progress, cancels promptly and releases a late result without overwriting a newer job', async () => {
    let resolveFirst!: (value: FileCompressionResult) => void
    let resolveSecond!: (value: FileCompressionResult) => void
    compressMock.mockImplementationOnce(() => new Promise<FileCompressionResult>((resolve) => { resolveFirst = resolve }))
    compressMock.mockImplementationOnce(() => new Promise<FileCompressionResult>((resolve) => { resolveSecond = resolve }))
    await startCompression()
    const firstOptions = compressMock.mock.calls[0]![2] as { signal: AbortSignal; onProgress: (value: FileOperationProgress) => void }
    firstOptions.onProgress({ stage: 'write-opfs-path', completed: 50, total: 100 })
    await nextTick()
    expect(host.querySelector('progress')?.value).toBe(50)
    expect(host.textContent).toContain('已处理 50 字节 / 100 字节')
    expect(host.textContent).not.toContain('write-opfs-path')
    await click('取消压缩')
    expect(firstOptions.signal.aborted).toBe(true)
    expect(host.textContent).toContain('已取消')
    await click('压缩文件')
    const stale = result()
    resolveFirst(stale)
    await settle()
    expect(releaseMock).toHaveBeenCalledWith(stale)
    expect(button('压缩文件').disabled).toBe(true)
    expect(host.querySelector('[data-testid="file-compress-result"]')).toBeNull()
    resolveSecond(result())
    await settle()
    expect(button('压缩文件').disabled).toBe(false)
    expect(host.querySelector('[data-testid="file-compress-result"]')).not.toBeNull()
  })

  it('cancels jobs on file, algorithm or encoding change and releases previous outputs on replacement or unmount', async () => {
    const complete = result()
    compressMock.mockResolvedValueOnce(complete)
    await startCompression()
    await select('文件文本编码', 'base64')
    expect(releaseMock).toHaveBeenCalledWith(complete)
    let resolve!: (value: FileCompressionResult) => void
    compressMock.mockImplementationOnce(() => new Promise<FileCompressionResult>((done) => { resolve = done }))
    await click('压缩文件')
    const options = compressMock.mock.calls[1]![2] as { signal: AbortSignal }
    await select('文件压缩算法', 'gzip')
    expect(options.signal.aborted).toBe(true)
    const stale = result()
    resolve(stale)
    await settle()
    expect(releaseMock).toHaveBeenCalledWith(stale)
    const restoredResult = restored()
    decompressMock.mockResolvedValueOnce(restoredResult)
    await upload('decompress', new File(['file'], 'archive.txt'))
    await click('解压文件')
    app!.unmount()
    app = undefined
    expect(releaseMock).toHaveBeenCalledWith(restoredResult)
  })

  it('clears completed outputs and aborts a pending compression when concurrency changes', async () => {
    const complete = result()
    compressMock.mockResolvedValueOnce(complete)
    await startCompression()
    expect(host.querySelector('[data-testid="file-compress-result"]')).not.toBeNull()
    await select('文件压缩并发', '8')
    expect(releaseMock).toHaveBeenCalledWith(complete)
    expect(host.querySelector('[data-testid="file-compress-result"]')).toBeNull()

    let resolve!: (value: FileCompressionResult) => void
    compressMock.mockImplementationOnce(() => new Promise<FileCompressionResult>((done) => { resolve = done }))
    await click('压缩文件')
    const options = compressMock.mock.calls[1]![2] as { concurrency: number; signal: AbortSignal; onProgress: (value: FileOperationProgress) => void }
    expect(options.concurrency).toBe(8)
    options.onProgress({ stage: 'compress', completed: 50, total: 100 })
    await nextTick()
    expect(host.querySelector('[data-testid="compress-progress"]')).not.toBeNull()
    await select('文件压缩并发', '16')
    expect(options.signal.aborted).toBe(true)
    expect(button('压缩文件').disabled).toBe(false)
    expect(host.querySelector('[data-testid="compress-progress"]')).toBeNull()
    options.onProgress({ stage: 'compress', completed: 100, total: 100 })
    const stale = result()
    resolve(stale)
    await settle()
    expect(releaseMock).toHaveBeenCalledWith(stale)
    expect(host.querySelector('[data-testid="file-compress-result"]')).toBeNull()
    expect(host.querySelector('[data-testid="compress-progress"]')).toBeNull()
    await click('压缩文件')
    expect(compressMock).toHaveBeenLastCalledWith(expect.any(File), 'brotli', expect.objectContaining({ concurrency: 16 }))
  })

  it('cancels decompression on new input and suppresses stale errors', async () => {
    let reject!: (reason: Error) => void
    decompressMock.mockImplementationOnce(() => new Promise<FileCompressionResult>((_, fail) => { reject = fail }))
    await upload('decompress', new File(['old'], 'old.zip'))
    await click('解压文件')
    const options = decompressMock.mock.calls[0]![2] as { signal: AbortSignal }
    await upload('decompress', new File(['new'], 'new.zip'))
    expect(options.signal.aborted).toBe(true)
    reject(new Error('stale failure'))
    await settle()
    expect(host.textContent).not.toContain('stale failure')
    expect(host.querySelector('[data-testid="archive-file-info"]')?.textContent).toContain('new.zip')
  })

  it('cancels when reselecting the same File object and on unmount, and ignores later progress', async () => {
    let resolve!: (value: FileCompressionResult) => void
    compressMock.mockImplementationOnce(() => new Promise<FileCompressionResult>((done) => { resolve = done }))
    const file = new File(['source'], 'same.bin')
    await upload('compress', file)
    await click('压缩文件')
    const firstOptions = compressMock.mock.calls[0]![2] as { signal: AbortSignal; onProgress: (value: FileOperationProgress) => void }
    await upload('compress', file)
    expect(firstOptions.signal.aborted).toBe(true)
    firstOptions.onProgress({ stage: 'compress', completed: 90, total: 100 })
    await settle()
    expect(host.querySelector('[data-testid="compress-progress"]')).toBeNull()
    const stale = result()
    resolve(stale)
    await settle()
    expect(releaseMock).toHaveBeenCalledWith(stale)
    decompressMock.mockImplementationOnce(() => new Promise<FileCompressionResult>(() => {}))
    await upload('decompress', new File(['archive'], 'archive.txt'))
    await click('解压文件')
    const nextOptions = decompressMock.mock.calls[0]![2] as { signal: AbortSignal; onProgress: (value: FileOperationProgress) => void }
    nextOptions.onProgress({ stage: 'decompress', completed: 1, total: 4 })
    await nextTick()
    expect(host.querySelector<HTMLProgressElement>('progress[aria-label="解压进度"]')!.value).toBe(25)
    app!.unmount()
    app = undefined
    expect(nextOptions.signal.aborted).toBe(true)
  })

  it('rejects oversized pasted text and directs the user to upload instead', async () => {
    await click('粘贴压缩文本')
    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="粘贴文件压缩文本"]')!
    input.value = 'a'.repeat(16 * 1024 ** 2 + 1)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(button('解压文件').disabled).toBe(true)
    expect(host.textContent).toContain('粘贴文本超过 16 MiB，请上传完整的压缩文本 .txt 文件')
    expect(decompressMock).not.toHaveBeenCalled()
  })

  it('gives downloads their 60-second URL lifetime even if the component unmounts', async () => {
    vi.useFakeTimers()
    await startCompression()
    await click('下载完整文本 .txt')
    app!.unmount()
    app = undefined
    expect(revokeObjectUrl).not.toHaveBeenCalled()
    vi.advanceTimersByTime(59_999)
    expect(revokeObjectUrl).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeObjectUrl).toHaveBeenCalledOnce()
  })

  it('uses the clipboard fallback and reports failure without losing the downloadable result', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true })
    await startCompression()
    await click('复制完整文本')
    await vi.waitFor(() => expect(host.textContent).toContain('复制失败，请下载完整文本'))
    expect(button('下载完整文本 .txt')).toBeDefined()
    expect(document.querySelectorAll('body > textarea')).toHaveLength(0)
  })

  it('preserves exact text when copying through the clipboard fallback', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    let copied = ''
    Object.defineProperty(document, 'execCommand', { value: vi.fn(() => {
      copied = document.querySelector<HTMLTextAreaElement>('body > textarea')!.value
      return true
    }), configurable: true })
    await startCompression()
    await click('复制完整文本')
    await vi.waitFor(() => expect(host.textContent).toContain('完整压缩文本已复制'))
    expect(copied).toBe('BTF2:原始字符😀\nEND\n')
    expect(document.querySelectorAll('body > textarea')).toHaveLength(0)
  })

  it('shows service errors and handles empty-file ratios without NaN or Infinity', async () => {
    decompressMock.mockRejectedValueOnce(new Error('不支持此压缩格式'))
    await upload('decompress', new File(['bad'], 'bad.rar'))
    await click('解压文件')
    expect(host.textContent).toContain('不支持此压缩格式')
    expect(button('解压文件').disabled).toBe(false)
    compressMock.mockResolvedValueOnce(result({ originalBytes: 0, byteRatio: null }))
    await upload('compress', new File([], 'empty.bin'))
    await click('压缩文件')
    expect(host.querySelector('[data-testid="file-compress-result"]')?.textContent).toContain('无法计算（原文件为空）')
    expect(host.textContent).not.toContain('NaN')
    expect(host.textContent).not.toContain('Infinity')
  })
})
