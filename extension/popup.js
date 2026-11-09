const fieldsEl = document.getElementById('fields')
const statusEl = document.getElementById('status')
const copyBtn = document.getElementById('copy')
const refreshBtn = document.getElementById('refresh')
const openOptionsBtn = document.getElementById('openOptions')
const menuBtn = document.getElementById('menuBtn')
const menuEl = document.getElementById('menu')
const copiedToastEl = document.getElementById('copiedToast')
const detailLayerEl = document.getElementById('detailLayer')
const errMonoEl = document.getElementById('errMono')
const errChecklistEl = document.getElementById('errChecklist')
const copyErrBtn = document.getElementById('copyErr')
const detailBackBtn = document.getElementById('detailBack')
const menuInfoEl = document.getElementById('menuInfo')

const TIMEOUT_MS = 10000

let copyText = ''
let toastTimer = null
// 气泡就近定位：heroRowEl = 当前成功态的主值容器；toastRowAnchor = 气泡当前跟随的字段行（用于清无边框标记）
let heroRowEl = null
let toastRowAnchor = null

// 复制反馈出现在被复制的字段附近：传 .o-row 时插到该行之后（兄弟节点），否则放进 hero 容器（值下方）。
// 气泡参与文档流、随内容滚动，长值展开时也不会跑出弹窗（不用 fixed 定位、不动态算坐标）。
function showToast(text, anchor) {
  copiedToastEl.textContent = text || '✓ 已自动复制'
  if (anchor && anchor.classList && anchor.classList.contains('o-row')) {
    if (toastRowAnchor && toastRowAnchor !== anchor) toastRowAnchor.classList.remove('toast-after')
    anchor.classList.add('toast-after')
    toastRowAnchor = anchor
    anchor.insertAdjacentElement('afterend', copiedToastEl)
    copiedToastEl.classList.add('row')
  } else {
    if (toastRowAnchor) { toastRowAnchor.classList.remove('toast-after'); toastRowAnchor = null }
    copiedToastEl.classList.remove('row')
    const host = (anchor && anchor.isConnected) ? anchor : heroRowEl
    if (host && host.isConnected) host.appendChild(copiedToastEl)
  }
  copiedToastEl.hidden = false
  clearTimeout(toastTimer)
  // 到期时连同位置标记一起还原，元素回到初始态（不留 toast-after 边框标记 / row 类）
  toastTimer = setTimeout(() => {
    copiedToastEl.hidden = true
    copiedToastEl.classList.remove('row')
    if (toastRowAnchor) { toastRowAnchor.classList.remove('toast-after'); toastRowAnchor = null }
  }, 3000)
}

// ⋯ 菜单顶部只读信息行：表格类型 + 取数方向，由现有配置推导（电子表格的字段带「=列字母」），不加存储键
function updateMenuInfo(cfg) {
  if (!menuInfoEl) return
  const done = (c) => {
    const fields = Array.isArray(c.fields) ? c.fields : []
    const isSheet = fields.some((n) => /=/.test(String(n)))
    menuInfoEl.textContent = (isSheet ? '电子表格' : '多维表格') + ' · ' + (c.order === 'top' ? '取首行值' : '取最新值')
  }
  if (cfg) { done(cfg); return }
  Promise.resolve(chrome.storage.local.get(['fields', 'order'])).then(done)
}

function versionTag() {
  return 'v' + chrome.runtime.getManifest().version + ' / ' + String(chrome.runtime.id).slice(-6)
}

function hostOf(url) {
  try { return new URL(url).host } catch (_) { return String(url || '') }
}

