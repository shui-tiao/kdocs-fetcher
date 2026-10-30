# 无 Wi-Fi 华为手表经手机访问局域网 —— 可行性实测方案

> 版本：v1.0  
> 目的：验证「手表 App 不连 Wi-Fi，仅靠手机蓝牙网络，能否访问同一局域网内的电脑（私有 IP）」  
> 交付对象：执行测试的开发 Agent  
> 约束：**不要修改本项目（浏览器插件 / kdocs-fetcher）的代码**，本测试使用独立的临时手表 App

---

## 1. 待验证命题

| 编号 | 命题 | 说明 |
|---|---|---|
| H1 | 手表 App 的网络请求能被手机蓝牙网络转发到公网 | 基线能力，必须成立，否则一切免谈 |
| H2 | 同一条转发链路能到达手机所在局域网的**私有地址**（如 `192.168.1.23`） | **核心命题**，官方无任何文档承诺 |
| H3 | API 12 上明文 HTTP 默认可用（或可通过 `network_config.json` 放行） | 工程前提，影响是否必须上 HTTPS |

三者全部成立 → 局域网方案可用；H1 成立但 H2 不成立 → 只能公网可达（等于需要服务器/域名）。

---

## 2. 环境与前置条件

### 2.1 硬件/系统清单（实测时逐项记录真实值）

| 项 | 要求 | 实测记录 |
|---|---|---|
| 手表型号 | **不支持 Wi-Fi 的华为手表**（如 Watch 5 蓝牙版 / 无 WLAN 版本） | |
| 手表系统版本 | HarmonyOS 5.0（API 12） | |
| 手表是否支持 Wi-Fi | **否**（设置为「不支持」，这是本测试的前提） | |
| 手机型号 | 华为手机，HarmonyOS 5.0+ | |
| 手机系统版本 | | |
| PC 系统 | Windows / macOS / Linux 任一 | |
| 路由器 | 2.4G + 5G 均可；**确认关闭 AP 隔离 / 客户端隔离** | |
| 开发环境 | DevEco Studio + HarmonyOS SDK API 12 | |

### 2.2 前置配置

1. PC 与手机连**同一个 Wi-Fi**，手机与 PC 在同一 `192.168.x.x` 网段。
2. 关闭路由器「AP 隔离 / 访客网络隔离 / 客户端隔离」，否则设备互访必失败。
3. 手机与手表通过华为运动健康正常配对，蓝牙连接稳定。
4. 手表开启开发者模式，`hdc list targets` 能看到设备。
5. 手表时间、手机时间与实际时间一致（便于对日志）。

---

## 3. 测试用例矩阵

| 用例 | 手表网络来源 | 手机网络 | 目标地址 | 预期 | 实际结果 | 判定 |
|---|---|---|---|---|---|---|
| T0.1 | — | Wi-Fi | 手机浏览器访问 `http://<PC-IP>:8000/ping` | 200 | | 前置 |
| T0.2 | — | 蜂窝（Wi-Fi 关闭） | 手机浏览器访问同一地址 | 失败 | | 前置（应失败） |
| T0.3 | 蓝牙网络 | Wi-Fi | `https://www.baidu.com` 或 `https://httpbin.org/get` | 200 | | 基线 H1 |
| **T1** | 蓝牙网络 | Wi-Fi | `http://<PC-IP>:8000/ping` | **200 + 预期 JSON** | | **核心 H2** |
| T2 | 蓝牙网络 | Wi-Fi | `http://<PC-IP>:80/ping`（PC 服务改用 80 端口） | 200 | | H2 端口变体 |
| T3 | 蓝牙网络 | Wi-Fi | `http://<PC主机名>.local:8000/ping`（mDNS） | 200 / 解析失败 | | H2 域名变体 |
| T4 | 蓝牙网络 | Wi-Fi | 配置 `network_config.json` 允许明文后重跑 T1 | 200 | | H3 |
| T5 | 蓝牙网络 | Wi-Fi | `https://<PC-IP>:8443/ping`（自签证书） | 预期证书错误 | | TLS 可达性 |
| T6 | 蓝牙网络 | Wi-Fi | `http://<PC-IP>:8000/big`（返回约 100 KB JSON） | 200 且完整 | | 带宽/代理限制 |
| T7 | 蓝牙网络 | Wi-Fi | 重跑 T1，观察 PC 侧访问日志的来源 IP | 来源 IP = 手机 IP | | 判定转发方式 |
| T8（可选对照） | 手表 Wi-Fi 直连同一 AP | 任意 | `http://<PC-IP>:8000/ping` | 200 | | 机型对照 |

