# 金山文档拉取器（kdocs-fetcher）

一个 Chrome / Edge 浏览器扩展：点击扩展图标，一键拉取金山文档表格中**最新一条记录的【内容】**，并支持一键复制。

## 工作原理

```
点击扩展图标
   │
   ▼
popup ──POST {}──▶ 金山文档 webhook（sync_task 同步执行接口）
                      │  Header: AirScript-Token
                      ▼
              AirScript 脚本（air.js）
              读取 UsedRange → 定位【内容】列 → 取最后一行非空值
                      │
                      ▼
popup ◀── { data: { result: { ok, content, row } } } ──返回
```

- 触发机制：金山文档 AirScript「脚本令牌 + webhook」同步执行，无需 OAuth、无需轮询
- 兼容性处理：金山网关会拒绝携带 `Origin: chrome-extension://...` 的请求（403），扩展通过 `declarativeNetRequest` 将请求 Origin 改写为 `https://www.kdocs.cn`

## 目录结构

```
├─ air.js                 # 金山文档脚本（部署到金山脚本编辑器）
├─ extension/
│  ├─ manifest.json       # MV3 清单（storage + declarativeNetRequest + kdocs host）
│  ├─ popup.html/.js      # 点击即拉取：加载中 → 内容/错误，复制按钮，10s 超时
│  ├─ options.html/.js    # 配置页：webhook 链接 + 脚本令牌（chrome.storage.local）
│  └─ rules.json          # DNR 规则：改写 Origin 头
├─ spec.md                # SDD 功能规格（含实测接口契约）
├─ checklist.md           # 质量/验收清单
└─ tasks.md               # 任务分解
```

## 部署

### 1. 金山文档侧（air.js）

1. 打开目标电子表格 → 脚本编辑器 → 新建脚本，粘贴 `air.js` 全部内容
2. 侧边栏脚本「更多菜单」→ 复制 **webhook 链接**（形如 `https://www.kdocs.cn/api/v3/ide/file/<file_id>/script/<script_id>/sync_task`）
3. 生成**脚本令牌**（AirScript-Token）

脚本行为：表头行含【内容】则按表头定位列；无表头则默认取 A 列；返回最后一行非空值。

### 2. 浏览器侧（扩展）

1. `chrome://extensions`（Edge 为 `edge://extensions`）→ 开启**开发者模式** → **加载已解压的扩展程序** → 选择 `extension` 目录
2. 右键扩展图标 → **选项** → 填入 webhook 链接与脚本令牌 → 保存
3. 点击工具栏扩展图标，即可查看最新内容

## 隐私与安全

- 脚本令牌仅存储于浏览器本地（`chrome.storage.local`），仅随请求头发往 `www.kdocs.cn`
- 扩展不收集、不上传任何数据到第三方
- 请勿将明文令牌提交到任何代码仓库

## 接口契约（实测）

请求：`POST <webhook>`，Header 携带 `AirScript-Token`，Body 为 `{}`

响应：

```json
{
  "status": "finished",
  "error": "",
  "data": { "logs": [], "result": { "ok": true, "content": "...", "row": 8 } }
}
```