// ============ 错误结构化（error-detail.html） ============
// 主页只留一句话（title + desc + 两个出口）；技术细节（错误原文、HTTP 状态、时间、版本/ID）
// 收进详情层 mono 块。排查清单按 popup.js / background.js 真实存在的失败分支编写，不臆造。
const ERROR_CHECKS = {
  unconfigured: [
    ['跟随配置向导完成连接', '向导会逐步收集 Webhook 链接与脚本令牌'],
    ['确认只保留一份本扩展副本', '不同安装路径的副本存储互不相通，请到 chrome://extensions 检查']
  ],
  'no-fields': [
    ['添加要拉取的字段', '到「扩展配置 → 字段 → 管理」中添加，如 内容、机构、日期:date']
  ],
  timeout: [
    ['检查网络连接', '网页能正常打开时，此项通常不是原因'],
    ['核对 Webhook 链接与脚本令牌', '到「扩展配置 → 连接」逐项比对'],
    ['确认金山文档脚本正在运行', '表格被关闭或脚本被删除都会导致失败']
  ],
  network: [
    ['检查网络连接', '断网、代理或防火墙都可能导致请求失败'],
    ['核对 Webhook 链接', '到「扩展配置 → 连接」比对向导第 5 步复制的链接']
  ],
  http: [
    ['核对 Webhook 链接', '链接不完整或已失效会返回非 200 状态'],
    ['核对脚本令牌', '令牌错误或过期可能导致 401 / 403'],
    ['确认脚本仍在脚本编辑器中保存', '脚本被删除后 Webhook 不再可用']
  ],
  parse: [
    ['确认 Webhook 链接复制完整', '截断的链接可能指向错误页面而非脚本'],
    ['重新复制一次 Webhook 链接', '到「扩展配置 → 连接」粘贴后保存']
  ],
  'script-error': [
    ['确认表格数据仍存在', '字段所在列/视图被删除会导致脚本执行失败'],
    ['重新部署最新 air.js', '到脚本编辑器粘贴最新脚本并保存'],
    ['重试一次', '偶发的服务端错误重试即可恢复']
  ],
  'no-result': [
    ['确认 air.js 已完整粘贴并保存', '模板代码未删除或未保存会导致无结果'],
    ['重新部署最新 air.js', '在向导第 3 步点「复制代码」获取最新脚本']
  ],
  'script-fail': [
    ['确认表格数据仍存在', '字段所在列/视图被删除会导致读取失败'],
    ['确认脚本与当前文档匹配', '同一脚本不能跨文档复用'],
    ['重试一次', '偶发的服务端错误重试即可恢复']
  ],
  'script-old': [
    ['将最新 air.js 重新部署到脚本编辑器', '在向导第 3 步点「复制代码」，覆盖旧脚本并保存'],
    ['保存后重新拉取', '版本一致后即可正常返回字段']
  ],
  'no-display': [
    ['检查「要展示的字段」配置', '到「扩展配置 → 字段 → 管理」核对']
  ],
  unknown: [
    ['重试一次', '若持续失败，请复制错误信息反馈']
  ]
}

// 最近一次错误（供详情层与「复制错误信息」使用）
let lastError = null

function createSvg(paths, stroke) {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('stroke', stroke)
  // 用 CSS 变量着色时，style 优先，确保暗色主题下图标随变量切换
  svg.style.stroke = stroke
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', d)
    svg.appendChild(p)
  }
  return svg
}

const GLYPH_INFO = ['M12 8v4', 'M12 16h.01']
const GLYPH_WARN_TRIANGLE = ['M12 3l10 18H2z', 'M12 10v4', 'M12 17.5h.01']

