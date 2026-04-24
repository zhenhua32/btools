// BTools Service Worker - Manifest V3
// 点击扩展图标时打开工具集新标签页

import { getAiSettings, getMissingAiSettingLabels } from '@/services/ai-settings'
import { translateTextWithAi } from '@/services/ai-translator'
import { requestChatCompletion, resolveChatEndpoint } from '@/services/ai-api'
import {
  PAGE_TRANSLATE_STATUS_MESSAGE_TYPE,
  type AiProxyReply,
  type AiProxyRequestMessage,
  type PageTranslateStatusMessage,
  type PageTranslateSubmitMessage,
  isAiProxyRequestMessage,
  isPageTranslateSubmitMessage,
} from '@/services/ai-types'

const PAGE_TRANSLATE_MENU_ID = 'btools:page-translate'
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
  if (info.menuItemId !== PAGE_TRANSLATE_MENU_ID || tab?.id === undefined) {
    return
  }

  const requestId = createPageTranslationRequestId()
  activePageTranslationRequests.set(tab.id, requestId)

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-script.js'],
    })

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (nextRequestId: string) => {
        const scope = globalThis as typeof globalThis & {
          __btoolsPageTranslateStart?: (requestId: string) => void
        }

        scope.__btoolsPageTranslateStart?.(nextRequestId)
      },
      args: [requestId],
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
  const tabId = sender.tab?.id
  if (tabId === undefined) {
    return
  }

  const activeRequestId = activePageTranslationRequests.get(tabId)
  if (!activeRequestId || activeRequestId !== message.payload.requestId) {
    return
  }

  try {
    const settings = await getAiSettings()
    const missingFields = getMissingAiSettingLabels(settings)

    if (missingFields.length > 0) {
      throw new Error(`请先在 BTools 设置页补全：${missingFields.join('、')}`)
    }

    sendPageTranslateStatus(tabId, {
      requestId: message.payload.requestId,
      status: 'loading',
      message: '正在连接模型...',
    })

    const result = await translateTextWithAi(message.payload.text, {
      settings,
      strategy: 'whole-document',
      fallbackToParagraphsOnFailure: true,
      onProgress: (progressMessage) => {
        sendPageTranslateStatus(tabId, {
          requestId: message.payload.requestId,
          status: 'loading',
          message: progressMessage,
        })
      },
    })

    if (activePageTranslationRequests.get(tabId) !== message.payload.requestId) {
      return
    }

    sendPageTranslateStatus(tabId, {
      requestId: message.payload.requestId,
      status: 'success',
      title: message.payload.title,
      url: message.payload.url,
      translatedText: result.text,
      targetLanguage: settings.defaultTargetLanguage || '中文',
      strategyUsed: result.strategyUsed,
    })
  } catch (error) {
    if (activePageTranslationRequests.get(tabId) !== message.payload.requestId) {
      return
    }

    sendPageTranslateStatus(tabId, {
      requestId: message.payload.requestId,
      status: 'error',
      message: error instanceof Error ? error.message : '网页全文翻译失败',
    })
  } finally {
    if (activePageTranslationRequests.get(tabId) === message.payload.requestId) {
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
}

function createPageTranslationRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
