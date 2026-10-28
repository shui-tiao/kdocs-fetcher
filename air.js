// air.js — 金山文档 AirScript（API 1.0 模式；同时兼容 多维表格 与 电子表格）
// 注意：脚本编辑器需切换为「API 1.0」；API 2.0 未开放多维表格（数据表）接口与「云文档API」服务
// 功能：读取当前表中指定字段（一个或多个）的最新一条数据，并通过 webhook 同步执行接口返回
// 请求参数（webhook POST body 的 Context.argv）：
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
//       Body: {"Context":{"argv":{"fields":["内容","机构","日期:date"],"order":"top"}}}
// 更多 API（请阅读 1.0 文档）: https://airsheet.wps.cn/docs/

const DEFAULT_FIELD = '内容'
const SCRIPT_VERSION = 11

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
  const req = { fields: [], order: 'bottom' }
  try {
    const argv = Context && Context.argv
    if (argv) {
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

// ============ 多维表格模式：字段名是元数据，记录按字段名取值 ============
// db: { fields, viewId, fetch(offset, useView) }
function runDataTableMode(db, specs, order) {
  const dbFields = db.fields || []
  // 字段名列表（按表内顺序），用于存在性校验与列字母定位
  const names = []
  for (let i = 0; i < dbFields.length; i++) names.push(toText(dbFields[i].name))

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

  if (!records.length) return { ok: false, error: '数据表中没有任何记录' }

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

// 入口 A（多维表格脚本 1.0 / dbsheet）：Application.Field / Record / Selection，参数带 SheetId
function makeAppDb(app) {
  const recordApi = getApiWith(app, 'Record', 'GetRecords')
  if (!recordApi) return null

  // 当前视图同时给出 SheetId 与 ViewId
  let sheetId = ''
  let viewId = ''
  try {
    const sel = getApiWith(app, 'Selection', 'GetActiveView')
    const view = sel ? sel.GetActiveView() : null
    if (view) {
      sheetId = view.sheetId || view.SheetId || ''
      viewId = view.viewId || view.ViewId || ''
    }
  } catch (e) {}

  // 所有表信息（同时可用来兜底取 SheetId / 字段）
  let sheets = null
  try {
    const sheetApi = getApiWith(app, 'Sheet', 'GetSheets')
    sheets = sheetApi ? sheetApi.GetSheets() : null
  } catch (e) {}
  if (!sheets || typeof sheets.length !== 'number') sheets = null

  // 视图不可用时，取第一张有字段的表（跳过仪表盘/页面）
  if (!sheetId && sheets) {
    for (let i = 0; i < sheets.length; i++) {
      const f = sheets[i] && sheets[i].fields
      if (f && typeof f.length === 'number' && f.length) { sheetId = sheets[i].id; break }
    }
  }
  if (!sheetId) return null

  // 字段：优先 Application.Field.GetFields({SheetId})，失败则用 Sheet.GetSheets() 里的 fields
  let fields = null
  const fieldApi = getApiWith(app, 'Field', 'GetFields')
  if (fieldApi) {
    try { fields = fieldApi.GetFields({ SheetId: sheetId }) } catch (e) { fields = null }
  }
  if ((!fields || typeof fields.length !== 'number' || !fields.length) && sheets) {
    for (let i = 0; i < sheets.length; i++) {
      if (sheets[i] && toText(sheets[i].id) === toText(sheetId)) { fields = sheets[i].fields; break }
    }
  }
  if (!fields || typeof fields.length !== 'number' || !fields.length) return null

  return {
    fields: fields,
    viewId: viewId,
    fetch: function (offset, useView) {
      const args = { SheetId: sheetId }
      if (useView && viewId) args.ViewId = viewId
      if (offset) args.Offset = offset
      return recordApi.GetRecords(args)
    }
  }
}

const db = makeAppDb(Application)

// 电子表格能力检测：避免对非电子表格直接访问 UsedRange 抛异常
function hasUsedRange(s) {
  try { return !!(s && s.UsedRange) } catch (e) { return false }
}

let result
try {
  if (db) {
    result = runDataTableMode(db, req.fields, req.order)
  } else if (hasUsedRange(activeSheet)) {
    result = runSheetMode(activeSheet, req.fields, req.order)
  } else {
    result = {
      ok: false,
      error: '当前文档中未找到可读取的数据表接口（请确认脚本编辑器 API 版本为 1.0）。探测：' + dumpApp(Application)
    }
  }
} catch (e) {
  result = {
    ok: false,
    error: '脚本执行异常：' + toText(e && e.message ? e.message : e) + '；探测：' + dumpApp(Application)
  }
}

result.v = SCRIPT_VERSION
result.mode = db ? 'data_table' : 'sheet'
console.log(JSON.stringify(result))
return result
