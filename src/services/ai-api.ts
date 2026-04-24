import type { AiProxyRequestPayload } from './ai-types'

export function resolveChatEndpoint(baseUrl: string): string {
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

export async function requestChatCompletion(
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
