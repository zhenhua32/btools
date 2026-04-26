import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestAiChatCompletionMock } = vi.hoisted(() => ({
  requestAiChatCompletionMock: vi.fn(),
}))

vi.mock('./ai-client', () => ({
  requestAiChatCompletion: requestAiChatCompletionMock,
}))

import { DEFAULT_AI_SETTINGS, normalizeAiSettings, type AiSettings } from './ai-types'
import { buildTranslationMessages, translateTextWithAi } from './ai-translator'

describe('AI translation timeout settings', () => {
  beforeEach(() => {
    requestAiChatCompletionMock.mockReset()
  })

  it('defaults request timeout to 300 seconds', () => {
    expect(DEFAULT_AI_SETTINGS.requestTimeoutMs).toBe(300000)
    expect(normalizeAiSettings({ requestTimeoutMs: 0 }).requestTimeoutMs).toBe(300000)
  })

  it('uses configured timeout for whole-document translation', async () => {
    const settings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      apiKey: 'test-key',
      model: 'test-model',
      requestTimeoutMs: 123000,
    }

    requestAiChatCompletionMock.mockResolvedValue({ content: '测试译文' })

    await translateTextWithAi('Hello world', {
      settings,
      strategy: 'whole-document',
    })

    expect(requestAiChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(requestAiChatCompletionMock).toHaveBeenCalledWith(expect.any(Array), {
      temperature: 0.2,
      timeoutMs: 123000,
    })
  })

  it('uses configured timeout for paragraph-by-paragraph translation', async () => {
    const settings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      apiKey: 'test-key',
      model: 'test-model',
      requestTimeoutMs: 240000,
    }

    requestAiChatCompletionMock.mockResolvedValue({ content: '测试译文' })

    await translateTextWithAi('First paragraph.\n\nSecond paragraph.', {
      settings,
      strategy: 'paragraph-by-paragraph',
      concurrencyLimit: 1,
    })

    expect(requestAiChatCompletionMock).toHaveBeenCalledTimes(2)
    for (const call of requestAiChatCompletionMock.mock.calls) {
      expect(call[1]).toMatchObject({ timeoutMs: 240000 })
    }
  })

  it('forces html fragments to use whole-document translation', async () => {
    const settings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      apiKey: 'test-key',
      model: 'test-model',
    }

    requestAiChatCompletionMock.mockResolvedValue({
      content: '你好 <a href="https://example.com">世界</a>',
    })

    const result = await translateTextWithAi('Hello <a href="https://example.com">world</a>', {
      settings,
      strategy: 'paragraph-by-paragraph',
      sourceFormat: 'html-fragment',
    })

    expect(requestAiChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(result.strategyUsed).toBe('whole-document')
    expect(result.text).toContain('<a href="https://example.com">世界</a>')
  })

  it('builds html-fragment prompts that preserve tags and attributes', () => {
    const messages = buildTranslationMessages(
      '<a href="https://example.com">hello</a>',
      DEFAULT_AI_SETTINGS,
      false,
      false,
      'html-fragment',
    )

    expect(messages[0].content).toContain('HTML 片段')
    expect(messages[1].content).toContain('只返回翻译后的 HTML 片段')
  })
})