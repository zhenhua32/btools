import { describe, expect, it } from 'vitest'
import { splitReadAloudLanguageRuns } from './read-aloud-language'

describe('read aloud sentence language routing', () => {
  it('routes independent Chinese and English sentences without changing the text', () => {
    const text = '你好，先听这一段。  Good morning!\n现在再看下一句。'
    const runs = splitReadAloudLanguageRuns(text)
    expect(runs).toEqual([
      { text: '你好，先听这一段。  ', language: 'zh' },
      { text: 'Good morning!\n', language: 'en' },
      { text: '现在再看下一句。', language: 'zh' },
    ])
    expect(runs.map((run) => run.text).join('')).toBe(text)
  })

  it('keeps short English names within their Chinese sentence', () => {
    expect(splitReadAloudLanguageRuns('请打开 Settings 页面，再点击 Save。下一步使用 AI。')).toEqual([
      { text: '请打开 Settings 页面，再点击 Save。下一步使用 AI。', language: 'zh' },
    ])
  })

  it('keeps closing quotes and brackets with their sentence before changing voices', () => {
    const text = '“Good morning.” 你好。 (Try it!) 再看下一句。'
    const runs = splitReadAloudLanguageRuns(text)
    expect(runs).toEqual([
      { text: '“Good morning.” ', language: 'en' },
      { text: '你好。 ', language: 'zh' },
      { text: '(Try it!) ', language: 'en' },
      { text: '再看下一句。', language: 'zh' },
    ])
    expect(runs.map((run) => run.text).join('')).toBe(text)
    expect(splitReadAloudLanguageRuns('"Hello." 你好。')[0]).toEqual({ text: '"Hello." ', language: 'en' })
  })

  it('recognizes an English sentence followed immediately by Chinese text', () => {
    expect(splitReadAloudLanguageRuns('Good morning!你好。')).toEqual([
      { text: 'Good morning!', language: 'en' },
      { text: '你好。', language: 'zh' },
    ])
  })

  it('does not split decimal numbers or lose punctuation, line breaks or emoji', () => {
    const text = 'Price: 3.14.\r\nTake a look 😀!  好的，继续。'
    const runs = splitReadAloudLanguageRuns(text)
    expect(runs).toEqual([
      { text: 'Price: 3.14.\r\nTake a look 😀!  ', language: 'en' },
      { text: '好的，继续。', language: 'zh' },
    ])
    expect(runs.map((run) => run.text).join('')).toBe(text)
  })

  it('uses the next sentence for leading numbers and the preceding one thereafter', () => {
    expect(splitReadAloudLanguageRuns('123. Hello there. 456. 你好。')).toEqual([
      { text: '123. Hello there. 456. ', language: 'en' },
      { text: '你好。', language: 'zh' },
    ])
  })

  it('supports accented Latin and a configurable fallback for text without letters', () => {
    expect(splitReadAloudLanguageRuns('Café, voilà!')).toEqual([
      { text: 'Café, voilà!', language: 'en' },
    ])
    expect(splitReadAloudLanguageRuns('123 😀!', 'en')).toEqual([
      { text: '123 😀!', language: 'en' },
    ])
    expect(splitReadAloudLanguageRuns('')).toEqual([])
  })
})
