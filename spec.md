# 规格说明书：浏览器扩展拉取金山文档最新记录【内容】

## 1. 背景与目标

用户点击浏览器扩展图标 → 扩展向金山文档发送 HTTP 请求 → 触发金山文档中已存在的 AirScript 脚本（air.js）→ 脚本读取电子表格中**最新一条记录的【内容】**并同步返回 → 扩展 popup 展示该内容。

## 2. 范围

### 2.1 In Scope

- Chrome / Edge 浏览器扩展（Manifest V3）：popup 页面 + options 配置页
- air.js：部署在金山文档脚本编辑器中的 AirScript 脚本
- 端到端联调与验收

### 2.2 Out of Scope

- 金山开放平台 OAuth 应用接入
- 多文档 / 多脚本管理
- 历史记录列表浏览、内容回写编辑
- 移动端浏览器

## 3. 技术选型

| 决策点     | 选择                                               | 理由                            |
| ------- | ------------------------------------------------ | ----------------------------- |
| 脚本触发机制  | 脚本令牌 + webhook 同步执行接口                            | 单次请求同步拿到脚本返回值；无需 OAuth、无需任务轮询 |
| 备选（不采用） | 开放平台 `developer.kdocs.cn` access\_token + 异步任务轮询 | 需要注册开发者、走 OAuth，链路长、复杂度高      |
| 扩展规范    | Manifest V3                                      | Chrome / Edge 现行标准            |
| 配置存储    | `chrome.storage.local`                           | 令牌仅存本地，不上传任何第三方               |

## 4. 接口契约

### 4.1 扩展 → 金山文档（webhook 同步执行）

- **Method**: `POST`
- **URL**: 脚本编辑器侧边栏「更多菜单 → 复制 webhook 链接」获得，形如：
  `https://www.kdocs.cn/api/v3/ide/file/<file_id>/script/<script_id>/sync_task`
- **Headers**:
  - `Content-Type: application/json`
  - `AirScript-Token: <脚本令牌>`（在脚本编辑器中生成）
- **Body**（实测：传 `{"Context":...}` 包装会被网关拒绝，返回 `InvalidArgument`）：

```json
{}
```

### 4.2 金山文档 → 扩展（同步响应，实测结构）

```json
{
  "status": "finished",
  "error": "",
  "data": {
    "logs": [],
    "result": { "ok": true, "content": "...", "row": 8 }
  }
}
```

- 脚本 `return` 的值位于 `data.result`
- `status === "finished"` 且 `error === ""` 表示执行成功；否则取 `error` 作为失败原因

### 4.3 AirScript 返回值约定（air.js 内 `return` 的对象）

成功：

```json
{
  "ok": true,
  "content": "最新一条记录的【内容】文本",
  "row": 8
}
```

失败：

```json
{ "ok": false, "error": "可读的错误描述" }
```

## 5. air.js 脚本逻辑（最终实现，针对普通电子表格）

> 实测：目标文件为普通电子表格（无 `Record` API）；`Range.Value` 是方法，须以 `Value()` 调用。

1. `Application.ActiveSheet` 获取当前工作表，`sheet.UsedRange.Value()` 一次性读出二维数组
2. 首行若存在【内容】单元格 → 表头模式，按列索引取数，数据从第 2 行起；否则无表头模式，默认取第一列（A 列）
3. 自下而上扫描，取最后一条非空单元格（即最新一条记录）
4. 按 §4.3 约定 `return { ok, content, row }`；表空、列缺失、无记录时返回 `ok:false` 及错误描述

约束：同步执行有执行时长上限，脚本保持轻量，不做网络请求与循环写入。

脚本**APIToken**：`<你的脚本令牌>`（明文令牌仅存本机，勿提交到任何仓库）

## 6. 扩展功能需求

| 编号  | 需求                                                                    |
| --- | --------------------------------------------------------------------- |
| FR1 | 点击工具栏扩展图标打开 popup，自动发起 webhook 请求，状态流转：加载中 → 展示内容 / 展示错误              |
| FR2 | popup 展示最新【内容】文本，并提供「复制」按钮写入剪贴板                                       |
| FR3 | options 页配置并持久化 webhook URL 与 AirScript-Token（`chrome.storage.local`） |
| FR4 | 未配置时 popup 显示引导文案并提供「前往配置」按钮打开 options 页                              |
| FR5 | 错误分类提示：网络失败 / HTTP 非 2xx / 脚本返回 `ok:false` / 响应解析失败，各自给出可读提示          |

## 7. 非功能需求

- `host_permissions` 仅申请 `https://www.kdocs.cn/*`
- `permissions` 仅申请 `storage` 与 `declarativeNetRequest`（剪贴板通过 popup 内 `navigator.clipboard` 实现）
- **实测约束**：金山网关对携带 `Origin: chrome-extension://...` 的请求返回 403（`Origin: null` 同样被拒，仅接受无 Origin 或 `https://www.kdocs.cn`）。扩展通过 declarativeNetRequest 规则将请求 `Origin` 头改写为 `https://www.kdocs.cn`（仅作用于 `www.kdocs.cn/api/v3/ide/`）
- 令牌不出现在 popup DOM 中，不随请求发往 `www.kdocs.cn` 以外的任何主机
- 请求超时 10 秒
- popup 首屏展示内容目标 < 2 秒（取决于金山脚本执行耗时）

## 8. 验收标准

1. 配置正确后点击扩展图标，popup 展示表格最新一条记录的【内容】
2. 在金山文档中新增一条记录后再次点击，返回新记录的内容
3. 令牌错误、URL 错误、断网、表格无记录四类场景均有明确可读提示
4. popup 页面 DOM 中不出现令牌明文
5. options 页保存配置后重启浏览器配置仍生效

## 9. 前置条件（用户侧操作）

1. 拥有一个金山文档**电子表格**文件，表中数据至少有一行（表头可有可无，无表头时默认取 A 列）
2. 在该文件的脚本编辑器中创建脚本并粘贴 air.js 内容
3. 生成**脚本令牌**，复制 **webhook 链接**
4. 将二者填入扩展 options 页

## 10. 假设与待确认

| 项        | 结论（已实测）                                 | 备注                                  |
| -------- | ----------------------------------------- | ----------------------------------- |
| 文档类型     | **普通电子表格**（无 `Record` API，`Range.Value` 为方法） | air.js 已按 Range/二维数组方式实现 |
| 「最新一条」定义 | 使用区域最后一行非空数据                            | 若需按时间字段排序，air.js 需增加排序逻辑            |
| 目标浏览器    | Chrome / Edge（MV3，Edge 实测通过）                        | Firefox 需另行适配                       |

