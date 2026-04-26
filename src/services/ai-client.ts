import { getAiSettings, getMissingAiSettingLabels } from './ai-settings'
import { requestChatCompletion, resolveChatEndpoint } from './ai-api'
import {
  AI_PROXY_MESSAGE_TYPE,
  type AiChatMessage,
  type AiProxyReply,
  type AiProxyRequestMessage,
} from './ai-types'

interface AiChatRequestOptions {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

export async function requestAiChatCompletion(
  messages: AiChatMessage[],
  options: AiChatRequestOptions = {},
): Promise<{ content: string; model?: string }> {
  const settings = await getAiSettings()
  const missingFields = getMissingAiSettingLabels(settings)

  if (missingFields.length > 0) {
    throw new Error(`请先在设置页补全：${missingFields.join('、')}`)
  }

  if (!hasRuntimeMessaging()) {
    throw new Error('当前环境不支持扩展后台代理，请在加载扩展后使用 AI 翻译')
  }

  const payload = {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    messages,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs ?? settings.requestTimeoutMs,
  }

  if (isServiceWorkerContext()) {
    const endpoint = resolveChatEndpoint(payload.baseUrl)
    return await requestChatCompletion(endpoint, payload)
  }

  const message: AiProxyRequestMessage = {
    type: AI_PROXY_MESSAGE_TYPE,
    payload,
  }

  let response: AiProxyReply | undefined

  try {
    response = (await chrome.runtime.sendMessage(message)) as AiProxyReply | undefined
  } catch (err: unknown) {
    throw new Error('后台服务已断开，请刷新页面或重载扩展。')
  }

  if (!response) {
    throw new Error('后台代理没有返回结果')
  }

  if (!response.ok) {
    throw new Error(response.error)
  }

  return response.data
}

function hasRuntimeMessaging(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.runtime.sendMessage
}

function isServiceWorkerContext(): boolean {
  return typeof window === 'undefined' && typeof self !== 'undefined' && 'ServiceWorkerGlobalScope' in self
}