import { resolveChatEndpoint } from './ai-api'
import { normalizeAiSettings, type AiSettings } from './ai-types'
import { MAX_READ_ALOUD_TEXT_LENGTH, type ReadAloudAudioChunk } from './read-aloud-types'
import { splitReadAloudLanguageRuns } from './read-aloud-language'
import {
  validateReadAloudVoiceReference,
  type ReadAloudVoiceReference,
  type ReadAloudVoiceReferences,
} from './read-aloud-voice-reference'

const MIMO_SAMPLE_RATE = 24000

/**
 * VoiceDesign and VoiceClone use compatibility streaming, returning full inference results.
 * Short sentence-aware requests let its first audio play while later text is generated.
 * Official protocol: https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5
 */
export function splitReadAloudText(
  text: string,
  model: string,
  options: { firstSegment?: boolean; preserveWhitespace?: boolean } = {},
): string[] {
  const characters = Array.from(options.preserveWhitespace ? text : text.trim())
  const shortSegments = /voicedesign|voiceclone/u.test(model.toLowerCase())
  const segments: string[] = []
  let offset = 0
  let leadingWhitespace = ''

  while (offset < characters.length) {
    const targetLength = shortSegments ? (options.firstSegment !== false && segments.length === 0 ? 80 : 260) : 1200
    const limit = Math.min(offset + targetLength, characters.length)
    let end = limit

    if (limit < characters.length) {
      const minimum = offset + Math.floor(targetLength / 2)
      let sentenceBoundary = 0
      let wordBoundary = 0
      for (let index = offset; index < limit; index++) {
        const character = characters[index]!
        if (/\s/u.test(character)) wordBoundary = index + 1
        if (/[。！？；\n]/u.test(character) ||
          (/[.!?;]/u.test(character) && /\s/u.test(characters[index + 1] || ''))) {
          sentenceBoundary = index + 1
        }
      }
      if (sentenceBoundary >= minimum) end = sentenceBoundary
      else if (wordBoundary > offset) end = wordBoundary
      else if (sentenceBoundary > offset) end = sentenceBoundary
    }

    const rawSegment = characters.slice(offset, end).join('')
    const segment = options.preserveWhitespace ? rawSegment : rawSegment.trim()
    if (options.preserveWhitespace && !segment.trim()) {
      // Whitespace must stay in order, but a whitespace-only inference can return
      // no audio and stop the whole reading. Attach it to substantive text instead.
      if (segments.length) segments[segments.length - 1] += segment
      else leadingWhitespace += segment
    } else if (segment) {
      segments.push(leadingWhitespace + segment)
      leadingWhitespace = ''
    }
    offset = end
  }

  return segments
}

export async function streamReadAloud(
  text: string,
  inputSettings: AiSettings,
  onChunk: (chunk: ReadAloudAudioChunk) => void | Promise<void>,
  signal?: AbortSignal,
  reference?: ReadAloudVoiceReference | ReadAloudVoiceReferences | null,
): Promise<void> {
  throwIfAborted(signal)
  const settings = normalizeAiSettings(inputSettings)
  if (!text.trim()) throw new Error('请先选择要朗读的文字')
  if (Array.from(text.trim()).length > MAX_READ_ALOUD_TEXT_LENGTH) {
    throw new Error(`朗读文字过长，请每次选择不超过 ${MAX_READ_ALOUD_TEXT_LENGTH} 个字符`)
  }
  if (!settings.ttsApiKey) throw new Error('请先在 AI 设置中配置朗读 API Key')
  let referenceDataUrls: string[] = []
  const segments: { text: string; voiceDescription: string; referenceDataUrl?: string }[] = []
  if (settings.ttsModel.toLowerCase().includes('voiceclone')) {
    if (!reference) throw new Error('请先在 AI 设置中添加 VoiceClone 参考音频')
    // Validate every supplied reference and snapshot the routing plan before any
    // network request. Changes to settings or references cannot affect later parts.
    const references = snapshotVoiceReferences(reference)
    referenceDataUrls = Object.values(references).flatMap((voice) => voice ? [voice.dataUrl] : [])
    const defaultLanguage = references.en && !references.zh && !references.default ? 'en' : 'zh'
    const runs = splitReadAloudLanguageRuns(text, defaultLanguage)
    const missingLanguages = [...new Set(runs
      .filter((run) => !references[run.language] && !references.default)
      .map((run) => run.language === 'zh' ? '中文' : '英文'))]
    if (missingLanguages.length) {
      throw new Error(`请先在 AI 设置中添加 ${missingLanguages.join('、')} VoiceClone 参考音频，或配置通用参考音频`)
    }
    for (const run of runs) {
      const voice = references[run.language] ?? references.default!
      const voiceDescription = (run.language === 'zh'
        ? settings.ttsChineseVoiceDescription
        : settings.ttsEnglishVoiceDescription) || settings.ttsVoiceDescription
      for (const segment of splitReadAloudText(run.text, settings.ttsModel, {
        firstSegment: segments.length === 0,
        preserveWhitespace: true,
      })) {
        segments.push({ text: segment, voiceDescription, referenceDataUrl: voice.dataUrl })
      }
    }
  } else {
    segments.push(...splitReadAloudText(text, settings.ttsModel).map((segment) => ({
      text: segment, voiceDescription: settings.ttsVoiceDescription,
    })))
  }
  const endpoint = resolveChatEndpoint(settings.ttsBaseUrl)
  if (!/^https?:$/u.test(new URL(endpoint).protocol)) {
    throw new Error('朗读 API 地址必须使用 HTTP 或 HTTPS')
  }

  for (const segment of segments) {
    throwIfAborted(signal)
    await requestReadAloudSegment(endpoint, segment.text, settings, onChunk, signal,
      segment.referenceDataUrl, segment.voiceDescription, referenceDataUrls)
  }
}

