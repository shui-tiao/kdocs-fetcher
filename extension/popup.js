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
  if (!navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (_) {
    return false
  }
}

// 按展示字段配置过滤并排序；未配置过（非数组）时展示全部
function filterDisplayFields(list, displayFields) {
  if (!Array.isArray(displayFields)) return list
  const out = []
  for (const df of displayFields) {
    // 与自动复制一致：去掉 「=列字母」「:date」 等修饰后按显示名匹配
    const base = String(df).split('=')[0].split(':')[0].trim()
    if (!base) continue
    const hit = list.find((f) => f && f.name === base && !out.includes(f))
    if (hit) out.push(hit)
  }
  return out
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
  // 已锁定：不发起任何 webhook 请求，直接进入解锁界面
  if (await Lock.isLocked()) {
    location.replace('unlock.html?return=popup')
    return
  }

  fieldsEl.innerHTML = ''
  statusEl.className = 'loading'
  statusEl.textContent = '加载中…'
  statusEl.classList.remove('hidden')
  copyBtn.disabled = true

  const cfg = await chrome.storage.local.get(['webhookUrl', 'token', 'sheet', 'fields', 'order', 'autoCopyField', 'displayFields'])
  if (!cfg.webhookUrl || !cfg.token) {
    // 精确指出缺了哪项，并标出当前扩展的版本与 ID，便于区分是否装了两份副本
    // （不同安装路径的副本扩展 ID 不同，存储互不相通）
    const missing = []
    if (!cfg.webhookUrl) missing.push('Webhook 链接')
    if (!cfg.token) missing.push('脚本令牌')
    const tag = 'v' + chrome.runtime.getManifest().version + ' / ' + String(chrome.runtime.id).slice(-6)
    showError('尚未配置：' + missing.join('、') + '（当前扩展 ' + tag + '）。若已在配置页保存或导入，说明该副本与配置页不是同一份，请到 chrome://extensions 只保留一个本扩展')
    openOptionsBtn.classList.remove('hidden')
    return
  }
  openOptionsBtn.classList.add('hidden')

  const fields = Array.isArray(cfg.fields) ? cfg.fields : []
  if (!fields.length) {
    showError('尚未配置要拉取的字段，请到配置页「连接」中添加')
    return
  }
  const order = cfg.order === 'top' ? 'top' : 'bottom'
  const argv = { fields, order }
  if (cfg.sheet) argv.sheet = cfg.sheet

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
  if (!Array.isArray(result.fields) || result.v !== 14) {
    showError('金山文档中的脚本版本过旧，请将最新 air.js 重新部署到脚本编辑器')
    return
  }

  const displayed = filterDisplayFields(result.fields, cfg.displayFields)
  if (Array.isArray(cfg.displayFields) && !displayed.length) {
    showError('没有可展示的字段，请到配置页「主页 → 要展示的字段」检查配置')
    return
  }

  await renderFields(displayed, cfg.autoCopyField || '')
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

// 未关闭「自动拉取字段」时，打开弹窗即自动拉取；关闭时等待手动点击「重新获取」
;(async () => {
  if (await Lock.isLocked()) {
    location.replace('unlock.html?return=popup')
    return
  }
  const cfg = await chrome.storage.local.get('autoFetch')
  if (cfg.autoFetch === false) {
    statusEl.className = 'loading'
    statusEl.textContent = '已关闭自动拉取，点击「重新获取」获取数据'
    return
  }
  fetchLatest()
})()
