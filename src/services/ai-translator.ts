import { requestAiChatCompletion } from './ai-client'
import type { AiChatMessage, AiSettings, TranslationStrategy } from './ai-types'

export interface TranslateTextOptions {
  settings: AiSettings
  strategy?: TranslationStrategy
  fallbackToParagraphsOnFailure?: boolean
  onProgress?: (message: string) => void
}

export interface TranslateTextResult {
  text: string
  paragraphs: string[]
  strategyUsed: TranslationStrategy
}

export async function translateTextWithAi(
  text: string,
  options: TranslateTextOptions,
): Promise<TranslateTextResult> {
  const source = text.trim()

  if (!source) {
    throw new Error('请输入待翻译内容')
  }

  const strategy = options.strategy ?? options.settings.defaultTranslationStrategy

  if (strategy === 'paragraph-by-paragraph') {
    return translateParagraphs(source, options)
  }

  try {
    return await translateWholeDocument(source, options)
  } catch (error) {
    if (!options.fallbackToParagraphsOnFailure) {
      throw error
    }

    options.onProgress?.('整页翻译失败，正在切换为逐段翻译...')
    return translateParagraphs(source, options)
  }
}

export function buildTranslationMessages(
  text: string,
  settings: AiSettings,
  singleParagraph: boolean,
  retryWithoutEcho = false,
): AiChatMessage[] {
  const targetLanguage = settings.defaultTargetLanguage || '中文'
  const systemParts = [
    settings.systemPrompt,
    `将用户提供的文本翻译成${targetLanguage}。`,
    '保留原文的段落、换行、列表、Markdown 或代码块结构。',    '输入文本可能包含内联 HTML 标签（如 <a>、<span>、<b> 等），请务必在译文中严格保留所有这些标签及其属性、并保持其原有相对位置结构，只翻译标签开头以及标签之间的可见纯文本内容。',    '只输出译文，不要解释，不要添加标题、备注或额外说明。',
    '绝对不要重复、复制、附带或夹带原文。输出中禁止出现未翻译的原文段落，除非是必须保留的代码、标识符或专有格式片段。',
  ].filter(Boolean)

  const retryNotice = retryWithoutEcho
    ? '你上一条回答错误地包含了原文。这次只返回译文正文，不要重复原文，不要做双语对照。\n\n'
    : ''
  const userPrompt = singleParagraph
    ? `${retryNotice}请翻译下面这一段内容，保持原意与格式，只返回译文：\n\n${text}`
    : `${retryNotice}请翻译下面的完整内容，并尽量保持原有段落结构，只返回译文：\n\n${text}`

  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: userPrompt },
  ]
}

export function sanitizeTranslationOutput(source: string, output: string): string {
  let candidate = output.trim()
  const trimmedSource = source.trim()

  if (!candidate) {
    return ''
  }

  if (candidate.startsWith(trimmedSource)) {
    candidate = candidate.slice(trimmedSource.length).trimStart()
    candidate = candidate.replace(/^[:：\-\n\s]+/, '').trim()
  }

  const sourceParagraphs = splitParagraphs(source)
  const outputParagraphs = splitParagraphs(candidate)
  let leadingEchoCount = 0

  while (
    leadingEchoCount < sourceParagraphs.length &&
    leadingEchoCount < outputParagraphs.length &&
    normalizeComparableText(sourceParagraphs[leadingEchoCount]) ===
      normalizeComparableText(outputParagraphs[leadingEchoCount])
  ) {
    leadingEchoCount += 1
  }

  if (leadingEchoCount > 0) {
    const stripped = outputParagraphs.slice(leadingEchoCount).join('\n\n').trim()
    if (stripped) {
      candidate = stripped
    }
  }

  return candidate.trim()
}

export function looksLikeSourceEcho(
  source: string,
  output: string,
  singleParagraph: boolean,
): boolean {
  const normalizedSource = normalizeComparableText(source)
  const normalizedOutput = normalizeComparableText(output)

  if (!normalizedOutput) {
    return true
  }

  if (normalizedOutput === normalizedSource) {
    return true
  }

  if (!singleParagraph && normalizedOutput.startsWith(normalizedSource)) {
    return true
  }

  const sourceParagraphs = splitParagraphs(source)
  const outputParagraphs = splitParagraphs(output)
  let sharedLeadingParagraphs = 0

  while (
    sharedLeadingParagraphs < sourceParagraphs.length &&
    sharedLeadingParagraphs < outputParagraphs.length &&
    normalizeComparableText(sourceParagraphs[sharedLeadingParagraphs]) ===
      normalizeComparableText(outputParagraphs[sharedLeadingParagraphs])
  ) {
    sharedLeadingParagraphs += 1
  }

  return singleParagraph ? sharedLeadingParagraphs > 0 : sharedLeadingParagraphs >= 1
}

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

async function translateWholeDocument(
  text: string,
  options: TranslateTextOptions,
): Promise<TranslateTextResult> {
  options.onProgress?.('正在整块翻译，请稍候...')
  const cleaned = await requestTranslatedContent(text, options.settings, false)

  return {
    text: cleaned,
    paragraphs: splitParagraphs(cleaned),
    strategyUsed: 'whole-document',
  }
}

async function translateParagraphs(
  text: string,
  options: TranslateTextOptions,
): Promise<TranslateTextResult> {
  const paragraphs = splitParagraphs(text)
  if (paragraphs.length === 0) {
    throw new Error('未识别到可翻译的段落')
  }

  const results: string[] = []

  for (let index = 0; index < paragraphs.length; index += 1) {
    options.onProgress?.(`正在翻译第 ${index + 1} / ${paragraphs.length} 段...`)
    results.push(await requestTranslatedContent(paragraphs[index], options.settings, true))
  }

  return {
    text: results.join('\n\n'),
    paragraphs: results,
    strategyUsed: 'paragraph-by-paragraph',
  }
}

async function requestTranslatedContent(
  text: string,
  settings: AiSettings,
  singleParagraph: boolean,
): Promise<string> {
  const firstPass = await requestAiChatCompletion(
    buildTranslationMessages(text, settings, singleParagraph),
    {
      temperature: 0.2,
      timeoutMs: singleParagraph ? 60000 : 90000,
    },
  )
  const cleanedFirstPass = sanitizeTranslationOutput(text, firstPass.content)

  if (!looksLikeSourceEcho(text, cleanedFirstPass, singleParagraph)) {
    return cleanedFirstPass
  }

  const secondPass = await requestAiChatCompletion(
    buildTranslationMessages(text, settings, singleParagraph, true),
    {
      temperature: 0,
      timeoutMs: singleParagraph ? 60000 : 90000,
    },
  )
  const cleanedSecondPass = sanitizeTranslationOutput(text, secondPass.content)

  if (!cleanedSecondPass.trim()) {
    throw new Error('模型返回了空结果，请重试或调整提示词')
  }

  return cleanedSecondPass
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}