// 渲染居中安静态：错误 / 空态。opt: { stroke, paths, title, titleClass, descLines[], fixText, onFix, mutedText, onMuted }
function renderQuiet(opt) {
  const descLines = Array.isArray(opt.descLines) ? opt.descLines : []
  // #status 在 HTML 中用 hidden 属性隐藏（[hidden]{display:none!important}），
  // 显示/隐藏必须操作 .hidden 属性而非 classList——此前用 classList 导致所有状态文案不可见
  statusEl.className = 'status error'
  statusEl.hidden = false
  statusEl.textContent = ''
  const wrap = document.createElement('div')
  wrap.className = 'quiet-block'
  const glyph = document.createElement('div')
  glyph.className = 'glyph'
  glyph.appendChild(createSvg(opt.paths, opt.stroke))
  const h3 = document.createElement('h3')
  if (opt.titleClass) h3.className = opt.titleClass
  h3.textContent = opt.title
  const p = document.createElement('p')
  descLines.forEach((line, i) => {
    if (i) p.appendChild(document.createElement('br'))
    p.appendChild(document.createTextNode(line))
  })
  wrap.appendChild(glyph)
  wrap.appendChild(h3)
  wrap.appendChild(p)
  if (opt.fixText) {
    const fix = document.createElement('button')
    fix.type = 'button'
    fix.className = 'fix-go'
    fix.textContent = opt.fixText
    fix.addEventListener('click', opt.onFix)
    wrap.appendChild(fix)
  }
  if (opt.mutedText) {
    const muted = document.createElement('button')
    muted.type = 'button'
    // 无主动作（fixText）时次级动作单独一行，居中显示
    muted.className = 'muted-act' + (opt.fixText ? '' : ' alone')
    muted.textContent = opt.mutedText
    muted.addEventListener('click', opt.onMuted)
    wrap.appendChild(muted)
  }
  statusEl.appendChild(wrap)
  fieldsEl.innerHTML = ''
  heroRowEl = null
  toastRowAnchor = null
  copiedToastEl.hidden = true
  copyBtn.disabled = true
  copyBtn.textContent = '全部复制'
  copyBtn.dataset.label = '全部复制'
  detailLayerEl.hidden = true
}

// 统一错误出口：msg = 主页一句话（与原实现文案一致）；key = 错误分支；tech = 详情层 mono 技术行。
// 错误区不再放「重试」：与底部「重新获取」同功能，只留底部一个重新拉取入口；错误区仅保留就近的「查看详情」。
function showError(msg, key, tech) {
  lastError = {
    msg: String(msg || ''),
    key: key || 'unknown',
    tech: Array.isArray(tech) ? tech.filter(Boolean) : [],
    time: new Date(),
    tag: versionTag()
  }
  renderQuiet({
    stroke: 'var(--err)',
    paths: key === 'script-old' ? ['M12 8v5', 'M12 16h.01'] : (key === 'unconfigured' ? GLYPH_INFO : GLYPH_WARN_TRIANGLE),
    title: msg,
    titleClass: 'err-line',
    mutedText: '查看详情',
    onMuted: openDetail
  })
}

function openDetail() {
  if (!lastError) return
  errMonoEl.textContent = ''
  const bad = document.createElement('span')
  bad.className = 'bad'
  bad.textContent = lastError.msg
  errMonoEl.appendChild(bad)
  const allLines = lastError.tech.concat([
    lastError.time.toLocaleString('zh-CN') + ' · ' + lastError.tag
  ])
  for (const line of allLines) {
    errMonoEl.appendChild(document.createElement('br'))
    errMonoEl.appendChild(document.createTextNode(line))
  }
  errChecklistEl.textContent = ''
  const checks = ERROR_CHECKS[lastError.key] || ERROR_CHECKS.unknown
  checks.forEach(([t, sub], i) => {
    const ck = document.createElement('div')
    ck.className = 'ck'
    const n = document.createElement('span')
    n.className = 'n'
    n.textContent = String(i + 1)
    const body = document.createElement('div')
    const b = document.createElement('b')
    b.textContent = t
    body.appendChild(b)
    body.appendChild(document.createElement('br'))
    const s = document.createElement('span')
    s.className = 'sub'
    s.textContent = sub
    body.appendChild(s)
    ck.appendChild(n)
    ck.appendChild(body)
    errChecklistEl.appendChild(ck)
  })
  detailLayerEl.hidden = false
}

