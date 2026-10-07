import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadAloudPlayer } from './read-aloud-player'
import type { ReadAloudAudioChunk } from './read-aloud-types'

class FakeBuffer {
  readonly data: Float32Array
  readonly duration: number
  constructor(readonly length: number, readonly sampleRate: number) {
    this.data = new Float32Array(length)
    this.duration = length / sampleRate
  }
  getChannelData() { return this.data }
}

class FakeSource {
  buffer: FakeBuffer | null = null
  onended: (() => void) | null = null
  connect = vi.fn()
  disconnect = vi.fn()
  stop = vi.fn()
  start = vi.fn()
  end() { this.onended?.() }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static initiallySuspended = false
  currentTime = 0
  state = FakeAudioContext.initiallySuspended ? 'suspended' : 'running'
  destination = {}
  sources: FakeSource[] = []
  buffers: FakeBuffer[] = []
  pendingResume: (() => void) | undefined
  resume = vi.fn(() => {
    if (this.state === 'suspended') return new Promise<void>((resolve) => { this.pendingResume = resolve })
    return Promise.resolve()
  })
  close = vi.fn(() => Promise.resolve())
  constructor() { FakeAudioContext.instances.push(this) }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const buffer = new FakeBuffer(length, sampleRate)
    this.buffers.push(buffer)
    return buffer
  }
  createBufferSource() {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }
}

function bytesChunk(bytes: number[]): ReadAloudAudioChunk {
  return { data: btoa(String.fromCharCode(...bytes)), format: 'pcm16', sampleRate: 24000 }
}

function durationChunk(seconds: number): ReadAloudAudioChunk {
  return bytesChunk(new Array(Math.round(seconds * 24000) * 2).fill(0))
}

