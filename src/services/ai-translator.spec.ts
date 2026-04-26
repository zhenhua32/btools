import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestAiChatCompletionMock } = vi.hoisted(() => ({
  requestAiChatCompletionMock: vi.fn(),
}))

vi.mock('./ai-client', () => ({
  requestAiChatCompletion: requestAiChatCompletionMock,
}))

import { DEFAULT_AI_SETTINGS, normalizeAiSettings, type AiSettings } from './ai-types'
import { translateTextWithAi } from './ai-translator'

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
})