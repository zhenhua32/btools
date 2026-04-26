export type AiDisplayMode = 'paragraph-stream' | 'side-by-side'
export type TranslationStrategy = 'whole-document' | 'paragraph-by-paragraph'
export type AiChatRole = 'system' | 'user' | 'assistant'
export type PageTranslateMode = 'page' | 'selection'

export interface AiSettings {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  defaultTargetLanguage: string
  defaultDisplayMode: AiDisplayMode
  defaultTranslationStrategy: TranslationStrategy
  concurrencyLimit: number
  requestTimeoutMs: number
  enableSelectionButton: boolean
  enableCtrlSelection: boolean
  enableStreaming: boolean
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
  stream?: boolean
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

export interface PageTranslateStartMessage {
  type: typeof PAGE_TRANSLATE_START_MESSAGE_TYPE
  payload: {
    requestId: string
  }
}

export interface PageTranslateSubmitMessage {
  type: typeof PAGE_TRANSLATE_SUBMIT_MESSAGE_TYPE
  payload: {
    requestId: string
    text: string
    title: string
    url: string
  }
}

export interface PageTranslateSelectionSubmitMessage {
  type: typeof PAGE_TRANSLATE_SELECTION_SUBMIT_MESSAGE_TYPE
  payload: {
    requestId: string
    text: string
    html?: string
    title: string
    url: string
  }
}

interface PageTranslateLoadingPayload {
  requestId: string
  status: 'loading'
  message: string
  mode: PageTranslateMode
}

interface PageTranslateStreamingPayload {
  requestId: string
  status: 'streaming'
  index: number
  delta: string
  fullText: string
  mode: PageTranslateMode
}

interface PageTranslateErrorPayload {
  requestId: string
  status: 'error'
  message: string
  mode: PageTranslateMode
}

interface PageTranslateSuccessPayload {
  requestId: string
  status: 'success'
  title: string
  url: string
  translatedText: string
  translatedHtml?: string
  paragraphs?: string[]
  targetLanguage: string
  strategyUsed: TranslationStrategy
  mode: PageTranslateMode
}

export interface PageTranslateStatusMessage {
  type: typeof PAGE_TRANSLATE_STATUS_MESSAGE_TYPE
  payload:
    | PageTranslateLoadingPayload
    | PageTranslateStreamingPayload
    | PageTranslateErrorPayload
    | PageTranslateSuccessPayload
}

export const AI_SETTINGS_STORAGE_KEY = 'ai-translate-settings'
export const AI_PROXY_MESSAGE_TYPE = 'btools:ai-chat'
export const PAGE_TRANSLATE_START_MESSAGE_TYPE = 'btools:page-translate-start'
export const PAGE_TRANSLATE_SUBMIT_MESSAGE_TYPE = 'btools:page-translate-submit'
export const PAGE_TRANSLATE_SELECTION_SUBMIT_MESSAGE_TYPE = 'btools:page-translate-selection-submit'
export const PAGE_TRANSLATE_STATUS_MESSAGE_TYPE = 'btools:page-translate-status'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  systemPrompt: '你是一名专业翻译助手，请忠实翻译文本并保留原有格式。',
  defaultTargetLanguage: '中文',
  defaultDisplayMode: 'paragraph-stream',
  defaultTranslationStrategy: 'whole-document',
  concurrencyLimit: 3,
  requestTimeoutMs: 300000,
  enableSelectionButton: true,
  enableCtrlSelection: true,
  enableStreaming: true,
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
    concurrencyLimit:
      typeof input?.concurrencyLimit === 'number' && input.concurrencyLimit > 0
        ? input.concurrencyLimit
        : DEFAULT_AI_SETTINGS.concurrencyLimit,
    requestTimeoutMs:
      typeof input?.requestTimeoutMs === 'number' && input.requestTimeoutMs > 0
        ? Math.round(input.requestTimeoutMs)
        : DEFAULT_AI_SETTINGS.requestTimeoutMs,
    defaultTranslationStrategy,
    enableSelectionButton: input?.enableSelectionButton ?? DEFAULT_AI_SETTINGS.enableSelectionButton,
    enableCtrlSelection: input?.enableCtrlSelection ?? DEFAULT_AI_SETTINGS.enableCtrlSelection,
    enableStreaming: input?.enableStreaming ?? DEFAULT_AI_SETTINGS.enableStreaming,
  }
}

export function isAiProxyRequestMessage(message: unknown): message is AiProxyRequestMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type?: unknown }).type === AI_PROXY_MESSAGE_TYPE &&
    'payload' in message
  )
}

export function isPageTranslateStartMessage(message: unknown): message is PageTranslateStartMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type?: unknown }).type === PAGE_TRANSLATE_START_MESSAGE_TYPE &&
    'payload' in message
  )
}

export function isPageTranslateSubmitMessage(message: unknown): message is PageTranslateSubmitMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type?: unknown }).type === PAGE_TRANSLATE_SUBMIT_MESSAGE_TYPE &&
    'payload' in message
  )
}

export function isPageTranslateSelectionSubmitMessage(
  message: unknown,
): message is PageTranslateSelectionSubmitMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type?: unknown }).type === PAGE_TRANSLATE_SELECTION_SUBMIT_MESSAGE_TYPE &&
    'payload' in message
  )
}

export function isPageTranslateStatusMessage(message: unknown): message is PageTranslateStatusMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type?: unknown }).type === PAGE_TRANSLATE_STATUS_MESSAGE_TYPE &&
    'payload' in message
  )
}