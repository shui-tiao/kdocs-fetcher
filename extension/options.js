// 已锁定时配置页一律跳转到解锁界面
;(async () => {
  if (await Lock.isLocked()) location.replace('unlock.html?return=options')
})()

const urlInput = document.getElementById('webhookUrl')
const tokenInput = document.getElementById('token')
const sheetInput = document.getElementById('sheetName')
const fieldListEl = document.getElementById('fieldList')
const statusEl = document.getElementById('status')
const autoCopySelect = document.getElementById('autoCopyField')
const autoFetchInput = document.getElementById('autoFetch')
const autoCopySection = document.getElementById('autoCopySection')

// 关闭自动拉取后，自动复制字段失去意义：重置为不自动复制并隐藏
function syncAutoFetchUI() {
  const enabled = autoFetchInput.checked
  autoCopySection.hidden = !enabled
  if (!enabled) autoCopySelect.value = ''
}

autoFetchInput.addEventListener('change', syncAutoFetchUI)

let savedAutoCopyField = ''

function createFieldRow(value) {
  const row = document.createElement('div')
  row.className = 'field-row'
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = '表头名（如 内容），或 显示名=列字母（如 机构=E）'
  input.value = value || ''
  input.addEventListener('input', refreshAutoCopyOptions)
  const del = document.createElement('button')
  del.type = 'button'
  del.className = 'del'
  del.textContent = '删除'
  del.addEventListener('click', () => {
    fieldListEl.removeChild(row)
    if (!fieldListEl.children.length) {
      fieldListEl.appendChild(createFieldRow(''))
    }
    refreshAutoCopyOptions()
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

function extractBaseName(raw) {
  // raw 可能是 "内容" / "机构=E" / "日期:date" / "机构=E:date"
  return raw.split('=')[0].split(':')[0].trim()
}

function refreshAutoCopyOptions() {
  const current = autoCopySelect.value
  autoCopySelect.innerHTML = ''
  const noneOpt = document.createElement('option')
  noneOpt.value = ''
  noneOpt.textContent = '不自动复制'
  autoCopySelect.appendChild(noneOpt)
  for (const raw of getFields()) {
    const opt = document.createElement('option')
    opt.value = raw
    const base = extractBaseName(raw)
    opt.textContent = raw === base ? raw : base + '（' + raw + '）'
    autoCopySelect.appendChild(opt)
  }
  // 恢复之前的选择（如果还存在）
  if ([...autoCopySelect.options].some((o) => o.value === current)) {
    autoCopySelect.value = current
  } else if ([...autoCopySelect.options].some((o) => o.value === savedAutoCopyField)) {
    autoCopySelect.value = savedAutoCopyField
  } else {
    autoCopySelect.value = ''
  }
}

chrome.storage.local.get(['webhookUrl', 'token', 'sheet', 'fields', 'order', 'autoCopyField', 'autoFetch'], (cfg) => {
  if (cfg.webhookUrl) urlInput.value = cfg.webhookUrl
  if (cfg.token) tokenInput.value = cfg.token
  if (cfg.sheet) sheetInput.value = cfg.sheet
  const fields = Array.isArray(cfg.fields) && cfg.fields.length ? cfg.fields : ['内容']
  fields.forEach((f) => fieldListEl.appendChild(createFieldRow(f)))
  const order = cfg.order === 'top' ? 'top' : 'bottom'
  document.querySelector('input[name="order"][value="' + order + '"]').checked = true
  autoFetchInput.checked = cfg.autoFetch !== false
  savedAutoCopyField = cfg.autoCopyField || ''
  refreshAutoCopyOptions()
  syncAutoFetchUI()
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
  refreshAutoCopyOptions()
})

document.getElementById('save').addEventListener('click', () => {
  const webhookUrl = urlInput.value.trim()
  const token = tokenInput.value.trim()
  const sheet = sheetInput.value.trim()
  const fields = getFields()
  const orderEl = document.querySelector('input[name="order"]:checked')
  const order = orderEl ? orderEl.value : 'bottom'
  const autoCopyField = autoCopySelect.value

  if (!webhookUrl.startsWith('https://www.kdocs.cn/')) {
    statusEl.className = 'err'
    statusEl.textContent = 'Webhook 链接需以 https://www.kdocs.cn/ 开头'
    return
  }
  if (!token) {
    statusEl.className = 'err'
    statusEl.textContent = '脚本令牌不能为空'
    return
  }
  if (!fields.length) {
    statusEl.className = 'err'
    statusEl.textContent = '请至少填写一个要拉取的字段'
    return
  }

  chrome.storage.local.set({ webhookUrl, token, sheet, fields, order, autoCopyField, autoFetch: autoFetchInput.checked }, () => {
    savedAutoCopyField = autoCopyField
    statusEl.className = 'ok'
    statusEl.textContent = '已保存'
  })
})

// 锁定：设置 6 位数字 PIN 后进入锁定状态
const lockBtn = document.getElementById('lockBtn')
const lockModal = document.getElementById('lockModal')
const pinInput = document.getElementById('pinInput')
const pinConfirmInput = document.getElementById('pinConfirm')
const lockErrorEl = document.getElementById('lockError')
const lockConfirmBtn = document.getElementById('lockConfirm')
const lockCancelBtn = document.getElementById('lockCancel')

function openLockModal() {
  pinInput.value = ''
  pinConfirmInput.value = ''
  lockErrorEl.textContent = ''
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
    lockErrorEl.textContent = '请输入 6 位数字 PIN'
    return
  }
  if (pin !== pinConfirmInput.value) {
    lockErrorEl.textContent = '两次输入的 PIN 不一致'
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
