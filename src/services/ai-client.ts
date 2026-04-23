import { getAiSettings, getMissingAiSettingLabels } from './ai-settings'
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

  const message: AiProxyRequestMessage = {
    type: AI_PROXY_MESSAGE_TYPE,
    payload: {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      timeoutMs: options.timeoutMs,
    },
  }

  const response = (await chrome.runtime.sendMessage(message)) as AiProxyReply | undefined

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