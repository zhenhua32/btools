import {
  extractPageContentFromDocument,
  type ExtractedPageContent,
} from '@/services/page-translate-extractor'
import {
  applySelectionTranslation,
  captureSelectionSnapshot,
  type SelectionTranslationSnapshot,
} from '@/services/selection-translate'
import { getAiSettings } from '@/services/ai-settings'
import {
  PAGE_TRANSLATE_SELECTION_SUBMIT_MESSAGE_TYPE,
  PAGE_TRANSLATE_SUBMIT_MESSAGE_TYPE,
  type PageTranslateMode,
  type PageTranslateSelectionSubmitMessage,
  type PageTranslateStatusMessage,
  type PageTranslateSubmitMessage,
  type TranslationStrategy,
  isPageTranslateStartMessage,
  isPageTranslateStatusMessage,
} from '@/services/ai-types'

interface OverlaySuccessState {
  title: string
  url: string
  translatedText: string
  paragraphs?: string[]
  targetLanguage: string
  strategyUsed: TranslationStrategy
  mode: PageTranslateMode
  operationMessage?: string
}

interface PageTranslateRuntimeState {
  activeRequestId: string
  overlay: ReturnType<typeof createTranslationOverlay>
  nodeElementsMap?: HTMLElement[]
  selectionSnapshot?: SelectionTranslationSnapshot
}

const globalScope = globalThis as typeof globalThis & {
  __btoolsPageTranslateInitialized?: boolean
  __btoolsPageTranslateState?: PageTranslateRuntimeState
  __btoolsPageTranslateStart?: (requestId: string) => void
  __btoolsPageTranslateSelectionStart?: (requestId: string) => void
}

if (!globalScope.__btoolsPageTranslateState) {
  const state: PageTranslateRuntimeState = {
    activeRequestId: '',
    overlay: createTranslationOverlay({
      onClose: () => {
        state.activeRequestId = ''
        state.selectionSnapshot = undefined
        state.nodeElementsMap = undefined
      },
    }),
  }

  globalScope.__btoolsPageTranslateState = state
}

const runtimeState = globalScope.__btoolsPageTranslateState

globalScope.__btoolsPageTranslateStart = (requestId: string) => {
  runtimeState.activeRequestId = requestId
  runtimeState.selectionSnapshot = undefined
  void beginPageTranslation(runtimeState, requestId)
}

globalScope.__btoolsPageTranslateSelectionStart = (requestId: string) => {
  runtimeState.activeRequestId = requestId
  runtimeState.nodeElementsMap = undefined
  void beginSelectionTranslation(runtimeState, requestId)
}

if (!globalScope.__btoolsPageTranslateInitialized) {
  globalScope.__btoolsPageTranslateInitialized = true

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (isPageTranslateStartMessage(message)) {
      globalScope.__btoolsPageTranslateStart?.(message.payload.requestId)
      return false
    }

    if (
      isPageTranslateStatusMessage(message) &&
      message.payload.requestId === runtimeState.activeRequestId
    ) {
      handlePageTranslateStatus(runtimeState, message)
    }

    return false
  })

  document.addEventListener('mouseup', async (event) => {
    // 忽略在浮层内部的点选
    const target = event.target as HTMLElement
    if (target?.closest?.('[data-btools-page-translation="true"]')) {
      return
    }

    const selection = window.getSelection()
    const text = selection?.toString().trim()
    console.log('[BTools] mouseup', { text, ctrlKey: event.ctrlKey, metaKey: event.metaKey })

    if (!text || selection?.isCollapsed) {
      hideSelectionFloatButton()
      return
    }

    const settings = await getAiSettings()
    console.log('[BTools] settings', { enableCtrlSelection: settings.enableCtrlSelection, enableSelectionButton: settings.enableSelectionButton })

    // 若配置开启且按住了 CTRL/CMD 键，则直接翻译
    if (settings.enableCtrlSelection && (event.ctrlKey || event.metaKey)) {
      hideSelectionFloatButton()
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      globalScope.__btoolsPageTranslateSelectionStart?.(requestId)
      return
    }

    // 若配置开启，显示悬浮按钮
    if (settings.enableSelectionButton) {
      showSelectionFloatButton(event, () => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        globalScope.__btoolsPageTranslateSelectionStart?.(requestId)
      })
    } else {
      hideSelectionFloatButton()
    }
  })

  // 当选取发生任何非结束调整时，尝试清理弹窗或隐藏，这要看需不需要，暂时让 mousedown/selectionchange 隐藏
  document.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement
    if (!target?.closest?.('[data-btools-page-translation="true"]')) {
      hideSelectionFloatButton()
    }
  })
}

