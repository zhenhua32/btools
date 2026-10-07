import type { ReadAloudAudioChunk } from './read-aloud-types'

interface ReadAloudPlayerCallbacks {
  onPlaying: () => void
  onFinished: () => void
  onError: (message: string) => void
  onBlocked?: () => void
  onResumed?: () => void
}

const INITIAL_BUFFER_SECONDS = 0.12
const CHUNK_BUFFER_SECONDS = 0.04
const SCHEDULING_LEAD_SECONDS = 0.04
const MAX_BUFFERED_SECONDS = 30

/** A small PCM queue, with all buffers scheduled on the same audio clock. */
export class ReadAloudPlayer {
  private readonly context: AudioContext
  private readonly ready: Promise<void>
  private operation = Promise.resolve()
  private sources = new Set<AudioBufferSourceNode>()
  private pcmParts: Float32Array[] = []
  private pcmLength = 0
  private sampleRate = 24000
  private oddByte: number | undefined
  private nextStartTime = 0
  private started = false
  private endRequested = false
  private streamFinished = false
  private disposed = false
  private blocked = false
  private blockedTimer: ReturnType<typeof setTimeout> | undefined
  private capacityTimer: ReturnType<typeof setTimeout> | undefined
  private capacityWaiters = new Set<() => void>()
  private readonly stopPromise: Promise<void>
  private resolveStop: () => void = () => {}

  constructor(private readonly callbacks: ReadAloudPlayerCallbacks) {
    this.stopPromise = new Promise((resolve) => { this.resolveStop = resolve })
    // Both calls must run in the click handler, before any network/settings await.
    this.context = new AudioContext()
    this.ready = this.context.resume().catch((error: unknown) => {
      this.fail(error)
    })
    this.blockedTimer = setTimeout(() => {
      if (!this.disposed && this.context.state === 'suspended') {
        this.blocked = true
        this.callbacks.onBlocked?.()
      }
    }, 200)
  }

  async resume(): Promise<void> {
    if (this.disposed) return
    try {
      // Invoked from the explicit play button when browser autoplay is blocked.
      await this.context.resume()
      if (!this.disposed && this.blocked) {
        this.blocked = false
        this.callbacks.onResumed?.()
      }
    } catch (error: unknown) {
      this.fail(error)
    }
  }

  addChunk(chunk: ReadAloudAudioChunk): Promise<void> {
    if (this.disposed || this.endRequested) return Promise.resolve()

    this.operation = this.operation.then(async () => {
      await this.ready
      if (this.disposed) return

      if (chunk.format === 'pcm16') {
        this.appendPcm(chunk)
        const minSeconds = this.started ? CHUNK_BUFFER_SECONDS : INITIAL_BUFFER_SECONDS
        if (this.pcmLength / this.sampleRate >= minSeconds) this.flushPcm()
      } else {
        // Compressed chunks must contain complete audio files. MiMo uses PCM.
        this.flushPcm()
        const bytes = decodeBase64(chunk.data)
        const buffer = await this.context.decodeAudioData(bytes.buffer as ArrayBuffer)
        if (!this.disposed) this.schedule(buffer)
      }
    }).catch((error: unknown) => this.fail(error))
    // Capacity waits do not block the decoder queue itself. The producer awaits
    // this promise before sending another chunk, bounding memory on long texts.
    const accepted = this.operation.then(() => this.waitForCapacity())
    return Promise.race([accepted, this.stopPromise])
  }

  finish(): void {
    if (this.disposed || this.endRequested) return
    this.endRequested = true
    this.operation = this.operation.then(async () => {
      await this.ready
      if (this.disposed) return
      if (this.oddByte !== undefined) throw new Error('朗读音频数据不完整，请重试')
      this.flushPcm()
      if (!this.started) throw new Error('模型没有返回可播放的音频')
      this.streamFinished = true
      this.completeIfDrained()
    }).catch((error: unknown) => this.fail(error))
  }

  stop(): void {
    if (this.disposed) return
    this.disposed = true
    clearTimeout(this.blockedTimer)
    clearTimeout(this.capacityTimer)
    this.capacityWaiters.forEach((resolve) => resolve())
    this.capacityWaiters.clear()
    this.resolveStop()
    for (const source of this.sources) {
      source.onended = null
      try { source.stop() } catch { /* The source may already have ended. */ }
      source.disconnect()
    }
    this.sources.clear()
    this.pcmParts = []
    this.pcmLength = 0
    this.oddByte = undefined
    void this.context.close().catch(() => {})
  }

  private appendPcm(chunk: ReadAloudAudioChunk): void {
    if (!Number.isFinite(chunk.sampleRate) || chunk.sampleRate <= 0) {
      throw new Error('朗读音频采样率无效')
    }
    if (this.sampleRate !== chunk.sampleRate) {
      if (this.oddByte !== undefined) throw new Error('朗读音频采样率发生异常变化')
      this.flushPcm()
      this.sampleRate = chunk.sampleRate
    }

    const incoming = decodeBase64(chunk.data)
    const prefixLength = this.oddByte === undefined ? 0 : 1
    const bytes = new Uint8Array(incoming.length + prefixLength)
    if (prefixLength) bytes[0] = this.oddByte!
    bytes.set(incoming, prefixLength)
    this.oddByte = bytes.length % 2 ? bytes[bytes.length - 1] : undefined

    const samples = new Float32Array(Math.floor(bytes.length / 2))
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < samples.length; index++) {
      samples[index] = view.getInt16(index * 2, true) / 32768
    }
    if (samples.length) {
      this.pcmParts.push(samples)
      this.pcmLength += samples.length
    }
  }

  private flushPcm(): void {
    if (!this.pcmLength || this.disposed) return
    const buffer = this.context.createBuffer(1, this.pcmLength, this.sampleRate)
    const output = buffer.getChannelData(0)
    let offset = 0
    for (const part of this.pcmParts) {
      output.set(part, offset)
      offset += part.length
    }
    this.pcmParts = []
    this.pcmLength = 0
    this.schedule(buffer)
  }

  private schedule(buffer: AudioBuffer): void {
    if (!buffer.length || this.disposed) return
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.context.destination)
    source.onended = () => {
      this.sources.delete(source)
      source.disconnect()
      this.completeIfDrained()
    }
    const startTime = Math.max(this.nextStartTime, this.context.currentTime + SCHEDULING_LEAD_SECONDS)
    this.nextStartTime = startTime + buffer.duration
    this.sources.add(source)
    source.start(startTime)
    if (!this.started) {
      this.started = true
      this.callbacks.onPlaying()
    }
  }

  private completeIfDrained(): void {
    if (this.disposed || !this.streamFinished || this.sources.size) return
    this.stop()
    this.callbacks.onFinished()
  }

  private waitForCapacity(): Promise<void> {
    if (this.disposed || this.nextStartTime - this.context.currentTime <= MAX_BUFFERED_SECONDS) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.capacityWaiters.add(resolve)
      if (!this.capacityTimer) this.capacityTimer = setTimeout(() => this.checkCapacity(), 250)
    })
  }

  private checkCapacity(): void {
    this.capacityTimer = undefined
    if (this.disposed || this.nextStartTime - this.context.currentTime <= MAX_BUFFERED_SECONDS) {
      this.capacityWaiters.forEach((resolve) => resolve())
      this.capacityWaiters.clear()
    } else {
      this.capacityTimer = setTimeout(() => this.checkCapacity(), 250)
    }
  }

  private fail(error: unknown): void {
    if (this.disposed) return
    this.stop()
    this.callbacks.onError(error instanceof Error ? error.message : '播放朗读音频失败')
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
