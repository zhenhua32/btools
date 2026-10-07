export const READ_ALOUD_PORT_NAME = 'btools-read-aloud'
export const MAX_READ_ALOUD_TEXT_LENGTH = 12000

/** MiMo streaming output is PCM16 little-endian, mono, at 24 kHz. */
export interface ReadAloudAudioChunk {
  data: string
  format: 'pcm16' | 'wav' | 'mp3'
  sampleRate: number
}

export type ReadAloudClientMessage =
  | { type: 'start'; text: string; useBackpressure?: boolean }
  | { type: 'cancel' }
  | { type: 'ping' }
  | { type: 'ready'; id: number }

export type ReadAloudServerMessage =
  | { type: 'audio'; chunk: ReadAloudAudioChunk; id?: number }
  | { type: 'done' }
  | { type: 'error'; message: string }

export function isReadAloudClientMessage(message: unknown): message is ReadAloudClientMessage {
  if (!message || typeof message !== 'object' || !('type' in message)) return false
  return message.type === 'cancel' || message.type === 'ping' ||
    (message.type === 'ready' && 'id' in message &&
      typeof message.id === 'number' && Number.isInteger(message.id) && message.id >= 0) ||
    (message.type === 'start' && 'text' in message && typeof message.text === 'string' &&
      (!('useBackpressure' in message) || message.useBackpressure === undefined ||
        typeof message.useBackpressure === 'boolean'))
}