function snapshotVoiceReferences(reference: ReadAloudVoiceReference | ReadAloudVoiceReferences): ReadAloudVoiceReferences {
  const supplied = 'dataUrl' in reference ? { default: reference, zh: null, en: null } : reference
  return {
    default: supplied.default == null ? null : validateReadAloudVoiceReference(supplied.default),
    zh: supplied.zh == null ? null : validateReadAloudVoiceReference(supplied.zh),
    en: supplied.en == null ? null : validateReadAloudVoiceReference(supplied.en),
  }
}

async function requestReadAloudSegment(
  endpoint: string,
  text: string,
  settings: AiSettings,
  onChunk: (chunk: ReadAloudAudioChunk) => void | Promise<void>,
  signal?: AbortSignal,
  referenceDataUrl?: string,
  voiceDescription = settings.ttsVoiceDescription,
  referenceDataUrls: readonly string[] = [],
): Promise<void> {
  const controller = new AbortController()
  let timedOut = false
  const abortRequest = () => controller.abort()
  signal?.addEventListener('abort', abortRequest, { once: true })
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const armNetworkTimeout = () => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, settings.requestTimeoutMs)
  }
  armNetworkTimeout()

  try {
    throwIfAborted(signal)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${settings.ttsApiKey}`,
      },
      body: JSON.stringify({
        model: settings.ttsModel,
        messages: [
          { role: 'user', content: voiceDescription },
          { role: 'assistant', content: text },
        ],
        audio: {
          format: 'pcm16',
          ...(referenceDataUrl
            ? { voice: referenceDataUrl }
            : settings.ttsModel === 'mimo-v2.5-tts'
            ? { voice: 'mimo_default' }
            : { optimize_text_preview: false }),
        },
        stream: true,
      }),
      signal: controller.signal,
    })
    throwIfAborted(controller.signal)

    if (!response.ok) {
      const body = await parseResponseBody(response)
      throw new Error(getProviderError(body) || `朗读接口返回 ${response.status}`)
    }

    let audioCount = 0
    const emitAudio = async (payload: unknown) => {
      throwIfAborted(controller.signal)
      const error = getProviderError(payload)
      if (error) throw new Error(error)
      const chunk = extractAudio(payload)
      if (chunk) {
        // Playback backpressure is deliberate waiting, not network inactivity.
        clearTimeout(timeoutId)
        await awaitAudioDelivery(onChunk(chunk), controller.signal)
        throwIfAborted(controller.signal)
        audioCount++
        armNetworkTimeout()
      }
    }

    // Compatible gateways can return a complete JSON result despite stream=true.
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      await emitAudio(await response.json())
    } else if (response.body) {
      await readAudioEvents(response.body, emitAudio, controller.signal, armNetworkTimeout)
    } else {
      throw new Error('朗读接口未返回音频数据')
    }
    throwIfAborted(controller.signal)
    if (!audioCount) throw new Error('朗读接口未返回音频数据，请检查朗读模型配置')
  } catch (error) {
    if (timedOut) throw new Error('朗读请求超时，请稍后重试')
    if (signal?.aborted || controller.signal.aborted) throw createAbortError()
    throw new Error(sanitizeReadAloudError(error, settings.ttsApiKey, referenceDataUrls))
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortRequest)
  }
}

async function readAudioEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (payload: unknown) => Promise<void>,
  signal: AbortSignal,
  beforeRead: () => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventData: string[] = []
  let eventType = ''
  let finished = false
  const cancelReader = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancelReader, { once: true })

  const dispatchEvent = async () => {
    if (!eventData.length) {
      eventType = ''
      return
    }
    const data = eventData.join('\n').trim()
    eventData = []
    const type = eventType
    eventType = ''
    if (data === '[DONE]') {
      finished = true
      return
    }
    if (!data) return
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      throw new Error('朗读接口返回了无效的流式数据')
    }
    if (type === 'error') {
      throw new Error(getProviderError(payload) || '朗读接口返回流式错误')
    }
    await onEvent(payload)
  }

  const consumeLine = async (rawLine: string) => {
    const line = rawLine.replace(/\r$/u, '')
    if (!line) await dispatchEvent()
    else if (line.startsWith('data:')) eventData.push(line.slice(5).replace(/^ /u, ''))
    else if (line.startsWith('event:')) eventType = line.slice(6).trim()
    // SSE comments, id and retry fields carry no audio.
  }

  try {
    throwIfAborted(signal)
    while (!finished) {
      beforeRead()
      const { done, value } = await reader.read()
      throwIfAborted(signal)
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0 && !finished) {
        await consumeLine(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
      if (done) {
        if (buffer && !finished) await consumeLine(buffer)
        if (!finished) await dispatchEvent()
        break
      }
    }
  } finally {
    signal.removeEventListener('abort', cancelReader)
    // Stop an open connection as soon as [DONE] arrives or processing fails.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function awaitAudioDelivery(delivery: void | Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted)
      reject(createAbortError())
    }
    // Attach rejection handling even if the consumer canceled synchronously.
    Promise.resolve(delivery).then(() => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }, (error: unknown) => {
      signal.removeEventListener('abort', aborted)
      reject(error)
    })
    if (signal.aborted) aborted()
    else signal.addEventListener('abort', aborted, { once: true })
  })
}

function extractAudio(payload: unknown): ReadAloudAudioChunk | null {
  if (!payload || typeof payload !== 'object' || !('choices' in payload)) return null
  if (!Array.isArray(payload.choices) || !payload.choices.length) return null
  const choice = payload.choices[0] as {
    delta?: { audio?: { data?: unknown; format?: unknown; sample_rate?: unknown } }
    message?: { audio?: { data?: unknown; format?: unknown; sample_rate?: unknown } }
  } | null
  const audio = choice?.delta?.audio || choice?.message?.audio
  if (!audio || typeof audio.data !== 'string' || !audio.data) return null
  const format = audio.format ?? 'pcm16'
  if (format !== 'pcm16' && format !== 'wav' && format !== 'mp3') {
    throw new Error('朗读接口返回了不支持的音频格式')
  }
  return {
    data: audio.data,
    format,
    sampleRate: typeof audio.sample_rate === 'number' && audio.sample_rate > 0
      ? audio.sample_rate
      : MIMO_SAMPLE_RATE,
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  try { return JSON.parse(text) } catch { return text }
}

function getProviderError(payload: unknown): string | null {
  if (typeof payload === 'string') return payload.trim() || null
  if (!payload || typeof payload !== 'object') return null
  if ('error' in payload) {
    if (typeof payload.error === 'string') return payload.error
    if (payload.error && typeof payload.error === 'object' &&
      'message' in payload.error && typeof payload.error.message === 'string') {
      return payload.error.message
    }
  }
  if ('message' in payload && typeof payload.message === 'string') return payload.message
  return null
}

function sanitizeReadAloudError(error: unknown, apiKey: string, referenceDataUrls: readonly string[]): string {
  let message = error instanceof Error ? error.message : typeof error === 'string' ? error : '朗读生成失败，请稍后重试'
  // Provider errors can echo the request. Sanitize before truncating so a long
  // reference or credential cannot survive as a partially exposed prefix.
  for (const referenceDataUrl of [...referenceDataUrls].sort((a, b) => b.length - a.length)) {
    message = message.split(referenceDataUrl).join('[参考音频已隐藏]')
    const encodedAudio = referenceDataUrl.slice(referenceDataUrl.indexOf(',') + 1)
    if (encodedAudio) message = message.split(encodedAudio).join('[参考音频已隐藏]')
  }
  message = message.replace(/data:audio\/(?:wav|mpeg|mp3);base64,[A-Za-z0-9+/]*={0,2}/giu, '[参考音频已隐藏]')
  if (apiKey) message = message.split(apiKey).join('[API Key 已隐藏]')
  return message.trim().slice(0, 500) || '朗读生成失败，请稍后重试'
}

function createAbortError(): DOMException {
  return new DOMException('朗读已停止', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}
