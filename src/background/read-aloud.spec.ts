import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadAloudClientMessage } from '@/services/read-aloud-types'
import { DEFAULT_AI_SETTINGS } from '@/services/ai-types'

const { settingsMock, streamMock } = vi.hoisted(() => ({
  settingsMock: vi.fn(),
  streamMock: vi.fn(),
}))
vi.mock('@/services/ai-settings', () => ({ getAiSettings: settingsMock }))
vi.mock('@/services/read-aloud-api', () => ({ streamReadAloud: streamMock }))

import { handleReadAloudPort } from './read-aloud'

function createPort() {
  let messageListener: ((message: unknown) => void) | undefined
  let disconnectListener: (() => void) | undefined
  return {
    onMessage: { addListener: (listener: (message: unknown) => void) => { messageListener = listener } },
    onDisconnect: { addListener: (listener: () => void) => { disconnectListener = listener } },
    postMessage: vi.fn(),
    emit: (message: ReadAloudClientMessage | unknown) => messageListener?.(message),
    drop: () => disconnectListener?.(),
  }
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('read aloud background connection', () => {
  const chunk = { data: 'AAA=', format: 'pcm16' as const, sampleRate: 24000 }
  beforeEach(() => {
    vi.clearAllMocks()
    settingsMock.mockResolvedValue({ ...DEFAULT_AI_SETTINGS, ttsApiKey: 'stored-key' })
  })

  it('reads credentials from stored settings and relays audio before generation completes', async () => {
    let complete: (() => void) | undefined
    streamMock.mockImplementation(async (_text, settings, onChunk) => {
      expect(settings.ttsApiKey).toBe('stored-key')
      await onChunk(chunk)
      await new Promise<void>((resolve) => { complete = resolve })
    })
    const port = createPort()
    handleReadAloudPort(port as unknown as chrome.runtime.Port)
    port.emit({ type: 'start', text: 'Hello world', ttsApiKey: 'untrusted-page-key' })
    await flush()
    expect(port.postMessage.mock.calls).toEqual([[{ type: 'audio', chunk }]])
    complete?.()
    await flush()
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'done' })
    expect(streamMock).toHaveBeenCalledOnce()
  })

  it('waits for queue capacity and aborts a pending acknowledgement on disconnect', async () => {
    let signal: AbortSignal | undefined
    const afterAudio = vi.fn()
    streamMock.mockImplementation(async (_text, _settings, onChunk, requestSignal) => {
      signal = requestSignal
      await onChunk(chunk)
      afterAudio()
      await onChunk(chunk)
    })
    const port = createPort()
    handleReadAloudPort(port as unknown as chrome.runtime.Port)
    port.emit({ type: 'start', text: 'Long selection', useBackpressure: true })
    await flush()
    expect(port.postMessage).toHaveBeenCalledOnce()
    expect(afterAudio).not.toHaveBeenCalled()
    port.emit({ type: 'ready', id: 99 })
    await flush()
    expect(afterAudio).not.toHaveBeenCalled()
    port.emit({ type: 'ready', id: 0 })
    await flush()
    expect(afterAudio).toHaveBeenCalledOnce()
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'audio', chunk, id: 1 })
    port.drop()
    await flush()
    expect(signal?.aborted).toBe(true)
    expect(port.postMessage).toHaveBeenCalledTimes(2)
  })

  it('does not start a network request if the tab closes while settings load', async () => {
    let resolveSettings: ((value: typeof DEFAULT_AI_SETTINGS) => void) | undefined
    settingsMock.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve }))
    const port = createPort()
    handleReadAloudPort(port as unknown as chrome.runtime.Port)
    port.emit({ type: 'start', text: 'Hello' })
    port.drop()
    resolveSettings?.(DEFAULT_AI_SETTINGS)
    await flush()
    expect(streamMock).not.toHaveBeenCalled()
    expect(port.postMessage).not.toHaveBeenCalled()
  })

  it('ignores duplicate starts and heartbeat traffic and reports provider errors', async () => {
    streamMock.mockRejectedValue(new Error('Invalid speech API key'))
    const port = createPort()
    handleReadAloudPort(port as unknown as chrome.runtime.Port)
    port.emit({ type: 'ping' })
    port.emit({ type: 'start', text: 'Hello' })
    port.emit({ type: 'start', text: 'Duplicate' })
    await flush()
    expect(streamMock).toHaveBeenCalledOnce()
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Invalid speech API key' })
  })
})
