# klgzapp · App Code

静态站：[www.klgzapp.com](https://www.klgzapp.com)

将 **包名 + 业务类型 + 上线日期** 编码为 **固定 32 位** URL-Safe Base64 字符串，并可完整逆向还原。

| 项 | 说明 |
|---|---|
| 输出长度 | 始终 32 字符（`A–Z a–z 0–9 - _`） |
| 载荷 | 24 字节：版本/压缩标志 · 业务类型 · 上线日（自 2000-01-01） · 包名槽 20 字节 |
| 业务类型 | 应用取值英文 key（如 `social` / `ai`）；界面展示 `English（中文备注）` |
| 包名 | 常见前缀（`com.` / `org.` …）字典压缩；仍超长则 `deflate-raw` |
| 混淆 | 与站点固定 key XOR（可逆，非保密加密） |

## 本地预览

```bash
python3 -m http.server 8080
```

打开 `http://127.0.0.1:8080`（须用 HTTP，模块脚本无法用 `file://`）。

## GitHub Pages

本仓库为独立 Pages 站点：

1. Settings → Pages → Source: **Deploy from a branch**
2. Branch: `main` / `/ (root)`
3. 已含 `CNAME`：`www.klgzapp.com`
4. DNS：将 `www` CNAME 到 `<user>.github.io`
