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

// ===== 点击扩展图标的打开方式：弹窗（默认）或侧边栏 =====
// manifest 不再声明 default_popup：一旦声明，action.onClicked 就不会触发。
// 改为按模式显式设置弹窗——侧边栏模式下 popup 为空，点击才能落到 onClicked。
const ACTION_POPUP = 'popup.html'

function applyOpenMode(mode) {
  if (!chrome.action || !chrome.action.setPopup) return
  const canPanel = Boolean(chrome.sidePanel && chrome.sidePanel.open)
  const usePanel = mode === 'panel' && canPanel
  chrome.action.setPopup({ popup: usePanel ? '' : ACTION_POPUP })
  // 显式声明主界面路径，避免此前打开过向导时路径残留
  if (usePanel && chrome.sidePanel.setOptions) {
    chrome.sidePanel.setOptions({ path: ACTION_POPUP, enabled: true }).catch(() => {})
  }
}

function refreshOpenMode() {
  chrome.storage.local.get('defaultOpenMode', (cfg) => {
    applyOpenMode(cfg.defaultOpenMode === 'panel' ? 'panel' : 'popup')
  })
}

// 切换模式：立即生效；从侧边栏切回弹窗时关闭已打开的侧边栏
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.defaultOpenMode) return
  const mode = changes.defaultOpenMode.newValue === 'panel' ? 'panel' : 'popup'
  applyOpenMode(mode)
  if (mode === 'popup' && chrome.sidePanel && chrome.sidePanel.close) {
    try { chrome.sidePanel.close() } catch (_) {}
  }
})

chrome.action.onClicked.addListener((tab) => {
  // 必须先同步调用 open()：sidePanel.open 要求处于用户手势的调用栈内，
  // 若先 await 读存储再调用，部分版本会直接拒绝（表现为点击无反应）。
  if (!chrome.sidePanel || !chrome.sidePanel.open) {
    chrome.windows.create({ url: chrome.runtime.getURL(ACTION_POPUP), type: 'popup', width: 360, height: 520 })
    return
  }
  const windowId = tab && tab.windowId ? tab.windowId : undefined
  const openPromise = windowId ? chrome.sidePanel.open({ windowId }) : chrome.windows.getCurrent().then((w) => chrome.sidePanel.open({ windowId: w.id }))
  Promise.resolve(openPromise)
    .then(() => chrome.sidePanel.setOptions({ path: ACTION_POPUP, enabled: true }))
    .catch(() => {
      // 侧边栏不可用时回退为独立窗口
      chrome.windows.create({ url: chrome.runtime.getURL(ACTION_POPUP), type: 'popup', width: 360, height: 520 })
    })
})

chrome.runtime.onInstalled.addListener(refreshOpenMode)
chrome.runtime.onStartup.addListener(refreshOpenMode)
refreshOpenMode()

// ===== 右键菜单「获取数据并粘贴」：拉取最新数据并把自动复制字段粘贴到光标所在输入框 =====
const PASTE_MENU_ID = 'kdocs-fetcher-paste'
// contextMenus 没有 get，用内存标记当前是否已注册（service worker 重启后会重新按存储注册）
let pasteMenuCreated = false

function updatePasteMenu(cfg) {
  const enabled = cfg.contextMenuPaste === true && !!cfg.autoCopyField
  if (enabled && pasteMenuCreated) return
  chrome.contextMenus.removeAll(() => {
    pasteMenuCreated = false
    if (!enabled) return
    chrome.contextMenus.create({
      id: PASTE_MENU_ID,
      title: '获取数据并粘贴',
      contexts: ['editable']
    }, () => {
      if (chrome.runtime.lastError) return
      pasteMenuCreated = true
    })
  })
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['contextMenuPaste', 'autoCopyField'], updatePasteMenu)
})
// service worker 被回收后重启时，事件监听器只有在事件触发时才会重新加载脚本，
// 这时内存标记已丢失，需要重新按存储状态注册，避免菜单丢失
function refreshPasteMenu() {
  chrome.storage.local.get(['contextMenuPaste', 'autoCopyField'], updatePasteMenu)
}
chrome.runtime.onStartup.addListener(refreshPasteMenu)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes.contextMenuPaste || changes.autoCopyField) refreshPasteMenu()
})
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== PASTE_MENU_ID || !tab || !tab.id) return
  const tabId = tab.id
  // 通过内容脚本更新页面上的进度气泡；注入失败时静默忽略（不影响粘贴流程）
  const notify = (msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {})

  const cfg = await chrome.storage.local.get([
    'locked', 'webhookUrl', 'token', 'sheet', 'fields', 'order', 'autoCopyField', 'displayFields', 'charByCharPaste'
  ])
  if (cfg.locked) {
    notify({ type: 'kdocs-fetcher-paste-error', message: '扩展已锁定，请先解锁' })
    return
  }
  if (!cfg.webhookUrl || !cfg.token || !cfg.autoCopyField) {
    notify({ type: 'kdocs-fetcher-paste-error', message: '尚未完成配置或未设置自动复制字段' })
    return
  }
  const fields = Array.isArray(cfg.fields) ? cfg.fields : []
  if (!fields.length) {
    notify({ type: 'kdocs-fetcher-paste-error', message: '尚未配置要拉取的字段' })
    return
  }

  // 先确保页面已注入内容脚本（扩展安装前已打开的页面没有注入），再显示「获取中」气泡
  try {
    await ensureContentScript(tabId)
  } catch (_) {
    return
  }
  notify({ type: 'kdocs-fetcher-paste-start' })

  let value = ''
  try {
    value = await fetchAutoCopyValue(cfg, fields)
  } catch (e) {
    notify({ type: 'kdocs-fetcher-paste-error', message: e && e.message ? e.message : '未知错误' })
    return
  }
  if (!value) {
    notify({ type: 'kdocs-fetcher-paste-error', message: '未获取到「' + cfg.autoCopyField + '」的数据' })
    return
  }

  // 粘贴成功/失败都由内容脚本用气泡反馈
  notify({ type: 'kdocs-fetcher-paste', value, charByChar: cfg.charByCharPaste === true })
})

// 内容脚本未注入时（如扩展安装前已打开的页面）动态注入；已注入则跳过
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'kdocs-fetcher-ping' })
    return
  } catch (_) {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
}

// 拉取最新一条数据，返回自动复制字段的值；失败时抛出异常
async function fetchAutoCopyValue(cfg, fields) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  let res
  try {
    res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'AirScript-Token': cfg.token
      },
      body: JSON.stringify({ Context: { argv: { fields, order: cfg.order === 'top' ? 'top' : 'bottom', ...(cfg.sheet ? { sheet: cfg.sheet } : {}) } } }),
      signal: controller.signal
    })
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时（10 秒），请稍后重试')
    throw new Error('网络请求失败：' + (e && e.message ? e.message : '未知错误'))
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error('接口返回 HTTP ' + res.status + '（请检查 Webhook 链接与脚本令牌）')
  let json
  try {
    json = await res.json()
  } catch (e) {
    throw new Error('响应解析失败：' + (e && e.message ? e.message : '未知错误'))
  }
  const result = json && json.data && json.data.result
  if (!result || !result.ok || !Array.isArray(result.fields)) {
    throw new Error((result && result.error) || '脚本返回失败')
  }
  const base = String(cfg.autoCopyField).split('=')[0].split(':')[0].trim()
  const hit = result.fields.find((f) => f && !f.error && (f.name === base || cfg.autoCopyField === f.name || cfg.autoCopyField === f.raw))
  return hit ? String(hit.value) : ''
}
