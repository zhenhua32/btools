import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { startMock } = vi.hoisted(() => ({ startMock: vi.fn() }))
vi.mock('./read-aloud-client', () => ({ createReadAloudSession: startMock }))

import { createPageReadAloudController } from './read-aloud-overlay'

describe('page read aloud controls', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.querySelectorAll('[data-btools-page-translation]').forEach((host) => host.remove())
    vi.clearAllMocks()
  })
  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'))
  })

  it('stops the previous read and ignores its late error while the new read continues', () => {
    const first = { stop: vi.fn(), resume: vi.fn() }
    const second = { stop: vi.fn(), resume: vi.fn() }
    startMock.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const controller = createPageReadAloudController()
    controller.start('First text')
    controller.start('Second text')
    expect(first.stop).toHaveBeenCalledOnce()
    startMock.mock.calls[0][1].onError('stale provider error')
    const shadow = document.querySelector('[data-btools-page-translation]')!.shadowRoot!
    expect(shadow.textContent).not.toContain('stale provider error')
    expect(shadow.querySelector('.preview')?.textContent).toBe('Second text')
    shadow.querySelector<HTMLButtonElement>('.close')!.click()
    expect(second.stop).toHaveBeenCalledOnce()
    expect(shadow.querySelector<HTMLElement>('.panel')?.hidden).toBe(true)
  })

  it('exposes an explicit play gesture when blocked and stops on page exit', () => {
    const session = { stop: vi.fn(), resume: vi.fn() }
    startMock.mockReturnValue(session)
    const controller = createPageReadAloudController()
    controller.start('Hello')
    const callbacks = startMock.mock.calls[0][1]
    const shadow = document.querySelector('[data-btools-page-translation]')!.shadowRoot!
    callbacks.onStatus('blocked')
    const resume = shadow.querySelector<HTMLButtonElement>('.resume')!
    expect(resume.hidden).toBe(false)
    resume.click()
    expect(session.resume).toHaveBeenCalledOnce()
    callbacks.onStatus('playing')
    expect(resume.hidden).toBe(true)
    window.dispatchEvent(new Event('pagehide'))
    expect(session.stop).toHaveBeenCalledOnce()
  })

  it('replays the full original text after playback finishes without requiring a new selection', () => {
    const session = { stop: vi.fn(), resume: vi.fn() }
    startMock.mockReturnValue(session)
    const controller = createPageReadAloudController()
    const originalText = '完整朗读内容。'.repeat(80)
    controller.start(originalText)
    const firstCallbacks = startMock.mock.calls[0][1]
    const shadow = document.querySelector('[data-btools-page-translation]')!.shadowRoot!
    const replay = shadow.querySelector<HTMLButtonElement>('.replay')!
    expect(replay.hidden).toBe(true)
    expect(shadow.querySelector('.preview')?.textContent).not.toBe(originalText)
    firstCallbacks.onStatus('finished')
    expect(replay.hidden).toBe(false)
    window.getSelection()?.removeAllRanges()
    replay.click()
    expect(startMock).toHaveBeenCalledTimes(2)
    expect(startMock.mock.calls[1][0]).toBe(originalText)
    expect(replay.hidden).toBe(true)
    firstCallbacks.onStatus('finished')
    expect(replay.hidden).toBe(true)
    startMock.mock.calls[1][1].onStatus('finished')
    expect(replay.hidden).toBe(false)
    controller.stop()
    expect(replay.hidden).toBe(true)
  })
})
