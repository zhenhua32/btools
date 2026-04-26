export interface ExtractedTextBlock {
  element: HTMLElement
  html: string
}

export interface ExtractedPageContent {
  text: string
  title: string
  url: string
  rootElement: HTMLElement
  blocks: ExtractedTextBlock[]
}

const EXCLUDED_PAGE_TRANSLATE_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'SVG',
  'VIDEO',
  'AUDIO',
  'IFRAME',
  'CANVAS',
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'LABEL',
])

const STRUCTURAL_TEXT_TAGS = new Set([
  'P',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'FIGCAPTION',
  'DD',
  'DT',
  'TD',
  'TH',
])

const GENERIC_TEXT_CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN'])
const ATOMIC_CONTAINER_TAGS = new Set(['UL', 'OL', 'TABLE', 'DL'])

const HIGH_CONFIDENCE_TEXT_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, blockquote, pre, figcaption, ul, ol, table, dl'

const MAIN_ROOT_CANDIDATE_SELECTOR =
  'main, article, [role="main"], .article, .post, .content, .article-content, .post-content, .entry-content, #content, #main, div[id*="content" i], div[class*="content" i], div[class*="article" i], div[class*="post" i], div[class*="entry" i], section[id*="content" i], section[class*="content" i], section[class*="article" i], section[class*="post" i], section[class*="entry" i], main[id*="content" i], main[class*="content" i], main[class*="article" i], main[class*="post" i], main[class*="entry" i], article[id*="content" i], article[class*="content" i], article[class*="article" i], article[class*="post" i], article[class*="entry" i]'

const EXCLUDED_PAGE_TRANSLATE_HINT_PATTERN =
  /(share|social|comment|related|recommend|breadcrumb|pagination|newsletter|subscribe|advert|ads|cookie|author|byline|meta|toolbar|reaction|promo|banner|outbrain|taboola)/i

export function extractPageContentFromDocument(documentRef: Document = document): ExtractedPageContent {
  const rootElement = getPreferredMainElement(documentRef)
  const blocks = collectTranslatableBlocks(rootElement)

  return {
    text: blocks.map((block) => block.html).join('\n\n'),
    title: documentRef.title.trim() || '未命名页面',
    url: documentRef.defaultView?.location.href || '',
    rootElement,
    blocks,
  }
}

function collectTranslatableBlocks(rootElement: HTMLElement): ExtractedTextBlock[] {
  const highConfidenceBlocks = collectHighConfidenceBlocks(rootElement)
  if (isHighConfidenceCoverageEnough(highConfidenceBlocks, rootElement)) {
    return highConfidenceBlocks
  }

  const textBlocks: ExtractedTextBlock[] = []

  const walk = (element: HTMLElement): boolean => {
    if (shouldSkipPageTranslateElement(element, rootElement)) {
      return false
    }

    if (ATOMIC_CONTAINER_TAGS.has(element.tagName.toUpperCase())) {
      const html = getExtractedBlockHtml(element)
      if (html) {
        textBlocks.push({ element, html })
        return true
      }
      return false
    }

    let childCaptured = false
    for (const child of Array.from(element.children)) {
      childCaptured = walk(child as HTMLElement) || childCaptured
    }

    if (childCaptured) {
      return true
    }

    const html = getExtractedBlockHtml(element)
    if (!html) {
      return false
    }

    textBlocks.push({ element, html })
    return true
  }

  walk(rootElement)
  return textBlocks
}

function collectHighConfidenceBlocks(rootElement: HTMLElement): ExtractedTextBlock[] {
  const blocks: ExtractedTextBlock[] = []
  const candidates: HTMLElement[] = []

  if (rootElement.matches(HIGH_CONFIDENCE_TEXT_SELECTOR)) {
    candidates.push(rootElement)
  }

  candidates.push(...Array.from(rootElement.querySelectorAll<HTMLElement>(HIGH_CONFIDENCE_TEXT_SELECTOR)))

  for (const element of candidates) {
    if (shouldSkipPageTranslateElement(element, rootElement)) {
      continue
    }

    if (blocks.some((block) => block.element.contains(element))) {
      continue
    }

    const html = getExtractedBlockHtml(element)
    if (!html) {
      continue
    }

    blocks.push({ element, html })
  }

  return blocks
}

