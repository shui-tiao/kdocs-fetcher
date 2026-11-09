// 已锁定时配置页一律跳转到解锁界面
;(async () => {
  if (await Lock.isLocked()) location.replace('unlock.html?return=options')
})()

const urlInput = document.getElementById('webhookUrl')
const tokenInput = document.getElementById('token')
const sheetInput = document.getElementById('sheetName')
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
const contextMenuPasteInput = document.getElementById('contextMenuPaste')
const contextMenuPasteTip = document.getElementById('contextMenuPasteTip')
const charByCharPasteInput = document.getElementById('charByCharPaste')
const charByCharPasteRow = document.getElementById('charByCharPasteRow')
const charByCharPasteTip = document.getElementById('charByCharPasteTip')

const CONTEXT_MENU_TIP_DEFAULT = contextMenuPasteTip.textContent
const CONTEXT_MENU_TIP_NEED_AUTOCOPY = '你需要先设置自动复制字段才能使用这个功能'

// 该选项依赖自动复制字段：未设置时禁用；已勾选但字段被取消时自动取消勾选
// 「逐字形式粘贴」依赖右键粘贴功能：未启用右键粘贴时隐藏
function updateContextMenuPasteUI() {
  const hasAutoCopy = Boolean(autoCopyField)
  contextMenuPasteInput.disabled = !hasAutoCopy
  if (!hasAutoCopy && contextMenuPasteInput.checked) contextMenuPasteInput.checked = false
  contextMenuPasteTip.textContent = hasAutoCopy ? CONTEXT_MENU_TIP_DEFAULT : CONTEXT_MENU_TIP_NEED_AUTOCOPY

  const showCharByChar = contextMenuPasteInput.checked
  charByCharPasteRow.classList.toggle('hidden', !showCharByChar)
  charByCharPasteTip.classList.toggle('hidden', !showCharByChar)
  if (!showCharByChar) charByCharPasteInput.checked = false
}

// 右键粘贴：切换即写入；取消勾选时连带关闭「逐字形式粘贴」（依赖关系）
contextMenuPasteInput.addEventListener('change', () => {
  updateContextMenuPasteUI()
  const patch = { contextMenuPaste: contextMenuPasteInput.checked }
  if (!contextMenuPasteInput.checked) patch.charByCharPaste = false
  chrome.storage.local.set(patch, () => showToast('已保存', true))
})
charByCharPasteInput.addEventListener('change', () => {
  chrome.storage.local.set({ charByCharPaste: charByCharPasteInput.checked }, () => showToast('已保存', true))
})

// ===== 防抖即时保存：连接配置修改即写入原存储键（无保存按钮）；非法值不落库 =====
let savedConn = { webhookUrl: '', token: '', sheet: '' } // 最近一次写入的连接配置，用于差量写入
let connTimer = null
const WEBHOOK_PREFIX = 'https://www.kdocs.cn/'

function saveConnNow() {
  const webhookUrl = urlInput.value.trim()
  const token = tokenInput.value.trim()
  const sheet = sheetInput.value.trim()
  // 允许清空（清空后弹窗进入「尚未配置」空态）；非空值必须合法，非法不写入以免写坏配置
  if (webhookUrl && !webhookUrl.startsWith(WEBHOOK_PREFIX)) {
    showToast('Webhook 链接需以 ' + WEBHOOK_PREFIX + ' 开头，本次修改未保存')
    return
  }
  const patch = {}
  if (webhookUrl !== savedConn.webhookUrl) patch.webhookUrl = webhookUrl
  if (token !== savedConn.token) patch.token = token
  if (sheet !== savedConn.sheet) patch.sheet = sheet
  if (!Object.keys(patch).length) return
  chrome.storage.local.set(patch, () => {
    Object.assign(savedConn, patch)
    showToast('已保存', true)
  })
}
for (const input of [urlInput, tokenInput, sheetInput]) {
  input.addEventListener('input', () => {
    clearTimeout(connTimer)
    connTimer = setTimeout(saveConnNow, 500)
  })
  input.addEventListener('blur', () => { clearTimeout(connTimer); saveConnNow() })
}

