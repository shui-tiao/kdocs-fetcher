// air.js — 金山文档 AirScript（API 1.0 模式；同时兼容 多维表格 与 电子表格）
// 注意：脚本编辑器需切换为「API 1.0」；API 2.0 未开放多维表格（数据表）接口与「云文档API」服务
// 功能：读取当前表中指定字段（一个或多个）的最新一条数据，并通过 webhook 同步执行接口返回
// 请求参数（webhook POST body 的 Context.argv）：
//   sheet:  数据表名称（多维表格里有多张表时用它指定要读取哪张表；不会都叫「数据表」）
//           也可填 1 起始的序号；不传时优先当前视图所在表，否则取第一张可读取的表
//           示例："项目"；表名不存在时返回错误并列出可用表名
//   fields: 字符串或字符串数组，每项格式为 [显示名=]定位目标[:date]
//           定位目标支持：字段名（推荐）/ 列字母（如 E）/ 列号（1 起始）
//           加 :date 后缀时，该列的数字（日期序列值或毫秒时间戳）转为 YYYY-MM-DD HH:mm:ss
//           示例：["内容", "机构", "日期:date"]；未传时默认 ["内容"]
//   order:  'bottom'（默认，最新一条在末尾）或 'top'（最新一条在开头，
//           适用于开启了按时间倒序自动排序的视图）
// 多维表格（多维表格脚本 1.0 / dbsheet 接口）：
//   Application.Field.GetFields({SheetId})、Application.Record.GetRecords({SheetId,ViewId,Offset})，
//   SheetId/ViewId 取自 Application.Selection.GetActiveView()
//   按字段名取记录值，调整列顺序、视图排序均不影响；记录优先按当前视图顺序读取
// 电子表格：全表自动寻找「含定位目标最多」的行作为表头（可在任意行）；
//           无表头行时字段必须用列字母/列号定位（如 机构=E），否则返回明确错误
// 1.0 取值：Range.Value2 是属性（不是方法），区域返回二维数组
// 响应：{ ok, v, fields: [{ name, value, row, col }] }；v 为脚本版本号，供调用方校验部署版本
// 部署：金山文档 → 脚本编辑器 → 右上角 API 版本选「1.0」→ 粘贴本文件 → 生成脚本令牌 → 复制 webhook 链接
// 调用：POST https://www.kdocs.cn/api/v3/ide/file/<file_id>/script/<script_id>/sync_task
//       Header: AirScript-Token: <脚本令牌>
//       Body: {"Context":{"argv":{"sheet":"项目","fields":["内容","机构","日期:date"],"order":"top"}}}
// 更多 API（请阅读 1.0 文档）: https://airsheet.wps.cn/docs/

const DEFAULT_FIELD = '内容'
const SCRIPT_VERSION = 14

// 任意值统一转为纯文本（保证返回值一定是 string）
function toText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const json = JSON.stringify(value)
  return typeof json === 'string' ? json : String(value)
}

function isEmpty(value) {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return false
}

// 全角字符（＝、Ｅ、５等）转半角，避免中文输入法导致配置解析失败
function toHalfWidth(s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out += (c >= 0xFF01 && c <= 0xFF5E) ? String.fromCharCode(c - 0xFEE0) : s[i]
  }
  return out
}

// 列字母（A=1）或 1 起始列号 → 0 起始下标；无法解析返回 -1
function parseColRef(text) {
  if (/^[A-Za-z]{1,3}$/.test(text)) {
    let n = 0
    const s = text.toUpperCase()
    for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64)
    return n - 1
  }
  if (/^\d+$/.test(text)) {
    const n = parseInt(text, 10)
    return n > 0 ? n - 1 : -1
  }
  return -1
}

// 0 起始列下标 → 列字母（0→A，4→E）
function colLetter(idx) {
  let s = ''
  let n = idx + 1
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function pad2(x) { return (x < 10 ? '0' : '') + x }

function formatDate(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds())
}

// 按字段格式输出：:date 时把数字（日期序列值或毫秒时间戳）转成可读时间，否则转纯文本
function formatValue(spec, value) {
  if (spec.format === 'date' && typeof value === 'number') {
    // 毫秒时间戳按 UTC+8 墙钟显示；否则按电子表格日期序列值（1900 日期系统）处理
    if (value > 100000000000) return formatDate(new Date(value + 8 * 3600000))
    const d = new Date(Math.round((value - 25569) * 86400) * 1000) // 25569 = 1970-01-01 的序列值
    return isNaN(d.getTime()) ? toText(value) : formatDate(d)
  }
  return toText(value)
}

