const contentEl = document.getElementById('content')
const metaEl = document.getElementById('meta')
const copyBtn = document.getElementById('copy')
const refreshBtn = document.getElementById('refresh')
const openOptionsBtn = document.getElementById('openOptions')

const TIMEOUT_MS = 10000

function showError(msg) {
  contentEl.className = 'error'
  contentEl.textContent = msg
  metaEl.textContent = ''
  copyBtn.disabled = true
}

function showContent(content, row) {
  contentEl.className = ''
  contentEl.textContent = content
  metaEl.textContent = '表格行号：' + row
  copyBtn.disabled = false
}

async function fetchLatest() {
  contentEl.className = 'loading'
  contentEl.textContent = '加载中…'
  metaEl.textContent = ''
  copyBtn.disabled = true

  const cfg = await chrome.storage.local.get(['webhookUrl', 'token'])
  if (!cfg.webhookUrl || !cfg.token) {
    showError('尚未配置 Webhook 链接或脚本令牌')
    openOptionsBtn.classList.remove('hidden')
    return
  }
  openOptionsBtn.classList.add('hidden')

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
      body: '{}',
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

  showContent(result.content, result.row)
}

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(contentEl.textContent)
  copyBtn.textContent = '已复制'
  setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
})

refreshBtn.addEventListener('click', fetchLatest)
openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage())

fetchLatest()
