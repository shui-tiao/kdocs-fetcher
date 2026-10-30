// 已锁定时配置页一律跳转到解锁界面
;(async () => {
  if (await Lock.isLocked()) location.replace('unlock.html?return=options')
})()

const urlInput = document.getElementById('webhookUrl')
const tokenInput = document.getElementById('token')
const sheetInput = document.getElementById('sheetName')
const fieldListEl = document.getElementById('fieldList')
const displayListEl = document.getElementById('displayList')
const toastEl = document.getElementById('toast')
let toastTimer = null

// ===== 标签页切换：主页 / 连接 / 配置 =====
const TAB_NAMES = ['home', 'connect', 'config']

function switchTab(name) {
  if (!TAB_NAMES.includes(name)) name = 'home'
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === name)
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('active', panel.id === 'tab-' + name)
  }
}

for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab))
}
switchTab(location.hash.replace(/^#/, ''))

// 统一的气泡提示：默认红色错误气泡，传 true 为绿色成功气泡，3 秒后自动消失
function showToast(msg, ok) {
  toastEl.textContent = msg
  toastEl.classList.toggle('ok', Boolean(ok))
  toastEl.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3000)
}

const autoFetchInput = document.getElementById('autoFetch')

let savedAutoCopyField = ''

function createFieldRow(value) {
  const row = document.createElement('div')
  row.className = 'field-row'
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = '表头名（如 内容），或 显示名=列字母（如 机构=E）'
  input.value = value || ''
  const del = document.createElement('button')
  del.type = 'button'
  del.className = 'del'
  del.textContent = '删除'
  del.addEventListener('click', () => {
    fieldListEl.removeChild(row)
    if (!fieldListEl.children.length) {
      fieldListEl.appendChild(createFieldRow(''))
    }
  })
  row.appendChild(input)
  row.appendChild(del)
  return row
}

function getFields() {
  const seen = new Set()
  const fields = []
  for (const input of fieldListEl.querySelectorAll('input')) {
    const name = input.value.trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      fields.push(name)
    }
  }
  return fields
}

// ===== 展示字段（主页）：默认展示全部拉取字段，可删除/恢复、拖拽排序，点击高亮即设为自动复制 =====
const removedEl = document.getElementById('removedDisplay')
const removedSection = document.getElementById('removedSection')
const displayEmptyTip = document.getElementById('displayEmptyTip')

let removedFields = [] // 已删除的展示字段
let autoCopyField = '' // 高亮的自动复制字段
let draggingRow = null

function setHighlight(name) {
  autoCopyField = name
  for (const row of displayListEl.children) {
    row.classList.toggle('highlight', row.dataset.name === name)
  }
}

function updateDisplayUI() {
  displayEmptyTip.classList.toggle('hidden', displayListEl.children.length > 0)
  removedSection.classList.toggle('hidden', !removedFields.length)
}

function visibleNames() {
  return [...displayListEl.children].map((row) => row.dataset.name)
}

function buildRemovedList() {
  removedEl.innerHTML = ''
  for (const name of removedFields) {
    const row = document.createElement('div')
    row.className = 'removed-row'
    const nameEl = document.createElement('span')
    nameEl.className = 'removed-name'
    nameEl.textContent = name
    const restore = document.createElement('button')
    restore.type = 'button'
    restore.className = 'restore'
    restore.textContent = '恢复'
    restore.addEventListener('click', () => {
      removedFields = removedFields.filter((n) => n !== name)
      displayListEl.appendChild(createDisplayRow(name))
      buildRemovedList()
      updateDisplayUI()
    })
    row.appendChild(nameEl)
    row.appendChild(restore)
    removedEl.appendChild(row)
  }
}

function removeDisplayField(name) {
  const row = [...displayListEl.children].find((r) => r.dataset.name === name)
  if (row) row.remove()
  if (autoCopyField === name) autoCopyField = ''
  removedFields.push(name)
  buildRemovedList()
  updateDisplayUI()
}

