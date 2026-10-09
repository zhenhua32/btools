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
    await streamReadAloud('选择的文字。', settings({
      ttsChineseVoiceDescription: 'Clone 中文风格', ttsEnglishVoiceDescription: 'Clone English style',
    }), onChunk)

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
    await streamReadAloud('Hello.', settings({ ttsModel: 'mimo-v2.5-tts', ttsEnglishVoiceDescription: 'Clone-only style' }), vi.fn())
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).audio).toEqual({ format: 'pcm16', voice: 'mimo_default' })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).messages[0].content).toBe('性感御姐音色')
  })

  it('uses one validated VoiceClone reference for every short segment and preserves the style instruction', async () => {
    const text = '这里需要稳定的说话人音色，并尽快开始朗读。'.repeat(30)
    const reference = { name: '固定音色.wav', dataUrl: 'data:audio/wav;base64,AQACAA==' }
    const originalReference = reference.dataUrl
    const style = '语速自然，平静温柔地朗读，保持参考音频中的说话人音色。'
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responseFromText(audioEvent())))
    vi.stubGlobal('fetch', fetchMock)

    await streamReadAloud(text, settings({ ttsModel: 'MiMo-v2.5-TTS-VoiceClone', ttsVoiceDescription: style }), () => {
      reference.dataUrl = 'data:audio/mpeg;base64,AwAEAA=='
    }, undefined, reference)

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))
    expect(bodies.length).toBeGreaterThan(1)
    expect(Array.from(bodies[0].messages[1].content).length).toBeLessThanOrEqual(80)
    expect(bodies.slice(1).every((body) => Array.from(body.messages[1].content).length <= 260)).toBe(true)
    expect(bodies.map((body) => body.messages[1].content).join('')).toBe(text)
    for (const body of bodies) {
      expect(body.messages[0]).toEqual({ role: 'user', content: style })
      expect(body.audio).toEqual({ format: 'pcm16', voice: originalReference })
      expect(body.stream).toBe(true)
    }
  })

  it('rejects missing or invalid VoiceClone reference audio before sending any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cloneSettings = settings({ ttsModel: 'mimo-v2.5-tts-voiceclone' })
    await expect(streamReadAloud('你好', cloneSettings, vi.fn())).rejects.toThrow('添加 VoiceClone 参考音频')
    await expect(streamReadAloud('你好', cloneSettings, vi.fn(), undefined, null)).rejects.toThrow('添加 VoiceClone 参考音频')
    await expect(streamReadAloud('你好', cloneSettings, vi.fn(), undefined, {
      name: '无效参考', dataUrl: 'https://example.com/voice.wav',
    })).rejects.toThrow('仅支持 WAV 或 MP3')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes mixed Chinese and English sentences through stable language voices and styles', async () => {
    const text = '中文使用 API 这个短词。  ' +
      'This is a complete English sentence spoken in a calm and natural voice. '.repeat(10) +
      '最后回到中文。'
    const references = {
      default: null,
      zh: { name: '中文.wav', dataUrl: 'data:audio/wav;base64,AQACAA==' },
      en: { name: 'English.mp3', dataUrl: 'data:audio/mpeg;base64,AwAEAA==' },
    }
    const originalZh = references.zh.dataUrl
    const originalEn = references.en.dataUrl
    const inputSettings = settings({
      ttsModel: 'mimo-v2.5-tts-voiceclone',
      ttsChineseVoiceDescription: '平静温柔地朗读。',
      ttsEnglishVoiceDescription: 'Read calmly and naturally.',
    })
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responseFromText(audioEvent())))
    vi.stubGlobal('fetch', fetchMock)
    await streamReadAloud(text, inputSettings, () => {
      references.zh.dataUrl = 'data:audio/wav;base64,AAABAA=='
      references.en.dataUrl = 'data:audio/mpeg;base64,AAABAA=='
      inputSettings.ttsEnglishVoiceDescription = 'Changed during playback'
    }, undefined, references)

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))
    expect(bodies.map((body) => body.messages[1].content).join('')).toBe(text)
    const englishBodies = bodies.filter((body) => !/\p{Script=Han}/u.test(body.messages[1].content))
    expect(englishBodies.length).toBeGreaterThan(1)
    expect(Array.from(englishBodies[0].messages[1].content).length).toBeGreaterThan(80)
    expect(bodies.slice(1).every((body) => Array.from(body.messages[1].content).length <= 260)).toBe(true)
    for (const body of bodies) {
      const chinese = /\p{Script=Han}/u.test(body.messages[1].content)
      expect(body.audio).toEqual({ format: 'pcm16', voice: chinese ? originalZh : originalEn })
      expect(body.messages[0].content).toBe(chinese ? '平静温柔地朗读。' : 'Read calmly and naturally.')
    }
  })

  it('keeps large whitespace gaps without sending silent segments that interrupt the next language', async () => {
    const text = 'Hello.' + ' '.repeat(400) + '你好。'
    const references = {
      default: null,
      zh: { name: '中文.wav', dataUrl: 'data:audio/wav;base64,AQACAA==' },
      en: { name: 'English.mp3', dataUrl: 'data:audio/mpeg;base64,AwAEAA==' },
    }
    const fetchMock = vi.fn().mockImplementation((_endpoint, request) => {
      const requestedText = JSON.parse(request.body).messages[1].content as string
      return Promise.resolve(responseFromText(requestedText.trim() ? audioEvent() : 'data: [DONE]\n\n'))
    })
    vi.stubGlobal('fetch', fetchMock)
    await streamReadAloud(text, settings({ ttsModel: 'mimo-v2.5-tts-voiceclone' }), vi.fn(), undefined, references)

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))
    expect(bodies).toHaveLength(2)
    expect(bodies.map((body) => body.messages[1].content).join('')).toBe(text)
    expect(bodies.every((body) => body.messages[1].content.trim())).toBe(true)
    expect(bodies[0].messages[1].content.trim()).toBe('Hello.')
    expect(bodies[1].audio.voice).toBe(references.zh.dataUrl)
  })

  it('preflights every required language and every supplied reference before the first fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cloneSettings = settings({ ttsModel: 'mimo-v2.5-tts-voiceclone' })
    const reference = { name: '参考.wav', dataUrl: 'data:audio/wav;base64,AQACAA==' }
    await expect(streamReadAloud('中文先读。 English follows.', cloneSettings, vi.fn(), undefined,
      { default: null, zh: reference, en: null })).rejects.toThrow('英文 VoiceClone 参考音频')
    await expect(streamReadAloud('English first. 中文随后。', cloneSettings, vi.fn(), undefined,
      { default: null, zh: null, en: reference })).rejects.toThrow('中文 VoiceClone 参考音频')
    await expect(streamReadAloud('只读中文。', cloneSettings, vi.fn(), undefined, {
      default: null, zh: reference, en: { name: '无效参考', dataUrl: 'not audio' },
    })).rejects.toThrow('仅支持 WAV 或 MP3')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retains old single references as a fallback for both languages and falls back to the global style', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responseFromText(audioEvent())))
    vi.stubGlobal('fetch', fetchMock)
    const reference = { name: '旧通用.wav', dataUrl: 'data:audio/wav;base64,AQACAA==' }
    await streamReadAloud('中文。 English.', settings({ ttsModel: 'mimo-v2.5-tts-voiceclone' }), vi.fn(), undefined, reference)
    expect(fetchMock.mock.calls).toHaveLength(2)
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(call[1].body)
      expect(body.audio.voice).toBe(reference.dataUrl)
      expect(body.messages[0].content).toBe('性感御姐音色')
    }
  })

  it('uses the configured default fallback and routes neutral text to an available English-only voice', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responseFromText(audioEvent())))
    vi.stubGlobal('fetch', fetchMock)
    const reference = { name: '默认.wav', dataUrl: 'data:audio/wav;base64,AQACAA==' }
    const englishReference = { name: '英语.mp3', dataUrl: 'data:audio/mpeg;base64,AwAEAA==' }
    const cloneSettings = settings({ ttsModel: 'mimo-v2.5-tts-voiceclone', ttsEnglishVoiceDescription: 'Read naturally.' })
    await streamReadAloud('中文。 English.', cloneSettings, vi.fn(), undefined, { default: reference, zh: null, en: englishReference })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).audio.voice).toBe(reference.dataUrl)
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).audio.voice).toBe(englishReference.dataUrl)
    await streamReadAloud('123 😀！', cloneSettings, vi.fn(), undefined, { default: null, zh: null, en: englishReference })
    const body = JSON.parse(fetchMock.mock.calls[2]![1].body)
    expect(body.audio.voice).toBe(englishReference.dataUrl)
    expect(body.messages[0].content).toBe('Read naturally.')
  })

  it('redacts all supplied language references even when a provider echoes a voice not used by the failing segment', async () => {
    const references = {
      default: { name: '默认.wav', dataUrl: 'data:audio/wav;base64,AAABAA==' },
      zh: { name: '中文.wav', dataUrl: 'data:audio/wav;base64,AQACAA==' },
      en: { name: 'English.mp3', dataUrl: 'data:audio/mpeg;base64,AwAEAA==' },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: {
      message: '模型返回错误：AAABAA== / AQACAA== / AwAEAA==',
    } }, { status: 400 })))
    const error = await streamReadAloud('只读中文。', settings({ ttsModel: 'mimo-v2.5-tts-voiceclone' }), vi.fn(), undefined, references)
      .catch((value: unknown) => value)
    const message = (error as Error).message
    expect(message).toContain('模型返回错误')
    expect(message).not.toContain('AAABAA==')
    expect(message).not.toContain('AQACAA==')
    expect(message).not.toContain('AwAEAA==')
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

  it('redacts echoed credentials and complete or bare reference audio before exposing HTTP errors', async () => {
    const key = 'private-tts-key.[+$]'
    const encodedAudio = 'QUJD'.repeat(300)
    const reference = { name: '私有参考.wav', dataUrl: `data:audio/wav;base64,${encodedAudio}` }
    const message = `请求被拒绝。API Key=${key}; voice=${reference.dataUrl}; audio=${encodedAudio}; 请检查模型。`
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(message, { status: 400 })))
    vi.stubGlobal('fetch', fetchMock)

    const error = await streamReadAloud('你好', settings({ ttsModel: 'mimo-v2.5-tts-voiceclone', ttsApiKey: key }), vi.fn(), undefined, reference)
      .catch((value: unknown) => value)

    expect(error).toBeInstanceOf(Error)
    const exposed = (error as Error).message
    expect(exposed).toContain('请求被拒绝')
    expect(exposed).toContain('请检查模型')
    expect(exposed).toContain('[API Key 已隐藏]')
    expect(exposed).toContain('[参考音频已隐藏]')
    expect(exposed).not.toContain(key)
    expect(exposed).not.toContain(reference.dataUrl)
    expect(exposed).not.toContain('QUJD')
    expect(exposed.length).toBeLessThanOrEqual(500)
  })

  it('redacts echoed secrets from SSE errors and bounds the remaining message length', async () => {
    const key = 'private-stream-key'
    const reference = { name: '私有参考.mp3', dataUrl: 'data:audio/mpeg;base64,AQACAA==' }
    const providerMessage = `额度不足：${key}，${reference.dataUrl}，AQACAA==，data:audio/mpeg;base64,AQAC。${'详情'.repeat(400)}`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFromText(
      `event: error\ndata: ${JSON.stringify({ message: providerMessage })}\n\n`,
    )))

    const error = await streamReadAloud('你好', settings({ ttsModel: 'mimo-v2.5-tts-voiceclone', ttsApiKey: key }), vi.fn(), undefined, reference)
      .catch((value: unknown) => value)
    const exposed = (error as Error).message
    expect(exposed).toContain('额度不足')
    expect(exposed).not.toContain(key)
    expect(exposed).not.toContain(reference.dataUrl)
    expect(exposed).not.toContain('AQACAA==')
    expect(exposed).not.toContain('data:audio/')
    expect(exposed.length).toBe(500)
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
  it('attaches long leading and trailing whitespace to substantive text and keeps the first spoken part short', () => {
    const text = ' '.repeat(400) + 'A'.repeat(100) + ' '.repeat(400)
    const parts = splitReadAloudText(text, 'mimo-v2.5-tts-voiceclone', { preserveWhitespace: true })
    expect(parts.join('')).toBe(text)
    expect(parts.every((part) => !!part.trim())).toBe(true)
    expect(Array.from(parts[0]!.trim()).length).toBeLessThanOrEqual(80)
  })

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
