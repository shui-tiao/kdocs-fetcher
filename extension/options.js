const urlInput = document.getElementById('webhookUrl')
const tokenInput = document.getElementById('token')
const fieldListEl = document.getElementById('fieldList')
const statusEl = document.getElementById('status')

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
    if (!fieldListEl.children.length) fieldListEl.appendChild(createFieldRow(''))
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

chrome.storage.local.get(['webhookUrl', 'token', 'fields', 'order'], (cfg) => {
  if (cfg.webhookUrl) urlInput.value = cfg.webhookUrl
  if (cfg.token) tokenInput.value = cfg.token
  const fields = Array.isArray(cfg.fields) && cfg.fields.length ? cfg.fields : ['内容']
  fields.forEach((f) => fieldListEl.appendChild(createFieldRow(f)))
  const order = cfg.order === 'top' ? 'top' : 'bottom'
  document.querySelector('input[name="order"][value="' + order + '"]').checked = true
})

document.getElementById('addField').addEventListener('click', () => {
  fieldListEl.appendChild(createFieldRow(''))
})

document.getElementById('save').addEventListener('click', () => {
  const webhookUrl = urlInput.value.trim()
  const token = tokenInput.value.trim()
  const fields = getFields()
  const orderEl = document.querySelector('input[name="order"]:checked')
  const order = orderEl ? orderEl.value : 'bottom'

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

  chrome.storage.local.set({ webhookUrl, token, fields, order }, () => {
    statusEl.className = 'ok'
    statusEl.textContent = '已保存'
  })
})