function createDisplayRow(name) {
  const row = document.createElement('div')
  row.className = 'display-row'
  row.dataset.name = name
  row.draggable = true

  const handle = document.createElement('span')
  handle.className = 'drag-handle'
  handle.title = '拖拽排序'
  handle.textContent = '≡'

  const nameEl = document.createElement('span')
  nameEl.className = 'display-name'
  nameEl.textContent = name

  const del = document.createElement('button')
  del.type = 'button'
  del.className = 'del'
  del.textContent = '删除'
  del.addEventListener('click', (e) => {
    e.stopPropagation()
    removeDisplayField(name)
  })

  row.appendChild(handle)
  row.appendChild(nameEl)
  row.appendChild(del)

  // 点击高亮 = 设为自动复制；再次点击取消
  row.addEventListener('click', () => {
    setHighlight(row.classList.contains('highlight') ? '' : name)
  })

  row.addEventListener('dragstart', (e) => {
    draggingRow = row
    row.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', name) } catch (_) {}
  })
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging')
    draggingRow = null
  })

  return row
}

displayListEl.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (!draggingRow) return
  const target = e.target.closest('.display-row')
  if (!target || target === draggingRow) return
  const rect = target.getBoundingClientRect()
  const before = e.clientY < rect.top + rect.height / 2
  displayListEl.insertBefore(draggingRow, before ? target : target.nextSibling)
})

// 依据拉取字段与已保存的展示字段重建列表；未保存过时展示全部拉取字段
function rebuildDisplayList(pullFields, saved) {
  let vis
  if (Array.isArray(saved)) {
    vis = saved.filter((n) => pullFields.includes(n))
    removedFields = pullFields.filter((n) => !vis.includes(n))
  } else {
    vis = [...pullFields]
    removedFields = []
  }
  displayListEl.innerHTML = ''
  for (const name of vis) displayListEl.appendChild(createDisplayRow(name))
  if (savedAutoCopyField && vis.includes(savedAutoCopyField)) setHighlight(savedAutoCopyField)
  else autoCopyField = ''
  buildRemovedList()
  updateDisplayUI()
}

// 保存后同步：合并本次会话中新增的拉取字段，移除已不存在的展示字段
function syncDisplayListWithPulls(pullFields) {
  const vis = visibleNames().filter((n) => pullFields.includes(n))
  removedFields = removedFields.filter((n) => pullFields.includes(n))
  for (const p of pullFields) {
    if (!vis.includes(p) && !removedFields.includes(p)) vis.push(p)
  }
  if (autoCopyField && !vis.includes(autoCopyField)) autoCopyField = ''
  displayListEl.innerHTML = ''
  for (const name of vis) displayListEl.appendChild(createDisplayRow(name))
  if (autoCopyField) setHighlight(autoCopyField)
  buildRemovedList()
  updateDisplayUI()
}

chrome.storage.local.get(['webhookUrl', 'token', 'sheet', 'fields', 'order', 'autoCopyField', 'autoFetch', 'displayFields'], (cfg) => {
  if (cfg.webhookUrl) urlInput.value = cfg.webhookUrl
  if (cfg.token) tokenInput.value = cfg.token
  if (cfg.sheet) sheetInput.value = cfg.sheet
  const fields = Array.isArray(cfg.fields) ? cfg.fields : []
  fields.forEach((f) => fieldListEl.appendChild(createFieldRow(f)))
  savedAutoCopyField = cfg.autoCopyField || ''
  rebuildDisplayList(fields, cfg.displayFields)
  const order = cfg.order === 'top' ? 'top' : 'bottom'
  document.querySelector('input[name="order"][value="' + order + '"]').checked = true
  autoFetchInput.checked = cfg.autoFetch !== false
})

document.getElementById('openWizard').addEventListener('click', async () => {
  // 优先在侧边栏打开；浏览器不支持 sidePanel 时回退为弹窗
  if (chrome.sidePanel && chrome.sidePanel.open) {
    try {
      const win = await chrome.windows.getCurrent()
      await chrome.sidePanel.open({ windowId: win.id })
      return
    } catch (_) {}
  }
  chrome.windows.create({
    url: chrome.runtime.getURL('wizard.html'),
    type: 'popup',
    width: 560,
    height: 760
  })
})

