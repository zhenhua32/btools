const PAGE_TRANSLATE_START_MESSAGE_TYPE = 'btools:page-translate-start'
const PAGE_TRANSLATE_SUBMIT_MESSAGE_TYPE = 'btools:page-translate-submit'
const PAGE_TRANSLATE_STATUS_MESSAGE_TYPE = 'btools:page-translate-status'

interface PageTranslateStartMessage {
  type: typeof PAGE_TRANSLATE_START_MESSAGE_TYPE
  payload: {
    requestId: string
  }
}

interface PageTranslateSubmitMessage {
  type: typeof PAGE_TRANSLATE_SUBMIT_MESSAGE_TYPE
  payload: {
    requestId: string
    text: string
    title: string
    url: string
  }
}

interface PageTranslateStatusMessage {
  type: typeof PAGE_TRANSLATE_STATUS_MESSAGE_TYPE
  payload:
    | {
        requestId: string
        status: 'loading'
        message: string
      }
    | {
        requestId: string
        status: 'error'
        message: string
      }
    | {
        requestId: string
        status: 'success'
        title: string
        url: string
        translatedText: string
        targetLanguage: string
        strategyUsed: 'whole-document' | 'paragraph-by-paragraph'
      }
}

interface ExtractedPageContent {
  text: string
  title: string
  url: string
}

interface OverlaySuccessState {
  title: string
  url: string
  translatedText: string
  targetLanguage: string
  strategyUsed: 'whole-document' | 'paragraph-by-paragraph'
}

interface PageTranslateRuntimeState {
  activeRequestId: string
  overlay: ReturnType<typeof createTranslationOverlay>
}

const globalScope = globalThis as typeof globalThis & {
  __btoolsPageTranslateInitialized?: boolean
  __btoolsPageTranslateState?: PageTranslateRuntimeState
  __btoolsPageTranslateStart?: (requestId: string) => void
}

if (!globalScope.__btoolsPageTranslateState) {
  const state: PageTranslateRuntimeState = {
    activeRequestId: '',
    overlay: createTranslationOverlay({
      onClose: () => {
        state.activeRequestId = ''
      },
    }),
  }

  globalScope.__btoolsPageTranslateState = state
}

const runtimeState = globalScope.__btoolsPageTranslateState

globalScope.__btoolsPageTranslateStart = (requestId: string) => {
  runtimeState.activeRequestId = requestId
  void beginPageTranslation(runtimeState, requestId)
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
}

async function beginPageTranslation(
  runtimeState: PageTranslateRuntimeState,
  requestId: string,
): Promise<void> {
  runtimeState.overlay.show()
  runtimeState.overlay.setLoading('正在读取页面正文...')

  try {
    const extracted = extractPageContent()
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

function handlePageTranslateStatus(
  runtimeState: PageTranslateRuntimeState,
  message: PageTranslateStatusMessage,
): void {
  if (message.payload.status === 'loading') {
    runtimeState.overlay.setLoading(message.payload.message)
    return
  }

  if (message.payload.status === 'error') {
    runtimeState.overlay.setError(message.payload.message)
    return
  }

  runtimeState.overlay.setSuccess({
    title: message.payload.title,
    url: message.payload.url,
    translatedText: message.payload.translatedText,
    targetLanguage: message.payload.targetLanguage,
    strategyUsed: message.payload.strategyUsed,
  })
}

function extractPageContent(): ExtractedPageContent {
  const bodyText = normalizePageText(document.body?.innerText || '')
  const mainText = pickPreferredMainContent()
  const text = mainText.length >= Math.max(300, Math.floor(bodyText.length * 0.35)) ? mainText : bodyText

  return {
    text,
    title: document.title.trim() || '未命名页面',
    url: window.location.href,
  }
}

function pickPreferredMainContent(): string {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('main, article, [role="main"], .article, .post, .content'),
  )
    .map((element) => normalizePageText(element.innerText || ''))
    .filter((text) => text.length > 0)
    .sort((left, right) => right.length - left.length)

  return candidates[0] || ''
}

function normalizePageText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

function submitPageContent(message: PageTranslateSubmitMessage): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError
  })
}

function isPageTranslateStartMessage(message: unknown): message is PageTranslateStartMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type?: unknown }).type === PAGE_TRANSLATE_START_MESSAGE_TYPE &&
    'payload' in message
  )
}

function isPageTranslateStatusMessage(message: unknown): message is PageTranslateStatusMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type?: unknown }).type === PAGE_TRANSLATE_STATUS_MESSAGE_TYPE &&
    'payload' in message
  )
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

  closeButton.addEventListener('click', () => {
    panel.classList.remove('visible')
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
      footerMeta.textContent = '正在处理整页内容'
      copyButton.disabled = true
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
    },
    setSuccess(state: OverlaySuccessState) {
      translatedText = state.translatedText
      badge.textContent = `译入 ${state.targetLanguage}`
      title.textContent = state.title
      url.textContent = state.url
      statusText.textContent =
        state.strategyUsed === 'paragraph-by-paragraph'
          ? '已完成，当前结果来自逐段回退翻译'
          : '已完成，整页翻译成功'
      spinner.classList.add('hidden')
      body.className = 'body'
      body.textContent = state.translatedText
      footerMeta.textContent =
        state.strategyUsed === 'paragraph-by-paragraph'
          ? '回退策略：逐段翻译'
          : '策略：整页翻译'
      copyButton.disabled = false
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