// ============== 选区悬浮按钮 DOM 管理 ================
let floatButtonHost: HTMLElement | null = null

function getOrCreateFloatButton(): HTMLElement {
  if (floatButtonHost) {
    return floatButtonHost
  }

  floatButtonHost = document.createElement('div')
  floatButtonHost.setAttribute('data-btools-page-translation', 'true')
  const shadowRoot = floatButtonHost.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    :host {
      all: initial;
    }
    .selection-btn {
      position: absolute;
      z-index: 2147483647;
      display: none;
      align-items: center;
      justify-content: center;
      background: #0ea5e9;
      color: #fff;
      font-size: 13px;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(14, 165, 233, 0.4);
      user-select: none;
      transition: all 0.2s ease-out;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .selection-btn:hover {
      background: #0284c7;
      transform: translateY(-1px);
    }
    .selection-btn.visible {
      display: flex;
    }
    .icon {
      margin-right: 4px;
      width: 14px;
      height: 14px;
      fill: currentColor;
    }
  `

  const btn = document.createElement('div')
  btn.className = 'selection-btn'
  btn.innerHTML = `
    <svg class="icon" viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04M18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12m-2.62 7l1.62-4.33L19.12 17h-3.24Z"/></svg>
    翻译
`

  shadowRoot.appendChild(style)
  shadowRoot.appendChild(btn)
  
  if (document.body) {
    document.body.appendChild(floatButtonHost)
  } else {
    document.documentElement.appendChild(floatButtonHost)
  }

  return floatButtonHost
}

let onFloatButtonClick: ((e: Event) => void) | null = null

function showSelectionFloatButton(event: MouseEvent, onClick: () => void) {
  const host = getOrCreateFloatButton()
  const btn = host.shadowRoot?.querySelector('.selection-btn') as HTMLElement
  if (!btn) return

  // 计算位置：鼠标正下方一点点，防止挡住选区
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  
  // 综合考虑鼠标位置和选区位置
  const top = window.scrollY + Math.max(event.clientY + 12, rect.bottom + 8)
  const left = window.scrollX + event.clientX

  btn.style.top = `${top}px`
  btn.style.left = `${left}px`
  btn.classList.add('visible')

  onFloatButtonClick = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    hideSelectionFloatButton()
    onClick()
  }
  
  btn.onmousedown = (e) => e.stopPropagation() // 防止触发全局 mousedown 而自己消失
  btn.onclick = onFloatButtonClick
}

function hideSelectionFloatButton() {
  if (!floatButtonHost) return
  const btn = floatButtonHost.shadowRoot?.querySelector('.selection-btn')
  if (btn) {
    btn.classList.remove('visible')
    if (onFloatButtonClick) {
      btn.removeEventListener('click', onFloatButtonClick)
      onFloatButtonClick = null
    }
  }
}

async function beginPageTranslation(
  runtimeState: PageTranslateRuntimeState,
  requestId: string,
): Promise<void> {
  runtimeState.overlay.show()
  runtimeState.overlay.setLoading('正在读取页面正文...')

  try {
    const extracted = extractPageContent(runtimeState)
    if (requestId !== runtimeState.activeRequestId) {
      return
    }

    if (!extracted.text.trim()) {
      runtimeState.overlay.setError('当前页面没有可翻译的正文内容')
      return
    }

    runtimeState.overlay.setMeta(extracted.title, extracted.url)
    submitPageContent({
      type: PAGE_TRANSLATE_SUBMIT_MESSAGE_TYPE,
      payload: {
        requestId,
        text: extracted.text,
        title: extracted.title,
        url: extracted.url,
      },
    })
  } catch (error) {
    if (requestId !== runtimeState.activeRequestId) {
      return
    }

    runtimeState.overlay.setError(error instanceof Error ? error.message : '读取页面正文失败')
  }
}

async function beginSelectionTranslation(
  runtimeState: PageTranslateRuntimeState,
  requestId: string,
): Promise<void> {
  runtimeState.overlay.show()
  runtimeState.overlay.setLoading('正在读取选中内容...')

  try {
    const snapshot = captureSelectionSnapshot(document)
    if (requestId !== runtimeState.activeRequestId) {
      return
    }

    runtimeState.selectionSnapshot = snapshot
    runtimeState.overlay.setMeta(document.title.trim() || '未命名页面', window.location.href)

    submitPageContent({
      type: PAGE_TRANSLATE_SELECTION_SUBMIT_MESSAGE_TYPE,
      payload: {
        requestId,
        text: snapshot.text,
        html: snapshot.html,
        title: document.title.trim() || '未命名页面',
        url: window.location.href,
      },
    })
  } catch (error) {
    if (requestId !== runtimeState.activeRequestId) {
      return
    }

    runtimeState.overlay.setError(error instanceof Error ? error.message : '读取选中内容失败')
  }
}

function handlePageTranslateStatus(
  runtimeState: PageTranslateRuntimeState,
  message: PageTranslateStatusMessage,
): void {
  if (message.payload.status === 'loading') {
    runtimeState.overlay.setLoading(message.payload.message)
    return
  }

  if (message.payload.status === 'error') {
    if (message.payload.mode === 'selection') {
      runtimeState.selectionSnapshot = undefined
    }
    runtimeState.overlay.setError(message.payload.message)
    return
  }

  if (message.payload.status === 'success') {
    if (message.payload.mode === 'selection') {
      const applyResult = runtimeState.selectionSnapshot
        ? applySelectionTranslation(runtimeState.selectionSnapshot, {
            translatedText: message.payload.translatedText,
            translatedHtml: message.payload.translatedHtml,
            documentRef: document,
          })
        : {
            applied: false,
            method: 'preview-only' as const,
            previewText: message.payload.translatedText,
            message: '未找到原始选区，仅展示译文',
          }

      runtimeState.selectionSnapshot = undefined
      window.getSelection()?.removeAllRanges()

      runtimeState.overlay.setSuccess({
        title: message.payload.title,
        url: message.payload.url,
        translatedText: applyResult.previewText || message.payload.translatedText,
        targetLanguage: message.payload.targetLanguage,
        strategyUsed: message.payload.strategyUsed,
        mode: message.payload.mode,
        operationMessage: applyResult.message,
      })
      return
    }

    if (
      message.payload.strategyUsed === 'paragraph-by-paragraph' &&
      message.payload.paragraphs &&
      runtimeState.nodeElementsMap &&
      message.payload.paragraphs.length === runtimeState.nodeElementsMap.length
    ) {
      const { paragraphs } = message.payload
      const { nodeElementsMap } = runtimeState
      for (let i = 0; i < nodeElementsMap.length; i++) {
        nodeElementsMap[i].innerHTML = paragraphs[i]
      }
    }

    runtimeState.overlay.setSuccess({
      title: message.payload.title,
      url: message.payload.url,
      translatedText: message.payload.translatedText,
      paragraphs: message.payload.paragraphs,
      targetLanguage: message.payload.targetLanguage,
      strategyUsed: message.payload.strategyUsed,
      mode: message.payload.mode,
    })
  }
}

function extractPageContent(runtimeState: PageTranslateRuntimeState): ExtractedPageContent {
  const extracted = extractPageContentFromDocument(document)
  runtimeState.nodeElementsMap = extracted.blocks.map((block) => block.element)
  runtimeState.selectionSnapshot = undefined
  return extracted
}

function submitPageContent(
  message: PageTranslateSubmitMessage | PageTranslateSelectionSubmitMessage,
): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError
  })
}

function createTranslationOverlay(options: { onClose: () => void }) {
  const host = document.createElement('div')
  host.setAttribute('data-btools-page-translation', 'true')
  const shadowRoot = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    :host {
      all: initial;
    }

    .panel {
      position: fixed;
      top: 20px;
      right: 20px;
      width: min(520px, calc(100vw - 24px));
      max-height: calc(100vh - 40px);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483647;
      color: #102a43;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      border-radius: 20px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      background:
        radial-gradient(circle at top right, rgba(14, 165, 233, 0.18), transparent 38%),
        linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(255, 255, 255, 0.96));
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.22);
      backdrop-filter: blur(16px);
    }

    .panel.visible {
      display: flex;
    }

    .header {
      padding: 18px 18px 14px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      background: linear-gradient(135deg, rgba(240, 249, 255, 0.92), rgba(255, 255, 255, 0.74));
    }

    .eyebrow {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      font-size: 12px;
      letter-spacing: 0.04em;
      color: #486581;
      text-transform: uppercase;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(14, 165, 233, 0.12);
      color: #075985;
      font-weight: 700;
      text-transform: none;
      letter-spacing: 0;
    }

    .title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .title {
      margin: 0;
      font-size: 18px;
      line-height: 1.35;
      font-weight: 700;
      color: #0f172a;
      word-break: break-word;
    }

    .close {
      flex: 0 0 auto;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.16);
      color: #334155;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }

    .close:hover {
      background: rgba(148, 163, 184, 0.24);
    }

    .url {
      margin-top: 8px;
      font-size: 12px;
      color: #64748b;
      word-break: break-all;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
      font-size: 13px;
      color: #334155;
      background: rgba(255, 255, 255, 0.72);
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    }

    .spinner {
      width: 15px;
      height: 15px;
      border-radius: 999px;
      border: 2px solid rgba(14, 165, 233, 0.18);
      border-top-color: #0284c7;
      animation: spin 0.8s linear infinite;
      flex: 0 0 auto;
    }

    .spinner.hidden {
      display: none;
    }

    .body {
      padding: 18px;
      overflow: auto;
      white-space: pre-wrap;
      line-height: 1.72;
      font-size: 14px;
      color: #0f172a;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(248, 250, 252, 0.98));
    }

    .body.loading {
      color: #475569;
      font-style: italic;
    }

    .body.error {
      color: #b91c1c;
      font-style: normal;
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px 18px;
      border-top: 1px solid rgba(148, 163, 184, 0.14);
      background: rgba(255, 255, 255, 0.78);
    }

    .footer-meta {
      font-size: 12px;
      color: #64748b;
    }

    .copy {
      border: 0;
      border-radius: 999px;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      color: #fff;
      background: linear-gradient(135deg, #0284c7, #0f766e);
      box-shadow: 0 10px 20px rgba(2, 132, 199, 0.2);
    }

    .copy:disabled {
      cursor: not-allowed;
      opacity: 0.45;
      box-shadow: none;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @media (max-width: 640px) {
      .panel {
        top: 12px;
        right: 12px;
        left: 12px;
        width: auto;
        max-height: calc(100vh - 24px);
      }
    }
  `

  const panel = document.createElement('section')
  panel.className = 'panel'

  const header = document.createElement('header')
  header.className = 'header'

  const eyebrow = document.createElement('div')
  eyebrow.className = 'eyebrow'
  eyebrow.textContent = 'BTools 页面翻译'

  const badge = document.createElement('span')
  badge.className = 'badge'
  badge.textContent = '等待开始'
  eyebrow.appendChild(badge)

  const titleRow = document.createElement('div')
  titleRow.className = 'title-row'

  const title = document.createElement('h2')
  title.className = 'title'
  title.textContent = '准备翻译当前网页'

  const closeButton = document.createElement('button')
  closeButton.className = 'close'
  closeButton.type = 'button'
  closeButton.textContent = '×'

  const url = document.createElement('div')
  url.className = 'url'

  titleRow.append(title, closeButton)
  header.append(eyebrow, titleRow, url)

  const status = document.createElement('div')
  status.className = 'status'

  const spinner = document.createElement('div')
  spinner.className = 'spinner hidden'

  const statusText = document.createElement('div')
  statusText.textContent = '等待翻译请求...'

  status.append(spinner, statusText)

  const body = document.createElement('div')
  body.className = 'body loading'
  body.textContent = '右键页面后选择“用 BTools AI 翻译全文”即可开始。'

  const footer = document.createElement('footer')
  footer.className = 'footer'

  const footerMeta = document.createElement('div')
  footerMeta.className = 'footer-meta'

  const copyButton = document.createElement('button')
  copyButton.className = 'copy'
  copyButton.type = 'button'
  copyButton.textContent = '复制译文'
  copyButton.disabled = true

  footer.append(footerMeta, copyButton)
  panel.append(header, status, body, footer)
  shadowRoot.append(style, panel)

  let translatedText = ''
  let startTime = 0
  let timerInterval: number | null = null

  closeButton.addEventListener('click', () => {
    panel.classList.remove('visible')
    if (timerInterval) clearInterval(timerInterval)
    timerInterval = null
    startTime = 0
    options.onClose()
  })

  copyButton.addEventListener('click', async () => {
    if (!translatedText.trim()) {
      return
    }

    await copyText(translatedText)
    copyButton.textContent = '已复制'
    window.setTimeout(() => {
      copyButton.textContent = '复制译文'
    }, 1500)
  })

  return {
    show() {
      if (!host.isConnected) {
        document.documentElement.appendChild(host)
      }
      panel.classList.add('visible')
    },
    setMeta(pageTitle: string, pageUrl: string) {
      title.textContent = pageTitle || '未命名页面'
      url.textContent = pageUrl
    },
    setLoading(message: string) {
      translatedText = ''
      badge.textContent = '翻译中'
      statusText.textContent = message
      spinner.classList.remove('hidden')
      body.className = 'body loading'
      body.textContent = message
      copyButton.disabled = true

      if (!startTime) {
        startTime = performance.now()
        timerInterval = window.setInterval(() => {
          const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
          footerMeta.textContent = `耗时: ${elapsed}s`
        }, 100)
      }
    },
    setError(message: string) {
      translatedText = ''
      badge.textContent = '失败'
      statusText.textContent = '翻译未完成'
      spinner.classList.add('hidden')
      body.className = 'body error'
      body.textContent = message
      footerMeta.textContent = '可调整模型设置后重试'
      copyButton.disabled = true

      if (timerInterval) clearInterval(timerInterval)
      timerInterval = null
      startTime = 0
    },
    setSuccess(state: OverlaySuccessState) {
      let elapsedStr = ''
      if (startTime) {
        elapsedStr = ` (总耗时: ${((performance.now() - startTime) / 1000).toFixed(1)}s)`
      }

      translatedText = state.translatedText
      badge.textContent = `译入 ${state.targetLanguage}`
      title.textContent = state.title
      url.textContent = state.url
      statusText.textContent = state.operationMessage
        ? `${state.operationMessage}${elapsedStr}`
        : state.mode === 'selection'
          ? `已完成选中内容翻译${elapsedStr}`
          : state.strategyUsed === 'paragraph-by-paragraph'
            ? `已完成，当前结果来自逐段回退翻译${elapsedStr}`
            : `已完成，整页翻译成功${elapsedStr}`
      spinner.classList.add('hidden')
      body.className = 'body'
      body.textContent = state.translatedText
      footerMeta.textContent =
        state.mode === 'selection'
          ? state.strategyUsed === 'paragraph-by-paragraph'
            ? '策略：逐段翻译'
            : '策略：整块翻译'
          : state.strategyUsed === 'paragraph-by-paragraph'
            ? '回退策略：逐段翻译'
            : '策略：整页翻译'
      copyButton.disabled = false

      if (timerInterval) clearInterval(timerInterval)
      timerInterval = null
      startTime = 0
    },
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
}