> 每个用例至少执行 3 次，任一次成功即记为 PASS，但需注明成功次数与耗时。

---

## 4. 测试准备

### 4.1 PC 端测试服务

保存为 `lan_test_server.py`，在 PC 上运行：`python lan_test_server.py`（默认监听 `0.0.0.0:8000`）。

```python
import json, time, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        # 关键证据：记录来源 IP、UA、路径、时间
        print(f"[{time.strftime('%H:%M:%S')}] from={self.client_address[0]} "
              f"path={self.path} ua={self.headers.get('User-Agent')}", flush=True)
        if self.path.startswith("/ping"):
            body = json.dumps({"ok": True, "from": self.client_address[0],
                               "t": int(time.time())}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/big"):
            body = json.dumps({"ok": True, "pad": "x" * 100_000}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()

ThreadingHTTPServer(("0.0.0.0", 8000), H).serve_forever()
```

**服务端自检**（在 PC 本机）：

```bash
curl http://127.0.0.1:8000/ping
curl http://<PC-IP>:8000/ping
```

### 4.2 手表端最小测试 App

用 DevEco Studio 新建 **Wearable（ArkTS）** 工程，API 12，最小实现：

- 页面元素：一个 URL 输入框（或几个写死 URL 的按钮）、一个「发送 GET」按钮、一个结果文本区
- 网络请求：`@ohos.net.http`
- 必需权限（`module.json5`）：

```json
"requestPermissions": [
  { "name": "ohos.permission.INTERNET" }
]
```

- 结果区必须输出：**HTTP 状态码 / 响应体前 200 字符 / 错误码 / 错误 message / 耗时 ms**
- 同时用 `hilog` 打印同样的内容，便于落盘取证

参考请求代码：

```ts
import http from '@ohos.net.http';

async function get(url: string): Promise<string> {
  const req = http.createHttp();
  const t0 = Date.now();
  try {
    const resp = await req.request(url, {
      method: http.RequestMethod.GET,
      connectTimeout: 15000,
      readTimeout: 15000,
      expectDataType: http.HttpDataType.STRING
    });
    return JSON.stringify({
      url,
      code: resp.responseCode,
      ms: Date.now() - t0,
      body: String(resp.result).slice(0, 200)
    });
  } catch (e) {
    return JSON.stringify({
      url,
      ms: Date.now() - t0,
      errCode: e?.code,
      errMsg: e?.message
    });
  } finally {
    req.destroy();
  }
}
```

**注意**：`<PC-IP>`、`<PC主机名>.local` 不要写死在代码里，做成输入框或可切换的常量，方便换环境复测。

### 4.3 安装与日志

```bash
hdc list targets
hdc install -r <hap路径>
hdc hilog | grep -i lan_test        # 建议在日志里打统一 TAG
hdc file recv /data/log/hilog/ <本地目录>   # 按实际路径调整
```

---

## 5. 执行顺序

严格按顺序执行，前面失败则记录原因并继续后面的分支（不要提前终止整个测试）。

1. **T0.1 / T0.2**：先确认「PC 服务可达」与「蜂窝下不可达」两个前置事实。
2. **T0.3**：手表基线联网能力（公网 HTTPS）。失败 → 记录错误码，检查手表网络设置（是否禁用蓝牙网络、是否飞行模式/超长续航模式）。
3. **T1**：核心用例，手表 → PC 私有 IP（手机连 Wi-Fi）。
4. **T2 / T3**：端口与 mDNS 变体。
5. **T4**：若 T1 返回明文拦截类错误，添加 `network_config.json` 后再测。
6. **T5**：TLS 可达性（自签证书预期失败，只记录错误码）。
7. **T6**：大响应体，验证是否被截断/限流。
8. **T7**：对照 PC 日志中的来源 IP。
9. **T8**：如有支持 Wi-Fi 的对照机型，做直连对照。