// 向导完成后刷新本页，避免页面上旧的令牌/链接覆盖新配置
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'config-updated') location.reload()
})

document.getElementById('addField').addEventListener('click', () => {
  fieldListEl.appendChild(createFieldRow(''))
})

for (const saveBtn of document.querySelectorAll('.save')) {
  saveBtn.addEventListener('click', () => {
    const webhookUrl = urlInput.value.trim()
    const token = tokenInput.value.trim()
    const sheet = sheetInput.value.trim()
    const fields = getFields()
    const displayFields = visibleNames()
    const orderEl = document.querySelector('input[name="order"]:checked')
    const order = orderEl ? orderEl.value : 'bottom'

    if (!webhookUrl.startsWith('https://www.kdocs.cn/')) {
      showToast('Webhook 链接需以 https://www.kdocs.cn/ 开头')
      return
    }
    if (!token) {
      showToast('脚本令牌不能为空')
      return
    }

    // 允许暂不填写拉取字段（可后补），弹窗会提示去配置页添加
    const noFields = !fields.length
    chrome.storage.local.set({ webhookUrl, token, sheet, fields, displayFields, order, autoCopyField, autoFetch: autoFetchInput.checked }, () => {
      savedAutoCopyField = autoCopyField
      showToast(noFields ? '已保存，但尚未填写要拉取的字段，请到「连接」页添加' : '已保存', true)
      syncDisplayListWithPulls(fields)
    })
  })
}

// 锁定：设置 6 位数字 PIN 后进入锁定状态
const lockBtn = document.getElementById('lockBtn')
const lockModal = document.getElementById('lockModal')
const pinInput = document.getElementById('pinInput')
const pinConfirmInput = document.getElementById('pinConfirm')
const lockConfirmBtn = document.getElementById('lockConfirm')
const lockCancelBtn = document.getElementById('lockCancel')

function openLockModal() {
  pinInput.value = ''
  pinConfirmInput.value = ''
  lockConfirmBtn.disabled = false
  lockModal.classList.remove('hidden')
  pinInput.focus()
}

function closeLockModal() {
  lockModal.classList.add('hidden')
}

for (const input of [pinInput, pinConfirmInput]) {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 6)
    if (digits !== input.value) input.value = digits
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lockConfirmBtn.click()
  })
}

lockBtn.addEventListener('click', openLockModal)
lockCancelBtn.addEventListener('click', closeLockModal)

lockConfirmBtn.addEventListener('click', async () => {
  const pin = pinInput.value
  if (!Lock.isSixDigits(pin)) {
    showToast('请输入 6 位数字 PIN')
    return
  }
  if (pin !== pinConfirmInput.value) {
    showToast('两次输入的 PIN 不一致')
    return
  }
  lockConfirmBtn.disabled = true
  await Lock.lock(pin)
  location.replace('unlock.html?return=options')
})

// 其他标签页锁定扩展时，本页也自动跳转解锁界面
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.locked && changes.locked.newValue === true) {
    location.replace('unlock.html?return=options')
  }
})

// ===== 加密迁移：PIN 派生密钥加密配置，经 storage.sync 跨设备同步 =====
const cloudUploadBtn = document.getElementById('cloudUploadBtn')
const cloudRestoreBtn = document.getElementById('cloudRestoreBtn')
const pinModal = document.getElementById('pinModal')
const pinModalTitle = document.getElementById('pinModalTitle')
const pinModalDesc = document.getElementById('pinModalDesc')
const pinModalInput = document.getElementById('pinModalInput')
const pinModalConfirm = document.getElementById('pinModalConfirm')
const pinModalCancel = document.getElementById('pinModalCancel')

