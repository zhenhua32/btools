import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import type { CompressionResult } from '@/services/text-compression-types'

const { compressMock, decompressMock } = vi.hoisted(() => ({
  compressMock: vi.fn(),
  decompressMock: vi.fn(),
}))

vi.mock('@/services/text-compression-client', () => ({
  compressText: compressMock,
  decompressText: decompressMock,
}))

vi.mock('./FileCompression.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ setup: () => () => h('div', { 'data-testid': 'file-compression-mode' }, '文件上传压缩') }) }
})

vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const container = defineComponent({
    setup: (_, { slots }) => () => h('div', [slots.header?.(), slots['header-extra']?.(), slots.default?.()]),
  })
  const input = defineComponent({
    props: ['value', 'inputProps'],
    emits: ['update:value'],
    setup: (props, { emit }) => () => h('textarea', {
      ...props.inputProps,
      value: props.value,
      onInput: (event: Event) => emit('update:value', (event.target as HTMLTextAreaElement).value),
    }),
  })
  const select = defineComponent({
    props: ['value', 'options', 'disabled'],
    emits: ['update:value'],
    setup: (props, { emit }) => () => h('select', {
      value: props.value,
      disabled: props.disabled,
      onChange: (event: Event) => emit('update:value', (event.target as HTMLSelectElement).value),
    }, props.options.map((option: { value: string; label: string }) => h('option', { value: option.value }, option.label))),
  })
  const button = defineComponent({
    props: ['disabled', 'loading'],
    setup: (props, { slots }) => () => h('button', { disabled: props.disabled }, slots.default?.()),
  })
  return { NAlert: container, NButton: button, NCard: container, NInput: input, NSelect: select, NSpace: container, NText: container }
})

import TextCompression from './TextCompression.vue'

describe('text compression tool', () => {
  let app: App | undefined
  let host: HTMLDivElement
  const writeText = vi.fn()

  function compressionResult(overrides: Partial<CompressionResult> = {}): CompressionResult {
    return {
      text: 'packed',
      algorithm: 'brotli',
      encoding: 'base32768',
      original: { characters: 100, utf8Bytes: 100 },
      compressed: { characters: 6, utf8Bytes: 6 },
      characterRatio: 0.06,
      byteRatio: 0.06,
      ...overrides,
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    host = document.createElement('div')
    document.body.appendChild(host)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    writeText.mockResolvedValue(undefined)
    compressMock.mockResolvedValue(compressionResult())
    decompressMock.mockResolvedValue(compressionResult({ text: 'restored', algorithm: 'gzip', encoding: 'base64' }))
    app = createApp(TextCompression)
    app.mount(host)
    await nextTick()
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
    host.remove()
    vi.restoreAllMocks()
  })

  function textarea(side: '原文' | '压缩文本') {
    return host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${side}"]`)!
  }

  async function edit(side: '原文' | '压缩文本', value: string) {
    const element = textarea(side)
    element.value = value
    element.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }

  function button(label: string) {
    return Array.from(host.querySelectorAll('button')).find((element) => element.textContent === label)!
  }

  async function click(label: string) {
    button(label).click()
    await nextTick()
    await nextTick()
  }

  it('defaults to Brotli and Base32768, counts Unicode code points, and copies the exact result', async () => {
    const selects = host.querySelectorAll<HTMLSelectElement>('select')
    expect(Array.from(selects).map((element) => element.value)).toEqual(['brotli', 'base32768'])
    await edit('原文', '中文😀')
    expect(host.querySelector('[data-testid="original-metrics"]')?.textContent).toContain('3 字符 · 10 UTF-8 字节')
    await click('压缩 →')

    expect(compressMock).toHaveBeenCalledWith('中文😀', 'brotli', 'base32768')
    expect(textarea('压缩文本').value).toBe('packed')
    expect(host.querySelector('[data-testid="compression-result"]')?.textContent).toContain('200.0%')
    expect(host.textContent).toContain('膨胀 100.0%')
    await click('复制压缩文本')
    expect(writeText).toHaveBeenCalledWith('packed')
    expect(host.textContent).toContain('压缩文本已复制')
    await click('复制原文')
    expect(writeText).toHaveBeenLastCalledWith('中文😀')
  })

  it('preserves whitespace-only input and invalidates ratios after edits or option changes', async () => {
    await edit('原文', ' \n\t')
    await click('压缩 →')
    expect(compressMock).toHaveBeenCalledWith(' \n\t', 'brotli', 'base32768')
    expect(host.querySelector('[data-testid="compression-result"]')).not.toBeNull()
    await edit('压缩文本', 'changed')
    expect(host.querySelector('[data-testid="compression-result"]')).toBeNull()
    await click('压缩 →')
    const select = host.querySelectorAll<HTMLSelectElement>('select')[1]!
    select.value = 'base64'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(host.querySelector('[data-testid="compression-result"]')).toBeNull()
  })

  it('automatically detects formats on decompression and updates the selectors', async () => {
    await edit('压缩文本', 'external packed text')
    await click('← 解压')
    expect(decompressMock).toHaveBeenCalledWith('external packed text')
    expect(textarea('原文').value).toBe('restored')
    expect(Array.from(host.querySelectorAll<HTMLSelectElement>('select')).map((element) => element.value)).toEqual(['gzip', 'base64'])
    expect(host.querySelector('[data-testid="compression-result"]')).not.toBeNull()
  })

  it('discards an asynchronous result if either text changes while processing', async () => {
    let resolve!: (result: CompressionResult) => void
    compressMock.mockImplementationOnce(() => new Promise<CompressionResult>((done) => { resolve = done }))
    await edit('原文', 'old input')
    await click('压缩 →')
    expect(button('← 解压').disabled).toBe(true)
    await edit('压缩文本', 'newly pasted content')
    resolve(compressionResult())
    await nextTick()
    await nextTick()

    expect(textarea('压缩文本').value).toBe('newly pasted content')
    expect(host.querySelector('[data-testid="compression-result"]')).toBeNull()
    expect(host.textContent).toContain('输入已修改，请重新操作')
    expect(button('压缩 →').disabled).toBe(false)
  })

  it('reports decompression errors while preserving both text fields', async () => {
    decompressMock.mockRejectedValueOnce(new Error('压缩文本已损坏'))
    await edit('原文', 'keep this input')
    await edit('压缩文本', 'invalid packed text')
    await click('← 解压')
    expect(host.textContent).toContain('压缩文本已损坏')
    expect(textarea('原文').value).toBe('keep this input')
    expect(textarea('压缩文本').value).toBe('invalid packed text')
    expect(host.querySelector('[data-testid="compression-result"]')).toBeNull()
  })

  it('reports clipboard failure when the fallback also fails', async () => {
    writeText.mockRejectedValueOnce(new Error('blocked'))
    Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true })
    await edit('原文', 'copy me')
    await click('复制原文')
    expect(host.textContent).toContain('复制失败，请选中文本后手动复制')
    expect(document.querySelectorAll('textarea')).toHaveLength(2)
  })

  it('switches between text and file modes while preserving the text inputs', async () => {
    await edit('原文', 'keep input when switching')
    await click('文件')
    expect(host.querySelector<HTMLElement>('.text-compression')?.style.display).toBe('none')
    expect(host.querySelector('[data-testid="file-compression-mode"]')).not.toBeNull()
    await click('文本')
    expect(textarea('原文').value).toBe('keep input when switching')
    expect(host.querySelector<HTMLElement>('[data-testid="file-compression-mode"]')?.style.display).toBe('none')
  })
})