detailBackBtn.addEventListener('click', () => { detailLayerEl.hidden = true })
copyErrBtn.addEventListener('click', async () => {
  if (!lastError) return
  const lines = [
    '金山文档拉取器 错误信息',
    '时间：' + lastError.time.toLocaleString('zh-CN'),
    '版本：' + lastError.tag,
    '错误：' + lastError.msg
  ]
  if (lastError.tech.length) lines.push('技术信息：' + lastError.tech.join(' | '))
  const ok = await copyToClipboard(lines.join('\n'))
  copyErrBtn.textContent = ok ? '✓ 已复制' : '复制失败'
  setTimeout(() => { copyErrBtn.textContent = '复制错误信息（反馈时附带）' }, 1500)
})

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

// 旧配置自愈：当前 UI 没有「隐藏字段」入口，displayFields 只应是 fields 的同序镜像。
// 历史版本向导只写 fields，残留的旧 displayFields 会把新字段过滤掉（严重时整页空）。
// 仅在「明确陈旧」时回写（displayFields 为空数组，或含 fields 里已不存在的名字），
// 保留旧版本用户有意保留的子集，避免把曾经的隐藏字段突然放出来。
async function healStaleDisplayFields(cfg) {
  if (!Array.isArray(cfg.fields) || !cfg.fields.length) return
  if (!Array.isArray(cfg.displayFields)) return
  const bases = new Set(cfg.fields.map((f) => String(f).split('=')[0].split(':')[0].trim()))
  const stale = cfg.displayFields.length === 0 || cfg.displayFields.some((df) => {
    const b = String(df).split('=')[0].split(':')[0].trim()
    return b && !bases.has(b)
  })
  if (!stale) return
  cfg.displayFields = cfg.fields.slice()
  try { await chrome.storage.local.set({ displayFields: cfg.displayFields }) } catch (_) {}
}

