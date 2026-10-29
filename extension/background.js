// 官网（docs 页面）与扩展之间的桥接：
// 1) ping：官网检测扩展是否已安装
// 2) open-import：官网把链接里的加密配置暂存后打开配置页，由配置页接手导入
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return

  if (msg.type === 'kdocs-fetcher-ping') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version })
    return
  }

  if (msg.type === 'kdocs-fetcher-open-import' && msg.payload) {
    // 配置页尚未打开，先把加密数据暂存到本地存储
    chrome.storage.local.set({ pendingImport: msg.payload }, () => {
      chrome.runtime.openOptionsPage()
      sendResponse({ ok: !chrome.runtime.lastError })
    })
    return true // 异步响应
  }
})
