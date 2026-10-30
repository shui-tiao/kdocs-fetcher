const TOTAL = 7
const REQUIRED_SCRIPT_VERSION = 14

// 已锁定时向导不可使用，跳转到解锁界面
;(async () => {
  if (await Lock.isLocked()) location.replace('unlock.html?return=wizard')
})()

const barEl = document.getElementById('bar')
const stepLabelEl = document.getElementById('stepLabel')
const prevBtn = document.getElementById('prev')
const nextBtn = document.getElementById('next')
const errorEl = document.getElementById('error')
const tokenInput = document.getElementById('token')
const webhookInput = document.getElementById('webhookUrl')
const copyCodeBtn = document.getElementById('copyCode')
const copyStatusEl = document.getElementById('copyStatus')
const summaryEl = document.getElementById('summary')
const closeTipEl = document.getElementById('closeTip')
const probeStateEl = document.getElementById('probeState')
const sheetListEl = document.getElementById('sheetList')
const reprobeBtn = document.getElementById('reprobe')
const backStepBtn = document.getElementById('backStep')
const fieldsInput = document.getElementById('wizardFields')
const fieldChipsEl = document.getElementById('fieldChips')
const doneMarkEl = document.getElementById('doneMark')
const wizardConfigEl = document.getElementById('wizardConfig')
const savedNoteEl = document.getElementById('savedNote')

let step = 1
let codeText = ''
let probeResult = null      // 探测返回：{ ok, mode, tables, active }
let selectedSheet = ''      // 当前选中的数据表名
let probing = false
let finished = false
let savedSheet = ''         // 已保存的表名（作为默认选中）

function showError(msg) {
  errorEl.textContent = msg || ''
}

function saveConfig(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve))
}

function renderSummary() {
  summaryEl.innerHTML = ''
  const rows = [
    ['脚本令牌', tokenInput.value.trim() ? '已填写' : '未填写'],
    ['Webhook 链接', webhookInput.value.trim() || '未填写']
  ]
  for (const [label, value] of rows) {
    const line = document.createElement('div')
    const key = document.createElement('b')
    key.textContent = label + '：'
    line.appendChild(key)
    line.appendChild(document.createTextNode(value))
    summaryEl.appendChild(line)
  }
}

function render() {
  for (const section of document.querySelectorAll('.step')) {
    section.hidden = Number(section.dataset.step) !== step
  }
  stepLabelEl.textContent = '第 ' + step + ' / ' + TOTAL + ' 步'
  barEl.style.width = (step / TOTAL) * 100 + '%'
  prevBtn.disabled = step === 1
  nextBtn.disabled = false
  closeTipEl.hidden = true
  if (step === 7) {
    nextBtn.textContent = '保存并完成'
  } else if (step === 4 || step === 5 || step === 6) {
    nextBtn.textContent = '保存并进入下一步'
  } else {
    nextBtn.textContent = '下一步'
  }
  showError('')
  if (step === 6) renderSummary()
  if (step === 7) {
    // 进入第 7 步就探测；探测中/失败时禁用「保存并完成」
    if (!probeResult) {
      probeTables()
    } else {
      nextBtn.disabled = false
    }
  }
}

// ============ 第 7 步：探测表清单 ============

function setProbeState(text, kind) {
  probeStateEl.textContent = text
  probeStateEl.className = 'probe-state' + (kind ? ' ' + kind : '')
}

function showBackStep(n) {
  if (!n) {
    backStepBtn.hidden = true
    return
  }
  backStepBtn.hidden = false
  backStepBtn.textContent = '返回第 ' + n + ' 步检查'
  backStepBtn.dataset.step = String(n)
}

function probeFail(msg, backStep) {
  probeResult = null
  probing = false
  nextBtn.disabled = true
  sheetListEl.hidden = true
  sheetListEl.innerHTML = ''
  fieldChipsEl.innerHTML = ''
  reprobeBtn.hidden = false
  setProbeState(msg, 'err')
  showBackStep(backStep)
}

