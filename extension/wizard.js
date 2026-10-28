const TOTAL = 6

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

let step = 1
let codeText = ''

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
  if (step === 6) {
    nextBtn.textContent = '完成并退出'
  } else if (step === 4 || step === 5) {
    nextBtn.textContent = '保存并进入下一步'
  } else {
    nextBtn.textContent = '下一步'
  }
  showError('')
  if (step === 6) renderSummary()
}

async function goNext() {
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
    // 向导以弹窗打开时：通知已打开的配置页刷新，关闭弹窗，并在标签页中打开扩展设置
    chrome.windows.getCurrent((win) => {
      if (win && win.type === 'popup') {
        chrome.runtime.sendMessage({ type: 'config-updated' }, () => void chrome.runtime.lastError)
        chrome.runtime.openOptionsPage()
        chrome.windows.remove(win.id)
      } else {
        location.href = 'options.html'
      }
    })
    return
  }
  if (step < TOTAL) {
    step++
    render()
  }
}

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (_) {}
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  return ok
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
  if (step > 1) {
    step--
    render()
  }
})

nextBtn.addEventListener('click', goNext)

for (const input of [tokenInput, webhookInput]) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nextBtn.click()
  })
}

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

chrome.storage.local.get(['token', 'webhookUrl'], (cfg) => {
  if (cfg.token) tokenInput.value = cfg.token
  if (cfg.webhookUrl) webhookInput.value = cfg.webhookUrl
  render()
})
