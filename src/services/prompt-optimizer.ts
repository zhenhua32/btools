import { requestAiChatCompletion } from './ai-client'
import type { AiChatMessage, AiSettings } from './ai-types'

export type PromptOptimizationMode = 'T2VA' | 'I2VA' | 'FL2VA' | 'L2VA' | 'Ref2VA'

export interface OptimizePromptOptions {
  settings: AiSettings
  mode: PromptOptimizationMode
  durationSeconds: number
}

export interface OptimizedPromptResult {
  chinesePrompt: string
  englishPrompt: string
}

export const PROMPT_OPTIMIZATION_MODE_OPTIONS: Array<{
  label: string
  value: PromptOptimizationMode
}> = [
  { label: 'T2VA · 纯文本生成视频', value: 'T2VA' },
  { label: 'I2VA · 首帧生成视频', value: 'I2VA' },
  { label: 'FL2VA · 首尾帧生成视频', value: 'FL2VA' },
  { label: 'L2VA · 尾帧生成视频', value: 'L2VA' },
  { label: 'Ref2VA · 全参考生成/编辑', value: 'Ref2VA' },
]

export const PROMPT_OPTIMIZATION_MODE_DESCRIPTIONS: Record<PromptOptimizationMode, string> = {
  T2VA: '仅使用文字构建完整的画面、镜头、动作、台词和声音时间线。',
  I2VA: 'Picture 1 是 0.00 秒首帧；请在描述中说明画面从首帧如何继续发展。',
  FL2VA: 'Picture 1 和 Picture 2 分别是首尾帧；重点描述两帧之间连续、可见的变化路径。',
  L2VA: 'Picture 1 是最终帧；从合理的前置状态逐步收敛到该画面。',
  Ref2VA: '适用于人物、场景、图片、视频或音频等完整参考资产；请在描述中写清每个素材的用途。',
}

export async function optimizePromptWithAi(
  description: string,
  options: OptimizePromptOptions,
): Promise<OptimizedPromptResult> {
  const source = description.trim()
  if (!source) {
    throw new Error('请输入需要优化的视频创意描述')
  }

  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
    throw new Error('视频时长必须大于 0 秒')
  }

  const response = await requestAiChatCompletion(
    buildPromptOptimizationMessages(source, options),
    {
      temperature: 0.35,
      maxTokens: 6500,
      timeoutMs: options.settings.requestTimeoutMs,
      enableStreaming: false,
    },
  )

  return parsePromptOptimizationResponse(response.content)
}

export function buildPromptOptimizationMessages(
  description: string,
  options: OptimizePromptOptions,
): AiChatMessage[] {
  const duration = options.durationSeconds.toFixed(2)
  const modeGuidance = PROMPT_OPTIMIZATION_MODE_DESCRIPTIONS[options.mode]

  return [
    {
      role: 'system',
      content: options.settings.promptOptimizerSystemPrompt,
    },
    {
      role: 'user',
      content: [
        `输入模式：${options.mode}`,
        `目标视频时长：${duration} 秒`,
        `模式说明：${modeGuidance}`,
        '',
        '用户原始描述：',
        description.trim(),
        '',
        '请在不改变用户意图的前提下补足可执行的视听细节，并严格按系统消息要求返回中英文两版 JSON。',
      ].join('\n'),
    },
  ]
}

export function parsePromptOptimizationResponse(content: string): OptimizedPromptResult {
  const normalized = stripMarkdownFence(content.trim())
  const parsed = parseJsonObject(normalized)
  const candidate = getResultCandidate(parsed)

  const chinesePrompt = readString(candidate, [
    'chinesePrompt',
    'chinese_prompt',
    'zhPrompt',
    'zh_prompt',
  ])
  const englishPrompt = readString(candidate, [
    'englishPrompt',
    'english_prompt',
    'enPrompt',
    'en_prompt',
  ])

  if (!chinesePrompt || !englishPrompt) {
    throw new Error('模型返回的中英文提示词不完整，请重试或检查提示词优化系统提示词')
  }

  return {
    chinesePrompt,
    englishPrompt,
  }
}

function stripMarkdownFence(content: string): string {
  const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() || content
}

function parseJsonObject(content: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(content))
  } catch {
    const firstBrace = content.indexOf('{')
    const lastBrace = content.lastIndexOf('}')

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return asRecord(JSON.parse(content.slice(firstBrace, lastBrace + 1)))
      } catch {
        // Fall through to the user-facing error below.
      }
    }
  }

  throw new Error('模型未按要求返回 JSON，请重试或调整提示词优化系统提示词')
}

function getResultCandidate(parsed: Record<string, unknown>): Record<string, unknown> {
  const nested = parsed.result
  return isRecord(nested) ? nested : parsed
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('模型返回的 JSON 不是对象')
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
