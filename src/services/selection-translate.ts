export interface SelectionTranslationSnapshot {
  text: string
  html?: string
  startPath: number[]
  endPath: number[]
  startOffset: number
  endOffset: number
  normalizedText: string
  originalStructureSignature: string
  allowedAttributes: Record<string, Record<string, string[]>>
}

export interface ApplySelectionTranslationResult {
  applied: boolean
  method: 'html' | 'text' | 'preview-only'
  previewText: string
  message: string
}

export function captureSelectionSnapshot(
  documentRef: Document = document,
): SelectionTranslationSnapshot {
  const selection = documentRef.defaultView?.getSelection()
  if (!selection || selection.rangeCount === 0) {
    throw new Error('请先选中需要翻译的文本')
  }

  const range = selection.getRangeAt(0)
  if (range.collapsed) {
    throw new Error('请先选中需要翻译的文本')
  }

  const text = selection.toString().trim()
  if (!text) {
    throw new Error('请先选中需要翻译的文本')
  }

  const fragment = range.cloneContents()
  const root = documentRef.documentElement

  return {
    text,
    html: hasElementChildren(fragment) ? fragmentToHtml(fragment, documentRef) || undefined : undefined,
    startPath: getNodePath(root, range.startContainer),
    endPath: getNodePath(root, range.endContainer),
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    normalizedText: normalizeComparableText(text),
    originalStructureSignature: buildStructureSignature(fragment),
    allowedAttributes: collectAllowedAttributes(fragment),
  }
}

export function applySelectionTranslation(
  snapshot: SelectionTranslationSnapshot,
  options: {
    translatedText?: string
    translatedHtml?: string
    documentRef?: Document
  },
): ApplySelectionTranslationResult {
  const documentRef = options.documentRef ?? document
  const previewText = getSelectionPreviewText(options.translatedText, options.translatedHtml, documentRef)

  const range = restoreSelectionRange(snapshot, documentRef)
  if (!range) {
    return {
      applied: false,
      method: 'preview-only',
      previewText,
      message: '选区已失效，未回写原网页内容',
    }
  }

  if (normalizeComparableText(range.toString()) !== snapshot.normalizedText) {
    return {
      applied: false,
      method: 'preview-only',
      previewText,
      message: '选区内容已变化，未回写原网页内容',
    }
  }

  if (snapshot.html && options.translatedHtml?.trim()) {
    const sanitized = sanitizeTranslatedHtml(snapshot, options.translatedHtml, documentRef)
    if (sanitized.fragment && sanitized.structureMatched) {
      const htmlRange = restoreSelectionRange(snapshot, documentRef)
      if (htmlRange) {
        htmlRange.deleteContents()
        htmlRange.insertNode(sanitized.fragment)
        normalizeRangeParent(htmlRange)

        return {
          applied: true,
          method: 'html',
          previewText: sanitized.previewText || previewText,
          message: '已回写选中内容，并尽量保留原有标签结构',
        }
      }
    }
  }

  const textRange = restoreSelectionRange(snapshot, documentRef)
  if (!textRange || !previewText) {
    return {
      applied: false,
      method: 'preview-only',
      previewText,
      message: '无法安全回写原网页内容，仅展示译文',
    }
  }

  replaceRangeWithText(textRange, previewText)
  normalizeRangeParent(textRange)

  return {
    applied: true,
    method: 'text',
    previewText,
    message: snapshot.html
      ? '已降级为纯文本回写，原有标签结构未全部保留'
      : '已回写选中内容',
  }
}

export function getSelectionPreviewText(
  translatedText?: string,
  translatedHtml?: string,
  documentRef: Document = document,
): string {
  const htmlText = translatedHtml ? extractPlainTextFromHtml(translatedHtml, documentRef) : ''
  return (htmlText || translatedText || '').trim()
}

function restoreSelectionRange(
  snapshot: SelectionTranslationSnapshot,
  documentRef: Document,
): Range | null {
  const root = documentRef.documentElement
  const startContainer = getNodeByPath(root, snapshot.startPath)
  const endContainer = getNodeByPath(root, snapshot.endPath)
  if (!startContainer || !endContainer) {
    return null
  }

  const range = documentRef.createRange()

  try {
    range.setStart(startContainer, clampOffset(startContainer, snapshot.startOffset))
    range.setEnd(endContainer, clampOffset(endContainer, snapshot.endOffset))
    return range
  } catch {
    return null
  }
}

function clampOffset(node: Node, offset: number): number {
  const maxOffset = node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length
  return Math.max(0, Math.min(offset, maxOffset))
}

function getNodePath(root: Node, node: Node): number[] {
  const path: number[] = []
  let current: Node | null = node

  while (current && current !== root) {
    const parent: Node | null = current.parentNode
    if (!parent) {
      throw new Error('无法记录当前选区位置')
    }

    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current))
    current = parent
  }

  if (current !== root) {
    throw new Error('无法记录当前选区位置')
  }

  return path
}

