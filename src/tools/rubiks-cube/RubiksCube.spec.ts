import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, KeepAlive, nextTick, ref, type App } from 'vue'
import RubiksCube from './RubiksCube.vue'
import { applyMove, createSolvedCube, orientationToCssMatrix, type CubeState } from '../../services/rubiks-cube'

describe('2×2 cube workshop interactions', () => {
  let app: App | undefined
  let host: HTMLDivElement
  let visible: ReturnType<typeof ref<boolean>>

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    vi.spyOn(Math, 'random').mockReturnValue(0.24)
    host = document.createElement('div')
    document.body.appendChild(host)
    visible = ref(true)
    app = createApp({
      setup: () => () => h(KeepAlive, null, {
        default: () => visible.value ? h(RubiksCube) : h('div', '另一个工具'),
      }),
    })
    app.mount(host)
    await nextTick()
    const viewport = host.querySelector<HTMLElement>('.cube-viewport')!
    const captured = new Set<number>()
    Object.defineProperties(viewport, {
      setPointerCapture: { value: (pointerId: number) => captured.add(pointerId) },
      hasPointerCapture: { value: (pointerId: number) => captured.has(pointerId) },
      releasePointerCapture: { value: (pointerId: number) => {
        if (captured.delete(pointerId)) viewport.dispatchEvent(pointer('lostpointercapture', 0, 0, { pointerId }))
      } },
    })
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
    host.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function geometry(root: ParentNode = host) {
    return Array.from(root.querySelectorAll<HTMLElement>('.cubie')).map((cubie) => cubie.style.transform)
  }

  function expectedGeometry(cube: CubeState) {
    return cube.map((cubie) => {
      const [x, y, z] = cubie.position
      return `translate3d(${x * 53}px, ${y * 53}px, ${z * 53}px) ${orientationToCssMatrix(cubie.orientation)}`
    })
  }

  function pointer(type: string, clientX: number, clientY: number, options: MouseEventInit & { pointerId?: number } = {}) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, ...options })
    Object.defineProperty(event, 'pointerId', { value: options.pointerId ?? 7 })
    return event
  }

  function sticker(id = '-1,-1,1', localFace = 'F') {
    const element = host.querySelector<HTMLElement>(`[data-cubie-id="${id}"][data-local-face="${localFace}"] .cube-sticker`)
    if (!element) throw new Error(`Sticker not found: ${id} ${localFace}`)
    return element
  }

  function viewport() {
    return host.querySelector<HTMLElement>('.cube-viewport')!
  }

  async function dragSticker(distance: number) {
    sticker().dispatchEvent(pointer('pointerdown', 100, 100))
    viewport().dispatchEvent(pointer('pointermove', 100 + distance, 100))
    await nextTick()
  }

  function steps() {
    return Number(host.querySelector('.moves-stat strong')?.textContent?.match(/\d+/)?.[0])
  }

  function time() {
    return host.querySelector('.time-value')?.textContent
  }

  function action(label: string) {
    const button = Array.from(host.querySelectorAll('button')).find((element) =>
      element.getAttribute('aria-label') === label || element.textContent?.includes(label),
    )
    if (!button) throw new Error(`Button not found: ${label}`)
    return button
  }

  async function click(label: string) {
    action(label).click()
    await nextTick()
  }

  async function advance(milliseconds: number) {
    await vi.advanceTimersByTimeAsync(milliseconds)
    await nextTick()
    await nextTick()
  }

  async function turn(label: string) {
    await click(label)
    await advance(250)
  }

  async function shuffle() {
    await click('随机打乱')
    await advance(2500)
  }

  function guide() {
    return document.querySelector<HTMLElement>('#cube-guide')
  }

  function guideVisible() {
    for (let element: HTMLElement | null = guide(); element; element = element.parentElement) {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return false
    }
    return guide() !== null
  }

  it('opens the operation guide above the page and supports both close buttons', async () => {
    expect(guideVisible()).toBe(false)
    await click('操作指南')
    await advance(100)
    const dialog = guide()!
    expect(dialog).not.toBeNull()
    expect(host.contains(dialog)).toBe(false)
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('cube-guide-title')
    expect(dialog.querySelector('#cube-guide-title')?.textContent).toContain('操作指南')
    expect(dialog.textContent).toContain('拖动')
    expect(guideVisible()).toBe(true)
    expect(action('操作指南').getAttribute('aria-expanded')).toBe('true')

    dialog.querySelector<HTMLButtonElement>('[aria-label="关闭操作指南"]')!.click()
    await nextTick()
    await advance(500)
    expect(guideVisible()).toBe(false)
    expect(action('操作指南').getAttribute('aria-expanded')).toBe('false')

    await click('操作指南')
    await advance(100)
    const done = Array.from(guide()!.querySelectorAll('button')).find((button) => button.textContent?.includes('我知道了'))!
    expect(done).toBeDefined()
    done.click()
    await nextTick()
    await advance(500)
    expect(guideVisible()).toBe(false)
  })

  it('keeps cube shortcuts inactive while the guide is open and dismisses it with Escape', async () => {
    const solved = geometry()
    await click('操作指南')
    await advance(100)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))
    guide()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
    await advance(300)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)
    expect(time()).toBe('00:00.00')

    guide()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    await advance(500)
    expect(guideVisible()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))
    await nextTick()
    await advance(250)
    expect(steps()).toBe(1)
  })

  it('closes the teleported guide when leaving the tool and can reopen after returning', async () => {
    await click('操作指南')
    await advance(100)
    expect(guideVisible()).toBe(true)
    visible.value = false
    await nextTick()
    await advance(500)
    expect(guideVisible()).toBe(false)

    visible.value = true
    await nextTick()
    await advance(100)
    expect(guideVisible()).toBe(false)
    expect(action('操作指南').getAttribute('aria-expanded')).toBe('false')
    await click('操作指南')
    await advance(100)
    expect(guideVisible()).toBe(true)
    app!.unmount()
    app = undefined
    await nextTick()
    expect(guide()).toBeNull()
  })

  it('commits a face turn once, blocks overlapping input, and completes after its inverse', async () => {
    const solved = geometry()
    expect(solved).toHaveLength(8)
    expect(host.querySelectorAll('.cube-sticker')).toHaveLength(24)

    await click('前面顺时针转动')
    expect(action('前面逆时针转动').disabled).toBe(true)
    expect(steps()).toBe(0)
    action('前面顺时针转动').click()
    await advance(250)
    expect(geometry()).not.toEqual(solved)
    expect(steps()).toBe(1)
    expect(host.querySelector('.move-trail')?.textContent).toBe('F')

    await turn('前面逆时针转动')
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(2)
    expect(host.querySelector('.status-pill')?.textContent).toContain('挑战完成')
    expect(host.querySelector('.completion-badge')).not.toBeNull()
    const completedTime = time()
    await advance(1000)
    expect(time()).toBe(completedTime)
  })

  it('keeps automatic scramble turns out of the counter and starts timing on the first manual turn', async () => {
    const solved = geometry()
    await shuffle()
    expect(geometry()).not.toEqual(solved)
    expect(steps()).toBe(0)
    expect(time()).toBe('00:00.00')
    expect(host.querySelector('.status-pill')?.textContent).toContain('准备就绪')
    expect(host.querySelector('.scramble-notation')?.textContent?.trim()).not.toBe('')
    await advance(1000)
    expect(time()).toBe('00:00.00')

    await turn('上面顺时针转动')
    expect(steps()).toBe(1)
    expect(time()).not.toBe('00:00.00')
    expect(host.querySelector('.status-pill')?.textContent).toContain('挑战中')
  })

  it('undoes only the latest manual turn and preserves the scrambled state', async () => {
    await shuffle()
    const scrambled = geometry()
    await turn('右面顺时针转动')
    expect(steps()).toBe(1)
    expect(geometry()).not.toEqual(scrambled)
    await click('撤销一步')
    await advance(250)
    expect(geometry()).toEqual(scrambled)
    expect(steps()).toBe(0)
    expect(action('撤销一步').disabled).toBe(true)
    expect(host.querySelector('.move-trail')).toBeNull()
  })

  it('automatically reverses both scramble and manual history to restore all eight corners', async () => {
    const solved = geometry()
    await shuffle()
    await turn('右面顺时针转动')
    await turn('上面逆时针转动')
    await click('自动复原')
    expect(action('前面顺时针转动').disabled).toBe(true)
    await advance(5000)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)
    expect(time()).toBe('00:00.00')
    expect(host.querySelector('.scramble-notation')).toBeNull()
    expect(action('自动复原').disabled).toBe(true)
    expect(host.querySelector('.status-pill')?.textContent).toContain('已复原')
  })

  it('retains a completed round for repeated undo and can restore after reopening that round', async () => {
    const solved = geometry()
    await turn('前面顺时针转动')
    const frontTurn = geometry()
    await turn('前面逆时针转动')
    expect(host.querySelector('.completion-badge')).not.toBeNull()
    await click('撤销一步')
    await advance(250)
    expect(geometry()).toEqual(frontTurn)
    expect(steps()).toBe(1)
    expect(host.querySelector('.completion-badge')).toBeNull()
    await click('撤销一步')
    await advance(250)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)
    expect(action('撤销一步').disabled).toBe(true)

    await turn('前面顺时针转动')
    await turn('前面逆时针转动')
    await click('撤销一步')
    await advance(250)
    await click('自动复原')
    await advance(1000)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)
    expect(action('自动复原').disabled).toBe(true)
  })

  it('supports face keys and Shift inverses while ignoring typing, shortcuts and held keys', async () => {
    const solved = geometry()
    const input = document.createElement('input')
    host.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', repeat: true }))
    await advance(300)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    await nextTick()
    await advance(250)
    expect(steps()).toBe(1)
    expect(geometry()).not.toEqual(solved)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }))
    await nextTick()
    await advance(250)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(2)
    input.remove()
  })

  it('cancels an unfinished animation on deactivation and ignores keys while hidden', async () => {
    const workshop = host.querySelector<HTMLElement>('.cube-workshop')!
    const solved = geometry()
    await click('右面顺时针转动')
    await advance(100)
    visible.value = false
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))
    await advance(1000)
    expect(geometry(workshop)).toEqual(solved)

    visible.value = true
    await nextTick()
    await advance(500)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)
    expect(action('右面顺时针转动').disabled).toBe(false)
    await turn('右面顺时针转动')
    expect(steps()).toBe(1)
    expect(geometry()).not.toEqual(solved)
  })

  it('does not schedule a late move when deactivated before the animation frame flushes', async () => {
    const solved = geometry()
    action('前面顺时针转动').click()
    visible.value = false
    await nextTick()
    await advance(1000)
    visible.value = true
    await nextTick()
    await advance(500)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)
    expect(action('前面顺时针转动').disabled).toBe(false)
    await turn('前面顺时针转动')
    expect(steps()).toBe(1)
  })

  it('stops a multi-turn scramble at its committed geometry when switching tools', async () => {
    await click('随机打乱')
    await advance(120)
    const partial = geometry()
    visible.value = false
    await nextTick()
    await advance(3000)
    visible.value = true
    await nextTick()
    await advance(500)
    expect(geometry()).toEqual(partial)
    expect(steps()).toBe(0)
    expect(action('前面顺时针转动').disabled).toBe(false)
    await click('自动复原')
    await advance(1000)
    expect(host.querySelector('.status-pill')?.textContent).toContain('已复原')
  })

  it('previews a directly dragged layer, then snaps to the matching legal quarter turn', async () => {
    const solved = geometry()
    const camera = host.querySelector<HTMLElement>('.cube-view')!.style.transform
    await dragSticker(110)
    expect(host.querySelector('.cube-stage')?.classList.contains('is-turning')).toBe(true)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)
    expect(time()).toBe('00:00.00')
    expect(host.querySelector<HTMLElement>('.cube-view')!.style.transform).toBe(camera)
    expect(Array.from(host.querySelectorAll<HTMLElement>('.cubie-layer')).filter((layer) => layer.style.transform !== '')).toHaveLength(4)

    // A key arriving during a tentative pointer gesture must not replace it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))
    await nextTick()
    viewport().dispatchEvent(pointer('pointerup', 210, 100))
    await nextTick()
    await advance(250)
    expect(geometry()).toEqual(expectedGeometry(applyMove(createSolvedCube(), { face: 'U', turns: -1 })))
    expect(steps()).toBe(1)
    expect(time()).not.toBe('00:00.00')
    expect(host.querySelector('.move-trail')?.textContent).toBe("U'")
  })

  it('returns a short layer drag to its initial state without starting a round', async () => {
    const solved = geometry()
    await dragSticker(16)
    expect(host.querySelector('.cube-stage')?.classList.contains('is-turning')).toBe(true)
    viewport().dispatchEvent(pointer('pointerup', 116, 100))
    await nextTick()
    await advance(500)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)
    expect(time()).toBe('00:00.00')
    expect(host.querySelector('.status-pill')?.textContent).toContain('已复原')
    expect(Array.from(host.querySelectorAll<HTMLElement>('.cubie-layer')).every((layer) => layer.style.transform === '')).toBe(true)
  })

  for (const eventType of ['pointercancel', 'lostpointercapture']) {
    it(`cancels an uncommitted layer on ${eventType} without a late turn`, async () => {
      const solved = geometry()
      await dragSticker(110)
      viewport().dispatchEvent(pointer(eventType, 210, 100))
      await nextTick()
      await advance(500)
      expect(geometry()).toEqual(solved)
      expect(steps()).toBe(0)
      expect(time()).toBe('00:00.00')
      expect(host.querySelector('.cube-stage')?.classList.contains('is-turning')).toBe(false)
      expect(action('前面顺时针转动').disabled).toBe(false)
      await turn('前面顺时针转动')
      expect(steps()).toBe(1)
    })
  }

  it('orbits from empty space, right drag or Alt drag without twisting the cube', async () => {
    const solved = geometry()
    for (const options of [{}, { button: 2 }, { altKey: true }]) {
      const camera = host.querySelector<HTMLElement>('.cube-view')!.style.transform
      const target = Object.keys(options).length ? sticker() : viewport()
      target.dispatchEvent(pointer('pointerdown', 100, 100, options))
      viewport().dispatchEvent(pointer('pointermove', 170, 130, options))
      viewport().dispatchEvent(pointer('pointerup', 170, 130, options))
      await nextTick()
      expect(host.querySelector<HTMLElement>('.cube-view')!.style.transform).not.toBe(camera)
      expect(geometry()).toEqual(solved)
      expect(steps()).toBe(0)
    }
    expect(time()).toBe('00:00.00')
  })

  it('wheels the current world face of a moved sticker and suppresses wheel bursts', async () => {
    await turn('前面顺时针转动')
    const frontTurn = geometry()
    const movedSticker = sticker('-1,-1,1', 'U')
    const wheel = (deltaY: number) => movedSticker.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY }))
    wheel(100)
    wheel(100)
    await nextTick()
    await advance(250)
    const expected = applyMove(applyMove(createSolvedCube(), { face: 'F', turns: 1 }), { face: 'R', turns: 1 })
    expect(geometry()).toEqual(expectedGeometry(expected))
    expect(steps()).toBe(2)
    wheel(-100)
    await advance(50)
    expect(steps()).toBe(2)
    await advance(200)
    wheel(-100)
    await nextTick()
    await advance(250)
    expect(geometry()).toEqual(frontTurn)
    expect(steps()).toBe(3)
  })

  it('zooms over empty space and leaves browser zoom shortcuts untouched', async () => {
    const solved = geometry()
    const scale = host.querySelector<HTMLElement>('.cube-scale')!
    const initial = scale.style.getPropertyValue('--cube-zoom')
    viewport().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }))
    await nextTick()
    expect(scale.style.getPropertyValue('--cube-zoom')).not.toBe(initial)
    const browserZoom = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, ctrlKey: true })
    sticker().dispatchEvent(browserZoom)
    await advance(500)
    expect(browserZoom.defaultPrevented).toBe(false)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)
  })

  it('discards a live drag preview when switching tools and keeps the clock idle', async () => {
    const solved = geometry()
    await dragSticker(110)
    visible.value = false
    await nextTick()
    await advance(1000)
    visible.value = true
    await nextTick()
    await advance(500)
    expect(geometry()).toEqual(solved)
    expect(steps()).toBe(0)
    expect(time()).toBe('00:00.00')
    expect(host.querySelector('.cube-stage')?.classList.contains('is-turning')).toBe(false)
    await turn('前面顺时针转动')
    expect(steps()).toBe(1)
  })
})
