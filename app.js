import { APP_TYPES, formatAppTypeLabel, encodeAppCode, decodeAppCode } from './codec.js';
import { webpFileToJson } from './webp-json.js';
import { parseUrlList, sliceRange, buildPythonScript, downloadToDirectory } from './batch-dl.js';
import {
  IMAGE_APP_TYPE,
  titleCaseName,
  packageFromName,
  generateAvailableApps,
  checkPlayOccupancy,
} from './pkg-gen.js';

const TOOLS = {
  'app-code': {
    title: 'App Code',
    lede: '包名 + 业务类型 → 32 位可逆编码 · 本地计算',
    catLabel: '编解码',
  },
  base64: {
    title: 'Base64',
    lede: '文本 ↔ Base64 · UTF-8 · 本地计算',
    catLabel: '编解码',
  },
  'webp-json': {
    title: 'WebP → Lottie',
    lede: '动图/静图 WebP → Lottie JSON · 本地计算',
    catLabel: '媒体',
  },
  'batch-dl': {
    title: '批量下载',
    lede: '粘贴 URL 列表 → 下载到本地文件夹或生成脚本',
    catLabel: '媒体',
  },
  'pkg-gen': {
    title: '生图立项',
    lede: '项目名 + 包名 → 检查 Google Play 是否已被占用',
    catLabel: '上架',
  },
};

function switchTool(toolId) {
  const meta = TOOLS[toolId];
  if (!meta) return;

  document.documentElement.setAttribute('data-active-tool', toolId);
  document.getElementById('tool-title').textContent = meta.title;
  document.getElementById('tool-lede').textContent = meta.lede;
  document.getElementById('tool-cat-label').textContent = meta.catLabel;
  document.title = `klgzapp · ${meta.title}`;

  document.querySelectorAll('[data-tool-panel]').forEach((panel) => {
    panel.hidden = panel.getAttribute('data-tool-panel') !== toolId;
  });

  document.querySelectorAll('.topnav__link').forEach((btn) => {
    const active = btn.getAttribute('data-tool') === toolId;
    btn.classList.toggle('is-active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  const url = new URL(window.location.href);
  if (toolId === 'app-code') {
    url.searchParams.delete('tool');
    url.pathname = url.pathname.replace(/\/index\.html$/i, '/') || '/';
  } else {
    url.searchParams.set('tool', toolId);
  }
  window.history.replaceState({}, '', url);
}

document.querySelectorAll('.topnav__link').forEach((link) => {
  link.addEventListener('click', (event) => {
    // 同源工具切换：阻止整页刷新；模块失败时仍可走真实 href
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    switchTool(link.getAttribute('data-tool'));
  });
});

const initialToolRaw = new URLSearchParams(window.location.search).get('tool');
const initialTool = initialToolRaw === 'webp-lottie' ? 'webp-json' : initialToolRaw;
if (initialTool && TOOLS[initialTool]) switchTool(initialTool);
else switchTool('app-code');

/* ——— App Code ——— */

const typeSelect = document.getElementById('app-type');
const groups = new Map();
for (const t of APP_TYPES) {
  const groupName = t.group === 'Games' ? 'Games（游戏）' : 'Apps（应用）';
  if (!groups.has(groupName)) {
    const og = document.createElement('optgroup');
    og.label = groupName;
    groups.set(groupName, og);
    typeSelect.append(og);
  }
  const opt = document.createElement('option');
  opt.value = t.key;
  opt.textContent = formatAppTypeLabel(t);
  groups.get(groupName).append(opt);
}

const encodeForm = document.getElementById('encode-form');
const encodeOut = document.getElementById('encode-out');
const encodeCode = document.getElementById('encode-code');
const encodeStatus = document.getElementById('encode-status');
const decodeForm = document.getElementById('decode-form');
const decodeInput = document.getElementById('decode-input');
const decodeOut = document.getElementById('decode-out');
const decodeStatus = document.getElementById('decode-status');

encodeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  encodeStatus.textContent = '';
  try {
    const code = await encodeAppCode({
      packageName: document.getElementById('package-name').value,
      appType: typeSelect.value,
    });
    encodeCode.textContent = code;
    encodeOut.hidden = false;
    encodeStatus.textContent = '已生成 32 位可逆编码';
  } catch (err) {
    encodeOut.hidden = true;
    encodeStatus.textContent = err instanceof Error ? err.message : String(err);
  }
});

document.getElementById('encode-copy').addEventListener('click', async () => {
  const code = encodeCode.textContent;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    encodeStatus.textContent = '已复制编码';
  } catch {
    encodeStatus.textContent = '复制失败，请手动选择';
  }
});

