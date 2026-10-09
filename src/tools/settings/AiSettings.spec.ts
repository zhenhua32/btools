import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/services/ai-types'

const { getAiSettingsMock, saveAiSettingsMock, resetAiSettingsMock, getReferenceMock, getReferencesMock, saveReferenceMock, importBundleMock } = vi.hoisted(() => ({
  getAiSettingsMock: vi.fn(),
  saveAiSettingsMock: vi.fn(),
  resetAiSettingsMock: vi.fn(),
  getReferenceMock: vi.fn(),
  getReferencesMock: vi.fn(),
  saveReferenceMock: vi.fn(),
  importBundleMock: vi.fn(),
}))

vi.mock('@/services/ai-settings', () => ({
  getAiSettings: getAiSettingsMock,
  saveAiSettings: saveAiSettingsMock,
  resetAiSettings: resetAiSettingsMock,
}))

vi.mock('@/services/read-aloud-voice-reference', async () => ({
  ...await vi.importActual('@/services/read-aloud-voice-reference'),
  getReadAloudVoiceReference: getReferenceMock,
  getReadAloudVoiceReferences: getReferencesMock,
  saveReadAloudVoiceReference: saveReferenceMock,
  importReadAloudVoiceBundle: importBundleMock,
}))

vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const container = defineComponent({
    setup: (_, { slots }) => () => h('div', [slots.default?.(), slots.feedback?.()]),
  })
  const input = defineComponent({
    props: ['value', 'type'],
    emits: ['update:value'],
    setup: (props, { emit }) => () => h(props.type === 'textarea' ? 'textarea' : 'input', {
      value: props.value,
      type: props.type,
      onInput: (event: Event) => emit('update:value', (event.target as HTMLInputElement).value),
    }),
  })
  const button = defineComponent({
    setup: (_, { slots }) => () => h('button', slots.default?.()),
  })
  return {
    NAlert: container,
    NButton: button,
    NCard: container,
    NForm: container,
    NFormItem: container,
    NInput: input,
    NInputNumber: container,
    NSelect: container,
    NSpace: container,
    NText: container,
    NSwitch: container,
  }
})

import AiSettingsView from './AiSettings.vue'