function isHighConfidenceCoverageEnough(
  blocks: ExtractedTextBlock[],
  rootElement: HTMLElement,
): boolean {
  if (blocks.length < 2) {
    return false
  }

  const rootTextLength = normalizeTextContent(rootElement.innerText || rootElement.textContent || '').length
  if (rootTextLength <= 0) {
    return false
  }

  const blockTextLength = blocks.reduce((total, block) => {
    return total + normalizeTextContent(block.element.innerText || block.element.textContent || '').length
  }, 0)
  const coverage = blockTextLength / rootTextLength

  return coverage >= 0.42 || blocks.length >= 8
}

function shouldSkipPageTranslateElement(element: HTMLElement, rootElement: HTMLElement): boolean {
  const tag = element.tagName.toUpperCase()

  if (EXCLUDED_PAGE_TRANSLATE_TAGS.has(tag)) {
    return true
  }

  if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
    return true
  }

  const documentRef = rootElement.ownerDocument
  const view = documentRef.defaultView ?? window
  const style = view.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') {
    return true
  }

  if (
    element !== rootElement &&
    (element.closest('[data-btools-page-translation]') ||
      element.closest('nav, footer, aside, form, dialog, menu, [role="navigation"], [role="complementary"], [role="search"], [role="dialog"], [role="tablist"]') ||
      (rootElement === documentRef.body &&
        element.closest('header, [role="banner"], [role="contentinfo"]')) ||
      hasExcludedSemanticContext(element, rootElement))
  ) {
    return true
  }

  return false
}

function hasExcludedSemanticContext(element: HTMLElement, rootElement: HTMLElement): boolean {
  let current: HTMLElement | null = element

  while (current && current !== rootElement) {
    if (shouldExcludeSemanticRegion(current, rootElement)) {
      return true
    }

    current = current.parentElement
  }

  return false
}

function shouldExcludeSemanticRegion(element: HTMLElement, rootElement: HTMLElement): boolean {
  if (!hasExcludedSemanticHint(element)) {
    return false
  }

  if (!element.matches('div, section, article, main, [role="main"]')) {
    return true
  }

  const rootTextLength = normalizeTextContent(rootElement.innerText || rootElement.textContent || '').length
  if (rootTextLength <= 0) {
    return true
  }

  const elementTextLength = normalizeTextContent(element.innerText || element.textContent || '').length
  return elementTextLength / rootTextLength < 0.65
}

function hasExcludedSemanticHint(element: HTMLElement): boolean {
  const semanticText = [
    element.id,
    typeof element.className === 'string' ? element.className : '',
    element.getAttribute('role') || '',
    element.getAttribute('aria-label') || '',
    element.getAttribute('data-testid') || '',
  ]
    .join(' ')
    .trim()

  return semanticText ? EXCLUDED_PAGE_TRANSLATE_HINT_PATTERN.test(semanticText) : false
}

function getExtractedBlockHtml(element: HTMLElement): string | null {
  if (!shouldUseAsTextBlock(element)) {
    return null
  }

  const html = normalizeExtractedHtml(element.innerHTML)
  return html || null
}

