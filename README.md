# klgzapp · Tools

面向 [www.klgzapp.com](https://www.klgzapp.com) 的静态站。

页面工具：

| 工具 | 说明 | 直达 |
|---|---|---|
| **App Code** | 包名 + 业务类型 → 固定 32 位小写 Base32，可逆还原 | 默认首页 |
| **Base64** | UTF-8 文本 ↔ Base64（可选 URL-safe） | `?tool=base64` |
| **WebP → Lottie** | 动图/静图 WebP → Bodymovin / Lottie JSON（嵌入 PNG 帧） | `?tool=webp-json` |
| **视频 → WebP** | 批量视频抽帧 → 动画 WebP | `?tool=video-webp` |
| **批量下载** | 粘贴 URL 列表，下载到本地文件夹或生成 Python 脚本 | `?tool=batch-dl` |
| **生图立项** | 生成项目名（首字母大写）+ 包名，并检查 Google Play 是否已被占用 | `?tool=pkg-gen` |

顶部导航：左侧品牌；**编解码**（App Code / Base64）、**上架**（生图立项）与 **媒体**（WebP → Lottie / 视频 → WebP / 批量下载）。

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

## WebP → Lottie

| 项 | 说明 |
|---|---|
| 输入 | `.webp`（静图 / 动画） |
| 输出 | Bodymovin / Lottie JSON：`assets` 嵌入 PNG（`e:1`）+ 按帧时长排布的 image layers |
| 帧率 | 可调 `fr`（默认 30），按原 WebP 每帧 ms 映射到时间轴 |
| 拆帧 | 需 Chromium `ImageDecoder`（Chrome / Edge） |
| 上限 | 默认最多导出 120 帧（可改） |
| 运行位置 | 浏览器本地，无服务端 |


## 视频 → WebP

| 项 | 说明 |
|---|---|
| 输入 | 多选视频（`mp4` / `webm` / `mov` 等） |
| 输出 | 每个视频一个**动画 WebP** |
| 压缩档位 | **保质压缩（默认）** / 更小体积 / 更高画质 |
| 保质策略 | 高质量缩放、偶数边长、跳过近似重复帧、体积超标时自动复压（不低于质量下限） |
| 默认（保质压缩） | 8 fps · q≈0.72（下限 0.58）· 宽边 ≤640 · ≤72 帧 · ≤12 秒 |
| 保存 | 「转换并下载」逐个保存；或「转换到文件夹」（Chrome / Edge） |
| 运行位置 | 浏览器本地，无服务端；需支持 canvas WebP 编码 |

## 批量下载

| 项 | 说明 |
|---|---|
| 输入 | 每行一条 URL；支持粘连地址与 `/amspire/...` 相对路径 |
| 范围 | 可指定从第 N 条到第 M 条 |
| 浏览器下载 | Chrome / Edge 选择本地文件夹（需目标站开放 CORS） |
| Python 脚本 | 页面可生成带当前列表的脚本；也可下载通用 [`download-batch.py`](./download-batch.py) |
| 用法 | `python3 download-batch.py urls.txt data_5S` |
| 运行位置 | 浏览器本地解析；实际拉取可在浏览器或本机 Python |

## 生图立项

| 项 | 说明 |
|---|---|
| 业务 | 固定生图：Play 类别 `ART_AND_DESIGN` |
| 项目名 | 英文词，首字母大写、其余小写（如 `Pixora`） |
| 包名 | `域名后缀.业务名.项目名`（如 `ai.lore.voya`）；业务名默认每次不同；后缀 `com` / `ai` / `io` / `app` / `me` |
| 占用检查 | 读取 Google Play 公开详情页；404 / Not Found → 未见上架；有应用标题 → 已被其他开发者占用 |
| 局限 | Play Console 预留但未上架的包名，公开页查不到 |
| 衔接 | 未见上架的结果可一键填入 App Code |
| 直达 | `?tool=pkg-gen` |

## 本地预览

```bash
cd sites/klgzapp-com
python3 -m http.server 8080
```

打开 `http://127.0.0.1:8080`（须用 HTTP，模块脚本无法用 `file://`）。  
Base64：`http://127.0.0.1:8080/?tool=base64`  
WebP → Lottie：`http://127.0.0.1:8080/?tool=webp-json`  
视频 → WebP：`http://127.0.0.1:8080/?tool=video-webp`  
批量下载：`http://127.0.0.1:8080/?tool=batch-dl`  
生图立项：`http://127.0.0.1:8080/?tool=pkg-gen`

## GitHub Pages

1. 将本目录推到独立公开仓库  
2. Settings → Pages → `main` / root  
3. 已含 `CNAME`：`www.klgzapp.com`  
4. DNS：`www` CNAME → `<user>.github.io`
