# 金山文档拉取器（kdocs-fetcher）

一个 Chrome / Edge 浏览器扩展：点击扩展图标，一键拉取金山文档表格中**指定字段的最新一条数据**（可配置一个或多个字段），并支持一键复制。

## 工作原理

```
点击扩展图标
   │
   ▼
popup ──POST {Context:{argv:{fields}}}──▶ 金山文档 webhook（sync_task 同步执行接口）
                      │  Header: AirScript-Token
                      ▼
              AirScript 脚本（air.js）
              读取 UsedRange → 定位各字段列 → 逐列取最后一行非空值
                      │
                      ▼
popup ◀── { data: { result: { ok, fields: [{name, value, row}] } } } ──返回
```

- 触发机制：金山文档 AirScript「脚本令牌 + webhook」同步执行，无需 OAuth、无需轮询
- 兼容性处理：金山网关会拒绝携带 `Origin: chrome-extension://...` 的请求（403），扩展通过 `declarativeNetRequest` 将请求 Origin 改写为 `https://www.kdocs.cn`

## 目录结构

```
├─ extension/
│  ├─ manifest.json       # MV3 清单（storage + declarativeNetRequest + kdocs host）
│  ├─ air.js              # 金山文档脚本（部署到金山脚本编辑器，向导可一键复制）
│  ├─ popup.html/.js      # 点击即拉取：加载中 → 内容/错误，复制按钮，10s 超时
│  ├─ options.html/.js    # 配置页：webhook 链接 + 脚本令牌 + 要拉取的字段列表（chrome.storage.local）
│  ├─ wizard.html/.js     # 配置向导：7 步引导部署、连接、探测并选择数据表/字段
│  ├─ screenshots/        # 向导每一步的截图（step1.png … step7.png）
│  └─ rules.json          # DNR 规则：改写 Origin 头
├─ spec.md                # SDD 功能规格（含实测接口契约）
├─ checklist.md           # 质量/验收清单
└─ tasks.md               # 任务分解
```

## 部署

### 1. 金山文档侧（air.js）

1. 打开目标电子表格 → 脚本编辑器 → 新建脚本，粘贴 `extension/air.js` 全部内容
2. 侧边栏脚本「更多菜单」→ 复制 **webhook 链接**（形如 `https://www.kdocs.cn/api/v3/ide/file/<file_id>/script/<script_id>/sync_task`）
3. 生成**脚本令牌**（AirScript-Token）

脚本行为：

- 表名由请求体 `Context.argv.sheet` 传入（**多维表格**有多张表时用它指定要读取哪张表，可填表名或 1 起始序号；留空时优先读取当前视图所在表，否则取第一张可读取的表；表名不存在时会返回错误并列出可用表名）
- 字段列表由请求体 `Context.argv.fields` 传入（未传默认【内容】），每项格式为 `[显示名=]定位目标[:date]`
- **多维表格**：通过 `Field.GetFields()` 读取字段元数据，按字段名取记录值，调整列顺序/视图排序均不影响；记录优先按当前视图顺序读取（视图自动排序生效）
- **电子表格**：全表自动寻找「含定位目标最多」的行作为表头（可在任意行）；全表无表头行时**必须**用列字母/列号（如 `E`）定位，无法定位的字段会返回明确错误（不会静默猜列）
- 配置中的全角字符（如 `＝`、`Ｅ`）会自动按半角处理
- 定位目标可加 `:date` 后缀（如 `日期:date`），数字（日期序列值或毫秒时间戳）会转为 `YYYY-MM-DD HH:mm:ss`
- 最新数据方向由 `Context.argv.order` 控制：`bottom`（默认，自下而上找）或 `top`（表格开启倒序自动排序时自上而下找）
- 每个字段分别取该列最新一条非空值

### 2. 浏览器侧（扩展）

1. `chrome://extensions`（Edge 为 `edge://extensions`）→ 开启**开发者模式** → **加载已解压的扩展程序** → 选择 `extension` 目录
2. 右键扩展图标 → **选项** → 填入 webhook 链接与脚本令牌 → 保存
3. 点击工具栏扩展图标，即可查看最新内容

## 隐私与安全

- 脚本令牌仅存储于浏览器本地（`chrome.storage.local`），仅随请求头发往 `www.kdocs.cn`
- 扩展不收集、不上传任何数据到第三方
- 请勿将明文令牌提交到任何代码仓库

## 接口契约（实测）

请求：`POST <webhook>`，Header 携带 `AirScript-Token`，Body 为 `{"Context":{"argv":{"sheet":"项目","fields":["内容","机构=E"],"order":"top"}}}`（`sheet`、`order` 可省略，`order` 默认 `bottom`）

响应：

```json
{
  "status": "finished",
  "error": "",
  "data": {
    "logs": [],
    "result": {
      "ok": true,
      "fields": [
        { "name": "内容", "value": "...", "row": 8 },
        { "name": "机构", "value": "...", "row": 6 }
      ]
    }
  }
}
```

字段级错误（如表头找不到该字段）以 `{ "name": "...", "error": "..." }` 形式出现在 `fields` 数组对应位置。