// ===== 字段胶囊：只读视图点击=切换自动复制；「管理」态可增删/拖拽，退出「管理」即保存 =====
const chipsEl = document.getElementById('fieldChips')
const chipAddRow = document.getElementById('chipAddRow')
const chipInput = document.getElementById('chipInput')
const chipAddBtn = document.getElementById('chipAdd')
const fieldHintEl = document.getElementById('fieldHint')
const manageToggleBtn = document.getElementById('manageToggle')

let autoCopyField = ''
let savedAutoCopy = ''
let currentFields = []
let savedFields = []
let manageMode = false
let draggingChip = null

const baseName = (n) => String(n).split('=')[0].split(':')[0].trim()

function chipNames() {
  return [...chipsEl.querySelectorAll('.fc[data-name]')].map((c) => c.dataset.name)
}

function refreshChipStars() {
  for (const chip of chipsEl.querySelectorAll('.fc[data-name]')) {
    // 自动复制字段只用黄色高亮（.star）表达，不再显示 ✓ 字符
    chip.classList.toggle('star', baseName(chip.dataset.name) === autoCopyField)
  }
}

function renderChips(names) {
  chipsEl.innerHTML = ''
  if (!names.length) {
    const s = document.createElement('span')
    s.className = 'fc none'
    s.textContent = manageMode ? '尚未添加字段，可在下方输入后点「添加」' : '未添加字段'
    chipsEl.appendChild(s)
    return
  }
  for (const name of names) {
    const chip = document.createElement('span')
    chip.className = 'fc'
      + (baseName(name) === autoCopyField ? ' star' : '')
      + (name.includes(':') ? ' date' : '')
      + (manageMode ? ' edit' : '')
    chip.dataset.name = name
    const label = document.createElement('span')
    label.textContent = name
    chip.appendChild(label)
    if (manageMode) {
      // 只有把手（≡）可拖：整颗胶囊 draggable=true 会让浏览器接管拖拽，
      // 光标离开页面就退化成「拖到地址栏搜索」，也容易误触发文本拖拽。
      chip.draggable = false
      chip.addEventListener('dragstart', (e) => {
        // dragstart 从把手冒泡上来时放行；从胶囊本体发起一律拦下
        if (!e.target.closest || !e.target.closest('.fc-grip')) e.preventDefault()
      })
      const grip = document.createElement('span')
      grip.className = 'fc-grip'
      grip.textContent = '≡'
      grip.title = '拖动排序'
      grip.draggable = true
      grip.addEventListener('dragstart', (e) => {
        draggingChip = chip
        chip.classList.add('dragging')
        e.dataTransfer.effectAllowed = 'move'
        // 只放自定义类型：带 text/plain 时拖到地址栏会被当成搜索词
        try { e.dataTransfer.setData('application/x-kdocs-field', name) } catch (_) {}
      })
      grip.addEventListener('dragend', () => {
        chip.classList.remove('dragging')
        draggingChip = null
      })
      chip.insertBefore(grip, label)
      const x = document.createElement('button')
      x.type = 'button'
      x.className = 'fc-x'
      x.textContent = '×'
      x.title = '删除'
      x.addEventListener('click', (e) => {
        e.stopPropagation()
        chip.remove()
        if (baseName(name) === autoCopyField) { autoCopyField = ''; updateContextMenuPasteUI() }
        if (!chipNames().length) renderChips([])
      })
      chip.appendChild(x)
    } else {
      // 只读视图：点胶囊切换自动复制字段，立即写入（弹窗/右键粘贴实时生效）
      chip.addEventListener('click', () => {
        const base = baseName(name)
        autoCopyField = base === autoCopyField ? '' : base
        chrome.storage.local.set({ autoCopyField }, () => showToast(autoCopyField ? '已设为自动复制字段' : '已取消自动复制字段', true))
        refreshChipStars()
        updateContextMenuPasteUI()
      })
    }
    chipsEl.appendChild(chip)
  }
}

// 退出「管理」时保存：fields 与 displayFields 同序镜像（展示顺序=胶囊顺序），存储键不变
function saveFieldsNow() {
  const fields = chipNames()
  const patch = {}
  if (JSON.stringify(fields) !== JSON.stringify(savedFields)) {
    patch.fields = fields
    patch.displayFields = fields
  }
  if (autoCopyField !== savedAutoCopy) patch.autoCopyField = autoCopyField
  currentFields = fields
  if (Object.keys(patch).length) {
    chrome.storage.local.set(patch, () => {
      savedFields = fields
      savedAutoCopy = autoCopyField
      showToast('字段已保存', true)
    })
  }
  renderChips(fields)
}

