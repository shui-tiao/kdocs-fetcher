// 纯展示层：连接状态带 + 分区压暗 + 就地编辑器开关。
// 只读取本地存储做展示推导（配置完整性），不写入任何数据、不发起任何网络请求；
// 不伪造探测：不存在后端探测机制，「配置不完整」按缺项推导呈现。
// 字段胶囊（#fieldChips）由 options.js 渲染与交互，此处不重复渲染，避免 onChanged 时覆盖编辑中的胶囊。
;(async () => {
  const band = document.getElementById('connStatus')
  const txt = document.getElementById('connStatusText')
  const sub = document.getElementById('connStatusSub')
  const ver = document.getElementById('aboutVersion')
  const sectFields = document.getElementById('sectFields')
  const sectBehavior = document.getElementById('sectBehavior')
  if (!band || !window.chrome || !chrome.storage || !chrome.storage.local) return

  if (ver && chrome.runtime.getManifest) {
    try { ver.textContent = 'v' + chrome.runtime.getManifest().version } catch (_) {}
  }

  function setSvc(id, state, text) {
    const el = document.getElementById(id)
    if (!el) return
    el.className = 'st ' + state
    el.textContent = text
  }

  function setAct(id, label, hidden) {
    const el = document.getElementById(id)
    if (!el) return
    el.hidden = !!hidden
    el.textContent = label
    el.dataset.label = label
  }

  // 字段胶囊渲染移交 options.js（可交互：点击=自动复制、管理态增删拖拽）

  function render(cfg) {
    const hasWebhook = !!cfg.webhookUrl
    const hasToken = !!cfg.token
    const fieldCount = Array.isArray(cfg.fields) ? cfg.fields.length : 0
    const missing = []
    if (!hasWebhook) missing.push('Webhook 链接')
    if (!hasToken) missing.push('脚本令牌')
    if (!fieldCount) missing.push('要拉取的字段')

    // 整体四态：加载中(busy) / 已连接(ok) / 配置不完整(partial) / 尚未配置(off)
    band.classList.remove('busy', 'ok', 'partial', 'off')
    if (hasWebhook && hasToken && fieldCount) {
      band.classList.add('ok')
      txt.textContent = '已连接' + (cfg.sheet ? ' · 数据表「' + cfg.sheet + '」' : '')
      sub.textContent = '配置完整，弹窗即可拉取最新记录'
      if (sectFields) sectFields.classList.remove('dim')
      if (sectBehavior) sectBehavior.classList.remove('dim')
    } else if (!hasWebhook && !hasToken && !fieldCount) {
      band.classList.add('off')
      txt.textContent = '尚未配置'
      sub.textContent = '还差 ' + missing.length + ' 项即可开始拉取最新记录'
      if (sectFields) sectFields.classList.add('dim')
      if (sectBehavior) sectBehavior.classList.add('dim')
    } else {
      band.classList.add('partial')
      txt.textContent = '配置不完整'
      sub.textContent = '还差 ' + missing.length + ' 项：' + missing.join('、')
      if (sectFields) sectFields.classList.add('dim')
      if (sectBehavior) sectBehavior.classList.remove('dim')
    }

    // 逐项状态与就地操作（数据表为可选项，未配置态不给操作）
    setSvc('svcWebhookState', hasWebhook ? 'ok' : 'no', hasWebhook ? '✓ 已配置' : '✕ 缺失')
    setAct('svcWebhookAct', hasWebhook ? '修改' : '去填写')
    setSvc('svcTokenState', hasToken ? 'ok' : 'no', hasToken ? '✓ 已配置' : '✕ 缺失')
    setAct('svcTokenAct', hasToken ? '修改' : '去填写')
    if (hasWebhook && hasToken) {
      setSvc('svcSheetState', cfg.sheet ? 'ok' : 'chk', cfg.sheet ? String(cfg.sheet) : '留空 · 自动')
      setAct('svcSheetAct', cfg.sheet ? '更换' : '修改')
    } else {
      setSvc('svcSheetState', 'chk', '待连接')
      setAct('svcSheetAct', '修改', true)
    }
  }

  // 首次渲染前保持 busy「加载中」态
  const keys = ['webhookUrl', 'token', 'fields', 'sheet', 'displayFields', 'autoCopyField']
  try {
    render(await chrome.storage.local.get(keys))
  } catch (e) {
    band.classList.remove('busy')
    band.classList.add('off')
    txt.textContent = '未能读取配置'
    sub.textContent = String(e && e.message ? e.message : e)
  }

  // 保存 / 迁移后实时刷新状态带与胶囊（仅展示）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (keys.some((k) => changes[k])) {
      chrome.storage.local.get(keys).then(render)
    }
  })

  // 状态带「修改 / 去填写 / 更换」就地展开编辑器（编辑器输入由 options.js 防抖即时保存）
  // 注意：编辑器在 HTML 里用 .hidden 类隐藏（options.html 有 .hidden{display:none!important}），
  // 必须切换类而非 hidden 属性——此前切属性导致类仍在、编辑器永远不可见（点「修改」无反应）
  function toggleEditor(editorId, actBtn) {
    const ed = document.getElementById(editorId)
    if (!ed) return
    ed.classList.toggle('hidden')
    if (!ed.classList.contains('hidden')) {
      actBtn.textContent = '收起'
      const input = ed.querySelector('input')
      ed.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => {
        if (!input) return
        try { input.focus({ preventScroll: true }) } catch (_) { try { input.focus() } catch (_) {} }
      }, 250)
    } else {
      actBtn.textContent = actBtn.dataset.label || '修改'
    }
  }
  for (const btn of document.querySelectorAll('.svc .act[data-editor]')) {
    btn.addEventListener('click', () => toggleEditor(btn.dataset.editor, btn))
  }
  // 状态带右上角「打开配置向导」：四态恒可见（意义是覆盖/重配），统一走 wizard-open.js 的侧边栏出口
  const bandWizardBtn = document.getElementById('bandWizardBtn')
  if (bandWizardBtn && window.openWizardPanel) {
    bandWizardBtn.addEventListener('click', () => window.openWizardPanel())
  }
  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => {
      const ed = document.getElementById(btn.dataset.close)
      if (ed) ed.classList.add('hidden')
      const actBtn = document.querySelector('.svc .act[data-editor="' + btn.dataset.close + '"]')
      if (actBtn) actBtn.textContent = actBtn.dataset.label || '修改'
    })
  }

  // 字段区「管理 / 完成」开关由 options.js 处理（胶囊增删拖拽，退出即保存）
})()