document.getElementById('encode-to-decode').addEventListener('click', () => {
  const code = encodeCode.textContent;
  if (!code) return;
  decodeInput.value = code;
  decodeForm.requestSubmit();
});

decodeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  decodeStatus.textContent = '';
  try {
    const data = await decodeAppCode(decodeInput.value);
    document.getElementById('out-package').textContent = data.packageName;
    document.getElementById('out-type').textContent = `${data.appType} · ${data.appTypeLabel}`;
    decodeOut.hidden = false;
    decodeStatus.textContent = '还原成功';
  } catch (err) {
    decodeOut.hidden = true;
    decodeStatus.textContent = err instanceof Error ? err.message : String(err);
  }
});

document.getElementById('decode-clear').addEventListener('click', () => {
  decodeInput.value = '';
  decodeOut.hidden = true;
  decodeStatus.textContent = '已删除还原结果';
});

/* ——— Base64 ——— */

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const cleaned = b64.replace(/\s+/g, '');
  if (!cleaned) throw new Error('请输入 Base64 字符串');
  let standard = cleaned.replace(/-/g, '+').replace(/_/g, '/');
  const pad = standard.length % 4;
  if (pad) standard += '='.repeat(4 - pad);
  let binary;
  try {
    binary = atob(standard);
  } catch {
    throw new Error('无效的 Base64 字符串');
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('解码结果不是有效 UTF-8 文本');
  }
}

function toUrlSafe(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const b64EncodeForm = document.getElementById('b64-encode-form');
const b64EncodeOut = document.getElementById('b64-encode-out');
const b64EncodeCode = document.getElementById('b64-encode-code');
const b64EncodeStatus = document.getElementById('b64-encode-status');
const b64UrlSafe = document.getElementById('b64-url-safe');
const b64DecodeForm = document.getElementById('b64-decode-form');
const b64Coded = document.getElementById('b64-coded');
const b64DecodeOut = document.getElementById('b64-decode-out');
const b64DecodeText = document.getElementById('b64-decode-text');
const b64DecodeStatus = document.getElementById('b64-decode-status');

b64EncodeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  b64EncodeStatus.textContent = '';
  try {
    const plain = document.getElementById('b64-plain').value;
    if (!plain) throw new Error('请输入原文');
    let coded = utf8ToBase64(plain);
    if (b64UrlSafe.checked) coded = toUrlSafe(coded);
    b64EncodeCode.textContent = coded;
    b64EncodeOut.hidden = false;
    b64EncodeStatus.textContent = b64UrlSafe.checked ? '已生成 URL-safe Base64' : '已生成 Base64';
  } catch (err) {
    b64EncodeOut.hidden = true;
    b64EncodeStatus.textContent = err instanceof Error ? err.message : String(err);
  }
});

document.getElementById('b64-encode-copy').addEventListener('click', async () => {
  const code = b64EncodeCode.textContent;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    b64EncodeStatus.textContent = '已复制';
  } catch {
    b64EncodeStatus.textContent = '复制失败，请手动选择';
  }
});

document.getElementById('b64-encode-to-decode').addEventListener('click', () => {
  const code = b64EncodeCode.textContent;
  if (!code) return;
  b64Coded.value = code;
  b64DecodeForm.requestSubmit();
});

b64DecodeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  b64DecodeStatus.textContent = '';
  try {
    const text = base64ToUtf8(b64Coded.value);
    b64DecodeText.textContent = text;
    b64DecodeOut.hidden = false;
    b64DecodeStatus.textContent = '解码成功';
  } catch (err) {
    b64DecodeOut.hidden = true;
    b64DecodeStatus.textContent = err instanceof Error ? err.message : String(err);
  }
});