manageToggleBtn.addEventListener('click', () => {
  manageMode = !manageMode
  manageToggleBtn.textContent = manageMode ? '完成' : '管理'
  fieldHintEl.textContent = manageMode ? '拖动把手排序' : '点击胶囊设为自动复制'
  chipAddRow.classList.toggle('hidden', !manageMode)
  if (manageMode) {
    renderChips(currentFields)
    try { chipsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) } catch (_) {}
  } else {
    saveFieldsNow()
  }
})

function addChipFromInput() {
  const name = chipInput.value.trim()
  if (!name) return
  if (chipNames().includes(name)) {
    showToast('该字段已存在')
    return
  }
  renderChips([...chipNames(), name])
  chipInput.value = ''
  try { chipInput.focus() } catch (_) {}
}
chipAddBtn.addEventListener('click', addChipFromInput)
chipInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addChipFromInput() })

// 落点按指针几何坐标算，不依赖 hover 到的元素：
// 胶囊换行时行间/容器四周的空白也都能判定；指针在首行上方空白 → 以第一颗为锚点插到最前。
chipsEl.addEventListener('dragover', (e) => {
  if (!manageMode || !draggingChip) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const others = [...chipsEl.querySelectorAll('.fc[data-name]')].filter((c) => c !== draggingChip)
  if (!others.length) { chipsEl.appendChild(draggingChip); return }
  // 第一颗「底部不高于指针」的胶囊 = 指针所在行（或下一行）
  let anchor = null
  for (const c of others) {
    if (c.getBoundingClientRect().bottom >= e.clientY) { anchor = c; break }
  }
  if (!anchor) { chipsEl.appendChild(draggingChip); return }
  const rect = anchor.getBoundingClientRect()
  // 指针在锚点上方（含行间空白）→ 插到它前面；行内按水平中点判定
  const before = e.clientY < rect.top || e.clientX < rect.left + rect.width / 2
  const ref = before ? anchor : anchor.nextSibling
  // 目标位置就是当前位置时不再移动，避免换行处反复重排导致抖动
  // 当前位置 = 被拖胶囊前面还有几颗（即它在全部胶囊中的下标）
  const desiredIdx = before ? others.indexOf(anchor) : others.indexOf(anchor) + 1
  if (desiredIdx === [...chipsEl.querySelectorAll('.fc[data-name]')].indexOf(draggingChip)) return
  chipsEl.insertBefore(draggingChip, ref)
})

// 拖拽期间在页面任意位置都吃掉 dragover/drop：光标离开列表也不会变成「拖到地址栏搜索」
document.addEventListener('dragover', (e) => {
  if (!draggingChip) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
})
document.addEventListener('drop', (e) => {
  if (!draggingChip) return
  e.preventDefault()
})

chrome.storage.local.get(['webhookUrl', 'token', 'sheet', 'fields', 'order', 'autoCopyField', 'autoFetch', 'contextMenuPaste', 'charByCharPaste', 'theme'], (cfg) => {
  if (cfg.webhookUrl) urlInput.value = cfg.webhookUrl
  if (cfg.token) tokenInput.value = cfg.token
  if (cfg.sheet) sheetInput.value = cfg.sheet
  savedConn = { webhookUrl: cfg.webhookUrl || '', token: cfg.token || '', sheet: cfg.sheet || '' }
  const fields = Array.isArray(cfg.fields) ? cfg.fields : []
  currentFields = fields
  savedFields = fields
  savedAutoCopy = cfg.autoCopyField ? baseName(cfg.autoCopyField) : ''
  autoCopyField = savedAutoCopy
  renderChips(fields)
  const order = cfg.order === 'top' ? 'top' : 'bottom'
  document.getElementById('orderSelect').value = order
  autoFetchInput.checked = cfg.autoFetch !== false
  const openMode = cfg.defaultOpenMode === 'panel' ? 'panel' : 'popup'
  document.getElementById('openModeSelect').value = openMode
  const theme = cfg.theme === 'light' || cfg.theme === 'dark' ? cfg.theme : 'auto'
  document.getElementById('themeSelect').value = theme
  contextMenuPasteInput.checked = cfg.contextMenuPaste === true
  charByCharPasteInput.checked = cfg.charByCharPaste === true
  updateContextMenuPasteUI()
})

