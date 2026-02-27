// BTools Service Worker - Manifest V3
// 点击扩展图标时打开工具集新标签页

chrome.action.onClicked.addListener(() => {
  // 检查是否已有 BTools 标签页打开，有则激活，无则新建
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