document.getElementById('b64-decode-copy').addEventListener('click', async () => {
  const text = b64DecodeText.textContent;
  if (text == null || text === '') return;
  try {
    await navigator.clipboard.writeText(text);
    b64DecodeStatus.textContent = '已复制';
      } catch {
    b64DecodeStatus.textContent = '复制失败，请手动选择';
  }
});

document.getElementById('b64-decode-clear').addEventListener('click', () => {
  b64Coded.value = '';
  b64DecodeOut.hidden = true;
  b64DecodeStatus.textContent = '已删除解码结果';
});

/* ——— WebP → Lottie ——— */

const webpForm = document.getElementById('webp-json-form');
const webpFile = document.getElementById('webp-file');
const webpFr = document.getElementById('webp-fr');
const webpMaxFrames = document.getElementById('webp-max-frames');
const webpPretty = document.getElementById('webp-pretty');
const webpPreview = document.getElementById('webp-preview');
const webpPreviewImg = document.getElementById('webp-preview-img');
const webpMeta = document.getElementById('webp-meta');
const webpJsonOut = document.getElementById('webp-json-out');
const webpJsonText = document.getElementById('webp-json-text');
const webpJsonStatus = document.getElementById('webp-json-status');
const webpConvertBtn = document.getElementById('webp-convert-btn');
const webpJsonCopy = document.getElementById('webp-json-copy');
const webpJsonDownload = document.getElementById('webp-json-download');
const webpClear = document.getElementById('webp-clear');

let webpPreviewUrl = '';
let lastWebpJsonName = 'lottie.json';
let lastWebpJsonText = '';

function revokeWebpPreview() {
  if (webpPreviewUrl) {
    URL.revokeObjectURL(webpPreviewUrl);
    webpPreviewUrl = '';
  }
}

if (webpFile) {
  webpFile.addEventListener('change', () => {
    revokeWebpPreview();
    if (webpJsonOut) webpJsonOut.hidden = true;
    if (webpJsonText) webpJsonText.textContent = '';
    lastWebpJsonText = '';
    const file = webpFile.files?.[0];
    if (!file) {
      if (webpPreview) webpPreview.hidden = true;
      if (webpMeta) webpMeta.hidden = true;
      if (webpJsonStatus) webpJsonStatus.textContent = '';
      return;
    }
    webpPreviewUrl = URL.createObjectURL(file);
    if (webpPreviewImg) webpPreviewImg.src = webpPreviewUrl;
    if (webpPreview) webpPreview.hidden = false;
    if (webpMeta) webpMeta.hidden = true;
    if (webpJsonStatus) {
      webpJsonStatus.textContent = `已选择 ${file.name}（${file.size.toLocaleString()} 字节）`;
    }
  });
}

if (webpForm) {
  webpForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (webpJsonStatus) webpJsonStatus.textContent = '';
    const file = webpFile?.files?.[0];
    if (!file) {
      if (webpJsonStatus) webpJsonStatus.textContent = '请先选择 WebP 文件';
      return;
    }

    const maxFrames = Number(webpMaxFrames?.value) || 120;
    const fr = Number(webpFr?.value) || 30;
    if (webpConvertBtn) webpConvertBtn.disabled = true;
    if (webpJsonStatus) webpJsonStatus.textContent = '转换中…';

    try {
      const { doc, text, meta } = await webpFileToJson(file, {
        maxFrames,
        fr,
        pretty: webpPretty?.checked !== false,
      });
      lastWebpJsonText = text;
      lastWebpJsonName = `${(file.name || 'image').replace(/\.webp$/i, '') || 'webp'}.json`;
      if (webpJsonText) webpJsonText.textContent = text;
      if (webpJsonOut) webpJsonOut.hidden = false;

      const sizeEl = document.getElementById('webp-meta-size');
      const animEl = document.getElementById('webp-meta-anim');
      const framesEl = document.getElementById('webp-meta-frames');
      const loopEl = document.getElementById('webp-meta-loop');
      if (sizeEl) sizeEl.textContent = `${meta.width} × ${meta.height}`;
      if (animEl) animEl.textContent = meta.animated ? '是' : '否';
      if (framesEl) {
        framesEl.textContent =
          meta.webpFrameCount && meta.webpFrameCount !== meta.exportedFrames
            ? `${meta.exportedFrames} / ${meta.webpFrameCount}`
            : String(meta.exportedFrames);
      }
      if (loopEl) {
        loopEl.textContent = `${meta.durationSec.toFixed(2)}s · ${meta.fr} fps · ${meta.durationFrames}f`;
      }
      if (webpMeta) webpMeta.hidden = false;

      if (webpJsonStatus) {
        webpJsonStatus.textContent = meta.note
          ? `完成 Lottie · ${meta.note}`
          : `完成 Lottie · ${meta.exportedFrames} 帧 · ${meta.durationSec.toFixed(2)}s @ ${meta.fr}fps · ${(text.length / 1024).toFixed(1)} KB`;
      }
    } catch (err) {
      if (webpJsonOut) webpJsonOut.hidden = true;
      if (webpJsonStatus) webpJsonStatus.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      if (webpConvertBtn) webpConvertBtn.disabled = false;
    }
  });
}