// 底部「打开配置向导」CTA 已删：状态带右上角胶囊（bandWizardBtn）四态常驻，为唯一向导入口

// 向导完成后刷新本页，避免页面上旧的令牌/链接覆盖新配置
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'config-updated') location.reload()
})

// ===== 行为开关与下拉选项：change 即写入原存储键（无保存按钮） =====
autoFetchInput.addEventListener('change', () => {
  chrome.storage.local.set({ autoFetch: autoFetchInput.checked }, () => showToast('已保存', true))
})
const orderSelect = document.getElementById('orderSelect')
orderSelect.addEventListener('change', () => {
  chrome.storage.local.set({ order: orderSelect.value }, () => showToast('已保存', true))
})
const openModeSelect = document.getElementById('openModeSelect')
openModeSelect.addEventListener('change', () => {
  // background.js 监听该键即时切换弹窗/侧边栏
  chrome.storage.local.set({ defaultOpenMode: openModeSelect.value }, () => showToast('已保存', true))
})
const themeSelect = document.getElementById('themeSelect')
themeSelect.addEventListener('change', () => {
  // theme.js 监听该键即时切换所有扩展页面的主题
  chrome.storage.local.set({ theme: themeSelect.value }, () => showToast('已保存', true))
})

// ===== 配置迁移弹层：两个入口（配置链接 / 云端数据），层内动作按钮沿用原有 id 与处理器 =====
function bindMigrationLayer(openBtnId, layerId) {
  const layer = document.getElementById(layerId)
  document.getElementById(openBtnId).addEventListener('click', () => layer.classList.remove('hidden'))
  layer.addEventListener('click', (e) => { if (e.target === layer) layer.classList.add('hidden') })
  const closeBtn = layer.querySelector('[data-layer-close]')
  if (closeBtn) closeBtn.addEventListener('click', () => layer.classList.add('hidden'))
}
bindMigrationLayer('linkLayerBtn', 'linkLayer')
bindMigrationLayer('cloudLayerBtn', 'cloudLayer')
// 层内动作按钮：点击后先收起所在层，再由原处理器打开二级弹窗/确认流程
for (const btn of document.querySelectorAll('[data-close-layer]')) {
  btn.addEventListener('click', () => document.getElementById(btn.dataset.closeLayer).classList.add('hidden'))
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

const pinModalRisk = document.getElementById('pinModalRisk')

// 导出配置链接的风险提示（链接会被手动传递，存在外传与离线破解风险）
const PIN_RISK_EXPORT = '<b>⚠ 导出前请务必了解以下风险</b>'
  + '生成的链接内含<b style="display:inline;color:inherit">加密后的完整配置（含 webhook 链接和脚本令牌）</b>。'
  + '任何拿到该链接的人，都可以在本地离线尝试破解 PIN，用显卡暴力破解通常只需几分钟到几小时。'
  + '配置泄露会导致您文档数据泄露。<br>'
  + '请勿把链接发到群聊、邮件、工单、截图、代码仓库或任何公开渠道；'
  + '若怀疑链接已外泄，请立即到金山文档脚本编辑器<b style="display:inline;color:inherit">重新生成脚本令牌</b>，旧令牌随即失效。'

// 云端迁移的风险提示（经浏览器账号同步，不外传；主要风险是同步不可控、可能丢数据）
const PIN_RISK_CLOUD = '<b>⚠ 云端备份并非可靠存储</b>'
  + '备份存放在浏览器账号同步空间中，由浏览器自行上传和下发，扩展无法控制同步时机。'
  + '可能出现<b style="display:inline;color:inherit">同步延迟数分钟甚至更久、同步失败、账号退出或切换后数据消失、'
  + '浏览器清理同步数据</b>等情况，导致备份丢失或还原到旧版本。<br>'
  + '请勿把云端备份当作唯一副本；迁移完成后请先在另一台设备上验证能否还原，再清理原设备配置。'

const PIN_RISK_IMPORT = '<b>⚠ 请确认来源可信</b>'
  + '导入会<b style="display:inline;color:inherit">覆盖本机当前配置（含 webhook 链接和脚本令牌）</b>。'
  + '只导入你自己导出、或完全信任的人给你的链接；不要导入来路不明的链接。'

function openPinModal({ title, desc, confirmText, risk, onSubmit, skipPin }) {
  pinModalTitle.textContent = title
  pinModalDesc.textContent = desc
  pinModalRisk.innerHTML = risk || ''
  pinModalRisk.classList.toggle('hidden', !risk)
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
    risk: PIN_RISK_CLOUD,
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
    risk: PIN_RISK_IMPORT,
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
const exportModal = document.getElementById('exportModal')
const exportModalClose = document.getElementById('exportModalClose')
const statsEl = document.getElementById('migrationStats')
const exportLinkInput = document.getElementById('exportLink')
const copyExportLinkBtn = document.getElementById('copyExportLink')
const importBtn = document.getElementById('importBtn')
const importModal = document.getElementById('importModal')
const importLinkInput = document.getElementById('importLinkInput')
const importConfirmBtn = document.getElementById('importConfirmBtn')
const importCancelBtn = document.getElementById('importCancelBtn')

// ===== 导出/导入操作记录 =====
// 独立存储键，不随配置保存或「清除数据」被覆盖/清空，也不参与导入导出
const EXPORT_IMPORT_STATS_KEY = 'exportImportStats'

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function recordMigrationStat(type) {
  const { [EXPORT_IMPORT_STATS_KEY]: stats } = await chrome.storage.local.get(EXPORT_IMPORT_STATS_KEY)
  const next = {
    lastType: type,
    lastTime: Date.now(),
    exportCount: (stats && stats.exportCount) || 0,
    importCount: (stats && stats.importCount) || 0
  }
  if (type === 'export') next.exportCount += 1
  else next.importCount += 1
  await chrome.storage.local.set({ [EXPORT_IMPORT_STATS_KEY]: next })
  renderMigrationStats(next)
  return next
}

function renderMigrationStats(stats) {
  if (!statsEl) return
  if (!stats || !stats.lastType) {
    statsEl.innerHTML = '本机尚未进行过导出或导入操作'
    return
  }
  const isExport = stats.lastType === 'export'
  statsEl.innerHTML = `上次操作：<b>${isExport ? '导出配置' : '导入配置'}</b>`
    + `（${formatTime(stats.lastTime)}）`
    + ` · 自本次安装以来已导出 <b>${stats.exportCount}</b> 次`
    + `，已导入 <b>${stats.importCount}</b> 次`
}

chrome.storage.local.get(EXPORT_IMPORT_STATS_KEY).then((res) => {
  renderMigrationStats(res[EXPORT_IMPORT_STATS_KEY])
})

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
    risk: PIN_RISK_IMPORT,
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
      await recordMigrationStat('import')
      pinModal.classList.add('hidden')
      showToast('已从链接还原配置，即将刷新页面…', true)
      setTimeout(() => location.reload(), 1200)
    }
  })
}