function getNodeByPath(root: Node, path: number[]): Node | null {
  let current: Node | null = root

  for (const index of path) {
    if (!current || index < 0 || index >= current.childNodes.length) {
      return null
    }
    current = current.childNodes[index]
  }

  return current
}

function sanitizeTranslatedHtml(
  snapshot: SelectionTranslationSnapshot,
  translatedHtml: string,
  documentRef: Document,
): {
  fragment: DocumentFragment | null
  previewText: string
  structureMatched: boolean
} {
  const template = documentRef.createElement('template')
  template.innerHTML = translatedHtml
  const fragment = template.content.cloneNode(true) as DocumentFragment

  sanitizeTree(fragment, snapshot.allowedAttributes)

  return {
    fragment,
    previewText: getFragmentPlainText(fragment),
    structureMatched: buildStructureSignature(fragment) === snapshot.originalStructureSignature,
  }
}

function sanitizeTree(
  root: DocumentFragment | Element,
  allowedAttributes: Record<string, Record<string, string[]>>,
): void {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.parentNode?.removeChild(child)
      continue
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue
    }

    const element = child as Element
    sanitizeTree(element, allowedAttributes)

    const tagName = element.tagName.toUpperCase()
    const allowedForTag = allowedAttributes[tagName]
    if (!allowedForTag) {
      unwrapElement(element)
      continue
    }

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase()
      const allowedValues = allowedForTag[attributeName] ?? []

      if (attributeName.startsWith('on')) {
        element.removeAttribute(attribute.name)
        continue
      }

      if (allowedValues.length === 0) {
        element.removeAttribute(attribute.name)
        continue
      }

      if (isUrlAttribute(attributeName)) {
        const safeValue = findSafeAllowedUrlValue(allowedValues, attribute.value)
        if (safeValue) {
          element.setAttribute(attribute.name, safeValue)
        } else {
          element.removeAttribute(attribute.name)
        }
        continue
      }

      if (!allowedValues.includes(attribute.value)) {
        element.setAttribute(attribute.name, allowedValues[0])
      }
    }
  }
}

function unwrapElement(element: Element): void {
  const parent = element.parentNode
  if (!parent) {
    return
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }

  parent.removeChild(element)
}

function findSafeAllowedUrlValue(allowedValues: string[], currentValue: string): string | null {
  if (allowedValues.includes(currentValue) && isSafeUrlValue(currentValue)) {
    return currentValue
  }

  return allowedValues.find((value) => isSafeUrlValue(value)) ?? null
}

function isSafeUrlValue(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return !normalized.startsWith('javascript:')
}

function isUrlAttribute(attributeName: string): boolean {
  return attributeName === 'href' || attributeName === 'src' || attributeName === 'xlink:href'
}

function collectAllowedAttributes(fragment: DocumentFragment): Record<string, Record<string, string[]>> {
  const allowedAttributes: Record<string, Record<string, string[]>> = {}

  for (const element of Array.from(fragment.querySelectorAll('*'))) {
    const tagName = element.tagName.toUpperCase()
    const target = (allowedAttributes[tagName] ??= {})

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase()
      const values = (target[attributeName] ??= [])
      if (!values.includes(attribute.value)) {
        values.push(attribute.value)
      }
    }
  }

  return allowedAttributes
}

function replaceRangeWithText(range: Range, text: string): void {
  if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = range.startContainer as Text
    const before = textNode.data.slice(0, range.startOffset)
    const after = textNode.data.slice(range.endOffset)
    textNode.data = `${before}${text}${after}`
    return
  }

  range.deleteContents()
  const documentRef = range.startContainer.ownerDocument ?? document
  range.insertNode(documentRef.createTextNode(text))
}

function normalizeRangeParent(range: Range): void {
  const container =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement

  container?.normalize()
}

function hasElementChildren(fragment: DocumentFragment): boolean {
  return Array.from(fragment.childNodes).some((node) => node.nodeType === Node.ELEMENT_NODE)
}

function fragmentToHtml(fragment: DocumentFragment, documentRef: Document): string {
  const wrapper = documentRef.createElement('div')
  wrapper.appendChild(fragment.cloneNode(true))
  return normalizeFragmentHtml(wrapper.innerHTML)
}

function extractPlainTextFromHtml(html: string, documentRef: Document): string {
  const template = documentRef.createElement('template')
  template.innerHTML = html
  return getFragmentPlainText(template.content)
}

function getFragmentPlainText(fragment: DocumentFragment): string {
  return (fragment.textContent || '').replace(/\s+/g, ' ').trim()
}

function normalizeFragmentHtml(html: string): string {
  return html.trim().replace(/\n\s*\n+/g, '\n')
}

function buildStructureSignature(root: DocumentFragment): string {
  return Array.from(root.childNodes)
    .map((node) => buildNodeSignature(node))
    .filter(Boolean)
    .join('|')
}

function buildNodeSignature(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.trim() ? 'T' : ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const element = node as Element
  const children = Array.from(element.childNodes)
    .map((child) => buildNodeSignature(child))
    .filter(Boolean)
    .join(',')
  return `${element.tagName.toUpperCase()}(${children})`
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}