async function probeTables() {
  if (probing) return
  probing = true
  probeResult = null
  selectedSheet = ''
  nextBtn.disabled = true
  reprobeBtn.hidden = true
  sheetListEl.hidden = true
  sheetListEl.innerHTML = ''
  fieldChipsEl.innerHTML = ''
  showBackStep(0)
  showError('')
  setProbeState('正在探测文档里的数据表…', '')

  const webhookUrl = webhookInput.value.trim()
  const token = tokenInput.value.trim()
  if (!webhookUrl || !token) {
    probeFail('缺少 Webhook 链接或脚本令牌，请回到前面的步骤填写', !webhookUrl ? 5 : 4)
    return
  }

  let res
  try {
    res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'AirScript-Token': token },
      body: JSON.stringify({ Context: { argv: { probe: true } } })
    })
  } catch (e) {
    probeFail('无法访问 Webhook（网络错误：' + e.message + '），请检查第 5 步复制的链接', 5)
    return
  }

  if (res.status === 401 || res.status === 403) {
    probeFail('脚本令牌无效或已过期（HTTP ' + res.status + '），请回到第 4 步重新申请', 4)
    return
  }
  if (res.status === 404) {
    probeFail('Webhook 链接不正确（HTTP 404），请回到第 5 步重新复制', 5)
    return
  }
  if (!res.ok) {
    probeFail('Webhook 请求失败（HTTP ' + res.status + '），请检查第 5 步的链接', 5)
    return
  }

  let json
  try {
    json = await res.json()
  } catch (e) {
    probeFail('Webhook 返回的不是 JSON，请确认第 5 步复制的是脚本的 Webhook 链接', 5)
    return
  }

  if (json.status !== 'finished' || json.error) {
    const detail = String(json.error || json.status || '未知错误')
    probeFail('脚本执行失败：' + detail + '。请确认第 3 步已粘贴最新脚本并保存', 3)
    return
  }

  const result = json.data && json.data.result
  if (!result || typeof result !== 'object') {
    probeFail('脚本没有返回结果，请确认第 3 步粘贴的是完整的 air.js 并已保存', 3)
    return
  }
  if (result.v !== REQUIRED_SCRIPT_VERSION) {
    probeFail('金山文档中的脚本版本过旧（v' + result.v + '，需要 v' + REQUIRED_SCRIPT_VERSION + '），请回到第 3 步重新粘贴最新 air.js 并保存', 3)
    return
  }
  if (!result.ok) {
    probeFail('探测失败：' + (result.error || '脚本返回失败') + '。请检查第 3 步的脚本是否与当前文档匹配', 3)
    return
  }

  probing = false
  probeResult = result
  nextBtn.disabled = false
  reprobeBtn.hidden = false
  showBackStep(0)

  if (result.mode === 'data_table') {
    const tables = Array.isArray(result.tables) ? result.tables : []
    if (!tables.length) {
      probeFail('文档里没有探测到可读取的数据表，请检查第 3 步的脚本版本或文档权限', 3)
      return
    }
    // 默认选中：已保存的表 → 当前视图所在表 → 第一张表
    let def = ''
    for (const t of tables) {
      if (t.name === savedSheet) { def = t.name; break }
    }
    if (!def && result.active) {
      for (const t of tables) {
        if (t.name === result.active) { def = t.name; break }
      }
    }
    if (!def) def = tables[0].name
    selectedSheet = def
    renderSheetList(tables)
    setProbeState('探测到 ' + tables.length + ' 张数据表，请选择要拉取的一张', 'ok')
  } else {
    selectedSheet = ''
    setProbeState('当前文档是电子表格（不是多维表格），无需选择数据表，直接填写字段即可', 'ok')
  }
  renderChips()
}

function renderSheetList(tables) {
  sheetListEl.innerHTML = ''
  for (const t of tables) {
    const label = document.createElement('label')
    label.className = 'sheet-item'
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'wizardSheet'
    radio.value = t.name
    radio.checked = t.name === selectedSheet
    radio.addEventListener('change', () => {
      selectedSheet = t.name
      // 换了数据表，字段名不再通用，清空后重新选择
      fieldsInput.value = ''
      renderChips()
    })
    const nameEl = document.createElement('span')
    nameEl.textContent = t.name
    const metaEl = document.createElement('em')
    metaEl.textContent = (Array.isArray(t.fields) ? t.fields.length : 0) + ' 个字段'
    label.appendChild(radio)
    label.appendChild(nameEl)
    label.appendChild(metaEl)
    sheetListEl.appendChild(label)
  }
  sheetListEl.hidden = false
}

// 字段输入用逗号/顿号/分号/换行分隔
function parseFieldList() {
  return fieldsInput.value
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// 取一项字段的定位目标（去掉「显示名=」前缀与「:date」后缀）用于和表字段名比对
function fieldTarget(entry) {
  let s = entry
  const eq = s.lastIndexOf('=')
  if (eq >= 0) s = s.slice(eq + 1)
  return s.replace(/:date$/i, '').trim()
}

function currentTableFields() {
  if (!probeResult || probeResult.mode !== 'data_table') return []
  const tables = Array.isArray(probeResult.tables) ? probeResult.tables : []
  for (const t of tables) {
    if (t.name === selectedSheet) return Array.isArray(t.fields) ? t.fields : []
  }
  return []
}

function renderChips() {
  fieldChipsEl.innerHTML = ''
  const names = currentTableFields()
  if (!names.length) return
  const picked = parseFieldList().map(fieldTarget)
  for (const name of names) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip' + (picked.indexOf(name) >= 0 ? ' on' : '')
    chip.textContent = name
    chip.addEventListener('click', () => toggleField(name))
    fieldChipsEl.appendChild(chip)
  }
}

