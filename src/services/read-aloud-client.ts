import { getAiSettings } from './ai-settings'
import { streamReadAloud } from './read-aloud-api'
import { ReadAloudPlayer } from './read-aloud-player'
import { READ_ALOUD_PORT_NAME, type ReadAloudServerMessage } from './read-aloud-types'

export type ReadAloudStatus = 'loading' | 'playing' | 'blocked' | 'finished'

interface ReadAloudCallbacks {
  onStatus: (status: ReadAloudStatus) => void
  onError: (message: string) => void
}

export interface ReadAloudSession {
  stop: () => void
  resume: () => Promise<void>
}

/** Call directly from a user gesture so the audio context can be unlocked. */
export function createReadAloudSession(text: string, callbacks: ReadAloudCallbacks): ReadAloudSession {
  let stopped = false
  let streamFinished = false
  let playbackStarted = false
  let port: chrome.runtime.Port | undefined
  let player: ReadAloudPlayer | undefined
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined
  const controller = new AbortController()

  function disconnect() {
    clearInterval(keepaliveTimer)
    keepaliveTimer = undefined
    const currentPort = port
    port = undefined
    try { currentPort?.disconnect() } catch { /* Extension may have reloaded. */ }
  }

  function stop() {
    if (stopped) return
    stopped = true
    controller.abort()
    disconnect()
    player?.stop()
  }

  function fail(message: string) {
    if (stopped) return
    stop()
    callbacks.onError(message)
  }

  function done() {
    if (stopped || streamFinished) return
    streamFinished = true
    disconnect()
    player?.finish()
  }

  try {
    if (!text.trim()) throw new Error('请输入要朗读的文本')
    player = new ReadAloudPlayer({
      onPlaying: () => {
        playbackStarted = true
        if (!stopped) callbacks.onStatus('playing')
      },
      onFinished: () => {
        if (stopped) return
        stop()
        callbacks.onStatus('finished')
      },
      onError: fail,
      onBlocked: () => { if (!stopped) callbacks.onStatus('blocked') },
      onResumed: () => { if (!stopped) callbacks.onStatus(playbackStarted ? 'playing' : 'loading') },
    })
    callbacks.onStatus('loading')

    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.runtime.connect) {
      port = chrome.runtime.connect({ name: READ_ALOUD_PORT_NAME })
      port.onMessage.addListener((message: ReadAloudServerMessage) => {
        if (stopped || streamFinished) return
        if (message.type === 'audio') {
          void player?.addChunk(message.chunk).then(() => {
            if (message.id === undefined || stopped || streamFinished) return
            try { port?.postMessage({ type: 'ready', id: message.id }) }
            catch { fail('朗读连接已断开，请刷新页面后重试') }
          })
        }
        else if (message.type === 'done') done()
        else if (message.type === 'error') fail(message.message)
      })
      port.onDisconnect.addListener(() => {
        // Read lastError inside the listener to consume Chrome's error, if any.
        const errorMessage = chrome.runtime.lastError?.message
        if (!stopped && !streamFinished) fail(errorMessage || '朗读连接已断开，请刷新页面后重试')
      })
      port.postMessage({ type: 'start', text: text.trim(), useBackpressure: true })
      keepaliveTimer = setInterval(() => {
        if (stopped || streamFinished) return
        try { port?.postMessage({ type: 'ping' }) }
        catch { fail('朗读连接已断开，请刷新页面后重试') }
      }, 20000)
    } else {
      void getAiSettings().then((settings) => {
        if (stopped) return
        return streamReadAloud(text.trim(), settings, (chunk) => {
          if (!stopped) return player?.addChunk(chunk)
        }, controller.signal)
      }).then(() => {
        if (!stopped) done()
      }).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : '朗读失败')
      })
    }
  } catch (error: unknown) {
    // Let callers assign the session before an immediate failure reaches their UI.
    queueMicrotask(() => fail(error instanceof Error ? error.message : '启动朗读失败'))
  }

  return { stop, resume: () => stopped ? Promise.resolve() : player?.resume() ?? Promise.resolve() }
}