async function renderFields(list, autoCopyField) {
  fieldsEl.innerHTML = ''
  heroRowEl = null
  toastRowAnchor = null
  const lines = []
  let valueCount = 0
  let autoCp = null
  const autoBase = autoCopyField ? autoCopyField.split('=')[0].split(':')[0].trim() : ''

  const frag = document.createDocumentFragment()
  const othersEl = document.createElement('div')
  othersEl.className = 'others'

  // 行尾提示随状态切换：短值「复制」/ 截断「展开」/ 已展开「收起」；复制进剪贴板的始终是完整值
  // 交互规则：短值行点行即复制；截断未展开行点行先展开（不复制）；已展开行点行复制、点「收起」折叠
  function bindCopy(rowEl, cp, getValue, isValueEl) {
    cp.dataset.hint = '复制'
    if (!isValueEl) cp.textContent = '复制'
    rowEl.addEventListener('click', async () => {
      if (rowEl.classList.contains('truncated') && !rowEl.classList.contains('open')) {
        rowEl.classList.add('open')
        cp.textContent = '收起'
        cp.dataset.hint = '收起'
        return
      }
      const ok = await copyToClipboard(getValue())
      if (ok) {
        // 成功反馈唯一出口 = 就近气泡；行尾 .cp 不再加任何类（此前的 .copied 绿色高亮已删，
        // 避免出现"变绿不恢复"的半套残留逻辑）
        showToast('✓ 已复制', rowEl)
      } else {
        if (isValueEl) {
          cp.classList.add('fail')
          setTimeout(() => cp.classList.remove('fail'), 1200)
        } else {
          cp.classList.add('fail')
          setTimeout(() => cp.classList.remove('fail'), 1200)
        }
      }
    })
    // 已展开行：点「收起」折叠，不触发复制
    cp.addEventListener('click', (e) => {
      if (rowEl.classList.contains('open')) {
        e.stopPropagation()
        rowEl.classList.remove('open')
        cp.textContent = '展开'
        cp.dataset.hint = '展开'
      }
    })
  }

  list.forEach((f, idx) => {
    const hasValue = !f.error
    if (idx === 0) {
      // 主值：第一个展示字段，字号 30px；长文本降级 18px 并钳制 3 行
      const hero = document.createElement('div')
      hero.className = 'hero-row'
      heroRowEl = hero
      const label = document.createElement('div')
      label.className = 'hero-label'
      label.textContent = f.name + ' · 最新值'
      const value = document.createElement('div')
      if (hasValue) {
        const isLong = String(f.value).length > 12
        value.className = 'hero-value' + (isLong ? ' long clamp3' : '')
        value.textContent = f.value
        lines.push(list.length > 1 ? f.name + '：' + f.value : f.value)
        valueCount++
        bindCopy(hero, value, () => f.value, true)
        value.dataset.hint = '复制'
        if (isLong) {
          const toggle = document.createElement('button')
          toggle.type = 'button'
          toggle.className = 'more-toggle'
          toggle.textContent = '展开'
          toggle.addEventListener('click', (e) => {
            e.stopPropagation()
            const collapsed = value.classList.toggle('clamp3')
            toggle.textContent = collapsed ? '展开' : '收起'
          })
          hero.appendChild(toggle)
        }
        if (autoBase && (f.name === autoBase || autoCopyField === f.name || autoCopyField === f.raw)) {
          autoCp = { cp: value, value: f.value, isValueEl: true }
        }
      } else {
        value.className = 'hero-value long'
        value.style.color = 'var(--err)'
        value.style.cursor = 'default'
        value.textContent = f.error
      }
      hero.appendChild(label)
      hero.appendChild(value)
      frag.appendChild(hero)
      return
    }

    // 其余字段行：整行可点即复制，无按钮无线条
    const row = document.createElement('div')
    row.className = 'o-row'
    const k = document.createElement('span')
    k.className = 'k'
    k.textContent = f.name
    const v = document.createElement('span')
    v.className = 'v'
    const cp = document.createElement('button')
    cp.type = 'button'
    cp.className = 'cp'
    if (hasValue) {
      v.textContent = f.value
      lines.push(list.length > 1 ? f.name + '：' + f.value : f.value)
      valueCount++
      bindCopy(row, cp, () => f.value)
      if (autoBase && (f.name === autoBase || autoCopyField === f.name || autoCopyField === f.raw)) {
        autoCp = { cp, value: f.value, row }
      }
    } else {
      row.classList.add('error-row')
      v.classList.add('error')
      v.textContent = f.error
    }
    row.appendChild(k)
    row.appendChild(v)
    row.appendChild(cp)
    othersEl.appendChild(row)
  })

  fieldsEl.appendChild(frag)
  if (othersEl.children.length) fieldsEl.appendChild(othersEl)

  // 截断检测：需先插入 DOM 才能测量；截断行点行展开而非复制
  for (const row of fieldsEl.querySelectorAll('.o-row:not(.error-row)')) {
    const v = row.querySelector('.v')
    const cp = row.querySelector('.cp')
    if (v.scrollWidth > v.clientWidth + 1) {
      row.classList.add('truncated')
      cp.textContent = '展开'
      cp.dataset.hint = '展开'
    }
  }

  statusEl.hidden = true
  statusEl.textContent = ''
  copyText = lines.join('\n')
  copyBtn.disabled = valueCount === 0
  // ⋯ 菜单项按 C 稿显示字段数：全部复制（N 项）
  copyBtn.textContent = valueCount > 1 ? '全部复制（' + valueCount + ' 项）' : '全部复制'
  copyBtn.dataset.label = copyBtn.textContent

  // 自动复制字段拉取成功后自动写入剪贴板（完整值）：反馈唯一出口 = 就近气泡（不再染绿任何行尾/主值文字）
  if (autoCp) {
    const ok = await copyToClipboard(autoCp.value)
    if (ok) showToast(null, autoCp.isValueEl ? heroRowEl : autoCp.row)
  }
}

