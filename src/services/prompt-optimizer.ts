import { requestAiChatCompletion } from './ai-client'
import { translateTextWithAi } from './ai-translator'
import type {
  AiChatImageUrlContentPart,
  AiChatMessage,
  AiChatTextContentPart,
  AiSettings,
} from './ai-types'

export type PromptOptimizationMode = 'T2VA' | 'I2VA' | 'FL2VA' | 'L2VA' | 'Ref2VA'

export interface OptimizePromptOptions {
  settings: AiSettings
  mode: PromptOptimizationMode
  durationSeconds: number
  referenceImages?: PromptReferenceImage[]
  onProgress?: (message: string) => void
}

export interface PromptReferenceImage {
  name: string
  dataUrl: string
  sizeBytes?: number
}

export interface PromptReferenceImageRequirement {
  min: number
  max: number
  summary: string
}

export interface OptimizedPromptResult {
  chinesePrompt: string
  englishPrompt: string
}

const H3_REVIEW_TRANSLATION_SYSTEM_PROMPT = `你正在翻译一份可直接提交给 MiniMax-H3 的英文视频提示词。请把其中的描述性英文完整翻译为简体中文审阅版，并遵守以下规则：
1. 保持原有段落、换行、字段顺序和镜头顺序，不总结、不删减、不扩写。
2. 以下结构内容必须原样保留：字段名、[Shot N]、时间戳、<Subject N>、<Picture N>、<Video N>、<Audio N>、(Sx)、<d>、<scenetrans>、<cutoff> 以及 retention marker。
3. <d> 标签内的语言标签、用户原始台词或歌词不得翻译或改写；画面中使用英文双引号包裹的原始文字也保持不变。
4. 除上述必须保留的内容外，所有叙事、动作、镜头、场景、声音和风格描述都必须翻译成简体中文，不能整段保留英文。
5. 只输出完整中文审阅版正文，不输出原文、JSON、Markdown 代码围栏、标题或解释。`

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

export const PROMPT_REFERENCE_IMAGE_REQUIREMENTS: Record<
  PromptOptimizationMode,
  PromptReferenceImageRequirement
> = {
  T2VA: { min: 0, max: 0, summary: '纯文本模式无需参考图片。' },
  I2VA: { min: 1, max: 1, summary: '需要上传 1 张首帧图片。' },
  FL2VA: { min: 2, max: 2, summary: '需要依次上传首帧和尾帧 2 张图片。' },
  L2VA: { min: 1, max: 1, summary: '需要上传 1 张尾帧图片。' },
  Ref2VA: { min: 1, max: 6, summary: '需要上传 1–6 张人物、场景或构图参考图片。' },
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

  const referenceImageError = validatePromptReferenceImages(
    options.mode,
    options.referenceImages ?? [],
  )
  if (referenceImageError) {
    throw new Error(referenceImageError)
  }

  options.onProgress?.('正在生成英文 H3 正式提示词…')
  const response = await requestAiChatCompletion(
    buildPromptOptimizationMessages(source, options),
    {
      temperature: 0.35,
      maxTokens: 6500,
      timeoutMs: options.settings.requestTimeoutMs,
      enableStreaming: false,
    },
  )

  const englishPrompt = parseEnglishPromptOptimizationResponse(response.content)

  options.onProgress?.('英文提示词已生成，正在翻译中文审阅版…')
  const translation = await translateTextWithAi(englishPrompt, {
    settings: {
      ...options.settings,
      systemPrompt: [
        options.settings.systemPrompt.trim(),
        H3_REVIEW_TRANSLATION_SYSTEM_PROMPT,
      ]
        .filter(Boolean)
        .join('\n\n'),
      defaultTargetLanguage: '简体中文',
      defaultTranslationStrategy: 'whole-document',
      enableStreaming: false,
    },
    strategy: 'whole-document',
  })
  const chinesePrompt = parseChineseReviewTranslation(englishPrompt, translation.text)

  return {
    chinesePrompt,
    englishPrompt,
  }
}

export function buildPromptOptimizationMessages(
  description: string,
  options: OptimizePromptOptions,
): AiChatMessage[] {
  const duration = options.durationSeconds.toFixed(2)
  const modeGuidance = PROMPT_OPTIMIZATION_MODE_DESCRIPTIONS[options.mode]
  const referenceImages = options.referenceImages ?? []
  const requestText = [
    `输入模式：${options.mode}`,
    `目标视频时长：${duration} 秒`,
    `模式说明：${modeGuidance}`,
    '',
    '时间轴编排要求：',
    `- 把 ${duration} 秒作为不可超出的硬边界，从 0.00 秒开始安排完整的开场、发展与收束。`,
    '- [Shot 1] 从 0.00 秒开始且不写时间戳；每个后续镜头必须写严格递增的切镜时间戳，格式为 MM:SS.mmm。',
    '- 按可用时长合理分配主体动作、摄影机运动、台词和同步声音，不得塞入在该时长内无法自然完成的事件或台词。',
    `- 最后一个动作、反应或画面落点必须在 ${duration} 秒内完成，并让结尾自然覆盖到目标时长附近。`,
    options.mode === 'FL2VA' || options.mode === 'L2VA'
      ? `- 最终参考帧必须准确对齐 ${duration} 秒，并在此前留出连续、可见的收敛过程。`
      : '- 所有切镜、台词和声音事件都必须与目标总时长一致，不得出现越界时间。',
    '',
    '用户原始描述：',
    description.trim(),
  ].join('\n')

  const userContent = referenceImages.length
    ? buildMultimodalUserContent(requestText, options.mode, referenceImages)
    : `${requestText}\n\n请在不改变用户意图的前提下补足可执行的视听细节。本阶段只生成可直接提交给 MiniMax-H3 的英文正式提示词，并严格按系统消息要求返回只含 englishPrompt 的 JSON。不要生成中文版本。`

  return [
    {
      role: 'system',
      content: options.settings.promptOptimizerSystemPrompt,
    },
    {
      role: 'user',
      content: userContent,
    },
  ]
}

