const urlInput = document.getElementById('webhookUrl')
const tokenInput = document.getElementById('token')
const statusEl = document.getElementById('status')

chrome.storage.local.get(['webhookUrl', 'token'], (cfg) => {
  if (cfg.webhookUrl) urlInput.value = cfg.webhookUrl
  if (cfg.token) tokenInput.value = cfg.token
})

document.getElementById('save').addEventListener('click', () => {
  const webhookUrl = urlInput.value.trim()
  const token = tokenInput.value.trim()

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

  chrome.storage.local.set({ webhookUrl, token }, () => {
    statusEl.className = 'ok'
    statusEl.textContent = '已保存'
  })
})
