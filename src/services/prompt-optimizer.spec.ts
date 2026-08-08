import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestAiChatCompletionMock } = vi.hoisted(() => ({
  requestAiChatCompletionMock: vi.fn(),
}))

vi.mock('./ai-client', () => ({
  requestAiChatCompletion: requestAiChatCompletionMock,
}))

import { DEFAULT_AI_SETTINGS, normalizeAiSettings } from './ai-types'
import {
  buildPromptOptimizationMessages,
  optimizePromptWithAi,
  parsePromptOptimizationResponse,
} from './prompt-optimizer'

describe('MiniMax-H3 prompt optimizer', () => {
  beforeEach(() => {
    requestAiChatCompletionMock.mockReset()
  })

  it('keeps the optimizer system prompt when normalizing legacy settings', () => {
    const normalized = normalizeAiSettings({
      model: 'test-model',
    })

    expect(normalized.promptOptimizerSystemPrompt).toContain('MiniMax-H3')
    expect(normalized.promptOptimizerSystemPrompt).toContain('integrated_multimodal_description')
  })

  it('builds mode and duration context for the model', () => {
    const messages = buildPromptOptimizationMessages('一只猫推开窗户', {
      settings: DEFAULT_AI_SETTINGS,
      mode: 'FL2VA',
      durationSeconds: 8,
    })

    expect(messages[0].content).toBe(DEFAULT_AI_SETTINGS.promptOptimizerSystemPrompt)
    expect(messages[1].content).toContain('输入模式：FL2VA')
    expect(messages[1].content).toContain('目标视频时长：8.00 秒')
  })

  it('parses fenced JSON with bilingual prompts', () => {
    const result = parsePromptOptimizationResponse(
      '```json\n{"chinesePrompt":"中文提示词","englishPrompt":"English prompt"}\n```',
    )

    expect(result).toEqual({
      chinesePrompt: '中文提示词',
      englishPrompt: 'English prompt',
    })
  })

  it('uses the configured translation model request path once', async () => {
    requestAiChatCompletionMock.mockResolvedValue({
      content: '{"chinesePrompt":"中文提示词","englishPrompt":"English prompt"}',
    })

    const result = await optimizePromptWithAi('雨中的咖啡店', {
      settings: {
        ...DEFAULT_AI_SETTINGS,
        apiKey: 'test-key',
        model: 'test-model',
        requestTimeoutMs: 180000,
      },
      mode: 'T2VA',
      durationSeconds: 6,
    })

    expect(result.englishPrompt).toBe('English prompt')
    expect(requestAiChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(requestAiChatCompletionMock).toHaveBeenCalledWith(expect.any(Array), {
      temperature: 0.35,
      maxTokens: 6500,
      timeoutMs: 180000,
      enableStreaming: false,
    })
  })
})