每个用例结束后立即填写矩阵表与证据清单，不要事后凭记忆补。

---

## 6. 证据清单（缺一不可）

1. 手表型号 / 系统版本 / API 版本截图（设置 → 关于）
2. 手机型号 / 系统版本
3. 路由器型号 + AP 隔离关闭的截图或说明
4. T0.1、T0.2 的截图（手机浏览器成功 / 蜂窝失败）
5. 手表 App 每个用例的结果区截图（含错误码与耗时）
6. `hilog` 完整片段（含统一 TAG）
7. PC 服务端 `stdout` 日志（含来源 IP、UA、时间）
8. 失败用例的错误码原文（不要只写「失败了」）

---

## 7. 判定标准

| 现象 | 结论 |
|---|---|
| T1 成功（200 且 body 正确），T7 来源 IP 为手机 IP | **H2 成立，局域网方案可用** |
| T1 失败，错误为超时 / 连接被拒 / 不可达，且 T0 正常 | **H2 不成立**，该机型只能公网可达 |
| T1 失败但 T3（mDNS）成功 | 仅域名解析路径可用，需固定主机名方案 |
| T1 失败且错误为明文拦截 | 先做 T4；T4 成功则 H3 可绕过，T1 重测 |
| T0.3 就失败 | **H1 不成立**，先排查手表网络设置，本测试阻塞 |
| 手表可直接连 Wi-Fi（T8）成功 | 与「无 Wi-Fi 机型」结论无关，仅作对照 |

**所有「失败」都必须带上错误码 + 耗时 + 手机当前网络类型**，否则视为无效证据。

---

## 8. 结论模板（测试完成后填写）

```
一、环境
  手表：<型号> / HarmonyOS <版本> / API <版本> / Wi-Fi：<支持|不支持>
  手机：<型号> / HarmonyOS <版本>
  PC：<系统> / IP：<192.168.x.x>
  路由：<型号>，AP 隔离：<已关闭>

二、结果
  H1（公网可达）：<PASS|FAIL>      证据：<用例号>
  H2（私有地址可达）：<PASS|FAIL>  证据：<用例号>
  H3（明文 HTTP）：<可用|需配置|被拦> 证据：<用例号>
  T7 转发判定：PC 侧来源 IP = <值>，判定为 <手机NAT|代理>

三、结论
  <局域网方案可行 | 仅特定组合可行 | 不可行>
  可复现的最小条件：<...>

四、建议
  <主通道保持 GitHub 短码 / 增加局域网模式 / 放弃局域网>
```

---

## 9. 常见坑与排查

| 现象 | 排查方向 |
|---|---|
| 手表连公网都失败 | 飞行模式、超长续航模式、蓝牙网络被关闭、手表与手机断连 |
| 手机浏览器打不开 PC 服务 | PC 防火墙未放行 8000、服务只监听 `127.0.0.1` |
| 手机能开、手表超时 | AP 隔离、手机侧代理不放行私有地址（核心结论） |
| 错误为明文拦截 | 走 T4：`network_config.json` 配 `cleartextTrafficPermitted` |
| 自签 HTTPS 报证书错误 | 预期结果，手表无法安装自签 CA；不要为此绕过证书校验 |
| mDNS 解析失败 | 手表可能不支持 mDNS，改用固定 IP（并在路由器做 DHCP 保留） |

**禁止项**：为了「跑通」而在测试 App 中关闭证书校验、或用明文绕过安全策略后当成正式结论——这类结果必须标注为「仅测试」。

---

## 10. 交付物

1. 填写完成的用例矩阵（第 3 节）
2. 证据包（第 6 节 8 项）
3. 结论（第 8 节模板）
4. 一句话决策建议：局域网模式是否值得进入正式方案