// 解析单个字段配置：[显示名=]定位目标[:格式]
function parseSpec(raw) {
  const s = toHalfWidth(toText(raw).trim())
  const eq = s.lastIndexOf('=')
  let label = ''
  let target = s
  if (eq > 0 && eq < s.length - 1) {
    label = s.slice(0, eq).trim()
    target = s.slice(eq + 1).trim()
  }
  const cn = target.lastIndexOf(':')
  if (cn > 0 && cn < target.length - 1) {
    const format = target.slice(cn + 1).trim().toLowerCase()
    target = target.slice(0, cn).trim()
    return { label: label || target, target: target, format: format }
  }
  return { label: label || target, target: target, format: '' }
}

// 从 webhook 请求体解析请求参数（编辑器内直接运行时无 Context，回退默认值）
function getRequest() {
  const req = { fields: [], order: 'bottom', sheet: '', probe: false }
  try {
    const argv = Context && Context.argv
    if (argv) {
      // probe=true：配置向导第 7 步探测所有数据表（不读取记录）
      const rawProbe = toText(argv.probe).trim().toLowerCase()
      req.probe = argv.probe === true || rawProbe === 'true' || rawProbe === '1'
      const rawSheet = argv.sheet !== undefined ? argv.sheet
        : (argv.table !== undefined ? argv.table
          : (argv.tableName !== undefined ? argv.tableName : argv.sheetName))
      req.sheet = toText(rawSheet).trim()
      const rawFields = argv.fields
      const list = Array.isArray(rawFields) ? rawFields : [rawFields]
      for (let i = 0; i < list.length; i++) {
        const spec = parseSpec(list[i])
        if (!spec.target) continue
        let dup = false
        for (let j = 0; j < req.fields.length; j++) {
          if (req.fields[j].label === spec.label && req.fields[j].target === spec.target) { dup = true; break }
        }
        if (!dup) req.fields.push(spec)
      }
      if (toText(argv.order).trim().toLowerCase() === 'top') req.order = 'top'
    }
  } catch (e) {}
  if (!req.fields.length) req.fields = [parseSpec(DEFAULT_FIELD)]
  return req
}

// 读取对象的多个可能属性名（不同 API 版本大小写/命名不一致）
function prop(obj, keys) {
  for (let i = 0; i < keys.length; i++) {
    try {
      const v = obj[keys[i]]
      if (v !== undefined && v !== null && v !== '') return v
    } catch (e) {}
  }
  return ''
}

// 字段/表的显示名
function nameOf(x) {
  return toText(prop(x, ['name', 'Name', 'title', 'Title']))
}

// ============ 多维表格模式：字段名是元数据，记录按字段名取值 ============
// db: { name, fields, viewId, fetch(offset, useView) }
function runDataTableMode(db, specs, order) {
  const dbFields = db.fields || []
  // 字段名列表（按表内顺序），用于存在性校验与列字母定位
  const names = []
  for (let i = 0; i < dbFields.length; i++) names.push(nameOf(dbFields[i]))

  // 逐字段解析：字段名 或 列字母/列号（按字段顺序）
  const resolved = []
  const results = []
  for (let k = 0; k < specs.length; k++) {
    const spec = specs[k]
    let fieldIdx = names.indexOf(spec.target)
    if (fieldIdx < 0) {
      const ci = parseColRef(spec.target)
      if (ci >= 0 && ci < names.length) fieldIdx = ci
    }
    if (fieldIdx < 0) {
      results.push({ name: spec.label, error: '多维表格中不存在字段【' + spec.target + '】，可用字段：' + names.join('、') })
    } else {
      resolved.push({ spec: spec, fieldName: names[fieldIdx], fieldIdx: fieldIdx })
    }
  }
  if (!resolved.length) return { ok: true, fields: results }

  // 分页拉取记录（每页最多 100 条）；视图 Id 无效时去掉 ViewId 重试一次
  const records = []
  let offset = null
  let useView = !!db.viewId
  do {
    let resp
    try {
      resp = db.fetch(offset, useView)
    } catch (e) {
      if (!useView) throw e
      useView = false // 视图 Id 无效：去掉 ViewId 重试
      resp = db.fetch(offset, useView)
    }
    const list = resp && (resp.records || resp.Records)
    if (!list || typeof list.length !== 'number' || !list.length) break
    for (let i = 0; i < list.length; i++) records.push(list[i])
    offset = resp.offset || resp.Offset || null
  } while (offset && records.length < 10000) // 上限保护

  if (!records.length) return { ok: false, error: '数据表' + (db.name ? '【' + db.name + '】' : '') + '中没有任何记录' }

  // 按方向逐字段取最新非空值（top：从首条往后；bottom：从末条往前）
  for (let r = 0; r < resolved.length; r++) {
    const item = resolved[r]
    let found = false
    if (order === 'top') {
      for (let i = 0; i < records.length; i++) {
        const fields = records[i] && (records[i].fields || records[i].Fields)
        const value = fields && fields[item.fieldName]
        if (!isEmpty(value)) {
          results.push({ name: item.spec.label, value: formatValue(item.spec, value), row: i + 1, col: colLetter(item.fieldIdx) })
          found = true
          break
        }
      }
    } else {
      for (let i = records.length - 1; i >= 0; i--) {
        const fields = records[i] && (records[i].fields || records[i].Fields)
        const value = fields && fields[item.fieldName]
        if (!isEmpty(value)) {
          results.push({ name: item.spec.label, value: formatValue(item.spec, value), row: i + 1, col: colLetter(item.fieldIdx) })
          found = true
          break
        }
      }
    }
    if (!found) results.push({ name: item.spec.label, error: '该字段没有任何记录', col: colLetter(item.fieldIdx) })
  }
  return { ok: true, fields: results }
}

