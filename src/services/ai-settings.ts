import {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  normalizeAiSettings,
  type AiSettings,
} from './ai-types'

const REQUIRED_SETTING_LABELS: Record<'baseUrl' | 'apiKey' | 'model', string> = {
  baseUrl: '接口地址',
  apiKey: 'API Key',
  model: '模型名称',
}

export async function getAiSettings(): Promise<AiSettings> {
  if (hasChromeStorage()) {
    const data = await chrome.storage.local.get([AI_SETTINGS_STORAGE_KEY])
    return normalizeAiSettings(data[AI_SETTINGS_STORAGE_KEY] as Partial<AiSettings> | undefined)
  }

  if (hasLocalStorage()) {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
    if (!raw) {
      return { ...DEFAULT_AI_SETTINGS }
    }
    try {
      return normalizeAiSettings(JSON.parse(raw) as Partial<AiSettings>)
    } catch {
      return { ...DEFAULT_AI_SETTINGS }
    }
  }

  return { ...DEFAULT_AI_SETTINGS }
}

export async function saveAiSettings(settings: AiSettings): Promise<AiSettings> {
  const normalized = normalizeAiSettings(settings)

  if (hasChromeStorage()) {
    await chrome.storage.local.set({
      [AI_SETTINGS_STORAGE_KEY]: normalized,
    })
    return normalized
  }

  if (hasLocalStorage()) {
    window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
  }

  return normalized
}

export async function resetAiSettings(): Promise<AiSettings> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({
      [AI_SETTINGS_STORAGE_KEY]: DEFAULT_AI_SETTINGS,
    })
    return { ...DEFAULT_AI_SETTINGS }
  }

  if (hasLocalStorage()) {
    window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_AI_SETTINGS))
  }

  return { ...DEFAULT_AI_SETTINGS }
}

export function getMissingAiSettingLabels(settings: AiSettings): string[] {
  return Object.entries(REQUIRED_SETTING_LABELS)
    .filter(([key]) => !settings[key as keyof typeof REQUIRED_SETTING_LABELS].trim())
    .map(([, label]) => label)
}

export function isAiSettingsConfigured(settings: AiSettings): boolean {
  return getMissingAiSettingLabels(settings).length === 0
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}