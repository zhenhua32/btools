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
  onStreamChunk?: (delta: string, fullText: string) => void
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
        stream: payload.stream ?? false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      if (payload.stream) {
         const body = await parseResponseBody(response)
         const errorMessage = getErrorMessage(body) || `模型接口返回 ${response.status}`
         throw new Error(errorMessage)
      } else {
         const body = await parseResponseBody(response)
         const errorMessage = getErrorMessage(body) || `模型接口返回 ${response.status}`
         throw new Error(errorMessage)
      }
    }

    if (payload.stream && response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let fullContent = ''
      let detectedModel = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        
        // Keep the last segment as buffer if it doesn't end with newline
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          if (trimmed === 'data: [DONE]') {
            break
          }
          
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6))
              if (data.model) detectedModel = data.model
              
              const delta = data.choices?.[0]?.delta?.content || ''
              if (delta) {
                fullContent += delta
                onStreamChunk?.(delta, fullContent)
              }
            } catch (e) {
              // skip parsing errors on chunks, wait for next clean parse? No, if JSON error it's already popped from buffer.
              // Actually OpenAI SSE uses two newlines `\n\n` to end a frame. Our splitting by `\n` works because JSON is 1 line.
            }
          }
        }
      }
      
      // Attempt to decode any remaining buffer
      if (buffer.trim() && buffer.trim().startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
        try {
           const data = JSON.parse(buffer.trim().slice(6))
           const delta = data.choices?.[0]?.delta?.content || ''
           if (delta) {
             fullContent += delta
             onStreamChunk?.(delta, fullContent)
           }
        } catch { }
      }
      
      return { content: fullContent, model: detectedModel }
    }

    const body = await parseResponseBody(response)

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
