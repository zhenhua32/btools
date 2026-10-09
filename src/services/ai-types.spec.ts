import { describe, expect, it } from 'vitest'
import { DEFAULT_AI_SETTINGS, normalizeAiSettings } from './ai-types'

describe('AI read aloud settings migration', () => {
  it('adds read aloud defaults to existing translation settings without changing them', () => {
    const migrated = normalizeAiSettings({
      baseUrl: 'https://translation.example/v1',
      apiKey: 'existing-translation-key',
      model: 'existing-model',
      enableSelectionButton: false,
      enableStreaming: false,
    })

    expect(migrated).toMatchObject({
      baseUrl: 'https://translation.example/v1',
      apiKey: 'existing-translation-key',
      model: 'existing-model',
      enableSelectionButton: false,
      enableStreaming: false,
      ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
      ttsApiKey: '',
      ttsModel: 'mimo-v2.5-tts-voicedesign',
      ttsVoiceDescription: '性感御姐音色',
      ttsChineseVoiceDescription: '',
      ttsEnglishVoiceDescription: '',
      enableSelectionReadAloudButton: true,
    })
  })

  it('keeps read aloud credentials independent and trims the saved configuration', () => {
    expect(normalizeAiSettings({
      ttsBaseUrl: ' https://speech.example/v1 ',
      ttsApiKey: ' speech-key ',
      ttsModel: ' speech-model ',
      ttsVoiceDescription: ' 温柔、低沉，语速平缓 ',
    })).toMatchObject({
      apiKey: '',
      model: '',
      ttsBaseUrl: 'https://speech.example/v1',
      ttsApiKey: 'speech-key',
      ttsModel: 'speech-model',
      ttsVoiceDescription: '温柔、低沉，语速平缓',
    })
  })

  it('restores usable model and voice defaults for blank settings', () => {
    expect(normalizeAiSettings({
      ttsBaseUrl: ' ',
      ttsApiKey: ' ',
      ttsModel: ' ',
      ttsVoiceDescription: ' ',
    })).toMatchObject({
      ttsBaseUrl: DEFAULT_AI_SETTINGS.ttsBaseUrl,
      ttsApiKey: '',
      ttsModel: DEFAULT_AI_SETTINGS.ttsModel,
      ttsVoiceDescription: DEFAULT_AI_SETTINGS.ttsVoiceDescription,
    })
  })

  it('preserves a disabled read aloud button separately from the translation button', () => {
    expect(normalizeAiSettings({
      enableSelectionButton: true,
      enableSelectionReadAloudButton: false,
    })).toMatchObject({
      enableSelectionButton: true,
      enableSelectionReadAloudButton: false,
    })
  })

  it('keeps legacy voice styles and trims optional language overrides without filling blank overrides', () => {
    expect(normalizeAiSettings({ ttsVoiceDescription: '保留原声，自然朗读' })).toMatchObject({
      ttsVoiceDescription: '保留原声，自然朗读',
      ttsChineseVoiceDescription: '',
      ttsEnglishVoiceDescription: '',
    })
    expect(normalizeAiSettings({
      ttsChineseVoiceDescription: ' 中文清晰含笑 ',
      ttsEnglishVoiceDescription: '   ',
    })).toMatchObject({
      ttsChineseVoiceDescription: '中文清晰含笑',
      ttsEnglishVoiceDescription: '',
    })
  })
})