describe('AI settings read aloud configuration', () => {
  let app: App | undefined
  let host: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    host = document.createElement('div')
    document.body.appendChild(host)
    saveAiSettingsMock.mockImplementation(async (settings: AiSettings) => settings)
    resetAiSettingsMock.mockResolvedValue({ ...DEFAULT_AI_SETTINGS })
    getReferenceMock.mockResolvedValue(null)
    getReferencesMock.mockImplementation(async () => ({ default: await getReferenceMock(), zh: null, en: null }))
    saveReferenceMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
    host.remove()
  })

  async function mountSettings(overrides: Partial<AiSettings> = {}) {
    getAiSettingsMock.mockResolvedValue({ ...DEFAULT_AI_SETTINGS, ...overrides })
    app = createApp(AiSettingsView)
    app.mount(host)
    await nextTick()
    await nextTick()
    await nextTick()
  }

  async function clickSave() {
    const button = Array.from(host.querySelectorAll('button'))
      .find((element) => element.textContent === '保存设置')
    expect(button).toBeDefined()
    button!.click()
    await nextTick()
    await nextTick()
  }

  it('saves read aloud credentials when translation credentials are empty', async () => {
    await mountSettings({ ttsApiKey: 'speech-only-key' })
    await clickSave()

    expect(saveAiSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: '',
      model: '',
      ttsApiKey: 'speech-only-key',
      ttsModel: 'mimo-v2.5-tts-voicedesign',
      ttsVoiceDescription: '性感御姐音色',
    }))
    expect(host.textContent).toContain('AI 设置已保存到当前浏览器本地')
  })

  it('rejects a supplied invalid speech endpoint before persisting settings', async () => {
    await mountSettings({ ttsBaseUrl: 'not-an-endpoint', ttsApiKey: 'speech-key' })
    await clickSave()

    expect(saveAiSettingsMock).not.toHaveBeenCalled()
    expect(host.textContent).toContain('朗读接口地址格式不正确，请输入完整 URL')
  })

  it('keeps both API keys in password fields and allows editing the voice description', async () => {
    await mountSettings({ apiKey: 'translation-key', ttsApiKey: 'speech-key' })

    expect(host.querySelectorAll('input[type="password"]')).toHaveLength(2)
    const voiceInput = Array.from(host.querySelectorAll('textarea'))
      .find((element) => element.value === '性感御姐音色')
    expect(voiceInput).toBeDefined()
    voiceInput!.value = '温柔的女声，语速舒缓'
    voiceInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await clickSave()

    expect(saveAiSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      ttsVoiceDescription: '温柔的女声，语速舒缓',
    }))
    expect(host.textContent).not.toContain('translation-key')
    expect(host.textContent).not.toContain('speech-key')
  })

  it('keeps a saved reference when settings are saved or reset and previews only the audio data', async () => {
    const reference = { name: 'selected-audition.wav', dataUrl: 'data:audio/wav;base64,AA==' }
    getReferenceMock.mockResolvedValue(reference)
    await mountSettings({ ttsModel: 'mimo-v2.5-tts-voiceclone', ttsApiKey: 'secret-key' })
    await clickSave()

    expect(saveReferenceMock).not.toHaveBeenCalled()
    expect(saveAiSettingsMock.mock.calls[0][0]).not.toHaveProperty('dataUrl')
    const preview = host.querySelector('audio')!
    expect(preview.getAttribute('src')).toBe(reference.dataUrl)
    expect(preview.getAttribute('src')).not.toContain('secret-key')
    expect(host.textContent).toContain('selected-audition.wav')
    expect(host.textContent).toContain('保留参考音色')

    Array.from(host.querySelectorAll('button')).find((element) => element.textContent === '恢复默认')!.click()
    await nextTick()
    await nextTick()
    expect(saveReferenceMock).not.toHaveBeenCalled()
    expect(host.querySelector('audio')!.getAttribute('src')).toBe(reference.dataUrl)
  })

  it('persists an intentionally selected WAV immediately without changing the model', async () => {
    await mountSettings()
    const input = host.querySelector<HTMLInputElement>('input[aria-label="选择通用参考音频"]')!
    const file = new File([new Uint8Array([0, 0])], 'audition.wav', { type: 'audio/wav' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(saveReferenceMock).toHaveBeenCalledOnce())
    await nextTick()

    expect(saveReferenceMock).toHaveBeenCalledWith({
      name: 'audition.wav', dataUrl: 'data:audio/wav;base64,AAA=',
    }, 'default')
    expect(host.querySelector('audio')!.getAttribute('src')).toBe('data:audio/wav;base64,AAA=')
    await clickSave()
    expect(saveAiSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      ttsModel: 'mimo-v2.5-tts-voicedesign',
    }))
  })

  it('rejects a non-audio upload while keeping the saved reference', async () => {
    const reference = { name: 'existing.wav', dataUrl: 'data:audio/wav;base64,AA==' }
    getReferenceMock.mockResolvedValue(reference)
    await mountSettings()
    const input = host.querySelector<HTMLInputElement>('input[aria-label="选择通用参考音频"]')!
    Object.defineProperty(input, 'files', {
      value: [new File(['not audio'], 'fake.wav', { type: 'text/html' })], configurable: true,
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    await nextTick()

    expect(saveReferenceMock).not.toHaveBeenCalled()
    expect(host.textContent).toContain('参考音频仅支持 WAV 或 MP3 文件')
    expect(host.querySelector('audio')!.getAttribute('src')).toBe(reference.dataUrl)
  })

  it('removes the reference only through the explicit remove button', async () => {
    getReferenceMock.mockResolvedValue({ name: 'selected.wav', dataUrl: 'data:audio/wav;base64,AA==' })
    await mountSettings()
    Array.from(host.querySelectorAll('button')).find((element) => element.textContent?.trim() === '移除通用参考音频')!.click()
    await nextTick()
    await nextTick()

    expect(saveReferenceMock).toHaveBeenCalledWith(null, 'default')
    expect(host.querySelector('audio')).toBeNull()
    expect(host.textContent).toContain('参考音频已移除')
  })

  it('shows independent language previews and removes only the selected language reference', async () => {
    const reference = (name: string) => ({ name, dataUrl: 'data:audio/wav;base64,AA==' })
    getReferencesMock.mockResolvedValue({ default: reference('common.wav'), zh: reference('P1.wav'), en: reference('C1.wav') })
    await mountSettings({ ttsModel: 'mimo-v2.5-tts-voiceclone' })
    expect(host.querySelectorAll('audio')).toHaveLength(3)
    Array.from(host.querySelectorAll('button')).find((element) => element.textContent?.trim() === '移除中文参考音频')!.click()
    await nextTick()
    await nextTick()

    expect(saveReferenceMock).toHaveBeenCalledWith(null, 'zh')
    expect(host.querySelector('audio[aria-label="中文参考音频试听"]')).toBeNull()
    expect(host.querySelector('audio[aria-label="通用参考音频试听"]')).not.toBeNull()
    expect(host.querySelector('audio[aria-label="英文参考音频试听"]')).not.toBeNull()
  })

  const bundle = {
    version: 1,
    model: 'mimo-v2.5-tts-voiceclone',
    voiceDescription: '自然朗读',
    chineseVoiceDescription: '中文清晰含笑',
    englishVoiceDescription: 'Natural American English',
    references: {
      zh: { name: 'P1.wav', dataUrl: 'data:audio/wav;base64,AA==' },
      en: { name: 'C1.wav', dataUrl: 'data:audio/wav;base64,AAAA' },
    },
  }

  function selectBundleFile(inputBundle: unknown) {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="选择音色组合文件"]')!
    Object.defineProperty(input, 'files', {
      value: [new File([JSON.stringify(inputBundle)], 'voices.json', { type: 'application/json' })],
      configurable: true,
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  it('imports both voices without saving unrelated unsaved edits and updates the previews', async () => {
    await mountSettings({ ttsApiKey: 'stored-key' })
    const keyInput = host.querySelector<HTMLInputElement>('input[placeholder="输入 MiMo 语音接口的 API Key"]')!
    keyInput.value = 'unsaved-key'
    keyInput.dispatchEvent(new Event('input', { bubbles: true }))
    importBundleMock.mockResolvedValue({
      ...DEFAULT_AI_SETTINGS,
      ttsApiKey: 'stored-key',
      ttsModel: bundle.model,
      ttsVoiceDescription: bundle.voiceDescription,
      ttsChineseVoiceDescription: bundle.chineseVoiceDescription,
      ttsEnglishVoiceDescription: bundle.englishVoiceDescription,
    })
    selectBundleFile(bundle)
    await vi.waitFor(() => expect(importBundleMock).toHaveBeenCalledOnce())
    await nextTick()

    expect(importBundleMock).toHaveBeenCalledWith(bundle)
    expect(saveAiSettingsMock).not.toHaveBeenCalled()
    expect(keyInput.value).toBe('unsaved-key')
    expect(host.querySelector('audio[aria-label="中文参考音频试听"]')!.getAttribute('src')).toBe(bundle.references.zh.dataUrl)
    expect(host.querySelector('audio[aria-label="英文参考音频试听"]')!.getAttribute('src')).toBe(bundle.references.en.dataUrl)
    expect(Array.from(host.querySelectorAll('textarea')).map((element) => element.value)).toContain('中文清晰含笑')
    expect(host.textContent).not.toContain('stored-key')
  })

  it('rejects a bundle with credential fields before calling the importer', async () => {
    await mountSettings()
    selectBundleFile({ ...bundle, ttsApiKey: 'forbidden' })
    await vi.waitFor(() => expect(host.textContent).toContain('音色组合结构无效'))
    expect(importBundleMock).not.toHaveBeenCalled()
    expect(saveAiSettingsMock).not.toHaveBeenCalled()
    expect(host.querySelector('audio')).toBeNull()
  })

  it('keeps old previews and form values when bundle persistence fails', async () => {
    const reference = { name: 'previous.wav', dataUrl: 'data:audio/wav;base64,AA==' }
    getReferencesMock.mockResolvedValue({ default: null, zh: reference, en: null })
    await mountSettings()
    importBundleMock.mockRejectedValue(new Error('浏览器本地存储空间不足'))
    selectBundleFile(bundle)
    await vi.waitFor(() => expect(host.textContent).toContain('浏览器本地存储空间不足'))
    expect(host.textContent).toContain('previous.wav')
    expect(host.textContent).not.toContain('C1.wav')
    await clickSave()
    expect(saveAiSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      ttsModel: 'mimo-v2.5-tts-voicedesign',
    }))
  })
})
