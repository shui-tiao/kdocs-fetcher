# 任务分解

> 依据 spec.md。任务按依赖顺序排列，T1 为金山侧准备，T2–T5 为扩展开发，T6 联调验收。

## T1 编写并部署 air.js（金山文档侧）

- 按 spec §5 实现：读取当前数据表全部记录 → 取末位 → 返回【内容】字段文本
- 返回结构遵循 spec §4.3
- 用户在金山文档脚本编辑器中粘贴脚本、生成脚本令牌、复制 webhook 链接

**产出**：air.js（本仓库中维护，与金山脚本编辑器中保持一致）

## T2 扩展脚手架

- 创建 `extension/manifest.json`（MV3）
- 权限：`storage`；`host_permissions: https://www.kdocs.cn/*`
- 注册 action（popup）与 options_page

**产出**：`extension/manifest.json`

## T3 options 配置页

- 表单：webhook URL、AirScript-Token
- 保存 / 读取 `chrome.storage.local`
- 简单格式校验（URL 需为 `https://www.kdocs.cn/...`；令牌非空）

**产出**：`extension/options.html` + `extension/options.js`

## T4 popup 页面

- 打开时读取配置；未配置 → 引导文案 + 跳转 options 按钮（FR4）
- 已配置 → 发起 webhook 请求（10s 超时），状态流转：加载中 → 内容 / 错误（FR1）
- 展示内容 + 「复制」按钮（FR2）
- 错误分类提示（FR5）：网络失败 / HTTP 非 2xx / `ok:false` / 响应解析失败
- 令牌仅用于请求头，不渲染进 DOM

**产出**：`extension/popup.html` + `extension/popup.js`

## T5 联调与验收

- 加载未打包扩展（chrome://extensions → 开发者模式）
- 填入真实 webhook URL 与令牌，按 checklist.md B 节逐项核对
- 覆盖验收标准：新增记录再拉取、四类错误场景、配置持久化

## 依赖关系

```
T1 ──┐
     ├──> T5
T2 → T3 → T4 ──┘
```