async function fetchLatest() {
  // 已锁定：不发起任何 webhook 请求，直接进入解锁界面
  if (await Lock.isLocked()) {
    location.replace('unlock.html?return=popup')
    return
  }

  fieldsEl.innerHTML = ''
  refreshBtn.disabled = false
  refreshBtn.textContent = '重新获取'
  detailLayerEl.hidden = true
  // 加载态：三点跳动（C 稿 01 加载帧）
  statusEl.className = 'status loading'
  statusEl.textContent = ''
  const dots = document.createElement('div')
  dots.className = 'dots'
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'))
  const loadingSub = document.createElement('div')
  loadingSub.className = 'loading-sub'
  loadingSub.textContent = '正在拉取最新一条…'
  statusEl.appendChild(dots)
  statusEl.appendChild(loadingSub)
  statusEl.hidden = false
  copyBtn.disabled = true

  const cfg = await chrome.storage.local.get(['webhookUrl', 'token', 'sheet', 'fields', 'order', 'autoCopyField', 'displayFields'])
  await healStaleDisplayFields(cfg)
  updateMenuInfo(cfg)
  if (!cfg.webhookUrl || !cfg.token) {
    // onboarding 空态（onboarding.html ①）：唯一入口指向配置向导；⋯ 菜单里的「扩展配置」是次级出口。
    // 原缺失项明细与版本/ID 提示移入「查看详情」的 mono 技术块，信息不丢失。
    const missing = []
    if (!cfg.webhookUrl) missing.push('Webhook 链接')
    if (!cfg.token) missing.push('脚本令牌')
    refreshBtn.disabled = true
    refreshBtn.textContent = '未就绪'
    lastError = {
      msg: '尚未配置：' + missing.join('、'),
      key: 'unconfigured',
      tech: ['缺少：' + missing.join('、'), '当前扩展 ' + versionTag()],
      time: new Date(),
      tag: versionTag()
    }
    renderQuiet({
      stroke: 'var(--muted)',
      paths: GLYPH_INFO,
      title: '还差一步配置',
      descLines: ['缺少 ' + missing.join('和') + '。', '跟随配置向导，几分钟即可完成连接。'],
      fixText: '打开配置向导 →',
      onFix: () => {
        openWizardPanel()
        try { window.close() } catch (_) {}
      }
      // 「扩展配置」次入口已撤：⋯ 菜单里恒有同一入口，不重复
    })
    return
  }
  // 「扩展配置」始终保留在 ⋯ 菜单里（此前误随旧底部入口一起隐藏，已恢复）

  const fields = Array.isArray(cfg.fields) ? cfg.fields : []
  if (!fields.length) {
    showError('尚未配置要拉取的字段，请到配置页「连接」中添加', 'no-fields', ['当前扩展 ' + versionTag()])
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
    if (e.name === 'AbortError') {
      showError('请求超时（10 秒），请稍后重试', 'timeout', ['ERR_ABORTED · after ' + TIMEOUT_MS + 'ms', 'POST ' + hostOf(cfg.webhookUrl)])
    } else {
      showError('网络请求失败：' + e.message, 'network', [String(e.message || e), 'POST ' + hostOf(cfg.webhookUrl)])
    }
    return
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    showError('金山文档接口返回 HTTP ' + res.status + '（请检查 Webhook 链接与脚本令牌）', 'http', ['HTTP ' + res.status, 'POST ' + hostOf(cfg.webhookUrl)])
    return
  }

  let json
  try {
    json = await res.json()
  } catch (e) {
    showError('响应解析失败：' + e.message, 'parse', [String(e.message || e), 'POST ' + hostOf(cfg.webhookUrl)])
    return
  }

  if (json.status !== 'finished' || json.error) {
    const detail = String(json.error || json.status || '未知错误')
    showError('脚本执行失败：' + detail, 'script-error', [detail, 'POST ' + hostOf(cfg.webhookUrl)])
    return
  }

  const result = json.data && json.data.result
  if (!result || typeof result !== 'object') {
    showError('脚本未返回有效结果', 'no-result', ['result 缺失或类型不符', 'POST ' + hostOf(cfg.webhookUrl)])
    return
  }
  if (!result.ok) {
    const detail = String(result.error || '脚本返回失败')
    showError(detail, 'script-fail', [detail, 'POST ' + hostOf(cfg.webhookUrl)])
    return
  }
  if (!Array.isArray(result.fields) || result.v !== 14) {
    showError('金山文档中的脚本版本过旧，请将最新 air.js 重新部署到脚本编辑器', 'script-old', ['脚本返回版本 v' + (result && result.v != null ? result.v : '?') + '，需要 v14', 'POST ' + hostOf(cfg.webhookUrl)])
    return
  }

  const displayed = filterDisplayFields(result.fields, cfg.displayFields)
  if (Array.isArray(cfg.displayFields) && !displayed.length) {
    showError('没有可展示的字段，请到配置页「主页 → 要展示的字段」检查配置', 'no-display', ['POST ' + hostOf(cfg.webhookUrl)])
    return
  }

  await renderFields(displayed, cfg.autoCopyField || '')
}