webpJsonCopy?.addEventListener('click', async () => {
  if (!lastWebpJsonText) return;
  try {
    await navigator.clipboard.writeText(lastWebpJsonText);
    if (webpJsonStatus) webpJsonStatus.textContent = '已复制 Lottie JSON';
  } catch {
    if (webpJsonStatus) webpJsonStatus.textContent = '复制失败，请手动选择';
  }
});

webpJsonDownload?.addEventListener('click', () => {
  if (!lastWebpJsonText) return;
  const blob = new Blob([lastWebpJsonText], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = lastWebpJsonName;
  a.click();
  URL.revokeObjectURL(url);
  if (webpJsonStatus) webpJsonStatus.textContent = `已下载 ${lastWebpJsonName}`;
});

webpClear?.addEventListener('click', () => {
  webpForm?.reset();
  if (webpPretty) webpPretty.checked = true;
  if (webpFr) webpFr.value = '30';
  if (webpMaxFrames) webpMaxFrames.value = '120';
  revokeWebpPreview();
  webpPreviewImg?.removeAttribute('src');
  if (webpPreview) webpPreview.hidden = true;
  if (webpMeta) webpMeta.hidden = true;
  if (webpJsonOut) webpJsonOut.hidden = true;
  if (webpJsonText) webpJsonText.textContent = '';
  lastWebpJsonText = '';
  if (webpJsonStatus) webpJsonStatus.textContent = '已清除';
});

/* ——— 批量下载 ——— */

const batchForm = document.getElementById('batch-dl-form');
const batchUrls = document.getElementById('batch-dl-urls');
const batchFrom = document.getElementById('batch-dl-from');
const batchTo = document.getElementById('batch-dl-to');
const batchWorkers = document.getElementById('batch-dl-workers');
const batchOutdir = document.getElementById('batch-dl-outdir');
const batchNumbered = document.getElementById('batch-dl-numbered');
const batchRun = document.getElementById('batch-dl-run');
const batchScript = document.getElementById('batch-dl-script');
const batchExport = document.getElementById('batch-dl-export');
const batchClear = document.getElementById('batch-dl-clear');
const batchMeta = document.getElementById('batch-dl-meta');
const batchMetaTotal = document.getElementById('batch-dl-meta-total');
const batchMetaRange = document.getElementById('batch-dl-meta-range');
const batchMetaProgress = document.getElementById('batch-dl-meta-progress');
const batchLog = document.getElementById('batch-dl-log');
const batchStatus = document.getElementById('batch-dl-status');

function currentBatchJobs() {
  const urls = parseUrlList(batchUrls?.value || '');
  if (!urls.length) throw new Error('请先粘贴 URL 列表');
  const sliced = sliceRange(urls, batchFrom?.value, batchTo?.value || urls.length);
  if (!sliced.items.length) throw new Error('范围内没有条目');
  return { urls, ...sliced };
}

function showBatchMeta(total, from, to, progress) {
  if (batchMetaTotal) batchMetaTotal.textContent = `${total} 条`;
  if (batchMetaRange) batchMetaRange.textContent = `${from}–${to}（${to - from + 1} 条）`;
  if (batchMetaProgress) batchMetaProgress.textContent = progress || '待开始';
  if (batchMeta) batchMeta.hidden = false;
}

function downloadTextFile(name, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function appendBatchLog(item) {
  if (!batchLog) return;
  batchLog.hidden = false;
  const li = document.createElement('li');
  li.className = `dl-log__item dl-log__item--${item.status}`;
  const label = item.status === 'ok' ? '完成' : item.status === 'exists' ? '已存在' : '失败';
  li.textContent = `${String(item.index).padStart(3, '0')} ${label} ${item.name}${item.error ? ` · ${item.error}` : ''}`;
  batchLog.append(li);
}

batchForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (batchStatus) batchStatus.textContent = '';
  if (batchLog) {
    batchLog.replaceChildren();
    batchLog.hidden = true;
  }

  let jobs;
  try {
    jobs = currentBatchJobs();
  } catch (err) {
    if (batchStatus) batchStatus.textContent = err instanceof Error ? err.message : String(err);
    return;
  }

  showBatchMeta(jobs.urls.length, jobs.from, jobs.to, `0 / ${jobs.items.length}`);
  if (!window.showDirectoryPicker) {
    if (batchStatus) {
      batchStatus.textContent = '当前浏览器不支持选择文件夹，请改用「下载 Python 脚本」';
    }
    return;
  }

  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (batchStatus) batchStatus.textContent = '已取消选择文件夹';
      return;
    }
    if (batchStatus) batchStatus.textContent = err instanceof Error ? err.message : String(err);
    return;
  }

  const stats = { ok: 0, exists: 0, err: 0 };
  if (batchRun) batchRun.disabled = true;
  if (batchStatus) batchStatus.textContent = '下载中…';
  try {
    const result = await downloadToDirectory(jobs.items, dirHandle, {
      workers: Number(batchWorkers?.value) || 4,
      numbered: Boolean(batchNumbered?.checked),
      onItem(item) {
        stats[item.status] = (stats[item.status] || 0) + 1;
        const done = stats.ok + stats.exists + stats.err;
        showBatchMeta(jobs.urls.length, jobs.from, jobs.to, `${done} / ${jobs.items.length} · 成功 ${stats.ok} · 已存在 ${stats.exists} · 失败 ${stats.err}`);
        appendBatchLog(item);
      },
    });
    if (batchStatus) {
      batchStatus.textContent = result.err
        ? `完成，但有 ${result.err} 条失败。跨域资源可改用「下载 Python 脚本」。`
        : `完成 · 成功 ${result.ok} · 已存在 ${result.exists}`;
    }
  } catch (err) {
    if (batchStatus) batchStatus.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    if (batchRun) batchRun.disabled = false;
  }
});

