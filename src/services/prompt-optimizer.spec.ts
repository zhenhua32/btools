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
  validatePromptReferenceImages,
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
    expect(messages[1].content).toContain('把 8.00 秒作为不可超出的硬边界')
    expect(messages[1].content).toContain('最终参考帧必须准确对齐 8.00 秒')
    expect(messages[1].content).toContain('格式为 MM:SS.mmm')
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

  it('builds image_url content for image-based modes', () => {
    const messages = buildPromptOptimizationMessages('让画面中的女孩抬头看向镜头', {
      settings: DEFAULT_AI_SETTINGS,
      mode: 'I2VA',
      durationSeconds: 6,
      referenceImages: [
        {
          name: 'first-frame.png',
          dataUrl: 'data:image/png;base64,dGVzdA==',
        },
      ],
    })

    const userContent = messages[1].content
    expect(Array.isArray(userContent)).toBe(true)
    if (!Array.isArray(userContent)) throw new Error('expected multimodal content')

    expect(userContent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,dGVzdA==',
            detail: 'high',
          },
        }),
      ]),
    )
    expect(
      userContent.some(
        (part) => part.type === 'text' && part.text.includes('<Picture 1>（首帧）'),
      ),
    ).toBe(true)
    expect(
      userContent.some(
        (part) => part.type === 'text' && part.text.includes('不得把图片中不可见'),
      ),
    ).toBe(true)
  })

  it('requires the correct number of real images for non-text modes', () => {
    expect(validatePromptReferenceImages('I2VA', [])).toContain('1 张首帧图片')
    expect(
      validatePromptReferenceImages('FL2VA', [
        { name: 'first.png', dataUrl: 'data:image/png;base64,dGVzdA==' },
      ]),
    ).toContain('首帧和尾帧 2 张图片')
    expect(
      validatePromptReferenceImages('L2VA', [
        { name: 'last.webp', dataUrl: 'data:image/webp;base64,dGVzdA==' },
      ]),
    ).toBeNull()
  })

  it('rejects non-image payloads', () => {
    expect(
      validatePromptReferenceImages('Ref2VA', [
        { name: 'not-image.txt', dataUrl: 'data:text/plain;base64,dGVzdA==' },
      ]),
    ).toContain('格式无效')
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
