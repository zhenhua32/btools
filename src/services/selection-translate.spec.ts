import { beforeEach, describe, expect, it } from 'vitest'

import {
  applySelectionTranslation,
  captureSelectionSnapshot,
} from './selection-translate'

describe('selection translate service', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  it('captures selection html when markup exists', () => {
    const container = document.createElement('div')
    container.innerHTML = 'Hello <a href="https://example.com">world</a>'
    document.body.appendChild(container)

    const range = document.createRange()
    range.selectNodeContents(container)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const snapshot = captureSelectionSnapshot(document)

    expect(snapshot.text).toBe('Hello world')
    expect(snapshot.html).toContain('<a href="https://example.com">world</a>')
  })

  it('replaces selected html while preserving allowed inline tags', () => {
    const container = document.createElement('div')
    container.innerHTML = 'Hello <a href="https://example.com">world</a>'
    document.body.appendChild(container)

    const range = document.createRange()
    range.selectNodeContents(container)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const snapshot = captureSelectionSnapshot(document)
    const result = applySelectionTranslation(snapshot, {
      translatedHtml: '你好 <a href="https://example.com">世界</a>',
      documentRef: document,
    })

    expect(result.applied).toBe(true)
    expect(result.method).toBe('html')
    expect(container.innerHTML).toBe('你好 <a href="https://example.com">世界</a>')
  })

  it('sanitizes risky attributes back to the original safe value', () => {
    const container = document.createElement('div')
    container.innerHTML = 'Hello <a href="https://example.com" target="_blank">world</a>'
    document.body.appendChild(container)

    const range = document.createRange()
    range.selectNodeContents(container)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const snapshot = captureSelectionSnapshot(document)
    applySelectionTranslation(snapshot, {
      translatedHtml:
        '你好 <a href="javascript:alert(1)" target="_self" onclick="alert(1)">世界</a>',
      documentRef: document,
    })

    expect(container.innerHTML).toBe('你好 <a href="https://example.com" target="_blank">世界</a>')
  })

  it('falls back to plain text when translated html structure changes', () => {
    const container = document.createElement('div')
    container.innerHTML = 'Hello <a href="https://example.com">world</a>'
    document.body.appendChild(container)

    const range = document.createRange()
    range.selectNodeContents(container)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const snapshot = captureSelectionSnapshot(document)
    const result = applySelectionTranslation(snapshot, {
      translatedHtml: '<strong>你好世界</strong>',
      translatedText: '你好世界',
      documentRef: document,
    })

    expect(result.applied).toBe(true)
    expect(result.method).toBe('text')
    expect(container.textContent).toBe('你好世界')
  })

  it('returns preview only when the original selection content changes', () => {
    const container = document.createElement('div')
    container.textContent = 'Hello world'
    document.body.appendChild(container)

    const textNode = container.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.data.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const snapshot = captureSelectionSnapshot(document)
    textNode.data = 'Hello changed'

    const result = applySelectionTranslation(snapshot, {
      translatedText: '你好世界',
      documentRef: document,
    })

    expect(result.applied).toBe(false)
    expect(result.method).toBe('preview-only')
    expect(container.textContent).toBe('Hello changed')
  })
})