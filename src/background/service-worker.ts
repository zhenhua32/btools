// BTools Service Worker - Manifest V3
// 点击扩展图标时打开工具集新标签页

import { getAiSettings, getMissingAiSettingLabels } from '@/services/ai-settings'
import { translateTextWithAi } from '@/services/ai-translator'
import { requestChatCompletion, resolveChatEndpoint } from '@/services/ai-api'
import {
  PAGE_TRANSLATE_STATUS_MESSAGE_TYPE,
  type AiProxyReply,
  type AiProxyRequestMessage,
  type PageTranslateSelectionSubmitMessage,
  type PageTranslateStatusMessage,
  type PageTranslateSubmitMessage,
  isAiProxyRequestMessage,
  isPageTranslateSelectionSubmitMessage,
  isPageTranslateSubmitMessage,
} from '@/services/ai-types'

const PAGE_TRANSLATE_MENU_ID = 'btools:page-translate'
const PAGE_TRANSLATE_SELECTION_MENU_ID = 'btools:page-translate-selection'
const activePageTranslationRequests = new Map<number, string>()

chrome.action.onClicked.addListener(() => {
  const url = chrome.runtime.getURL('index.html')
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs.length > 0 && tabs[0].id !== undefined) {
      chrome.tabs.update(tabs[0].id, { active: true })
      if (tabs[0].windowId !== undefined) {
        chrome.windows.update(tabs[0].windowId, { focused: true })
      }
    } else {
      chrome.tabs.create({ url })
    }
  })
})

chrome.runtime.onInstalled.addListener(() => {
  ensurePageTranslateContextMenu()
})

chrome.runtime.onStartup.addListener(() => {
  ensurePageTranslateContextMenu()
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (tab?.id === undefined) {
    return
  }

  const mode =
    info.menuItemId === PAGE_TRANSLATE_MENU_ID
      ? 'page'
      : info.menuItemId === PAGE_TRANSLATE_SELECTION_MENU_ID
        ? 'selection'
        : null

  if (!mode) {
    return
  }

  const requestId = createPageTranslationRequestId()
  activePageTranslationRequests.set(tab.id, requestId)

  try {
    await ensurePageTranslateContentScript(tab.id)

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (nextRequestId: string, nextMode: 'page' | 'selection') => {
        const scope = globalThis as typeof globalThis & {
          __btoolsPageTranslateStart?: (requestId: string) => void
          __btoolsPageTranslateSelectionStart?: (requestId: string) => void
        }

        if (nextMode === 'selection') {
          scope.__btoolsPageTranslateSelectionStart?.(nextRequestId)
          return
        }

        scope.__btoolsPageTranslateStart?.(nextRequestId)
      },
      args: [requestId, mode],
    })
  } catch {
    activePageTranslationRequests.delete(tab.id)
  }
})

ensurePageTranslateContextMenu()

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isAiProxyRequestMessage(message)) {
    handleAiProxyRequest(message)
      .then((response) => sendResponse(response))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : '后台代理请求失败',
        } satisfies AiProxyReply)
      })

    return true
  }

  if (isPageTranslateSubmitMessage(message)) {
    handlePageTranslateSubmit(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : '网页全文翻译失败',
        })
      })

    return true
  }

  if (isPageTranslateSelectionSubmitMessage(message)) {
    handlePageTranslateSelectionSubmit(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : '选中文本翻译失败',
        })
      })

    return true
  }

  return false
})

async function handleAiProxyRequest(message: AiProxyRequestMessage): Promise<AiProxyReply> {
  try {
    const endpoint = resolveChatEndpoint(message.payload.baseUrl)
    const response = await requestChatCompletion(endpoint, message.payload)
    return {
      ok: true,
      data: response,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '模型接口调用失败',
    }
  }
}

async function handlePageTranslateSubmit(
  message: PageTranslateSubmitMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  await handleTranslationRequest(
    {
      requestId: message.payload.requestId,
      title: message.payload.title,
      url: message.payload.url,
      text: message.payload.text,
      mode: 'page',
    },
    sender,
  )
}

async function handlePageTranslateSelectionSubmit(
  message: PageTranslateSelectionSubmitMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  await handleTranslationRequest(
    {
      requestId: message.payload.requestId,
      title: message.payload.title,
      url: message.payload.url,
      text: message.payload.text,
      html: message.payload.html,
      mode: 'selection',
    },
    sender,
  )
}

