// air.js — 金山文档电子表格 AirScript
// 功能：读取当前工作表最新一条记录（最后一行非空数据）的【内容】，并通过 webhook 同步执行接口返回
// 兼容两种表结构：
//   A. 有表头行：在首行定位【内容】列，数据从第 2 行起
//   B. 无表头行：默认【内容】为第一列（A 列），数据从第 1 行起
// 部署：金山文档 → 工具/脚本 → 脚本编辑器 → 新建脚本并粘贴本文件 → 生成脚本令牌 → 复制 webhook 链接
// 调用：POST https://www.kdocs.cn/api/v3/ide/file/<file_id>/script/<script_id>/sync_task
//       Header: AirScript-Token: <脚本令牌>
// 更多 API: https://airsheet.wps.cn/docs/

const FIELD_NAME = '内容'

// 任意值统一转为纯文本（保证返回值一定是 string）
function toText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const json = JSON.stringify(value)
  return typeof json === 'string' ? json : String(value)
}

function isEmpty(value) {
  return value === null || value === undefined || value === ''
}

const sheet = Application.ActiveSheet
const firstRow = sheet.UsedRange.Row
const data = sheet.UsedRange.Value() // Value 是方法，必须调用；返回 0 起始的二维数组

if (!Array.isArray(data) || data.length === 0) {
  return { ok: false, error: '数据表为空' }
}

// 1. 判断首行是否为表头：含【内容】单元格则按表头定位列；否则默认取第一列
let colIdx = 0
let startIdx = 0
const firstLine = data[0] || []
for (let j = 0; j < firstLine.length; j++) {
  if (toText(firstLine[j]).trim() === FIELD_NAME) {
    colIdx = j
    startIdx = 1
    break
  }
}

// 2. 自下而上找最后一条非空数据行（即最新一条记录）
let result = { ok: false, error: '数据表中没有任何记录' }
for (let i = data.length - 1; i >= startIdx; i--) {
  const row = data[i] || []
  const value = row[colIdx]
  if (!isEmpty(value)) {
    result = { ok: true, content: toText(value), row: firstRow + i }
    break
  }
}

console.log(JSON.stringify(result))
return result