batchScript?.addEventListener('click', () => {
  try {
    const jobs = currentBatchJobs();
    showBatchMeta(jobs.urls.length, jobs.from, jobs.to, `将导出 ${jobs.items.length} 条`);
    const script = buildPythonScript(jobs.items, batchOutdir?.value || 'downloads');
    downloadTextFile('download-batch.py', script, 'text/x-python;charset=utf-8');
    if (batchStatus) batchStatus.textContent = `已下载脚本，共 ${jobs.items.length} 条。运行：python3 download-batch.py`;
  } catch (err) {
    if (batchStatus) batchStatus.textContent = err instanceof Error ? err.message : String(err);
  }
});

batchExport?.addEventListener('click', () => {
  try {
    const jobs = currentBatchJobs();
    showBatchMeta(jobs.urls.length, jobs.from, jobs.to, `将导出 ${jobs.items.length} 条`);
    downloadTextFile('urls.txt', `${jobs.items.join('\n')}\n`);
    if (batchStatus) {
      batchStatus.textContent = `已导出 urls.txt（${jobs.items.length} 条）。也可配合 ./download-batch.py 使用。`;
    }
  } catch (err) {
    if (batchStatus) batchStatus.textContent = err instanceof Error ? err.message : String(err);
  }
});

batchClear?.addEventListener('click', () => {
  batchForm?.reset();
  if (batchFrom) batchFrom.value = '1';
  if (batchWorkers) batchWorkers.value = '4';
  if (batchOutdir) batchOutdir.value = 'data_5S';
  if (batchMeta) batchMeta.hidden = true;
  if (batchLog) {
    batchLog.replaceChildren();
    batchLog.hidden = true;
  }
  if (batchStatus) batchStatus.textContent = '已清除';
});

