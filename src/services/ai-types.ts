export type AiDisplayMode = 'paragraph-stream' | 'side-by-side'
export type TranslationStrategy = 'whole-document' | 'paragraph-by-paragraph'
export type AiChatRole = 'system' | 'user' | 'assistant'

export interface AiSettings {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  defaultTargetLanguage: string
  defaultDisplayMode: AiDisplayMode
  defaultTranslationStrategy: TranslationStrategy
}

export interface AiChatMessage {
  role: AiChatRole
  content: string
}

export interface AiProxyRequestPayload {
  baseUrl: string
  apiKey: string
  model: string
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

export interface AiProxyRequestMessage {
  type: typeof AI_PROXY_MESSAGE_TYPE
  payload: AiProxyRequestPayload
}

export interface AiProxySuccessResponse {
  ok: true
  data: {
    content: string
    model?: string
  }
}

export interface AiProxyErrorResponse {
  ok: false
  error: string
}

export type AiProxyReply = AiProxySuccessResponse | AiProxyErrorResponse

export const AI_SETTINGS_STORAGE_KEY = 'ai-translate-settings'
export const AI_PROXY_MESSAGE_TYPE = 'btools:ai-chat'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  systemPrompt: '你是一名专业翻译助手，请忠实翻译文本并保留原有格式。',
  defaultTargetLanguage: '中文',
  defaultDisplayMode: 'paragraph-stream',
  defaultTranslationStrategy: 'whole-document',
}

export const DISPLAY_MODE_OPTIONS: Array<{ label: string; value: AiDisplayMode }> = [
  { label: '段落流', value: 'paragraph-stream' },
  { label: '左右对照', value: 'side-by-side' },
] 

export const TRANSLATION_STRATEGY_OPTIONS: Array<{
  label: string
  value: TranslationStrategy
}> = [
  { label: '整块翻译，保留段落', value: 'whole-document' },
  { label: '逐段翻译，再合并', value: 'paragraph-by-paragraph' },
]

export function isAiDisplayMode(value: string): value is AiDisplayMode {
  return value === 'paragraph-stream' || value === 'side-by-side'
}

export function isTranslationStrategy(value: string): value is TranslationStrategy {
  return value === 'whole-document' || value === 'paragraph-by-paragraph'
}

export function normalizeAiSettings(input?: Partial<AiSettings> | null): AiSettings {
  const requestedDisplayMode = input?.defaultDisplayMode
  const requestedTranslationStrategy = input?.defaultTranslationStrategy
  const defaultDisplayMode: AiDisplayMode =
    requestedDisplayMode && isAiDisplayMode(requestedDisplayMode)
      ? requestedDisplayMode
      : DEFAULT_AI_SETTINGS.defaultDisplayMode
  const defaultTranslationStrategy: TranslationStrategy =
    requestedTranslationStrategy && isTranslationStrategy(requestedTranslationStrategy)
      ? requestedTranslationStrategy
      : DEFAULT_AI_SETTINGS.defaultTranslationStrategy

  return {
    baseUrl: input?.baseUrl?.trim() || DEFAULT_AI_SETTINGS.baseUrl,
    apiKey: input?.apiKey?.trim() || '',
    model: input?.model?.trim() || '',
    systemPrompt: input?.systemPrompt?.trim() || DEFAULT_AI_SETTINGS.systemPrompt,
    defaultTargetLanguage:
      input?.defaultTargetLanguage?.trim() || DEFAULT_AI_SETTINGS.defaultTargetLanguage,
    defaultDisplayMode,
    defaultTranslationStrategy,
  }
}