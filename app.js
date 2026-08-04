import { APP_TYPES, formatAppTypeLabel, encodeAppCode, decodeAppCode } from './codec.js';
import { webpFileToJson } from './webp-json.js';

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
    title: 'WebP → JSON',
    lede: '动图/静图 WebP → 帧与元数据 JSON · 本地计算',
    catLabel: '媒体',
  },
};

function switchTool(toolId) {
  const meta = TOOLS[toolId];
  if (!meta) return;

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
  if (toolId === 'app-code') url.searchParams.delete('tool');
  else url.searchParams.set('tool', toolId);
  window.history.replaceState({}, '', url);
}

document.querySelectorAll('.topnav__link').forEach((btn) => {
  btn.addEventListener('click', () => switchTool(btn.getAttribute('data-tool')));
});

const initialTool = new URLSearchParams(window.location.search).get('tool');
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

/* ——— WebP → JSON ——— */

const webpForm = document.getElementById('webp-json-form');
const webpFile = document.getElementById('webp-file');
const webpMaxFrames = document.getElementById('webp-max-frames');
const webpPretty = document.getElementById('webp-pretty');
const webpPreview = document.getElementById('webp-preview');
const webpPreviewImg = document.getElementById('webp-preview-img');
const webpMeta = document.getElementById('webp-meta');
const webpJsonOut = document.getElementById('webp-json-out');
const webpJsonText = document.getElementById('webp-json-text');
const webpJsonStatus = document.getElementById('webp-json-status');
const webpConvertBtn = document.getElementById('webp-convert-btn');

let webpPreviewUrl = '';
let lastWebpJsonName = 'webp.json';
let lastWebpJsonText = '';

function revokeWebpPreview() {
  if (webpPreviewUrl) {
    URL.revokeObjectURL(webpPreviewUrl);
    webpPreviewUrl = '';
  }
}

webpFile.addEventListener('change', () => {
  revokeWebpPreview();
  webpJsonOut.hidden = true;
  webpJsonText.textContent = '';
  lastWebpJsonText = '';
  const file = webpFile.files?.[0];
  if (!file) {
    webpPreview.hidden = true;
    webpMeta.hidden = true;
    webpJsonStatus.textContent = '';
    return;
  }
  webpPreviewUrl = URL.createObjectURL(file);
  webpPreviewImg.src = webpPreviewUrl;
  webpPreview.hidden = false;
  webpMeta.hidden = true;
  webpJsonStatus.textContent = `已选择 ${file.name}（${file.size.toLocaleString()} 字节）`;
});

webpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  webpJsonStatus.textContent = '';
  const file = webpFile.files?.[0];
  if (!file) {
    webpJsonStatus.textContent = '请先选择 WebP 文件';
    return;
  }

  const maxFrames = Number(webpMaxFrames.value) || 120;
  webpConvertBtn.disabled = true;
  webpJsonStatus.textContent = '转换中…';

  try {
    const { doc, text } = await webpFileToJson(file, {
      maxFrames,
      pretty: webpPretty.checked,
    });
    lastWebpJsonText = text;
    lastWebpJsonName = `${(file.name || 'image').replace(/\.webp$/i, '') || 'webp'}.json`;
    webpJsonText.textContent = text;
    webpJsonOut.hidden = false;

    const img = doc.image || {};
    document.getElementById('webp-meta-size').textContent =
      img.width && img.height ? `${img.width} × ${img.height}` : '—';
    document.getElementById('webp-meta-anim').textContent = img.animated ? '是' : '否';
    document.getElementById('webp-meta-frames').textContent =
      doc.frames?.length != null
        ? `${doc.frames.length}${img.frameCount && img.frameCount !== doc.frames.length ? ` / ${img.frameCount}` : ''}`
        : String(img.frameCount ?? '—');
    document.getElementById('webp-meta-loop').textContent =
      img.loopCount == null ? '—' : img.loopCount === 0 ? '无限' : String(img.loopCount);
    webpMeta.hidden = false;

    const frameBytes = (doc.frames || []).reduce((n, f) => n + (f.data?.length || 0), 0);
    webpJsonStatus.textContent = doc.note
      ? `完成 · ${doc.note}`
      : `完成 · ${doc.frames?.length || 0} 帧 · JSON 约 ${(text.length / 1024).toFixed(1)} KB（base64 约 ${(frameBytes / 1024).toFixed(1)} KB）`;
  } catch (err) {
    webpJsonOut.hidden = true;
    webpJsonStatus.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    webpConvertBtn.disabled = false;
  }
});

document.getElementById('webp-json-copy').addEventListener('click', async () => {
  if (!lastWebpJsonText) return;
  try {
    await navigator.clipboard.writeText(lastWebpJsonText);
    webpJsonStatus.textContent = '已复制 JSON';
  } catch {
    webpJsonStatus.textContent = '复制失败，请手动选择';
  }
});

document.getElementById('webp-json-download').addEventListener('click', () => {
  if (!lastWebpJsonText) return;
  const blob = new Blob([lastWebpJsonText], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = lastWebpJsonName;
  a.click();
  URL.revokeObjectURL(url);
  webpJsonStatus.textContent = `已下载 ${lastWebpJsonName}`;
});

document.getElementById('webp-clear').addEventListener('click', () => {
  webpForm.reset();
  webpPretty.checked = true;
  webpMaxFrames.value = '120';
  revokeWebpPreview();
  webpPreviewImg.removeAttribute('src');
  webpPreview.hidden = true;
  webpMeta.hidden = true;
  webpJsonOut.hidden = true;
  webpJsonText.textContent = '';
  lastWebpJsonText = '';
  webpJsonStatus.textContent = '已清除';
});