exportBtn.addEventListener('click', () => {
  openPinModal({
    title: '导出配置链接',
    desc: '请设置 6 位数字 PIN 用于加密配置。PIN 不会被保存，还原时必须输入相同 PIN，请务必牢记。',
    risk: PIN_RISK_EXPORT,
    confirmText: '加密并生成链接',
    onSubmit: async (pin) => {
      const cfg = await chrome.storage.local.get(Migration.CONFIG_KEYS)
      if (!cfg.webhookUrl || !cfg.token) {
        showToast('请先保存配置（至少包含 Webhook 链接和脚本令牌）')
        pinModalConfirm.disabled = false
        return
      }
      const backup = await Migration.encryptConfig(pin, cfg)
      await recordMigrationStat('export')
      pinModal.classList.add('hidden')
      showExportLink(buildExportLink(backup))
    }
  })
})

// 导出结果只在弹窗中展示一次：关闭即清空，不落地、不可再次查看
function showExportLink(link) {
  exportLinkInput.value = link
  exportModal.classList.remove('hidden')
  exportLinkInput.focus()
  exportLinkInput.select()
}

function hideExportLink() {
  exportLinkInput.value = ''
  exportModal.classList.add('hidden')
}

exportModalClose.addEventListener('click', hideExportLink)

// 关闭弹窗（点遮罩、Esc）同样清空链接
exportModal.addEventListener('click', (e) => {
  if (e.target === exportModal) hideExportLink()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !exportModal.classList.contains('hidden')) hideExportLink()
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