async function handleTranslationRequest(
  request: {
    requestId: string
    title: string
    url: string
    text: string
    html?: string
    mode: 'page' | 'selection'
  },
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = sender.tab?.id
  if (tabId === undefined) {
    return
  }

  const activeRequestId = activePageTranslationRequests.get(tabId)
  if (!activeRequestId || activeRequestId !== request.requestId) {
    return
  }

  try {
    const settings = await getAiSettings()
    const missingFields = getMissingAiSettingLabels(settings)

    if (missingFields.length > 0) {
      throw new Error(`请先在 BTools 设置页补全：${missingFields.join('、')}`)
    }

    const useHtmlSource = !!request.html?.trim()
    const result = await translateTextWithAi(useHtmlSource ? request.html ?? request.text : request.text, {
      settings,
      strategy: request.mode === 'selection' || useHtmlSource ? 'whole-document' : 'paragraph-by-paragraph',
      sourceFormat: useHtmlSource ? 'html-fragment' : 'plain-text',
      preserveParagraphOnFailure: request.mode === 'page',
      onProgress: (progressMessage) => {
        sendPageTranslateStatus(tabId, {
          requestId: request.requestId,
          status: 'loading',
          message: progressMessage,
          mode: request.mode,
        })
      },
    })

    if (activePageTranslationRequests.get(tabId) !== request.requestId) {
      return
    }

    sendPageTranslateStatus(tabId, {
      requestId: request.requestId,
      status: 'success',
      title: request.title,
      url: request.url,
      translatedText: useHtmlSource ? extractTextPreviewFromHtml(result.text) : result.text,
      translatedHtml: useHtmlSource ? result.text : undefined,
      paragraphs: request.mode === 'page' ? result.paragraphs : undefined,
      targetLanguage: settings.defaultTargetLanguage || '中文',
      strategyUsed: result.strategyUsed,
      mode: request.mode,
    })
  } catch (error) {
    if (activePageTranslationRequests.get(tabId) !== request.requestId) {
      return
    }

    sendPageTranslateStatus(tabId, {
      requestId: request.requestId,
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : request.mode === 'selection'
            ? '选中文本翻译失败'
            : '网页全文翻译失败',
      mode: request.mode,
    })
  } finally {
    if (activePageTranslationRequests.get(tabId) === request.requestId) {
      activePageTranslationRequests.delete(tabId)
    }
  }
}

function ensurePageTranslateContextMenu(): void {
  chrome.contextMenus.remove(PAGE_TRANSLATE_MENU_ID, () => {
    void chrome.runtime.lastError

    chrome.contextMenus.create(
      {
        id: PAGE_TRANSLATE_MENU_ID,
        title: '用 BTools AI 翻译全文',
        contexts: ['all'],
        documentUrlPatterns: ['http://*/*', 'https://*/*'],
      },
      () => {
        void chrome.runtime.lastError
      },
    )
  })

  chrome.contextMenus.remove(PAGE_TRANSLATE_SELECTION_MENU_ID, () => {
    void chrome.runtime.lastError

    chrome.contextMenus.create(
      {
        id: PAGE_TRANSLATE_SELECTION_MENU_ID,
        title: '用 BTools AI 翻译选中文本',
        contexts: ['selection'],
        documentUrlPatterns: ['http://*/*', 'https://*/*'],
      },
      () => {
        void chrome.runtime.lastError
      },
    )
  })
}

function createPageTranslationRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function ensurePageTranslateContentScript(tabId: number): Promise<void> {
  const [existingScriptState] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const scope = globalThis as typeof globalThis & {
        __btoolsPageTranslateInitialized?: boolean
      }

      return !!scope.__btoolsPageTranslateInitialized
    },
  })

  if (existingScriptState?.result) {
    return
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-script.js'],
  })
}

function sendPageTranslateStatus(
  tabId: number,
  payload: PageTranslateStatusMessage['payload'],
): void {
  if (activePageTranslationRequests.get(tabId) !== payload.requestId) {
    return
  }

  chrome.tabs.sendMessage(
    tabId,
    {
      type: PAGE_TRANSLATE_STATUS_MESSAGE_TYPE,
      payload,
    } satisfies PageTranslateStatusMessage,
  ).catch(() => {
    // 忽略因接收端不存在（例如页面被刷新或关闭）造成的报错
    void chrome.runtime.lastError
  })
}

function extractTextPreviewFromHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
