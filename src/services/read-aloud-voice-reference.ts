import { getAiSettings } from './ai-settings'
import { AI_SETTINGS_STORAGE_KEY, normalizeAiSettings, type AiSettings } from './ai-types'

export const READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY = 'read-aloud-voice-reference'
export const MAX_READ_ALOUD_REFERENCE_BASE64_LENGTH = 10_000_000
export const READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS = {
  default: READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY,
  zh: `${READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY}-zh`,
  en: `${READ_ALOUD_VOICE_REFERENCE_STORAGE_KEY}-en`,
} as const

export type ReadAloudVoiceLanguage = 'default' | 'zh' | 'en'

export interface ReadAloudVoiceReference {
  name: string
  dataUrl: string
}

export interface ReadAloudVoiceReferences {
  default: ReadAloudVoiceReference | null
  zh: ReadAloudVoiceReference | null
  en: ReadAloudVoiceReference | null
}

export interface ReadAloudVoiceBundle {
  version: 1
  model: 'mimo-v2.5-tts-voiceclone'
  voiceDescription: string
  chineseVoiceDescription: string
  englishVoiceDescription: string
  references: {
    zh: ReadAloudVoiceReference
    en: ReadAloudVoiceReference
  }
}

/** Reference audio stays outside the frequently loaded AI settings object. */
export function validateReadAloudVoiceReference(reference: unknown): ReadAloudVoiceReference {
  if (!reference || typeof reference !== 'object' ||
    !('name' in reference) || typeof reference.name !== 'string' ||
    !('dataUrl' in reference) || typeof reference.dataUrl !== 'string') {
    throw new Error('参考音频格式无效，请重新选择 WAV 或 MP3 文件')
  }

  const dataUrl = reference.dataUrl.trim()
  const match = /^data:audio\/(wav|mpeg);base64,(.*)$/u.exec(dataUrl)
  if (!match) throw new Error('参考音频仅支持 WAV 或 MP3 文件')
  const encodedAudio = match[2]!
  if (encodedAudio.length > MAX_READ_ALOUD_REFERENCE_BASE64_LENGTH) {
    throw new Error('参考音频编码后不能超过 10 MB，请选择更短的 WAV 或 MP3 文件')
  }
  if (!encodedAudio || encodedAudio.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encodedAudio)) {
    throw new Error('参考音频数据无效，请重新选择 WAV 或 MP3 文件')
  }

  return { name: reference.name.trim() || '参考音频', dataUrl }
}

export async function getReadAloudVoiceReference(language: ReadAloudVoiceLanguage = 'default'): Promise<ReadAloudVoiceReference | null> {
  const key = referenceStorageKey(language)
  let stored: unknown
  if (hasChromeStorage()) {
    const data = await chrome.storage.local.get([key])
    stored = data[key]
  } else if (hasLocalStorage()) {
    stored = parseStoredReference(window.localStorage.getItem(key))
  }

  if (stored === undefined || stored === null) return null
  return validateReadAloudVoiceReference(stored)
}

export async function getReadAloudVoiceReferences(): Promise<ReadAloudVoiceReferences> {
  let stored: Record<string, unknown> = {}
  if (hasChromeStorage()) {
    stored = await chrome.storage.local.get(Object.values(READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS))
  } else if (hasLocalStorage()) {
    for (const key of Object.values(READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS)) {
      stored[key] = parseStoredReference(window.localStorage.getItem(key))
    }
  }

  const readReference = (language: ReadAloudVoiceLanguage) => {
    const reference = stored[referenceStorageKey(language)]
    return reference === undefined || reference === null ? null : validateReadAloudVoiceReference(reference)
  }
  return { default: readReference('default'), zh: readReference('zh'), en: readReference('en') }
}

export async function saveReadAloudVoiceReference(reference: ReadAloudVoiceReference | null, language: ReadAloudVoiceLanguage = 'default'): Promise<void> {
  const key = referenceStorageKey(language)
  const normalized = reference === null ? null : validateReadAloudVoiceReference(reference)
  try {
    if (hasChromeStorage()) {
      if (normalized) {
        await chrome.storage.local.set({ [key]: normalized })
      } else {
        await chrome.storage.local.remove(key)
      }
      return
    }

    if (hasLocalStorage()) {
      if (normalized) {
        window.localStorage.setItem(key, JSON.stringify(normalized))
      } else {
        window.localStorage.removeItem(key)
      }
      return
    }

    throw new Error('当前浏览器不支持保存参考音频')
  } catch (error: unknown) {
    throwStorageError(error)
  }
}

