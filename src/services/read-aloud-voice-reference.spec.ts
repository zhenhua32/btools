import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_SETTINGS_STORAGE_KEY, DEFAULT_AI_SETTINGS } from './ai-types'
import { resetAiSettings, saveAiSettings } from './ai-settings'
import {
  getReadAloudVoiceReference,
  getReadAloudVoiceReferences,
  saveReadAloudVoiceReference,
  importReadAloudVoiceBundle,
  validateReadAloudVoiceBundle,
  validateReadAloudVoiceReference,
  READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY,
  READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS,
  MAX_READ_ALOUD_REFERENCE_BASE64_LENGTH,
} from './read-aloud-voice-reference'

const reference = { name: 'audition.wav', dataUrl: 'data:audio/wav;base64,AA==' }
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

describe('reusable read aloud voice reference', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', undefined)
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('accepts canonical WAV/MP3 references and trims their display name', () => {
    expect(validateReadAloudVoiceReference({ ...reference, name: ' audition.wav ' })).toEqual(reference)
    expect(validateReadAloudVoiceReference({ name: 'voice.mp3', dataUrl: 'data:audio/mpeg;base64,AAAA' }))
      .toEqual({ name: 'voice.mp3', dataUrl: 'data:audio/mpeg;base64,AAAA' })
  })

  it.each([
    'https://example.com/voice.wav',
    'data:audio/ogg;base64,AA==',
    'data:text/html;base64,AA==',
    'data:audio/wav;base64,',
    'data:audio/wav;base64,AA?',
    'data:audio/wav;base64,AAAA====',
  ])('rejects unsupported or invalid references: %s', (dataUrl) => {
    expect(() => validateReadAloudVoiceReference({ ...reference, dataUrl })).toThrow(/参考音频/u)
  })

  it('enforces the provider limit on base64 data before saving', async () => {
    const oversized = {
      ...reference,
      dataUrl: `data:audio/wav;base64,${'A'.repeat(MAX_READ_ALOUD_REFERENCE_BASE64_LENGTH + 4)}`,
    }
    await expect(saveReadAloudVoiceReference(oversized)).rejects.toThrow('编码后不能超过 10 MB')
    expect(window.localStorage.getItem(READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY)).toBeNull()
  })

  it('saves, loads and removes a reference independently of AI settings', async () => {
    expect(await getReadAloudVoiceReference()).toBeNull()
    await saveReadAloudVoiceReference(reference)
    expect(await getReadAloudVoiceReference()).toEqual(reference)
    expect(window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY)).toBeNull()

    await saveAiSettings({ ...DEFAULT_AI_SETTINGS, ttsModel: 'mimo-v2.5-tts-voiceclone' })
    expect(await getReadAloudVoiceReference()).toEqual(reference)
    await resetAiSettings()
    expect(await getReadAloudVoiceReference()).toEqual(reference)

    await saveReadAloudVoiceReference(null)
    expect(await getReadAloudVoiceReference()).toBeNull()
    expect(window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY)).not.toBeNull()
  })

  it('uses Chrome local storage when available', async () => {
    const stored: Record<string, unknown> = {}
    const set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, values) })
    const get = vi.fn(async () => ({ ...stored }))
    const remove = vi.fn(async (key: string) => { delete stored[key] })
    vi.stubGlobal('chrome', { storage: { local: { get, set, remove } } })

    await saveReadAloudVoiceReference(reference)
    expect(set).toHaveBeenCalledWith({ [READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY]: reference })
    expect(await getReadAloudVoiceReference()).toEqual(reference)
    expect(get).toHaveBeenCalledWith([READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY])
    expect(window.localStorage.length).toBe(0)
    await saveReadAloudVoiceReference(null)
    expect(remove).toHaveBeenCalledWith(READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY)
    expect(await getReadAloudVoiceReference()).toBeNull()
  })

  it('reports a useful storage quota error and keeps the existing reference', async () => {
    await saveReadAloudVoiceReference(reference)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    await expect(saveReadAloudVoiceReference({ ...reference, name: 'new.wav' }))
      .rejects.toThrow('浏览器本地存储空间不足')
    expect(await getReadAloudVoiceReference()).toEqual(reference)
  })

  it('reports corrupted stored reference data instead of silently changing the voice', async () => {
    window.localStorage.setItem(READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY, '{bad-json')
    await expect(getReadAloudVoiceReference()).rejects.toThrow('保存的参考音频已损坏')
  })

  it('keeps the legacy key as the default and stores languages independently', async () => {
    await saveReadAloudVoiceReference(reference)
    await saveReadAloudVoiceReference(bundle.references.zh, 'zh')
    await saveReadAloudVoiceReference(bundle.references.en, 'en')
    expect(await getReadAloudVoiceReference()).toEqual(reference)
    expect(await getReadAloudVoiceReference('zh')).toEqual(bundle.references.zh)
    expect(await getReadAloudVoiceReference('en')).toEqual(bundle.references.en)
    expect(await getReadAloudVoiceReferences()).toEqual({ default: reference, ...bundle.references })
    await saveReadAloudVoiceReference(null, 'zh')
    expect(await getReadAloudVoiceReferences()).toEqual({ default: reference, zh: null, en: bundle.references.en })
    await resetAiSettings()
    expect(await getReadAloudVoiceReference('en')).toEqual(bundle.references.en)
  })

  it('reads all three Chrome references in one operation and fills missing slots with null', async () => {
    const get = vi.fn(async () => ({
      [READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY]: reference,
      [READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS.en]: bundle.references.en,
    }))
    vi.stubGlobal('chrome', { storage: { local: { get } } })
    expect(await getReadAloudVoiceReferences()).toEqual({ default: reference, zh: null, en: bundle.references.en })
    expect(get).toHaveBeenCalledOnce()
    expect(get).toHaveBeenCalledWith(Object.values(READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS))
  })

  it.each([
    { ...bundle, apiKey: 'forbidden' },
    { ...bundle, baseUrl: 'https://forbidden.example' },
    { ...bundle, version: 2 },
    { ...bundle, model: 'mimo-v2.5-tts-voicedesign' },
    { ...bundle, references: { zh: bundle.references.zh } },
    { ...bundle, references: { ...bundle.references, en: { ...bundle.references.en, secret: 'forbidden' } } },
    { ...bundle, references: { ...bundle.references, en: { ...bundle.references.en, dataUrl: 'data:audio/ogg;base64,AA==' } } },
  ])('rejects invalid bundle metadata or audio before any write', async (input) => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await expect(importReadAloudVoiceBundle(input)).rejects.toThrow()
    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
  })

  it('imports only the model and voice styles while preserving stored keys, URLs and default reference', async () => {
    const settings = {
      ...DEFAULT_AI_SETTINGS,
      apiKey: 'translation-key',
      ttsApiKey: 'speech-key',
      baseUrl: 'https://translation.example/v1',
      ttsBaseUrl: 'https://speech.example/v1',
      defaultTargetLanguage: 'English',
    }
    await saveAiSettings(settings)
    await saveReadAloudVoiceReference(reference)
    const imported = await importReadAloudVoiceBundle(bundle)
    expect(imported).toEqual({
      ...settings,
      ttsModel: bundle.model,
      ttsVoiceDescription: bundle.voiceDescription,
      ttsChineseVoiceDescription: bundle.chineseVoiceDescription,
      ttsEnglishVoiceDescription: bundle.englishVoiceDescription,
    })
    expect(await getReadAloudVoiceReferences()).toEqual({ default: reference, ...bundle.references })
    const storedSettings = JSON.parse(window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY)!)
    expect(storedSettings).not.toHaveProperty('references')
    expect(storedSettings).not.toHaveProperty('dataUrl')
  })

  it('persists Chrome bundle settings and both references with a single atomic set', async () => {
    const stored: Record<string, unknown> = {
      [AI_SETTINGS_STORAGE_KEY]: { ...DEFAULT_AI_SETTINGS, ttsApiKey: 'stored-key' },
      [READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY]: reference,
    }
    const get = vi.fn(async () => ({ ...stored }))
    const set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, values) })
    vi.stubGlobal('chrome', { storage: { local: { get, set } } })
    await importReadAloudVoiceBundle(bundle)
    expect(set).toHaveBeenCalledOnce()
    const values = set.mock.calls[0][0]
    expect(Object.keys(values)).toHaveLength(3)
    expect(values[AI_SETTINGS_STORAGE_KEY]).toMatchObject({ ttsApiKey: 'stored-key', ttsModel: bundle.model })
    expect(values[READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS.zh]).toEqual(bundle.references.zh)
    expect(values[READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS.en]).toEqual(bundle.references.en)
    expect(stored[READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY]).toEqual(reference)
  })

  it('keeps all old Chrome data when the atomic bundle write exceeds the quota', async () => {
    const stored: Record<string, unknown> = {
      [AI_SETTINGS_STORAGE_KEY]: { ...DEFAULT_AI_SETTINGS, ttsApiKey: 'stored-key' },
      [READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY]: reference,
      [READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS.zh]: reference,
    }
    const previous = structuredClone(stored)
    const set = vi.fn(async () => { throw new Error('QUOTA_BYTES quota exceeded') })
    vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ ...stored }), set } } })
    await expect(importReadAloudVoiceBundle(bundle)).rejects.toThrow('浏览器本地存储空间不足')
    expect(stored).toEqual(previous)
    expect(set).toHaveBeenCalledOnce()
  })

  it('rolls back partial localStorage writes and removes slots that were previously absent', async () => {
    await saveAiSettings({ ...DEFAULT_AI_SETTINGS, ttsApiKey: 'old-key' })
    await saveReadAloudVoiceReference(reference, 'zh')
    const oldSettings = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
    const originalSetItem = Storage.prototype.setItem
    let failed = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS.en && !failed) {
        failed = true
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      originalSetItem.call(this, key, value)
    })
    await expect(importReadAloudVoiceBundle(bundle)).rejects.toThrow('浏览器本地存储空间不足')
    expect(window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY)).toBe(oldSettings)
    expect(await getReadAloudVoiceReference('zh')).toEqual(reference)
    expect(window.localStorage.getItem(READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS.en)).toBeNull()
  })

  it('preflights large webpage-mode bundles before replacing existing references', async () => {
    await saveReadAloudVoiceReference(reference, 'zh')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const input = {
      ...bundle,
      references: {
        ...bundle.references,
        zh: { name: 'large.wav', dataUrl: `data:audio/wav;base64,${'A'.repeat(3_000_000)}` },
      },
    }
    expect(validateReadAloudVoiceBundle(input).references.zh.name).toBe('large.wav')
    await expect(importReadAloudVoiceBundle(input)).rejects.toThrow('网页模式的本地存储可能不足')
    expect(setItem).not.toHaveBeenCalled()
    expect(await getReadAloudVoiceReference('zh')).toEqual(reference)
  })
})
