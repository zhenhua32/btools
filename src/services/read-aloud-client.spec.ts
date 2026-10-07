import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadAloudServerMessage } from './read-aloud-types'
import { READ_ALOUD_PORT_NAME } from './read-aloud-types'
import { createReadAloudSession } from './read-aloud-client'

const { players, settingsMock, streamMock, eventOrder } = vi.hoisted(() => ({
  players: [] as {
    callbacks: { onPlaying: () => void; onFinished: () => void; onError: (message: string) => void; onBlocked: () => void; onResumed: () => void }
    addChunk: ReturnType<typeof vi.fn>
    finish: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
  }[],
  settingsMock: vi.fn(),
  streamMock: vi.fn(),
  eventOrder: [] as string[],
}))

vi.mock('./ai-settings', () => ({ getAiSettings: settingsMock }))
vi.mock('./read-aloud-api', () => ({ streamReadAloud: streamMock }))
vi.mock('./read-aloud-player', () => ({
  ReadAloudPlayer: class {
    addChunk = vi.fn(() => Promise.resolve())
    finish = vi.fn()
    stop = vi.fn()
    resume = vi.fn(() => Promise.resolve())
    constructor(readonly callbacks: typeof players[number]['callbacks']) {
      eventOrder.push('unlock audio')
      players.push(this)
    }
  },
}))

function createPort() {
  let onMessage: ((message: ReadAloudServerMessage) => void) | undefined
  let onDisconnect: (() => void) | undefined
  return {
    onMessage: { addListener: vi.fn((listener) => { onMessage = listener }) },
    onDisconnect: { addListener: vi.fn((listener) => { onDisconnect = listener }) },
    postMessage: vi.fn(),
    disconnect: vi.fn(() => onDisconnect?.()),
    emit: (message: ReadAloudServerMessage) => onMessage?.(message),
    drop: () => onDisconnect?.(),
  }
}

describe('read aloud client', () => {
  beforeEach(() => {
    players.length = 0
    eventOrder.length = 0
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('unlocks audio before connecting and waits for playback completion after stream done', () => {
    const port = createPort()
    const connect = vi.fn(() => { eventOrder.push('connect'); return port })
    vi.stubGlobal('chrome', { runtime: { id: 'test', connect } })
    const onStatus = vi.fn()
    const onError = vi.fn()
    createReadAloudSession(' hello ', { onStatus, onError })

    expect(eventOrder).toEqual(['unlock audio', 'connect'])
    expect(connect).toHaveBeenCalledWith({ name: READ_ALOUD_PORT_NAME })
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'start', text: 'hello', useBackpressure: true })
    const chunk = { data: 'AA==', format: 'pcm16' as const, sampleRate: 24000 }
    port.emit({ type: 'audio', chunk })
    expect(players[0].addChunk).toHaveBeenCalledWith(chunk)
    port.emit({ type: 'done' })
    expect(players[0].finish).toHaveBeenCalledOnce()
    expect(onStatus).not.toHaveBeenCalledWith('finished')
    expect(port.disconnect).toHaveBeenCalledOnce()

    players[0].callbacks.onFinished()
    expect(onStatus).toHaveBeenLastCalledWith('finished')
    expect(onError).not.toHaveBeenCalled()
  })

  it('disconnects to abort generation and guards all callbacks from stopped sessions', async () => {
    const port = createPort()
    vi.stubGlobal('chrome', { runtime: { id: 'test', connect: () => port } })
    const onStatus = vi.fn()
    const onError = vi.fn()
    const session = createReadAloudSession('hello', { onStatus, onError })
    session.stop()
    session.stop()
    port.emit({ type: 'error', message: 'late error' })
    players[0].callbacks.onPlaying()
    players[0].callbacks.onFinished()
    players[0].callbacks.onError('late playback error')

    expect(port.disconnect).toHaveBeenCalledOnce()
    expect(players[0].stop).toHaveBeenCalledOnce()
    expect(onStatus.mock.calls).toEqual([['loading']])
    expect(onError).not.toHaveBeenCalled()
    await session.resume()
  })

  it('keeps the service worker alive during synthesis and stops pinging after done', async () => {
    vi.useFakeTimers()
    const port = createPort()
    vi.stubGlobal('chrome', { runtime: { id: 'test', connect: () => port } })
    const session = createReadAloudSession('hello', { onStatus: vi.fn(), onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(40000)
    expect(port.postMessage.mock.calls).toEqual([[{ type: 'start', text: 'hello', useBackpressure: true }], [{ type: 'ping' }], [{ type: 'ping' }]])
    port.emit({ type: 'done' })
    await vi.advanceTimersByTimeAsync(40000)
    expect(port.postMessage).toHaveBeenCalledTimes(3)
    session.stop()
  })

  it('cleans up player and connection on unexpected disconnect', () => {
    const port = createPort()
    vi.stubGlobal('chrome', { runtime: { id: 'test', connect: () => port, lastError: { message: 'worker lost' } } })
    const onError = vi.fn()
    createReadAloudSession('hello', { onStatus: vi.fn(), onError })
    port.drop()
    expect(onError).toHaveBeenCalledWith('worker lost')
    expect(players[0].stop).toHaveBeenCalledOnce()
  })

  it('acknowledges each chunk after the player has capacity, and never acknowledges after stopping', async () => {
    const port = createPort()
    vi.stubGlobal('chrome', { runtime: { id: 'test', connect: () => port } })
    const session = createReadAloudSession('hello', { onStatus: vi.fn(), onError: vi.fn() })
    let resolveCapacity: (() => void) | undefined
    players[0].addChunk.mockImplementation(() => new Promise<void>((resolve) => { resolveCapacity = resolve }))
    const chunk = { data: 'AA==', format: 'pcm16' as const, sampleRate: 24000 }
    port.emit({ type: 'audio', chunk, id: 1 })
    expect(port.postMessage).toHaveBeenCalledTimes(1)
    resolveCapacity?.()
    await Promise.resolve()
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'ready', id: 1 })

    port.emit({ type: 'audio', chunk, id: 2 })
    session.stop()
    resolveCapacity?.()
    await Promise.resolve()
    expect(port.postMessage).toHaveBeenCalledTimes(2)
  })
})