/** A voice bundle deliberately cannot include credentials or unrelated AI settings. */
export function validateReadAloudVoiceBundle(input: unknown): ReadAloudVoiceBundle {
  const bundle = requireExactObject(input, [
    'version', 'model', 'voiceDescription', 'chineseVoiceDescription', 'englishVoiceDescription', 'references',
  ])
  if (bundle.version !== 1 || bundle.model !== 'mimo-v2.5-tts-voiceclone') {
    throw new Error('音色组合版本或模型无效，仅支持版本 1 的 VoiceClone 组合')
  }
  for (const key of ['voiceDescription', 'chineseVoiceDescription', 'englishVoiceDescription']) {
    if (typeof bundle[key] !== 'string' || (bundle[key] as string).length > 10000) {
      throw new Error('音色组合的朗读风格格式无效')
    }
  }
  if (!(bundle.voiceDescription as string).trim()) throw new Error('音色组合需要提供通用朗读风格')
  const references = requireExactObject(bundle.references, ['zh', 'en'])
  const readReference = (reference: unknown) => {
    requireExactObject(reference, ['name', 'dataUrl'])
    return validateReadAloudVoiceReference(reference)
  }
  return {
    version: 1,
    model: 'mimo-v2.5-tts-voiceclone',
    voiceDescription: (bundle.voiceDescription as string).trim(),
    chineseVoiceDescription: (bundle.chineseVoiceDescription as string).trim(),
    englishVoiceDescription: (bundle.englishVoiceDescription as string).trim(),
    references: { zh: readReference(references.zh), en: readReference(references.en) },
  }
}

export async function importReadAloudVoiceBundle(input: unknown): Promise<AiSettings> {
  // Validate all fields and both audio payloads before any persistent write.
  const bundle = validateReadAloudVoiceBundle(input)
  const settings = normalizeAiSettings({
    ...await getAiSettings(),
    ttsModel: bundle.model,
    ttsVoiceDescription: bundle.voiceDescription,
    ttsChineseVoiceDescription: bundle.chineseVoiceDescription,
    ttsEnglishVoiceDescription: bundle.englishVoiceDescription,
  })
  const values = {
    [AI_SETTINGS_STORAGE_KEY]: settings,
    [READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS.zh]: bundle.references.zh,
    [READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS.en]: bundle.references.en,
  }

  try {
    if (hasChromeStorage()) {
      // One quota-checked operation keeps settings and the two voices together.
      await chrome.storage.local.set(values)
    } else if (hasLocalStorage()) {
      saveLocalStorageValues(values)
    } else {
      throw new Error('当前浏览器不支持保存音色组合')
    }
  } catch (error: unknown) {
    throwStorageError(error)
  }
  return settings
}

function referenceStorageKey(language: ReadAloudVoiceLanguage): string {
  if (language !== 'default' && language !== 'zh' && language !== 'en') {
    throw new Error('参考音频的语言无效')
  }
  return READ_ALOUD_VOICE_REFERENCE_STORAGE_KEYS[language]
}

function parseStoredReference(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch {
    throw new Error('保存的参考音频已损坏，请重新选择 WAV 或 MP3 文件')
  }
}

function requireExactObject(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    throw new Error('音色组合结构无效，仅允许音色、风格和参考音频字段')
  }
  return input as Record<string, unknown>
}

function saveLocalStorageValues(values: Record<string, unknown>): void {
  const entries = Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)] as const)
  const previous = new Map(entries.map(([key]) => [key, window.localStorage.getItem(key)]))
  const projected = new Map<string, string>()
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index)!
    projected.set(key, window.localStorage.getItem(key)!)
  }
  for (const [key, value] of entries) projected.set(key, value)
  const estimatedBytes = Array.from(projected).reduce((sum, [key, value]) => sum + (key.length + value.length) * 2, 0)
  // localStorage quotas vary. This is a conservative preflight, not a capacity guarantee.
  if (estimatedBytes > 5 * 1024 * 1024) {
    throw new Error('音色组合较大，网页模式的本地存储可能不足，请使用扩展模式或更短的参考音频')
  }
  try {
    for (const [key, value] of entries) window.localStorage.setItem(key, value)
  } catch (error: unknown) {
    try {
      for (const [key] of entries) window.localStorage.removeItem(key)
      for (const [key, value] of previous) {
        if (value !== null) window.localStorage.setItem(key, value)
      }
    } catch {
      throw new Error('音色组合导入失败，恢复旧数据时出错，请检查浏览器本地存储权限')
    }
    throw error
  }
}

function throwStorageError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (/quota|exceed|配额|容量|空间/iu.test(message)) {
    throw new Error('参考音频无法保存：浏览器本地存储空间不足，请选择更短的 WAV/MP3 音频或压缩后重试')
  }
  throw error
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}
