// 向导打开的共用出口：默认在浏览器侧边栏打开 wizard.html，API 缺失或调用失败时回退新标签页。
// 注意：chrome.sidePanel.open 要求用户手势——本函数必须在点击处理器里被同步调用，
// setOptions + open 在同一同步任务内发起（不得放进 await 链），异步失败再走回退。
;(function () {
  window.openWizardPanel = function () {
    const url = chrome.runtime.getURL('wizard.html')
    const sp = chrome.sidePanel
    if (sp && typeof sp.setOptions === 'function' && typeof sp.open === 'function') {
      try {
        // 侧边栏默认展示主界面（popup.html），向导必须先显式指定路径；
        // 下次点扩展图标时 background.js 会自行把路径恢复为 popup.html
        const opt = sp.setOptions({ path: url, enabled: true })
        const opened = sp.open({ windowId: chrome.windows && chrome.windows.WINDOW_ID_CURRENT != null ? chrome.windows.WINDOW_ID_CURRENT : undefined })
        if (opt && typeof opt.catch === 'function') opt.catch(() => {})
        if (opened && typeof opened.catch === 'function') {
          opened.catch(() => chrome.tabs.create({ url }))
        }
        return
      } catch (_) { /* 同步抛错（API 不支持/无窗口上下文）→ 走回退 */ }
    }
    chrome.tabs.create({ url })
  }
})()
