import { expect, it, vi } from 'vitest'
import { DEFAULT_AI_SETTINGS } from '@/services/ai-types'

const { settingsMock, readMock } = vi.hoisted(() => ({ settingsMock: vi.fn(), readMock: vi.fn() }))
vi.mock('@/services/ai-settings', () => ({ getAiSettings: settingsMock }))
vi.mock('@/services/read-aloud-client', () => ({ createReadAloudSession: readMock }))

it('offers independent selection actions and preserves selection on a read aloud click', async () => {
  const sendMessage = vi.fn((_message, callback) => callback?.())
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn() }, sendMessage } })
  settingsMock.mockResolvedValue({ ...DEFAULT_AI_SETTINGS, enableSelectionButton: false })
  readMock.mockReturnValue({ stop: vi.fn(), resume: vi.fn() })
  document.body.innerHTML = '<p>Hello selected world</p>'
  const paragraph = document.querySelector('p')!
  const text = paragraph.firstChild!
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 14)
  range.getBoundingClientRect = () => ({ bottom: 24 } as DOMRect)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  await import('./content-script')
  paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 20, clientY: 20 }))
  await vi.waitFor(() => {
    const host = Array.from(document.querySelectorAll('[data-btools-page-translation]'))
      .find((element) => element.shadowRoot?.querySelector('.selection-actions.visible'))
    expect(host).toBeDefined()
  })
  const host = Array.from(document.querySelectorAll('[data-btools-page-translation]'))
    .find((element) => element.shadowRoot?.querySelector('.selection-actions'))!
  const translate = host.shadowRoot!.querySelector<HTMLButtonElement>('.translate-btn')!
  const read = host.shadowRoot!.querySelector<HTMLButtonElement>('.read-aloud-btn')!
  expect(translate.hidden).toBe(true)
  expect(read.hidden).toBe(false)
  const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  read.dispatchEvent(mousedown)
  expect(mousedown.defaultPrevented).toBe(true)
  read.click()
  expect(readMock).toHaveBeenCalledWith('Hello selected', expect.any(Object))
  expect(window.getSelection()!.toString()).toBe('Hello selected')

  settingsMock.mockResolvedValue({ ...DEFAULT_AI_SETTINGS, enableSelectionReadAloudButton: false })
  paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await vi.waitFor(() => expect(read.hidden).toBe(true))
  expect(translate.hidden).toBe(false)
  translate.click()
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'btools:page-translate-selection-submit',
    payload: expect.objectContaining({ text: 'Hello selected' }),
  }), expect.any(Function))
  window.dispatchEvent(new Event('pagehide'))
  vi.unstubAllGlobals()
})