function openPinModal({ title, desc, confirmText, onSubmit, skipPin }) {
  pinModalTitle.textContent = title
  pinModalDesc.textContent = desc
  pinModalConfirm.textContent = confirmText
  pinModalInput.value = ''
  pinModalInput.classList.toggle('hidden', !!skipPin)
  const inputLabel = pinModalInput.previousElementSibling
  if (inputLabel && inputLabel.tagName === 'LABEL') inputLabel.classList.toggle('hidden', !!skipPin)
  pinModalConfirm.disabled = false
  pinModal.classList.remove('hidden')
  if (!skipPin) pinModalInput.focus()
  pinModalConfirm.onclick = async () => {
    const pin = pinModalInput.value
    if (!skipPin && !Lock.isSixDigits(pin)) {
      showToast('请输入 6 位数字 PIN')
      return
    }
    pinModalConfirm.disabled = true
    try {
      await onSubmit(pin)
    } catch (e) {
      showToast('操作失败：' + (e && e.message ? e.message : '未知错误'))
      pinModalConfirm.disabled = false
    }
  }
}

pinModalCancel.addEventListener('click', () => pinModal.classList.add('hidden'))
pinModalInput.addEventListener('input', () => {
  const digits = pinModalInput.value.replace(/\D/g, '').slice(0, 6)
  if (digits !== pinModalInput.value) pinModalInput.value = digits
})
pinModalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pinModalConfirm.click()
})

cloudUploadBtn.addEventListener('click', () => {
  openPinModal({
    title: '迁移到云端',
    desc: '请设置 6 位数字 PIN 用于加密配置。PIN 不会被保存，还原时必须输入相同 PIN，请务必牢记。',
    confirmText: '加密并迁移',
    onSubmit: async (pin) => {
      const cfg = await chrome.storage.local.get(Migration.CONFIG_KEYS)
      if (!cfg.webhookUrl || !cfg.token) {
        showToast('请先保存配置（至少包含 Webhook 链接和脚本令牌）')
        pinModalConfirm.disabled = false
        return
      }
      const backup = await Migration.encryptConfig(pin, cfg)
      await chrome.storage.sync.set({ [Migration.SYNC_KEY]: backup })
      pinModal.classList.add('hidden')
      showToast('已加密迁移到云端，新设备可通过「从云端移入」还原', true)
    }
  })
})

cloudRestoreBtn.addEventListener('click', async () => {
  const { [Migration.SYNC_KEY]: backup } = await chrome.storage.sync.get(Migration.SYNC_KEY)
  if (!backup || !backup.data) {
    showToast('云端没有可还原的备份数据')
    return
  }
  openPinModal({
    title: '从云端移入',
    desc: '检测到云端备份，请输入迁移时设置的 6 位 PIN 解密还原（将覆盖本机当前配置）。',
    confirmText: '解密还原',
    onSubmit: async (pin) => {
      let cfg
      try {
        cfg = await Migration.decryptConfig(pin, backup)
      } catch (_) {
        showToast('PIN 错误或云端数据已损坏')
        pinModalConfirm.disabled = false
        return
      }
      if (!cfg.webhookUrl || !cfg.token) {
        showToast('云端数据缺少 Webhook 链接或脚本令牌，已取消还原')
        pinModalConfirm.disabled = false
        return
      }
      await chrome.storage.local.set(Migration.sanitizeConfig(cfg))
      pinModal.classList.add('hidden')
      showToast('已从云端还原配置，即将刷新页面…', true)
      setTimeout(() => location.reload(), 1200)
    }
  })
})

