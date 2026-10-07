import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/services/ai-types'

const { getAiSettingsMock, saveAiSettingsMock } = vi.hoisted(() => ({
  getAiSettingsMock: vi.fn(),
  saveAiSettingsMock: vi.fn(),
}))

vi.mock('@/services/ai-settings', () => ({
  getAiSettings: getAiSettingsMock,
  saveAiSettings: saveAiSettingsMock,
  resetAiSettings: vi.fn(),
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
})