// ============ 电子表格模式：全表探测表头行 + 按方向扫描 ============
function runSheetMode(sheet, specs, order) {
  const used = sheet && sheet.UsedRange
  if (!used) {
    return { ok: false, error: '当前活动表不支持 UsedRange，不是电子表格' }
  }
  const firstRow = used.Row // 1 起始行号
  let data = used.Value2 // 1.0 中 Value2 是属性；区域返回二维数组（行、列均 0 起始）
  // 仅一个单元格时 1.0 返回标量（字符串/数字/日期），这里统一补成二维数组
  if (data === null || typeof data !== 'object' || typeof data.length !== 'number') data = [[data]]
  if (data.length === 0) {
    return { ok: false, error: '数据表为空' }
  }

  // 表头探测：全表找「含定位目标最多」的行作为表头（表头可在任意行，自动排序/调列序不影响）
  // 纯列字母/列号配置跳过探测，直接按列取数
  const targets = []
  let needHeader = false
  for (let k = 0; k < specs.length; k++) {
    targets.push(specs[k].target)
    if (parseColRef(specs[k].target) < 0) needHeader = true
  }
  let headerIdx = -1
  if (needHeader) {
    let best = 0
    for (let i = 0; i < data.length; i++) {
      const row = data[i] || []
      let matches = 0
      for (let j = 0; j < row.length; j++) {
        if (targets.indexOf(toText(row[j]).trim()) !== -1) matches++
      }
      if (matches > best) { best = matches; headerIdx = i }
    }
  }

  const results = []
  for (let k = 0; k < specs.length; k++) {
    const spec = specs[k]
    let colIdx = -1
    if (headerIdx >= 0) {
      const headerRow = data[headerIdx] || []
      for (let j = 0; j < headerRow.length; j++) {
        if (toText(headerRow[j]).trim() === spec.target) { colIdx = j; break }
      }
    }
    if (colIdx < 0) colIdx = parseColRef(spec.target)
    if (colIdx < 0) {
      // 不静默猜列：定位失败必须报错，避免返回错误列的数据
      results.push({ name: spec.label, error: '无法定位字段【' + spec.target + '】：表格中未找到该表头；若无表头行请改用「显示名=列字母」，如 机构=E' })
      continue
    }

    let found = false
    if (order === 'top') {
      for (let i = 0; i < data.length; i++) {
        if (i === headerIdx) continue
        const value = (data[i] || [])[colIdx]
        if (!isEmpty(value)) {
          results.push({ name: spec.label, value: formatValue(spec, value), row: firstRow + i, col: colLetter(colIdx) })
          found = true
          break
        }
      }
    } else {
      for (let i = data.length - 1; i >= 0; i--) {
        if (i === headerIdx) continue
        const value = (data[i] || [])[colIdx]
        if (!isEmpty(value)) {
          results.push({ name: spec.label, value: formatValue(spec, value), row: firstRow + i, col: colLetter(colIdx) })
          found = true
          break
        }
      }
    }
    if (!found) results.push({ name: spec.label, error: '该字段没有任何记录', col: colLetter(colIdx) })
  }
  return { ok: true, fields: results }
}