function toggleField(name) {
  const list = parseFieldList()
  const exists = list.some((e) => fieldTarget(e) === name)
  const next = exists ? list.filter((e) => fieldTarget(e) !== name) : list.concat(name)
  fieldsInput.value = next.join(',')
  renderChips()
}

async function saveAndFinish() {
  const list = parseFieldList()
  if (!list.length) {
    showError('请至少填写一个要抓取的字段')
    return
  }
  if (probeResult && probeResult.mode === 'data_table' && !selectedSheet) {
    showError('请选择一个数据表')
    return
  }
  await saveConfig({
    token: tokenInput.value.trim(),
    webhookUrl: webhookInput.value.trim(),
    sheet: probeResult && probeResult.mode === 'data_table' ? selectedSheet : '',
    fields: list
  })
  // 侧边栏内无法自行关闭：通知配置页刷新，并标记完成
  chrome.runtime.sendMessage({ type: 'config-updated' }, () => void chrome.runtime.lastError)
  finished = true
  nextBtn.textContent = '已保存，可关闭侧边栏'
  nextBtn.disabled = true
  prevBtn.disabled = true
  // 保存完成：隐藏配置项，只留下提示与绿色对勾
  wizardConfigEl.hidden = true
  savedNoteEl.textContent = '已保存：' + (selectedSheet ? '数据表「' + selectedSheet + '」' : '电子表格') + '，' + list.length + ' 个字段'
  savedNoteEl.hidden = false
  doneMarkEl.hidden = false
  closeTipEl.hidden = false
}

async function goNext() {
  if (finished) return
  if (step === 4) {
    const token = tokenInput.value.trim()
    if (!token) {
      showError('请先粘贴脚本令牌')
      return
    }
    await saveConfig({ token })
  } else if (step === 5) {
    const webhookUrl = webhookInput.value.trim()
    if (!webhookUrl.startsWith('https://www.kdocs.cn/')) {
      showError('Webhook 链接需以 https://www.kdocs.cn/ 开头')
      return
    }
    await saveConfig({ webhookUrl })
  } else if (step === 6) {
    await saveConfig({ token: tokenInput.value.trim(), webhookUrl: webhookInput.value.trim() })
  } else if (step === 7) {
    await saveAndFinish()
    return
  }
  if (step < TOTAL) {
    step++
    render()
  }
}

async function copyToClipboard(text) {
  if (!navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (_) {
    return false
  }
}

async function loadCode() {
  try {
    const res = await fetch('air.js')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    codeText = await res.text()
  } catch (e) {
    copyCodeBtn.disabled = true
    copyStatusEl.className = 'hint err'
    copyStatusEl.textContent = '代码加载失败，请手动复制 air.js 内容'
  }
}

// 截图缺失时显示占位框（图片放在 extension/screenshots/stepN.png）
function bindScreenshotFallback() {
  for (const img of document.querySelectorAll('.shot')) {
    const placeholder = img.nextElementSibling
    const showPlaceholder = () => {
      img.hidden = true
      if (placeholder) placeholder.hidden = false
    }
    if (img.complete && img.naturalWidth === 0) showPlaceholder()
    img.addEventListener('error', showPlaceholder)
  }
}

prevBtn.addEventListener('click', () => {
  if (finished) return
  if (step > 1) {
    step--
    render()
  }
})

nextBtn.addEventListener('click', goNext)

reprobeBtn.addEventListener('click', () => {
  if (!probing && !finished) probeTables()
})

backStepBtn.addEventListener('click', () => {
  const n = Number(backStepBtn.dataset.step)
  if (n >= 1 && n <= TOTAL) {
    step = n
    render()
  }
})

for (const input of [tokenInput, webhookInput, fieldsInput]) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nextBtn.click()
  })
}

fieldsInput.addEventListener('input', renderChips)

copyCodeBtn.addEventListener('click', async () => {
  if (!codeText) return
  const ok = await copyToClipboard(codeText)
  copyStatusEl.className = ok ? 'hint' : 'hint err'
  copyStatusEl.textContent = ok ? '已复制，粘贴到脚本编辑器即可' : '复制失败，请手动复制'
  if (ok) {
    setTimeout(() => {
      if (copyStatusEl.textContent.startsWith('已复制')) copyStatusEl.textContent = ''
    }, 3000)
  }
})

bindScreenshotFallback()
loadCode()

chrome.storage.local.get(['token', 'webhookUrl', 'sheet', 'fields'], (cfg) => {
  if (cfg.token) tokenInput.value = cfg.token
  if (cfg.webhookUrl) webhookInput.value = cfg.webhookUrl
  if (cfg.sheet) savedSheet = cfg.sheet
  if (Array.isArray(cfg.fields) && cfg.fields.length) fieldsInput.value = cfg.fields.join(',')
  render()
})
