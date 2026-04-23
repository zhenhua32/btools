// BTools Service Worker - Manifest V3
// 点击扩展图标时打开工具集新标签页

import {
  AI_PROXY_MESSAGE_TYPE,
  type AiProxyReply,
  type AiProxyRequestMessage,
  type AiProxyRequestPayload,
} from '@/services/ai-types'

chrome.action.onClicked.addListener(() => {
  // 检查是否已有 BTools 标签页打开，有则激活，无则新建
  const url = chrome.runtime.getURL('index.html')
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs.length > 0 && tabs[0].id !== undefined) {
      chrome.tabs.update(tabs[0].id, { active: true })
      if (tabs[0].windowId !== undefined) {
        chrome.windows.update(tabs[0].windowId, { focused: true })
      }
    } else {
      chrome.tabs.create({ url })
    }
  })
})

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isAiProxyRequestMessage(message)) {
    return false
  }

  handleAiProxyRequest(message)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : '后台代理请求失败',
      } satisfies AiProxyReply)
    })

  return true
})

async function handleAiProxyRequest(message: AiProxyRequestMessage): Promise<AiProxyReply> {
  try {
    const endpoint = resolveChatEndpoint(message.payload.baseUrl)
    const response = await requestChatCompletion(endpoint, message.payload)
    return {
      ok: true,
      data: response,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '模型接口调用失败',
    }
  }
}

function isAiProxyRequestMessage(message: unknown): message is AiProxyRequestMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type?: unknown }).type === AI_PROXY_MESSAGE_TYPE &&
    'payload' in message
  )
}

function resolveChatEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim())
  const pathname = url.pathname.replace(/\/+$/, '')

  if (pathname.endsWith('/chat/completions')) {
    return url.toString()
  }

  if (pathname.endsWith('/v1')) {
    url.pathname = `${pathname}/chat/completions`
    return url.toString()
  }

  url.pathname = pathname ? `${pathname}/v1/chat/completions` : '/v1/chat/completions'
  return url.toString()
}

async function requestChatCompletion(
  endpoint: string,
  payload: AiProxyRequestPayload,
): Promise<{ content: string; model?: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), payload.timeoutMs ?? 60000)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${payload.apiKey}`,
      },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        temperature: payload.temperature ?? 0.2,
        max_tokens: payload.maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    })

    const body = await parseResponseBody(response)

    if (!response.ok) {
      const errorMessage = getErrorMessage(body) || `模型接口返回 ${response.status}`
      throw new Error(errorMessage)
    }

    const content = extractContent(body)
    if (!content) {
      throw new Error('模型接口未返回可用内容')
    }

    return {
      content,
      model: typeof body === 'object' && body && 'model' in body ? String(body.model) : undefined,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('模型请求超时，请稍后重试')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function getErrorMessage(body: unknown): string | null {
  if (typeof body === 'string') {
    return body.trim() || null
  }

  if (typeof body !== 'object' || body === null) {
    return null
  }

  if ('error' in body && typeof body.error === 'object' && body.error !== null) {
    const nested = body.error as { message?: unknown }
    if (typeof nested.message === 'string') {
      return nested.message
    }
  }

  if ('message' in body && typeof body.message === 'string') {
    return body.message
  }

  return null
}

function extractContent(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('choices' in body)) {
    return ''
  }

  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return ''
  }

  const firstChoice = choices[0] as {
    message?: { content?: string | Array<{ text?: string; type?: string }> }
    text?: string
  }

  if (typeof firstChoice.text === 'string') {
    return firstChoice.text.trim()
  }

  const content = firstChoice.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim()
  }

  return ''
}
