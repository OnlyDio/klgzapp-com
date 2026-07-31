# klgzapp · Tools

面向 [www.klgzapp.com](https://www.klgzapp.com) 的静态站。

页面工具：

| 工具 | 说明 | 直达 |
|---|---|---|
| **App Code** | 包名 + 业务类型 → 固定 32 位小写 Base32，可逆还原 | 默认首页 |
| **Base64** | UTF-8 文本 ↔ Base64（可选 URL-safe） | `?tool=base64` |

顶部导航：**分类**（当前「编解码」）→ 其下工具（App Code / Base64）。后续新工具可挂到新分类。

---

## App Code

将 **包名 + 业务类型** 编码为 **固定 32 位小写** Base32 字符串，并可完整逆向还原。

| 项 | 说明 |
|---|---|
| 输出长度 | 始终 **32 位小写**（`a–z` / `2–7`） |
| 载荷 | 20 字节：版本/压缩标志 · 业务类型 · 包名槽 18 字节 |
| 业务类型 | Google Play 全部分类（Apps 32 + Games 17）；取值英文类别 ID（如 `SOCIAL` / `GAME_ACTION`）；界面 `English（中文备注）` |
| 编码版本 | v4（无上线时间） |
| 包名 | 常见前缀（`com.` / `org.` …）字典压缩；仍超长则 `deflate-raw` |
| 混淆 | 与站点固定 key XOR（可逆，非保密加密） |
| 还原 | 页面「还原」区粘贴 32 位小写码即可解出包名与业务类型 |

## Base64

| 项 | 说明 |
|---|---|
| 编码 | 文本 → Base64（UTF-8） |
| 解码 | Base64 → 文本（自动兼容标准 / URL-safe） |
| URL-safe | 可选：`+`→`-`，`/`→`_`，去掉末尾 `=` |
| 运行位置 | 浏览器本地，无服务端 |

## 本地预览

```bash
cd sites/klgzapp-com
python3 -m http.server 8080
```

打开 `http://127.0.0.1:8080`（须用 HTTP，模块脚本无法用 `file://`）。  
Base64：`http://127.0.0.1:8080/?tool=base64`

## GitHub Pages

1. 将本目录推到独立公开仓库  
2. Settings → Pages → `main` / root  
3. 已含 `CNAME`：`www.klgzapp.com`  
4. DNS：`www` CNAME → `<user>.github.io`