// ============ 入口 ============
const req = getRequest()
const activeSheet = Application.ActiveSheet

// 取 AirScript 子接口：成员可能是属性对象，也可能是函数（函数本身挂方法，或调用后返回对象）
function getApiWith(obj, name, method) {
  let raw
  try { raw = obj[name] } catch (e) { return null }
  if (!raw) return null
  if (typeof raw !== 'function') {
    try { return typeof raw[method] === 'function' ? raw : null } catch (e) { return null }
  }
  try { if (typeof raw[method] === 'function') return raw } catch (e) {}
  try {
    const r = raw()
    return (r && typeof r[method] === 'function') ? r : null
  } catch (e) { return null }
}
function probeMember(obj, name, method) {
  let raw
  try { raw = obj[name] } catch (e) { return name + ':error' }
  if (raw === undefined || raw === null) return name + ':undefined'
  let hasMethod = false
  try { hasMethod = typeof raw[method] === 'function' } catch (e) {}
  return name + ':' + typeof raw + (hasMethod ? '(有' + method + ')' : '')
}
// 诊断用：列出表名，便于定位接口不可用的原因
function sheetTitles(app) {
  const out = []
  let s = null
  try { s = app.ActiveSheet } catch (e) {}
  if (s) { try { out.push(toText(s.Name)) } catch (e) {} }
  for (let i = 1; i <= 5; i++) {
    let si = null
    try { si = app.Sheets.Item(i) } catch (e) { break }
    if (!si) break
    try { out.push(toText(si.Name)) } catch (e) {}
  }
  return out.join('/')
}
function dumpApp(app) {
  return probeMember(app, 'Sheet', 'GetSheets') + ',' + probeMember(app, 'Field', 'GetFields') + ',' +
    probeMember(app, 'Record', 'GetRecords') + ',' + probeMember(app, 'Selection', 'GetActiveView') +
    '；表：' + sheetTitles(app)
}

// 取所有表信息：优先 Application.Sheet.GetSheets()，不可用时退回 app.Sheets.Item(i)
function listSheets(app, sheetApi) {
  const out = []
  let raw = null
  try { raw = sheetApi ? sheetApi.GetSheets() : null } catch (e) { raw = null }
  // 兼容返回 { sheets: [...] } / { data: [...] } 的版本
  if (raw && typeof raw.length !== 'number') {
    const wrapped = prop(raw, ['sheets', 'Sheets', 'data', 'Data'])
    if (wrapped && typeof wrapped.length === 'number') raw = wrapped
  }
  if (raw && typeof raw.length === 'number') {
    for (let i = 0; i < raw.length; i++) if (raw[i]) out.push(raw[i])
    return out
  }
  for (let i = 1; i <= 50; i++) {
    let s = null
    try { s = app.Sheets.Item(i) } catch (e) { break }
    if (!s) break
    out.push(s)
  }
  return out
}

