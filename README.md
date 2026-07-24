# klgzapp · App Code

面向 [www.klgzapp.com](https://www.klgzapp.com) 的静态站。

将 **包名 + 业务类型 + 上线日期** 编码为 **固定 32 位** URL-Safe Base64 字符串，并可完整逆向还原。

| 项 | 说明 |
|---|---|
| 输出长度 | 始终 32 字符（`A–Z a–z 0–9 - _`） |
| 载荷 | 24 字节：版本/压缩标志 · **业务类型** · 上线日（自 2000-01-01） · 包名槽 20 字节 |
| 业务类型 | Google Play 全部分类（Apps 32 + Games 17）；取值英文类别 ID（如 `SOCIAL` / `GAME_ACTION`）；界面 `English（中文备注）` |
| 编码版本 | v2（Play 分类表） |
| 包名 | 常见前缀（`com.` / `org.` …）字典压缩；仍超长则 `deflate-raw` |
| 混淆 | 与站点固定 key XOR（可逆，非保密加密） |
| 还原 | 页面「还原」区粘贴 32 位码即可解出三字段 |

页面提供：**编码**、**还原**、**删除还原结果**。

## 本地预览

```bash
cd sites/klgzapp-com
python3 -m http.server 8080
```

打开 `http://127.0.0.1:8080`（须用 HTTP，模块脚本无法用 `file://`）。

## GitHub Pages

1. 将本目录推到独立公开仓库  
2. Settings → Pages → `main` / root  
3. 已含 `CNAME`：`www.klgzapp.com`  
4. DNS：`www` CNAME → `<user>.github.io`
