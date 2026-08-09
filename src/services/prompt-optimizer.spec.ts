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
  parseChineseReviewTranslation,
  parseEnglishPromptOptimizationResponse,
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
    expect(normalized.promptOptimizerSystemPrompt).toContain('{"englishPrompt":"complete English prompt"}')
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
    expect(messages[1].content).toContain('只含 englishPrompt 的 JSON')
    expect(messages[1].content).toContain('不要生成中文版本')
  })

  it('parses the English prompt from fenced JSON and tolerates saved legacy instructions', () => {
    const result = parseEnglishPromptOptimizationResponse(
      '```json\n{"chinesePrompt":"中文提示词","englishPrompt":"English prompt"}\n```',
    )

    expect(result).toBe('English prompt')
  })

  it('accepts a translated Chinese review and rejects an English duplicate', () => {
    const englishPrompt = 'integrated_multimodal_description:\n[Shot 1] A woman opens the door.'

    expect(
      parseChineseReviewTranslation(
        englishPrompt,
        'integrated_multimodal_description:\n[Shot 1] 一名女子缓缓打开房门，随后走进房间。',
      ),
    ).toContain('一名女子缓缓打开房门')
    expect(() => parseChineseReviewTranslation(englishPrompt, englishPrompt)).toThrow(
      '仍以英文为主',
    )
    expect(() =>
      parseChineseReviewTranslation(
        englishPrompt,
        'integrated_multimodal_description:\n[镜头 1] 一名女子缓缓打开房门，随后走进房间。',
      ),
    ).toThrow('改动了 H3 结构标记')
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

  it('generates the English H3 prompt first and then translates the Chinese review', async () => {
    requestAiChatCompletionMock
      .mockResolvedValueOnce({
        content:
          '{"englishPrompt":"integrated_multimodal_description:\\n[Shot 1] A woman walks into a coffee shop while rain falls outside."}',
      })
      .mockResolvedValueOnce({
        content:
          'integrated_multimodal_description:\n[Shot 1] 一名女子走进咖啡店，窗外持续下着雨。',
      })
    const progressMessages: string[] = []

    const result = await optimizePromptWithAi('雨中的咖啡店', {
      settings: {
        ...DEFAULT_AI_SETTINGS,
        apiKey: 'test-key',
        model: 'test-model',
        requestTimeoutMs: 180000,
      },
      mode: 'T2VA',
      durationSeconds: 6,
      onProgress: (message) => progressMessages.push(message),
    })

    expect(result.englishPrompt).toContain('A woman walks into a coffee shop')
    expect(result.chinesePrompt).toContain('一名女子走进咖啡店')
    expect(progressMessages).toEqual([
      '正在生成英文 H3 正式提示词…',
      '英文提示词已生成，正在翻译中文审阅版…',
    ])
    expect(requestAiChatCompletionMock).toHaveBeenCalledTimes(2)
    expect(requestAiChatCompletionMock).toHaveBeenNthCalledWith(1, expect.any(Array), {
      temperature: 0.35,
      maxTokens: 6500,
      timeoutMs: 180000,
      enableStreaming: false,
    })

    const translationMessages = requestAiChatCompletionMock.mock.calls[1][0]
    expect(translationMessages[0].content).toContain('MiniMax-H3')
    expect(translationMessages[0].content).toContain('所有叙事、动作、镜头')
    expect(translationMessages[1].content).toContain('A woman walks into a coffee shop')
  })
})