// 收集表清单与官方接口（Sheet.GetSheets / Field.GetFields / Selection）
function collectTables(app) {
  const recordApi = getApiWith(app, 'Record', 'GetRecords')
  if (!recordApi) return { isTable: false }

  const fieldApi = getApiWith(app, 'Field', 'GetFields')
  const sheetApi = getApiWith(app, 'Sheet', 'GetSheets')

  // 表清单：Sheet.GetSheets() 只保证表名/表 Id，字段一律以官方 Field.GetFields({SheetId}) 为准
  const tables = []
  const names = []
  const list = listSheets(app, sheetApi)
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    // GetSheets 若仅返回表名（字符串/数字），只能用于按名定位，SheetId 需要另寻
    if (typeof s !== 'object') {
      const onlyName = toText(s)
      tables.push({ id: '', idKey: '', name: onlyName, fields: null })
      if (onlyName) names.push(onlyName)
      continue
    }
    const rawId = prop(s, ['id', 'Id', 'sheetId', 'SheetId'])
    const t = {
      id: rawId,            // 原样保留类型（官方 SheetId 多为数字，转字符串会报 InvalidArgument）
      idKey: toText(rawId), // 仅用于比较/缓存
      name: nameOf(s),
      fields: null // GetSheets 若顺便带了 fields，只当兜底
    }
    const f = prop(s, ['fields', 'Fields'])
    if (f && typeof f.length === 'number' && f.length) t.fields = f
    tables.push(t)
    if (t.name) names.push(t.name)
  }

  // GetFields/GetRecords 对 SheetId 类型敏感：数字 ↔ 数字字符串互相转换后重试
  function altId(v) {
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
    if (typeof v === 'number') return String(v)
    return v
  }

  // 官方取字段：Application.Field.GetFields({ SheetId })（带缓存，避免重复调用）
  const fieldsCache = {}
  function officialFields(t) {
    if (!fieldApi || !t.idKey) return null
    if (fieldsCache[t.idKey] !== undefined) return fieldsCache[t.idKey]
    let f = null
    try {
      const r = fieldApi.GetFields({ SheetId: t.id })
      if (r && typeof r.length === 'number' && r.length) f = r
    } catch (e) {
      try {
        const r2 = fieldApi.GetFields({ SheetId: altId(t.id) })
        if (r2 && typeof r2.length === 'number' && r2.length) f = r2
      } catch (e2) { f = null }
    }
    fieldsCache[t.idKey] = f
    return f
  }

  // 当前选中的表/视图：Selection.GetActiveSheet() 取表，GetActiveView() 取 ViewId
  let activeIdKey = ''
  let activeName = ''
  let viewId = ''
  try {
    let sel = getApiWith(app, 'Selection', 'GetActiveSheet')
    if (!sel) sel = getApiWith(app, 'Selection', 'GetActiveView')
    if (sel) {
      if (typeof sel.GetActiveSheet === 'function') {
        const s = sel.GetActiveSheet()
        if (s) {
          activeIdKey = toText(prop(s, ['id', 'Id', 'sheetId', 'SheetId']))
          activeName = nameOf(s)
        }
      }
      if (typeof sel.GetActiveView === 'function') {
        const v = sel.GetActiveView()
        if (v) {
          if (!activeIdKey) activeIdKey = toText(prop(v, ['sheetId', 'SheetId']))
          viewId = toText(prop(v, ['viewId', 'ViewId']))
        }
      }
    }
  } catch (e) {}

  let active = null
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i]
    if ((activeIdKey && t.idKey === activeIdKey) || (!activeIdKey && activeName && t.name === activeName)) {
      active = t
      break
    }
  }

  // 报错时列出真正的数据表（官方 GetFields 返回空的多为仪表盘/页面）；仅在出错时探测
  let listedCache = null
  function listedNames() {
    if (listedCache) return listedCache
    const real = []
    for (let i = 0; i < tables.length && i < 30; i++) {
      if (!tables[i].name) continue
      if (officialFields(tables[i]) || tables[i].fields) real.push(tables[i].name)
    }
    listedCache = real.length ? real : names
    return listedCache
  }

  return {
    isTable: true,
    recordApi: recordApi,
    tables: tables,
    names: names,
    active: active,
    activeIdKey: activeIdKey,
    viewId: viewId,
    officialFields: officialFields,
    altId: altId,
    listedNames: listedNames
  }
}

