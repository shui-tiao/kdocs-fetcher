const fieldsEl = document.getElementById('fields')
const statusEl = document.getElementById('status')
const copyBtn = document.getElementById('copy')
const refreshBtn = document.getElementById('refresh')
const openOptionsBtn = document.getElementById('openOptions')

const TIMEOUT_MS = 10000

let copyText = ''

function showError(msg) {
  statusEl.className = 'error'
  statusEl.textContent = msg
  statusEl.classList.remove('hidden')
  fieldsEl.innerHTML = ''
  copyBtn.disabled = true
}

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true } catch (_) {}
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

async function renderFields(list, autoCopyField) {
  fieldsEl.innerHTML = ''
  const lines = []
  let valueCount = 0
  let matchedCopyBtn = null
  let matchedValue = ''
  const autoBase = autoCopyField ? autoCopyField.split('=')[0].split(':')[0].trim() : ''

  for (const f of list) {
    const card = document.createElement('div')
    card.className = 'field'

    const name = document.createElement('div')
    name.className = 'field-name'
    const info = []
    if (f.col) info.push(f.col + ' 列')
    if (f.row) info.push('行 ' + f.row)
    const nameLabel = document.createElement('span')
    nameLabel.textContent = info.length ? f.name + '（' + info.join('，') + '）' : f.name
    name.appendChild(nameLabel)

    const value = document.createElement('div')
    if (f.error) {
      value.className = 'field-value error'
      value.textContent = f.error
    } else {
      value.className = 'field-value'
      value.textContent = f.value
      lines.push(list.length > 1 ? f.name + '：' + f.value : f.value)
      valueCount++

      const copyFieldBtn = document.createElement('button')
      copyFieldBtn.className = 'copy-field'
      copyFieldBtn.textContent = '复制'
      copyFieldBtn.addEventListener('click', async () => {
        const ok = await copyToClipboard(f.value)
        if (ok) {
          copyFieldBtn.textContent = '已复制'
          copyFieldBtn.classList.add('copied')
          setTimeout(() => {
            copyFieldBtn.textContent = '复制'
            copyFieldBtn.classList.remove('copied')
          }, 1500)
        } else {
          copyFieldBtn.textContent = '复制失败'
          setTimeout(() => { copyFieldBtn.textContent = '复制' }, 1500)
        }
      })
      name.appendChild(copyFieldBtn)

      if (autoBase && (f.name === autoBase || autoCopyField === f.name || autoCopyField === f.raw)) {
        matchedCopyBtn = copyFieldBtn
        matchedValue = f.value
      }
    }

    card.appendChild(name)
    card.appendChild(value)
    fieldsEl.appendChild(card)
  }
  statusEl.classList.add('hidden')
  copyText = lines.join('\n')
  copyBtn.disabled = valueCount === 0

  if (matchedCopyBtn && matchedValue) {
    const ok = await copyToClipboard(matchedValue)
    if (ok) {
      matchedCopyBtn.textContent = '已复制'
      matchedCopyBtn.classList.add('copied')
      setTimeout(() => {
        matchedCopyBtn.textContent = '复制'
        matchedCopyBtn.classList.remove('copied')
      }, 3000)
    }
  }
}

async function fetchLatest() {
  fieldsEl.innerHTML = ''
  statusEl.className = 'loading'
  statusEl.textContent = '加载中…'
  statusEl.classList.remove('hidden')
  copyBtn.disabled = true

  const cfg = await chrome.storage.local.get(['webhookUrl', 'token', 'fields', 'order', 'autoCopyField'])
  if (!cfg.webhookUrl || !cfg.token) {
    showError('尚未配置 Webhook 链接或脚本令牌')
    openOptionsBtn.classList.remove('hidden')
    return
  }
  openOptionsBtn.classList.add('hidden')

  const fields = Array.isArray(cfg.fields) && cfg.fields.length ? cfg.fields : ['内容']
  const order = cfg.order === 'top' ? 'top' : 'bottom'
  const argv = { fields, order }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res
  try {
    res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'AirScript-Token': cfg.token
      },
      body: JSON.stringify({ Context: { argv } }),
      signal: controller.signal
    })
  } catch (e) {
    showError(e.name === 'AbortError' ? '请求超时（10 秒），请稍后重试' : '网络请求失败：' + e.message)
    return
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    showError('金山文档接口返回 HTTP ' + res.status + '（请检查 Webhook 链接与脚本令牌）')
    return
  }

  let json
  try {
    json = await res.json()
  } catch (e) {
    showError('响应解析失败：' + e.message)
    return
  }

  if (json.status !== 'finished' || json.error) {
    showError('脚本执行失败：' + (json.error || json.status || '未知错误'))
    return
  }

  const result = json.data && json.data.result
  if (!result || typeof result !== 'object') {
    showError('脚本未返回有效结果')
    return
  }
  if (!result.ok) {
    showError(result.error || '脚本返回失败')
    return
  }
  if (!Array.isArray(result.fields) || result.v !== 11) {
    showError('金山文档中的脚本版本过旧，请将最新 air.js 重新部署到脚本编辑器')
    return
  }

  await renderFields(result.fields, cfg.autoCopyField || '')
  statusEl.className = 'loading'
  statusEl.textContent = result.mode === 'data_table' ? '多维表格模式' : '电子表格模式'
  statusEl.classList.remove('hidden')
}

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(copyText)
  copyBtn.textContent = '已复制'
  setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
})

refreshBtn.addEventListener('click', fetchLatest)
openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage())

fetchLatest()