copyBtn.addEventListener('click', async () => {
  menuEl.hidden = true
  await navigator.clipboard.writeText(copyText)
  copyBtn.textContent = '已复制'
  // 全部复制：气泡只显示一次，贴在主值旁
  showToast('✓ 已复制全部')
  setTimeout(() => { copyBtn.textContent = copyBtn.dataset.label || '全部复制' }, 1500)
})

refreshBtn.addEventListener('click', fetchLatest)
openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage())
// 「重新拉取」菜单项已移除：与底部「重新获取」同功能，按「同一动作只留一个入口」合并到底部主按钮

// ⋯ 菜单开关：点击外部自动收起
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  menuEl.hidden = !menuEl.hidden
})
document.addEventListener('click', (e) => {
  if (!menuEl.hidden && !menuEl.contains(e.target) && e.target !== menuBtn) menuEl.hidden = true
})

// 配置保存后（onboarding ③：向导保存 → 弹窗直接显示首条结果），弹窗与侧边栏自动重新拉取。
// 仅由配置写入触发，拉取逻辑本身不变。
const CONFIG_KEYS = ['webhookUrl', 'token', 'sheet', 'fields', 'order', 'autoCopyField', 'displayFields']
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (CONFIG_KEYS.some((k) => changes[k])) {
    Lock.isLocked().then((locked) => { if (!locked) fetchLatest() })
  }
})

// 在侧边栏中打开时铺满宽度（弹窗模式仍是固定的 340px 宽度）
if (chrome.runtime.getContexts) {
  chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }).then((contexts) => {
    if (contexts && contexts.length) document.body.classList.add('in-panel')
  }).catch(() => {})
}

// 未关闭「自动拉取字段」时，打开弹窗即自动拉取；关闭时等待手动点击「重新获取」
;(async () => {
  // 构建证据标识：确认加载的是最新代码、以及当前是哪一份扩展副本（ID 尾 6 位，可与 chrome://extensions 的 ID 对照）
  const verMarkEl = document.getElementById('verMark')
  if (verMarkEl) verMarkEl.textContent = versionTag()
  console.info('[KDOCS PULL] popup ' + versionTag())
  updateMenuInfo()
  if (await Lock.isLocked()) {
    location.replace('unlock.html?return=popup')
    return
  }
  const cfg = await chrome.storage.local.get('autoFetch')
  if (cfg.autoFetch === false) {
    // 待机态：安静态说明 + 底部「重新获取」主按钮（安静区内不再重复放同一动作的按钮）
    renderQuiet({
      stroke: 'var(--muted)',
      paths: GLYPH_INFO,
      title: '自动拉取已关闭',
      descLines: ['到表格更新数据后，点下方「重新获取」手动拉取最新一条。', '可在扩展配置中重新开启自动拉取。']
    })
    refreshBtn.disabled = false
    refreshBtn.textContent = '重新获取'
    return
  }
  fetchLatest()
})()