// 入口 A（多维表格脚本 1.0 / dbsheet）：Application.Field / Record / Selection，参数带 SheetId
// wantName：用户指定的数据表名称（多维表格里常有多张表，且表名各不相同）
// 返回 { db, isTable, tables, error }
function makeAppDb(app, wantName) {
  const ctx = collectTables(app)
  if (!ctx.isTable) return { db: null, isTable: false, tables: [] }

  const tables = ctx.tables
  const names = ctx.names
  const active = ctx.active
  const activeIdKey = ctx.activeIdKey
  const viewId = ctx.viewId
  const officialFields = ctx.officialFields
  const altId = ctx.altId
  const listedNames = ctx.listedNames
  const recordApi = ctx.recordApi

  // 候选顺序：指定表名 → 当前选中的表 → 其余表（仪表盘等无字段的表会被自动跳过）
  const candidates = []
  function addCandidate(t) { if (t && candidates.indexOf(t) < 0) candidates.push(t) }

  const want = toText(wantName).trim()
  if (want) {
    let hit = null
    const wantHalf = toHalfWidth(want)
    for (let i = 0; i < tables.length; i++) {
      if (toHalfWidth(tables[i].name).trim() === wantHalf) { hit = tables[i]; break }
    }
    // 也允许用 1 起始序号（如 sheet: "3"）
    if (!hit && /^\d+$/.test(want)) {
      const idx = parseInt(want, 10) - 1
      if (idx >= 0 && idx < tables.length) hit = tables[idx]
    }
    if (!hit) {
      return {
        db: null, isTable: true, tables: listedNames(),
        error: '多维表格中不存在数据表【' + want + '】，可用数据表：' + (listedNames().join('、') || '（未取到表清单）')
      }
    }
    addCandidate(hit)
  } else {
    addCandidate(active)
    for (let i = 0; i < tables.length; i++) addCandidate(tables[i])
  }

  // 逐个候选表取字段：官方 GetFields 优先，GetSheets 自带字段兜底
  let chosen = null
  let fields = null
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i]
    const f = officialFields(t) || t.fields
    if (f && f.length) { chosen = t; fields = f; break }
  }
  if (!chosen) {
    return {
      db: null, isTable: true, tables: listedNames(),
      error: '未能读取数据表字段（可用数据表：' + (listedNames().join('、') || '（未取到表清单）') + '），请通过 sheet 参数指定表名'
    }
  }
  if (!chosen.idKey) {
    return {
      db: null, isTable: true, tables: listedNames(),
      error: '无法获取数据表【' + chosen.name + '】的 SheetId（请确认脚本编辑器 API 版本为 1.0）'
    }
  }

  // 只有目标表与当前选中的表是同一张表时才带 ViewId，否则视图顺序/可见范围会串到别的表
  const useView = !!viewId && (!activeIdKey || activeIdKey === chosen.idKey)
  return {
    isTable: true,
    tables: names,
    db: {
      name: chosen.name,
      fields: fields,
      viewId: useView ? viewId : '',
      fetch: function (offset, withView) {
        const args = { SheetId: chosen.id }
        if (withView && useView && viewId) args.ViewId = viewId
        if (offset) args.Offset = offset
        try {
          return recordApi.GetRecords(args)
        } catch (e) {
          const alt = altId(chosen.id)
          if (alt !== chosen.id) {
            args.SheetId = alt
            try { return recordApi.GetRecords(args) } catch (e2) {}
          }
          throw new Error('Record.GetRecords 调用失败（SheetId=' + toText(chosen.id) +
            '，ViewId=' + toText(args.ViewId) + '，Offset=' + toText(offset) + '）：' + toText(e))
        }
      }
    }
  }
}

// 探测模式（argv.probe）：只返回所有数据表及字段名，不读取记录，供配置向导选表
function probeTables(app) {
  const ctx = collectTables(app)
  if (!ctx.isTable) return { ok: true, mode: 'sheet', tables: [] }

  const tables = ctx.tables
  const list = []
  for (let i = 0; i < tables.length && i < 50; i++) {
    const f = ctx.officialFields(tables[i]) || tables[i].fields
    if (!f || !f.length) continue
    const fieldNames = []
    for (let j = 0; j < f.length; j++) {
      const n = nameOf(f[j])
      if (n) fieldNames.push(n)
    }
    list.push({ name: tables[i].name, fields: fieldNames })
  }
  if (!list.length) {
    return {
      ok: false,
      error: '未能探测到可读取的数据表（文档中的表：' + (ctx.names.join('、') || '空') +
        '）。请确认脚本编辑器中的 air.js 已更新到 v' + SCRIPT_VERSION + '，且 API 版本为 1.0'
    }
  }
  const out = { ok: true, mode: 'data_table', tables: list }
  if (ctx.active && ctx.active.name) out.active = ctx.active.name
  return out
}

// 电子表格能力检测：避免对非电子表格直接访问 UsedRange 抛异常
function hasUsedRange(s) {
  try { return !!(s && s.UsedRange) } catch (e) { return false }
}

let built = { db: null, isTable: false, tables: [] }
let db = null
let result
try {
  if (req.probe) {
    result = probeTables(Application)
  } else {
    built = makeAppDb(Application, req.sheet)
    db = built.db
    if (db) {
      result = runDataTableMode(db, req.fields, req.order)
    } else if (built.error) {
      // 是多维表格但没定位到表：直接给出表清单，而不是笼统的接口不可用
      result = { ok: false, error: built.error, tables: built.tables }
    } else if (hasUsedRange(activeSheet)) {
      result = runSheetMode(activeSheet, req.fields, req.order)
    } else {
      result = {
        ok: false,
        error: '当前文档中未找到可读取的数据表接口（请确认脚本编辑器 API 版本为 1.0）。探测：' + dumpApp(Application)
      }
    }
  }
} catch (e) {
  result = {
    ok: false,
    error: '脚本执行异常：' + toText(e && e.message ? e.message : e) + '；探测：' + dumpApp(Application)
  }
}

result.v = SCRIPT_VERSION
if (!req.probe) result.mode = (db || built.isTable) ? 'data_table' : 'sheet'
if (db && db.name) result.sheet = db.name
console.log(JSON.stringify(result))
return result