export function validatePromptReferenceImages(
  mode: PromptOptimizationMode,
  referenceImages: PromptReferenceImage[],
): string | null {
  const requirement = PROMPT_REFERENCE_IMAGE_REQUIREMENTS[mode]

  if (referenceImages.length < requirement.min) {
    return `${mode} 模式${requirement.summary}`
  }

  if (referenceImages.length > requirement.max) {
    return `${mode} 模式最多支持 ${requirement.max} 张参考图片`
  }

  const invalidImageIndex = referenceImages.findIndex(
    (image) => !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(image.dataUrl),
  )
  if (invalidImageIndex >= 0) {
    return `第 ${invalidImageIndex + 1} 张参考图片格式无效，请使用 JPG、PNG 或 WebP`
  }

  return null
}

export function getPromptReferenceImageLabel(
  mode: PromptOptimizationMode,
  index: number,
): string {
  if (mode === 'I2VA') return '<Picture 1>（首帧）'
  if (mode === 'FL2VA') {
    return index === 0 ? '<Picture 1>（首帧）' : '<Picture 2>（尾帧）'
  }
  if (mode === 'L2VA') return '<Picture 1>（尾帧）'
  return `<Picture ${index + 1}>（参考图 ${index + 1}）`
}

function buildMultimodalUserContent(
  requestText: string,
  mode: PromptOptimizationMode,
  referenceImages: PromptReferenceImage[],
): Array<AiChatTextContentPart | AiChatImageUrlContentPart> {
  const parts: Array<AiChatTextContentPart | AiChatImageUrlContentPart> = [
    {
      type: 'text',
      text: [
        requestText,
        '',
        '视觉事实约束：',
        '以下图片是本次提示词改写的真实视觉依据。先逐张观察，再编写提示词。图片决定参考主体的外观、服装、物体、环境、光线、空间关系和构图；用户文字决定期望发生的动作与变化。',
        '不得把图片中不可见或无法确认的身份、品牌、材质、细节、人物特征或背景元素描述成既定事实；不得用常见模板替换图片中的真实主体。若图片与文字存在冲突，应保留用户明确要求的变化，同时准确说明它从图片中的可见初始状态如何发生。',
      ].join('\n'),
    },
  ]

  referenceImages.forEach((image, index) => {
    parts.push(
      {
        type: 'text',
        text: `${getPromptReferenceImageLabel(mode, index)}，文件名：${image.name || `picture-${index + 1}`}`,
      },
      {
        type: 'image_url',
        image_url: {
          url: image.dataUrl,
          detail: 'high',
        },
      },
    )
  })

  parts.push({
    type: 'text',
    text: '现在请以这些图片中的可见事实为锚点，在不改变用户意图的前提下补足可执行的视听细节。本阶段只生成可直接提交给 MiniMax-H3 的英文正式提示词，并严格按系统消息要求返回只含 englishPrompt 的 JSON。不要生成中文版本。',
  })

  return parts
}

export function parseEnglishPromptOptimizationResponse(content: string): string {
  const normalized = stripMarkdownFence(content.trim())
  const parsed = parseJsonObject(normalized)
  const candidate = getResultCandidate(parsed)

  const englishPrompt = readString(candidate, [
    'englishPrompt',
    'english_prompt',
    'enPrompt',
    'en_prompt',
  ])

  if (!englishPrompt) {
    throw new Error('模型未返回英文 H3 提示词，请重试或检查提示词优化系统提示词')
  }

  return englishPrompt
}

export function parseChineseReviewTranslation(
  englishPrompt: string,
  translatedContent: string,
): string {
  const chinesePrompt = stripMarkdownFence(translatedContent.trim())

  if (!chinesePrompt) {
    throw new Error('翻译模型未返回中文审阅版，请重试')
  }

  if (!looksLikeChineseTranslation(englishPrompt, chinesePrompt)) {
    throw new Error('翻译模型返回的中文审阅版仍以英文为主，请重试或检查 AI 翻译设置')
  }

  return chinesePrompt
}

function looksLikeChineseTranslation(source: string, translated: string): boolean {
  if (normalizeComparableText(source) === normalizeComparableText(translated)) {
    return false
  }

  const descriptiveText = translated
    .replace(/<d>[\s\S]*?<\/d>/gi, '')
    .replace(/"[^"\r\n]*"/g, '')
  const chineseCharacterCount = descriptiveText.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0
  const latinCharacterCount = descriptiveText.match(/[a-z]/gi)?.length ?? 0
  const languageCharacterCount = chineseCharacterCount + latinCharacterCount

  return (
    chineseCharacterCount >= 8 &&
    languageCharacterCount > 0 &&
    chineseCharacterCount / languageCharacterCount >= 0.08
  )
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
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
