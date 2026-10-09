import { getAiSettings } from '@/services/ai-settings'
import { streamReadAloud } from '@/services/read-aloud-api'
import { getReadAloudVoiceReferences } from '@/services/read-aloud-voice-reference'
import {
  isReadAloudClientMessage,
  type ReadAloudServerMessage,
} from '@/services/read-aloud-types'

export function handleReadAloudPort(port: chrome.runtime.Port): void {
  let disconnected = false
  let started = false
  let controller: AbortController | undefined
  let nextChunkId = 0
  let acknowledge: ((id: number) => void) | undefined

  function post(message: ReadAloudServerMessage): void {
    if (disconnected || controller?.signal.aborted) return
    try {
      port.postMessage(message)
    } catch {
      disconnected = true
      controller?.abort()
    }
  }

  port.onDisconnect.addListener(() => {
    disconnected = true
    controller?.abort()
  })

  port.onMessage.addListener((message: unknown) => {
    if (!isReadAloudClientMessage(message)) return
    if (message.type === 'ready') {
      acknowledge?.(message.id)
      return
    }
    if (message.type === 'cancel') {
      controller?.abort()
      return
    }
    if (message.type !== 'start') return
    if (started || disconnected) return
    started = true
    controller = new AbortController()
    const signal = controller.signal

    void (async () => {
      try {
        const settings = await getAiSettings()
        if (signal.aborted || disconnected) return
        const reference = settings.ttsModel.toLowerCase().includes('voiceclone')
          ? await getReadAloudVoiceReferences()
          : null
        if (signal.aborted || disconnected) return
        await streamReadAloud(message.text, settings, async (chunk) => {
          if (!message.useBackpressure) {
            post({ type: 'audio', chunk })
            return
          }
          const id = nextChunkId++
          // The player acknowledges when its queue has room for more audio.
          // This bounds memory for long selections and pauses synthesis while autoplay is blocked.
          const ready = new Promise<void>((resolve, reject) => {
            const abort = () => {
              acknowledge = undefined
              reject(new DOMException('朗读已停止', 'AbortError'))
            }
            acknowledge = (receivedId) => {
              if (receivedId !== id) return
              acknowledge = undefined
              signal.removeEventListener('abort', abort)
              resolve()
            }
            if (signal.aborted) abort()
            else signal.addEventListener('abort', abort, { once: true })
          })
          post({ type: 'audio', chunk, id })
          await ready
        }, signal, reference)
        post({ type: 'done' })
      } catch (error) {
        if (signal.aborted || disconnected) return
        post({
          type: 'error',
          message: error instanceof Error ? error.message : '朗读生成失败，请稍后重试',
        })
      }
    })()
  })
}