function shouldUseAsTextBlock(element: HTMLElement): boolean {
  const tag = element.tagName.toUpperCase()
  if (!STRUCTURAL_TEXT_TAGS.has(tag) && !GENERIC_TEXT_CONTAINER_TAGS.has(tag) && !ATOMIC_CONTAINER_TAGS.has(tag)) {
    return false
  }

  const rawText = element.innerText || element.textContent || ''
  const normalizedText = normalizeTextContent(rawText)
  if (!normalizedText) {
    return false
  }

  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length
  const hasCjk = /[\u4e00-\u9fff]/.test(normalizedText)
  const hasSentencePunctuation = /[。！？.!?;；:：]/.test(normalizedText)
  const hasLineBreak = /[\r\n]/.test(rawText)
  const linkDensity = getLinkTextDensity(element, normalizedText)

  if (linkDensity > 0.65) {
    return false
  }

  if (ATOMIC_CONTAINER_TAGS.has(tag)) {
    return normalizedText.length >= 8
  }

  if (STRUCTURAL_TEXT_TAGS.has(tag)) {
    if (tag.startsWith('H')) {
      return normalizedText.length >= 6
    }

    if (tag === 'LI') {
      return (
        normalizedText.length >= 20 ||
        wordCount >= 6 ||
        (hasSentencePunctuation && (normalizedText.length >= 12 || wordCount >= 4))
      )
    }

    return normalizedText.length >= 12 || wordCount >= 4 || (hasCjk && normalizedText.length >= 6)
  }

  if (linkDensity > 0.45 && wordCount < 12 && normalizedText.length < 80) {
    return false
  }

  return (
    normalizedText.length >= 56 ||
    wordCount >= 12 ||
    (hasSentencePunctuation && normalizedText.length >= 28) ||
    (hasCjk && normalizedText.length >= 22 && (hasSentencePunctuation || hasLineBreak))
  )
}

function getLinkTextDensity(element: HTMLElement, normalizedText: string): number {
  if (!normalizedText) {
    return 0
  }

  const linkTextLength = Array.from(element.querySelectorAll('a')).reduce((total, link) => {
    return total + normalizeTextContent(link.textContent || '').length
  }, 0)

  return linkTextLength / normalizedText.length
}

function normalizeTextContent(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeExtractedHtml(html: string): string {
  return html.trim().replace(/\n\s*\n+/g, '\n')
}

function getPreferredMainElement(documentRef: Document): HTMLElement {
  const body = documentRef.body
  if (!body) {
    return documentRef.documentElement as HTMLElement
  }

  const bodyTextLength = normalizeTextContent(body.innerText || body.textContent || '').length

  const candidates = Array.from(documentRef.querySelectorAll<HTMLElement>(MAIN_ROOT_CANDIDATE_SELECTOR))
    .map((element) => {
      const { score, textLength } = scoreMainElementCandidate(element, bodyTextLength)
      return { element, score, textLength }
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)

  const bestCandidate = candidates[0]
  if (bestCandidate && bestCandidate.textLength >= 260) {
    return bestCandidate.element
  }

  return body
}

function scoreMainElementCandidate(
  element: HTMLElement,
  bodyTextLength: number,
): { score: number; textLength: number } {
  const normalizedText = normalizeTextContent(element.innerText || element.textContent || '')
  const textLength = normalizedText.length

  if (textLength < 220) {
    return { score: -1, textLength }
  }

  if (hasExcludedSemanticHint(element)) {
    return { score: -1, textLength }
  }

  const coverageRatio = bodyTextLength > 0 ? textLength / bodyTextLength : 1
  if (coverageRatio > 0.98) {
    return { score: -1, textLength }
  }

  const linkDensity = getLinkTextDensity(element, normalizedText)
  if (linkDensity > 0.58) {
    return { score: -1, textLength }
  }

  const paragraphLikeCount = Math.min(
    20,
    element.querySelectorAll('p, h1, h2, h3, blockquote, pre, li').length,
  )
  const semanticBoost = element.matches('main, article, [role="main"]') ? 220 : 0
  const coveragePenalty = Math.max(0, coverageRatio - 0.72) * 700

  return {
    score: textLength + paragraphLikeCount * 24 + semanticBoost - linkDensity * 320 - coveragePenalty,
    textLength,
  }
}