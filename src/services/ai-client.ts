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
  enableStreaming?: boolean
  onStreamChunk?: (delta: string, fullTextSoFar: string) => void
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
    stream: options.enableStreaming,
  }

  if (isServiceWorkerContext()) {
    const endpoint = resolveChatEndpoint(payload.baseUrl)
    return await requestChatCompletion(endpoint, payload, options.onStreamChunk)
  }

  if (options.enableStreaming) {
    return new Promise((resolve, reject) => {
      const portName = `btools-ai-stream-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      const port = chrome.runtime.connect({ name: portName })
      let fullContent = ''
      let isDone = false
      
      port.onMessage.addListener((msg: any) => {
        if (msg.type === 'chunk') {
          fullContent += msg.delta || ''
          options.onStreamChunk?.(msg.delta || '', fullContent)
        } else if (msg.type === 'done') {
          isDone = true
          resolve({ content: fullContent, model: msg.model })
          port.disconnect()
        } else if (msg.type === 'error') {
          isDone = true
          reject(new Error(msg.error))
          port.disconnect()
        }
      })
      
      port.onDisconnect.addListener(() => {
        if (!isDone) {
          reject(new Error('流式请求意外断开'))
        }
      })

      port.postMessage({
        type: AI_PROXY_MESSAGE_TYPE,
        payload,
      })
    })
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