/* ——— 生图立项 ——— */

const pkgGenForm = document.getElementById('pkg-gen-form');
const pkgGenRun = document.getElementById('pkg-gen-run');
const pkgGenClear = document.getElementById('pkg-gen-clear');
const pkgGenStatus = document.getElementById('pkg-gen-status');
const pkgGenList = document.getElementById('pkg-gen-list');
const pkgCheckForm = document.getElementById('pkg-check-form');
const pkgCheckName = document.getElementById('pkg-check-name');
const pkgCheckPkg = document.getElementById('pkg-check-pkg');
const pkgCheckStatus = document.getElementById('pkg-check-status');
const pkgUsedNames = new Set();

function occupancyLabel(row) {
  if (row.occupied === true) return { text: '已被占用', kind: 'taken' };
  if (row.occupied === false) return { text: '未见上架', kind: 'free' };
  return { text: '查询失败', kind: 'unknown' };
}

function fillAppCode(packageName) {
  const pkgInput = document.getElementById('package-name');
  if (pkgInput) pkgInput.value = packageName;
  if (typeSelect) typeSelect.value = IMAGE_APP_TYPE;
  switchTool('app-code');
  encodeStatus.textContent = `已填入 ${packageName} · ${IMAGE_APP_TYPE}，可直接生成编码`;
}

function appendPkgCard(row, prepend = true) {
  if (!pkgGenList) return;
  pkgGenList.hidden = false;
  const badge = occupancyLabel(row);
  const item = document.createElement('li');
  item.className = `pkg-card pkg-card--${badge.kind}`;

  const head = document.createElement('div');
  head.className = 'pkg-card__head';
  const nameEl = document.createElement('p');
  nameEl.className = 'pkg-card__name';
  nameEl.textContent = row.name;
  const pill = document.createElement('span');
  pill.className = `pkg-pill pkg-pill--${badge.kind}`;
  pill.textContent = badge.text;
  head.append(nameEl, pill);

  const pkgEl = document.createElement('p');
  pkgEl.className = 'pkg-card__pkg';
  pkgEl.textContent = row.packageName;

  const metaEl = document.createElement('p');
  metaEl.className = 'pkg-card__meta';
  metaEl.textContent = row.occupied
    ? [row.title, row.developer].filter(Boolean).join(' · ')
    : row.error || 'Play 公开详情页未找到该包名';

  const actions = document.createElement('div');
  actions.className = 'code-out__actions';

  const copyNameBtn = document.createElement('button');
  copyNameBtn.type = 'button';
  copyNameBtn.className = 'btn btn--ghost';
  copyNameBtn.textContent = '复制项目名';
  copyNameBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(row.name);
      if (pkgGenStatus) pkgGenStatus.textContent = `已复制项目名 ${row.name}`;
    } catch {
      if (pkgGenStatus) pkgGenStatus.textContent = '复制失败，请手动选择';
    }
  });

  const copyPkgBtn = document.createElement('button');
  copyPkgBtn.type = 'button';
  copyPkgBtn.className = 'btn btn--ghost';
  copyPkgBtn.textContent = '复制包名';
  copyPkgBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(row.packageName);
      if (pkgGenStatus) pkgGenStatus.textContent = `已复制包名 ${row.packageName}`;
    } catch {
      if (pkgGenStatus) pkgGenStatus.textContent = '复制失败，请手动选择';
    }
  });

  const playLink = document.createElement('a');
  playLink.className = 'btn btn--ghost';
  playLink.href = row.playUrl;
  playLink.target = '_blank';
  playLink.rel = 'noreferrer';
  playLink.textContent = '打开 Play';

  actions.append(copyNameBtn, copyPkgBtn, playLink);
  if (row.occupied === false) {
    const toCode = document.createElement('button');
    toCode.type = 'button';
    toCode.className = 'btn btn--ghost';
    toCode.textContent = '填入 App Code';
    toCode.addEventListener('click', () => fillAppCode(row.packageName));
    actions.append(toCode);
  }

  item.append(head, pkgEl, metaEl, actions);
  if (prepend) pkgGenList.prepend(item);
  else pkgGenList.append(item);
}