// ===== 清除云端数据 =====
const cloudClearBtn = document.getElementById('cloudClearBtn')
cloudClearBtn.addEventListener('click', async () => {
  showToast('正在扫描云端数据…')
  let all
  try {
    all = await chrome.storage.sync.get(null)
  } catch (e) {
    showToast('扫描失败：' + (e && e.message ? e.message : '未知错误'))
    return
  }
  const hasBackup = !!(all && all[Migration.SYNC_KEY] && all[Migration.SYNC_KEY].data)
  const otherKeys = Object.keys(all || {}).filter((k) => k !== Migration.SYNC_KEY)
  const totalKeys = (hasBackup ? 1 : 0) + otherKeys.length
  if (totalKeys === 0) {
    showToast('云端暂无数据，无需清除', true)
    return
  }
  const backupMsg = hasBackup ? '检测到一份本扩展的加密备份。' : ''
  const otherMsg = otherKeys.length
    ? `另外还有 ${otherKeys.length} 项其他同步数据。`
    : ''
  openPinModal({
    title: '清除云端数据',
    desc: (backupMsg || otherMsg) + (backupMsg && otherMsg ? '<br>' : '') + '确认后将执行「清除云端数据」，这些数据将无法恢复。本机配置不会受到影响。',
    confirmText: '确认清除',
    skipPin: true,
    onSubmit: async () => {
      pinModal.classList.add('hidden')
      showToast('正在清除云端数据…')
      try {
        await chrome.storage.sync.clear()
      } catch (e) {
        showToast('清除失败：' + (e && e.message ? e.message : '未知错误'))
        return
      }
      // 复扫验证
      let verify
      try {
        verify = await chrome.storage.sync.get(null)
      } catch (e) {
        showToast('已清除，但复扫验证失败：' + (e && e.message ? e.message : '未知错误'))
        return
      }
      const remainingKeys = Object.keys(verify || {})
      if (remainingKeys.length === 0) {
        showToast('云端数据已全部清除', true)
      } else if (remainingKeys.length === 1 && verify[Migration.SYNC_KEY] && !verify[Migration.SYNC_KEY].data) {
        // 浏览器可能保留了空壳 key
        showToast('云端备份已清除干净，浏览器保留了一项空壳条目（无需处理）', true)
      } else {
        showToast(`清除后仍有 ${remainingKeys.length} 项数据残留：${remainingKeys.join('、')}，请稍后再试或手动清理`)
      }
    }
  })
})

// ===== 导出 / 导入配置链接 =====
// 链接格式：https://shui-tiao.github.io/kdocs-fetcher/docs/#/import?v=1&d=<密文>&x=<扩展ID>
// d 为 base64url 编码的加密配置（放在 hash 中，不会随请求发往服务器）
const EXPORT_LINK_BASE = 'https://shui-tiao.github.io/kdocs-fetcher/docs'

const exportBtn = document.getElementById('exportBtn')
const exportResult = document.getElementById('exportResult')
const exportLinkInput = document.getElementById('exportLink')
const copyExportLinkBtn = document.getElementById('copyExportLink')
const importBtn = document.getElementById('importBtn')
const importModal = document.getElementById('importModal')
const importLinkInput = document.getElementById('importLinkInput')
const importConfirmBtn = document.getElementById('importConfirmBtn')
const importCancelBtn = document.getElementById('importCancelBtn')