async function flushQueue() {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

describe('streaming read aloud player', () => {
  const callbacks = () => ({ onPlaying: vi.fn(), onFinished: vi.fn(), onError: vi.fn(), onBlocked: vi.fn() })

  beforeEach(() => {
    FakeAudioContext.instances = []
    FakeAudioContext.initiallySuspended = false
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('unlocks synchronously, starts before synthesis ends and schedules consecutive buffers without gaps', async () => {
    const events = callbacks()
    const player = new ReadAloudPlayer(events)
    const context = FakeAudioContext.instances[0]
    expect(context.resume).toHaveBeenCalledOnce()
    player.addChunk(durationChunk(0.12))
    player.addChunk(durationChunk(0.08))
    await flushQueue()

    expect(events.onPlaying).toHaveBeenCalledOnce()
    expect(context.sources).toHaveLength(2)
    expect(context.sources[0].start).toHaveBeenCalledWith(0.04)
    expect(context.sources[1].start).toHaveBeenCalledWith(0.16)
    expect(events.onFinished).not.toHaveBeenCalled()
    player.stop()
  })

  it('reports finished after the final scheduled source ends, not when generation ends', async () => {
    const events = callbacks()
    const player = new ReadAloudPlayer(events)
    player.addChunk(durationChunk(0.12))
    player.addChunk(durationChunk(0.08))
    player.finish()
    await flushQueue()
    const context = FakeAudioContext.instances[0]

    expect(context.close).not.toHaveBeenCalled()
    context.sources[0].end()
    expect(events.onFinished).not.toHaveBeenCalled()
    context.sources[1].end()
    expect(events.onFinished).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
    expect(events.onError).not.toHaveBeenCalled()
  })

  it('preserves little-endian samples split across odd byte boundaries and flushes short final audio', async () => {
    const events = callbacks()
    const player = new ReadAloudPlayer(events)
    player.addChunk(bytesChunk([0x00]))
    player.addChunk(bytesChunk([0x80, 0xff, 0x7f]))
    player.finish()
    await flushQueue()
    const context = FakeAudioContext.instances[0]

    expect(context.buffers[0].data).toEqual(new Float32Array([-1, 32767 / 32768]))
    expect(events.onError).not.toHaveBeenCalled()
    player.stop()
  })

  it('stops every queued source and suppresses later chunk and completion callbacks', async () => {
    const events = callbacks()
    const player = new ReadAloudPlayer(events)
    player.addChunk(durationChunk(0.12))
    player.addChunk(durationChunk(0.12))
    await flushQueue()
    const context = FakeAudioContext.instances[0]

    player.stop()
    player.stop()
    player.addChunk(durationChunk(0.12))
    player.finish()
    context.sources.forEach((source) => source.end())
    await flushQueue()

    expect(context.sources).toHaveLength(2)
    context.sources.forEach((source) => {
      expect(source.stop).toHaveBeenCalledOnce()
      expect(source.disconnect).toHaveBeenCalledOnce()
    })
    expect(context.close).toHaveBeenCalledOnce()
    expect(events.onFinished).not.toHaveBeenCalled()
  })

  it('rejects truncated PCM without reporting success', async () => {
    const events = callbacks()
    const player = new ReadAloudPlayer(events)
    player.addChunk(bytesChunk([0x80]))
    player.finish()
    await flushQueue()

    expect(events.onError).toHaveBeenCalledWith('朗读音频数据不完整，请重试')
    expect(events.onFinished).not.toHaveBeenCalled()
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledOnce()
  })

  it('offers an explicit resume when autoplay requires another gesture', async () => {
    vi.useFakeTimers()
    FakeAudioContext.initiallySuspended = true
    const events = callbacks()
    const player = new ReadAloudPlayer(events)
    player.addChunk(durationChunk(0.12))
    await vi.advanceTimersByTimeAsync(200)
    expect(events.onBlocked).toHaveBeenCalledOnce()
    expect(events.onPlaying).not.toHaveBeenCalled()

    const context = FakeAudioContext.instances[0]
    context.state = 'running'
    context.pendingResume?.()
    await player.resume()
    await flushQueue()
    expect(events.onPlaying).toHaveBeenCalledOnce()
    player.stop()
  })

  it('holds producer acknowledgements above thirty seconds while decoding later queued chunks independently', async () => {
    vi.useFakeTimers()
    const player = new ReadAloudPlayer(callbacks())
    const firstAccepted = vi.fn()
    const secondAccepted = vi.fn()
    void player.addChunk({ ...bytesChunk(new Array(6200).fill(0)), sampleRate: 100 }).then(firstAccepted)
    void player.addChunk({ ...bytesChunk(new Array(200).fill(0)), sampleRate: 100 }).then(secondAccepted)
    await flushQueue()
    const context = FakeAudioContext.instances[0]
    expect(context.sources).toHaveLength(2)
    expect(firstAccepted).not.toHaveBeenCalled()
    expect(secondAccepted).not.toHaveBeenCalled()

    context.currentTime = 3
    await vi.advanceTimersByTimeAsync(250)
    expect(firstAccepted).toHaveBeenCalledOnce()
    expect(secondAccepted).toHaveBeenCalledOnce()
    player.stop()
  })

  it('releases capacity waits and pending autoplay unlock when stopped', async () => {
    vi.useFakeTimers()
    const player = new ReadAloudPlayer(callbacks())
    const accepted = vi.fn()
    void player.addChunk({ ...bytesChunk(new Array(6200).fill(0)), sampleRate: 100 }).then(accepted)
    await flushQueue()
    expect(accepted).not.toHaveBeenCalled()
    player.stop()
    await flushQueue()
    expect(accepted).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)

    FakeAudioContext.initiallySuspended = true
    const suspendedPlayer = new ReadAloudPlayer(callbacks())
    const pendingChunk = suspendedPlayer.addChunk(durationChunk(0.12))
    suspendedPlayer.stop()
    await expect(pendingChunk).resolves.toBeUndefined()
  })
})