function syncCheckPackage() {
  const name = titleCaseName(pkgCheckName?.value || '');
  if (!name || !pkgCheckPkg) return;
  const pattern = document.getElementById('pkg-gen-pattern')?.value || 'com.android';
  try {
    pkgCheckPkg.value = packageFromName(name, pattern);
  } catch {
    /* 输入未完成时不提示 */
  }
}

pkgCheckName?.addEventListener('input', syncCheckPackage);
pkgCheckName?.addEventListener('blur', () => {
  const name = titleCaseName(pkgCheckName.value);
  if (name) pkgCheckName.value = name;
  syncCheckPackage();
});
document.getElementById('pkg-gen-pattern')?.addEventListener('change', syncCheckPackage);

pkgGenForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pkgGenRun) pkgGenRun.disabled = true;
  if (pkgGenStatus) pkgGenStatus.textContent = '正在生成并查询 Google Play…';
  try {
    const result = await generateAvailableApps({
      count: Number(document.getElementById('pkg-gen-count')?.value) || 3,
      seed: document.getElementById('pkg-gen-seed')?.value || '',
      pattern: document.getElementById('pkg-gen-pattern')?.value || 'com.android',
      usedNames: pkgUsedNames,
      onProgress({ phase, name, packageName, found, want, row }) {
        if (phase === 'checking' && pkgGenStatus) {
          pkgGenStatus.textContent = `正在查 ${name} / ${packageName} · 已找到 ${found}/${want}`;
        }
        if (phase === 'checked' && row) appendPkgCard(row);
      },
    });
    if (pkgGenStatus) {
      pkgGenStatus.textContent = result.found.length
        ? `完成：${result.found.length} 个未见上架（共查 ${result.log.length} 个候选）`
        : `未找到未见上架的包名（已查 ${result.log.length} 个）。可换关键词或包名格式再试。`;
    }
  } catch (err) {
    if (pkgGenStatus) pkgGenStatus.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    if (pkgGenRun) pkgGenRun.disabled = false;
  }
});

pkgCheckForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pkgCheckStatus) pkgCheckStatus.textContent = '正在查询…';
  try {
    const typedName = titleCaseName(pkgCheckName?.value || '');
    let packageName = (pkgCheckPkg?.value || '').trim().toLowerCase();
    const pattern = document.getElementById('pkg-gen-pattern')?.value || 'com.android';
    if (!packageName && typedName) packageName = packageFromName(typedName, pattern);
    if (typedName && pkgCheckName) pkgCheckName.value = typedName;
    if (pkgCheckPkg) pkgCheckPkg.value = packageName;
    const check = await checkPlayOccupancy(packageName);
    const row = {
      name: typedName || titleCaseName(packageName.split('.')[1] || '') || 'Custom',
      packageName,
      ...check,
    };
    appendPkgCard(row);
    const badge = occupancyLabel(row);
    if (pkgCheckStatus) {
      pkgCheckStatus.textContent = check.error
        ? `查询失败：${check.error}`
        : `${row.name} / ${packageName} → ${badge.text}`;
    }
  } catch (err) {
    if (pkgCheckStatus) pkgCheckStatus.textContent = err instanceof Error ? err.message : String(err);
  }
});

pkgGenClear?.addEventListener('click', () => {
  pkgGenForm?.reset();
  pkgCheckForm?.reset();
  pkgUsedNames.clear();
  const count = document.getElementById('pkg-gen-count');
  if (count) count.value = '3';
  if (pkgGenList) {
    pkgGenList.replaceChildren();
    pkgGenList.hidden = true;
  }
  if (pkgGenStatus) pkgGenStatus.textContent = '已清除';
  if (pkgCheckStatus) pkgCheckStatus.textContent = '';
});