function bytesToB64Url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64UrlToBytes(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const bin = atob(s + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function encodeImportData(backup) {
  return bytesToB64Url(new TextEncoder().encode(JSON.stringify(backup)))
}

function buildExportLink(backup) {
  return EXPORT_LINK_BASE + '/#/import?v=1&d=' + encodeImportData(backup) + '&x=' + chrome.runtime.id
}

// 解析链接（也允许只粘贴 # 后面的片段），取出加密配置对象
function parseImportLink(raw) {
  // 长链接被聊天工具转载时常被折行，解析前先去掉所有空白字符
  const text = String(raw || '').replace(/\s+/g, '')
  if (!text) throw new Error('请先粘贴配置链接')

  let hash = ''
  try {
    hash = new URL(text).hash
  } catch (_) {
    hash = text
  }
  hash = hash.replace(/^#/, '')

  const q = hash.indexOf('?')
  if (q < 0 || !hash.slice(0, q).includes('import')) {
    throw new Error('链接格式不正确，请确认是导出的配置链接')
  }

  const rawD = new URLSearchParams(hash.slice(q + 1)).get('d')
  if (!rawD) throw new Error('链接中未找到配置数据')
  // 长链接经聊天工具转载时可能混入换行，这里一并清理
  const d = rawD.replace(/\s+/g, '')

  let backup
  try {
    backup = JSON.parse(new TextDecoder().decode(b64UrlToBytes(d)))
  } catch (_) {
    throw new Error('链接数据已损坏或被截断')
  }
  if (!backup || !backup.data) throw new Error('链接中未找到配置数据')
  return backup
}

// 打开 PIN 输入框，解密并还原（覆盖当前配置）
function startImport(backup) {
  openPinModal({
    title: '从链接导入配置',
    desc: '请输入导出时设置的 6 位 PIN 解密还原（将覆盖当前配置）。',
    confirmText: '解密还原',
    onSubmit: async (pin) => {
      let cfg
      try {
        cfg = await Migration.decryptConfig(pin, backup)
      } catch (_) {
        showToast('PIN 错误或链接数据已损坏')
        pinModalConfirm.disabled = false
        return
      }
      if (!cfg.webhookUrl || !cfg.token) {
        showToast('导入的数据缺少 Webhook 链接或脚本令牌，已取消还原')
        pinModalConfirm.disabled = false
        return
      }
      await chrome.storage.local.set(Migration.sanitizeConfig(cfg))
      pinModal.classList.add('hidden')
      showToast('已从链接还原配置，即将刷新页面…', true)
      setTimeout(() => location.reload(), 1200)
    }
  })
}

exportBtn.addEventListener('click', () => {
  exportResult.classList.add('hidden')
  openPinModal({
    title: '导出配置链接',
    desc: '请设置 6 位数字 PIN 用于加密配置。PIN 不会被保存，还原时必须输入相同 PIN，请务必牢记。',
    confirmText: '加密并生成链接',
    onSubmit: async (pin) => {
      const cfg = await chrome.storage.local.get(Migration.CONFIG_KEYS)
      if (!cfg.webhookUrl || !cfg.token) {
        showToast('请先保存配置（至少包含 Webhook 链接和脚本令牌）')
        pinModalConfirm.disabled = false
        return
      }
      const backup = await Migration.encryptConfig(pin, cfg)
      exportLinkInput.value = buildExportLink(backup)
      pinModal.classList.add('hidden')
      exportResult.classList.remove('hidden')
      exportLinkInput.focus()
      exportLinkInput.select()
      showToast('已生成配置链接，请保存', true)
    }
  })
})

copyExportLinkBtn.addEventListener('click', async () => {
  const text = exportLinkInput.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copyExportLinkBtn.textContent = '已复制'
    setTimeout(() => { copyExportLinkBtn.textContent = '复制' }, 1500)
  } catch (_) {
    exportLinkInput.focus()
    exportLinkInput.select()
    showToast('复制失败，已选中链接，请手动复制')
  }
})

importBtn.addEventListener('click', () => {
  importLinkInput.value = ''
  importModal.classList.remove('hidden')
  importLinkInput.focus()
})

importCancelBtn.addEventListener('click', () => importModal.classList.add('hidden'))

importConfirmBtn.addEventListener('click', () => {
  let backup
  try {
    backup = parseImportLink(importLinkInput.value)
  } catch (e) {
    showToast(e.message)
    return
  }
  importModal.classList.add('hidden')
  startImport(backup)
})

importLinkInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') importConfirmBtn.click()
})

// 从官网链接跳转进入（options.html#/import?...）或官网唤起导入时，自动弹出 PIN 输入框
let importStarted = false

function beginImport(backup) {
  if (importStarted) return
  importStarted = true
  startImport(backup)
}

;(async () => {
  if (!location.hash.includes('import')) return
  // 锁定时页面会跳去解锁，保留 hash 以便解锁回到本页后再处理
  if (await Lock.isLocked()) return
  let backup = null
  try { backup = parseImportLink(location.href) } catch (_) {}
  // 清掉 hash，避免刷新后重复弹出
  history.replaceState(null, '', location.pathname + location.search)
  if (backup) beginImport(backup)
})()

// 官网「打开扩展进行导入」把加密配置暂存后打开本页，这里接手
chrome.storage.local.get('pendingImport', async (res) => {
  const backup = res.pendingImport
  if (!backup || !backup.data) return
  if (await Lock.isLocked()) return
  chrome.storage.local.remove('pendingImport')
  beginImport(backup)
})
