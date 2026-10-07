import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AI_SETTINGS, type AiSettings } from './ai-types'
import { splitReadAloudText, streamReadAloud } from './read-aloud-api'
import { MAX_READ_ALOUD_TEXT_LENGTH, type ReadAloudAudioChunk } from './read-aloud-types'

const encoder = new TextEncoder()

function settings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
    ttsApiKey: 'test-tts-key',
    ttsModel: 'mimo-v2.5-tts-voicedesign',
    ttsVoiceDescription: '性感御姐音色',
    ...overrides,
  }
}

function audioEvent(data = 'AACAPw=='): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { audio: { data } } }] })}\n\n`
}

function responseFromText(text: string): Response {
  return new Response(text, { headers: { 'content-type': 'text/event-stream' } })
}

function openResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value },
    cancel,
  })
  return {
    controller,
    cancel,
    response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('MiMo streaming read aloud', () => {
  it('uses the VoiceDesign chat protocol and preserves the exact selected text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFromText(`${audioEvent()}data: [DONE]\n\n`))
    vi.stubGlobal('fetch', fetchMock)
    const onChunk = vi.fn()
    await streamReadAloud('选择的文字。', settings(), onChunk)

    const [endpoint, request] = fetchMock.mock.calls[0]!
    expect(endpoint).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(request.headers.Authorization).toBe('Bearer test-tts-key')
    expect(JSON.parse(request.body)).toEqual({
      model: 'mimo-v2.5-tts-voicedesign',
      messages: [
        { role: 'user', content: '性感御姐音色' },
        { role: 'assistant', content: '选择的文字。' },
      ],
      audio: { format: 'pcm16', optimize_text_preview: false },
      stream: true,
    })
    expect(onChunk).toHaveBeenCalledWith({ data: 'AACAPw==', format: 'pcm16', sampleRate: 24000 })
  })

  it('emits audio while the connection is still open and cancels it at DONE', async () => {
    const open = openResponse()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(open.response))
    let ended = false
    const chunks: ReadAloudAudioChunk[] = []
    const promise = streamReadAloud('Hello.', settings(), (chunk) => { chunks.push(chunk) })
      .then(() => { ended = true })
    open.controller.enqueue(encoder.encode(audioEvent('AQACAA==')))
    await vi.waitFor(() => expect(chunks).toHaveLength(1))
    expect(ended).toBe(false)
    open.controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    await promise
    expect(ended).toBe(true)
    expect(open.cancel).toHaveBeenCalledOnce()
  })

  it('handles fragmented UTF-8, CRLF, multiline data and an unterminated final event', async () => {
    const source = ': keepalive\r\n\r\ndata: {"note":"中文",\r\ndata: "choices":[{"delta":{"audio":{"data":"AQACAA=="}}}]}\r\n\r\n' +
      'data: {"choices":[],"usage":{"total_tokens":3}}\r\n\r\n' + audioEvent('AwAEAA==').trimEnd()
    const bytes = encoder.encode(source)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const chunks: ReadAloudAudioChunk[] = []
    await streamReadAloud('你好', settings(), (chunk) => { chunks.push(chunk) })
    expect(chunks.map((chunk) => chunk.data)).toEqual(['AQACAA==', 'AwAEAA=='])
  })

  it('reads compatible JSON audio responses without making another request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      choices: [{ message: { audio: { data: 'AQACAA==' } } }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const onChunk = vi.fn()
    await streamReadAloud('你好', settings(), onChunk)
    expect(onChunk).toHaveBeenCalledWith({ data: 'AQACAA==', format: 'pcm16', sampleRate: 24000 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('uses the documented default built-in voice for the real streaming model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFromText(audioEvent()))
    vi.stubGlobal('fetch', fetchMock)
    await streamReadAloud('Hello.', settings({ ttsModel: 'mimo-v2.5-tts' }), vi.fn())
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).audio).toEqual({ format: 'pcm16', voice: 'mimo_default' })
  })

  it('starts a short VoiceDesign segment before requesting the rest in order', async () => {
    const text = '第一句需要尽快开始朗读。'.repeat(40)
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responseFromText(audioEvent())))
    vi.stubGlobal('fetch', fetchMock)
    const chunks: ReadAloudAudioChunk[] = []
    await streamReadAloud(text, settings(), (chunk) => {
      expect(fetchMock).toHaveBeenCalledTimes(chunks.length + 1)
      chunks.push(chunk)
    })
    const requestedTexts = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).messages[1].content)
    expect(Array.from(requestedTexts[0]).length).toBeLessThanOrEqual(80)
    expect(requestedTexts.slice(1).every((part) => Array.from(part as string).length <= 260)).toBe(true)
    expect(requestedTexts.join('')).toBe(text)
  })

  it('reports HTTP and SSE provider errors and never retries audio already emitted', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: 'API Key 无效' } }, { status: 401 }))
      .mockResolvedValueOnce(responseFromText(`${audioEvent()}event: error\ndata: {"message":"额度不足"}\n\n`))
    vi.stubGlobal('fetch', fetchMock)
    await expect(streamReadAloud('你好', settings(), vi.fn())).rejects.toThrow('API Key 无效')
    const onChunk = vi.fn()
    await expect(streamReadAloud('你好', settings(), onChunk)).rejects.toThrow('额度不足')
    expect(onChunk).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed streams and empty audio responses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(responseFromText('data: {broken}\n\n'))
      .mockResolvedValueOnce(responseFromText('data: {"choices":[]}\n\ndata: [DONE]\n\n')))
    await expect(streamReadAloud('你好', settings(), vi.fn())).rejects.toThrow('无效的流式数据')
    await expect(streamReadAloud('你好', settings(), vi.fn())).rejects.toThrow('未返回音频数据')
  })

  it('rejects missing credentials, empty and oversized selections before sending', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(streamReadAloud('你好', settings({ ttsApiKey: '' }), vi.fn())).rejects.toThrow('配置朗读 API Key')
    await expect(streamReadAloud('  ', settings(), vi.fn())).rejects.toThrow('请先选择')
    await expect(streamReadAloud('字'.repeat(MAX_READ_ALOUD_TEXT_LENGTH + 1), settings(), vi.fn())).rejects.toThrow('朗读文字过长')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('honors an already aborted signal without sending a request', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(streamReadAloud('你好', settings(), vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels a pending reader and prevents late chunks and later segments', async () => {
    const controller = new AbortController()
    const open = openResponse()
    const fetchMock = vi.fn().mockResolvedValue(open.response)
    vi.stubGlobal('fetch', fetchMock)
    const onChunk = vi.fn(() => controller.abort())
    const promise = streamReadAloud('字'.repeat(500), settings(), onChunk, controller.signal)
    open.controller.enqueue(encoder.encode(audioEvent()))
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(onChunk).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(open.cancel).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true)
  })

  it('times out even while waiting for the next streaming event', async () => {
    vi.useFakeTimers()
    const open = openResponse()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(open.response))
    const promise = streamReadAloud('你好', settings({ requestTimeoutMs: 50 }), vi.fn())
    const rejection = expect(promise).rejects.toThrow('朗读请求超时')
    await vi.advanceTimersByTimeAsync(51)
    await rejection
    expect(open.cancel).toHaveBeenCalledOnce()
  })

  it('waits for playback capacity before delivering subsequent audio from the same SSE buffer', async () => {
    let allowDelivery!: () => void
    const waitingForPlayback = new Promise<void>((resolve) => { allowDelivery = resolve })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFromText(
      `${audioEvent('AQACAA==')}${audioEvent('AwAEAA==')}data: [DONE]\n\n`,
    )))
    const chunks: string[] = []
    const promise = streamReadAloud('你好', settings(), (chunk) => {
      chunks.push(chunk.data)
      if (chunks.length === 1) return waitingForPlayback
    })
    await vi.waitFor(() => expect(chunks).toEqual(['AQACAA==']))
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    expect(chunks).toEqual(['AQACAA=='])
    allowDelivery()
    await promise
    expect(chunks).toEqual(['AQACAA==', 'AwAEAA=='])
  })

  it('pauses the network timeout during backpressure and aborts without waiting for ready', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const open = openResponse()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(open.response))
    const onChunk = vi.fn(() => new Promise<void>(() => {}))
    const promise = streamReadAloud('你好', settings({ requestTimeoutMs: 50 }), onChunk, controller.signal)
    open.controller.enqueue(encoder.encode(audioEvent()))
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    expect(onChunk).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(500)
    expect(open.cancel).not.toHaveBeenCalled()
    controller.abort()
    await rejection
    expect(open.cancel).toHaveBeenCalledOnce()
  })
})

describe('sentence-aware read aloud text splitting', () => {
  it('keeps English words intact and all nonwhitespace text in order', () => {
    const text = 'An informative sentence with some ordinary English words. '.repeat(20)
    const parts = splitReadAloudText(text, 'mimo-v2.5-tts-voicedesign')
    expect(parts.join(' ').replace(/\s/gu, '')).toBe(text.replace(/\s/gu, ''))
    expect(parts[0]!.length).toBeLessThanOrEqual(80)
    expect(parts.every((part) => part.endsWith('.') || text.includes(`${part} `))).toBe(true)
  })

  it('does not split surrogate pairs and uses fewer requests for actual streaming models', () => {
    const text = '😀'.repeat(2500)
    const parts = splitReadAloudText(text, 'mimo-v2.5-tts')
    expect(parts.map((part) => Array.from(part).length)).toEqual([1200, 1200, 100])
    expect(parts.join('')).toBe(text)
    expect(parts.some((part) => /[\uD800-\uDBFF]$/u.test(part))).toBe(false)
  })
})
