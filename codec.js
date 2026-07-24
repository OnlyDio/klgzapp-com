/**
 * klgzapp App Code v1
 * 32-char URL-safe Base64 ←→ { packageName, appType(业务类型), launchAt }
 *
 * Binary layout (24 bytes → Base64URL → exactly 32 chars):
 *   [0]     version/flags   bit7=compressed, low7=version (1)
 *   [1]     appType
 *   [2..3]  days since 2000-01-01 UTC (uint16 BE)
 *   [4..23] package slot (20 bytes)
 *           uncompressed: [prefixId:1][utf8...][NUL...]
 *           compressed:   [len:1][deflate-raw bytes...][pad...]
 *
 * XOR with site key (reversible obfuscation, not secret encryption).
 */

/**
 * 业务类型：应用取值用英文 key；UI 展示英文 + 中文备注。
 * key = 编码/还原时的业务标识（英文）
 */
export const APP_TYPES = [
  { id: 0, key: 'social', en: 'Social', zh: '社交' },
  { id: 1, key: 'ai', en: 'AI', zh: 'AI 应用' },
  { id: 2, key: 'create', en: 'Create', zh: 'AI 创作' },
  { id: 3, key: 'tool', en: 'Tool', zh: '工具' },
  { id: 4, key: 'content', en: 'Content', zh: '内容' },
  { id: 5, key: 'media', en: 'Media', zh: '影音' },
  { id: 6, key: 'game', en: 'Game', zh: '游戏' },
  { id: 7, key: 'ecommerce', en: 'Ecommerce', zh: '电商' },
  { id: 8, key: 'other', en: 'Other', zh: '其他' },
];

/** 下拉/还原展示：English（中文备注） */
export function formatAppTypeLabel(type) {
  return `${type.en}（${type.zh}）`;
}

const VERSION = 1;
const PKG_SLOT = 20;
const PAYLOAD_LEN = 24;
const CODE_LEN = 32;
const DAY0 = Date.UTC(2000, 0, 1);
const MS_PER_DAY = 86_400_000;
const XOR_KEY = new TextEncoder().encode('klgzapp.com/v1/app-code');

const PREFIXES = [
  { id: 1, text: 'com.' },
  { id: 2, text: 'org.' },
  { id: 3, text: 'net.' },
  { id: 4, text: 'io.' },
  { id: 5, text: 'cn.' },
  { id: 6, text: 'me.' },
  { id: 7, text: 'app.' },
  { id: 8, text: 'xyz.' },
  { id: 9, text: 'co.' },
];

function xorBytes(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[i] = bytes[i] ^ XOR_KEY[i % XOR_KEY.length];
  }
  return out;
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前环境不支持解压，无法还原该编码');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function writeUint16BE(view, offset, value) {
  view[offset] = (value >>> 8) & 0xff;
  view[offset + 1] = value & 0xff;
}

function readUint16BE(view, offset) {
  return (view[offset] << 8) | view[offset + 1];
}

function typeById(id) {
  return APP_TYPES.find((t) => t.id === id) ?? null;
}

function typeByKey(key) {
  return APP_TYPES.find((t) => t.key === key) ?? null;
}

function toUtcDayNumber(date) {
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const days = Math.floor((utcMidnight - DAY0) / MS_PER_DAY);
  if (days < 0 || days > 0xffff) {
    throw new Error('上线日期超出可编码范围（2000-01-01 起约 179 年内）');
  }
  return days;
}

function fromUtcDayNumber(days) {
  return new Date(DAY0 + days * MS_PER_DAY);
}

function packPackageUncompressed(packageName) {
  let prefixId = 0;
  let rest = packageName;
  for (const p of PREFIXES) {
    if (packageName.startsWith(p.text)) {
      prefixId = p.id;
      rest = packageName.slice(p.text.length);
      break;
    }
  }
  const restBytes = new TextEncoder().encode(rest);
  if (1 + restBytes.length > PKG_SLOT) return null;
  const slot = new Uint8Array(PKG_SLOT);
  slot[0] = prefixId;
  slot.set(restBytes, 1);
  return slot;
}

function unpackPackageUncompressed(slot) {
  const prefixId = slot[0];
  let end = slot.length;
  while (end > 1 && slot[end - 1] === 0) end -= 1;
  const rest = new TextDecoder().decode(slot.subarray(1, end));
  const prefix = PREFIXES.find((p) => p.id === prefixId);
  if (prefixId !== 0 && !prefix) throw new Error(`未知包名前缀 id=${prefixId}`);
  return (prefix?.text ?? '') + rest;
}

/**
 * @param {{ packageName: string, appType: string|number, launchAt: Date|string|number }} input
 * @returns {Promise<string>} 32-char code
 */
export async function encodeAppCode(input) {
  const packageName = String(input.packageName ?? '').trim();
  if (!packageName) throw new Error('请填写包名');
  if (packageName.length > 128) throw new Error('包名过长');

  let typeId;
  if (typeof input.appType === 'number') {
    typeId = input.appType;
  } else {
    const t = typeByKey(String(input.appType));
    if (!t) throw new Error('未知业务类型');
    typeId = t.id;
  }
  if (!typeById(typeId)) throw new Error('未知业务类型');

  const launch = input.launchAt instanceof Date
    ? input.launchAt
    : new Date(input.launchAt);
  if (Number.isNaN(launch.getTime())) throw new Error('上线时间无效');
  const days = toUtcDayNumber(launch);

  let pkgSlot = packPackageUncompressed(packageName);
  let compressed = false;

  if (!pkgSlot) {
    const zipped = await deflateRaw(new TextEncoder().encode(packageName));
    // slot: [len:1][data...] max data 19 bytes
    if (!zipped || zipped.length > PKG_SLOT - 1) {
      throw new Error(
        `包名无法装入编码（槽 ${PKG_SLOT} 字节）。请缩短包名（当前 ${packageName.length} 字符 / UTF-8 ${new TextEncoder().encode(packageName).length} 字节）`,
      );
    }
    pkgSlot = new Uint8Array(PKG_SLOT);
    pkgSlot[0] = zipped.length;
    pkgSlot.set(zipped, 1);
    compressed = true;
  }

  const payload = new Uint8Array(PAYLOAD_LEN);
  payload[0] = (compressed ? 0x80 : 0x00) | VERSION;
  payload[1] = typeId & 0xff;
  writeUint16BE(payload, 2, days);
  payload.set(pkgSlot, 4);

  const code = toBase64Url(xorBytes(payload));
  if (code.length !== CODE_LEN) {
    throw new Error(`内部错误：编码长度 ${code.length}，期望 ${CODE_LEN}`);
  }
  return code;
}

/**
 * @param {string} code
 */
export async function decodeAppCode(code) {
  const raw = String(code ?? '').trim();
  if (!/^[A-Za-z0-9_-]{32}$/.test(raw)) {
    throw new Error('编码须为 32 位字符（A–Z a–z 0–9 - _）');
  }

  const payload = xorBytes(fromBase64Url(raw));
  if (payload.length !== PAYLOAD_LEN) {
    throw new Error('编码载荷长度不正确');
  }

  const version = payload[0] & 0x7f;
  const compressed = (payload[0] & 0x80) !== 0;
  if (version !== VERSION) {
    throw new Error(`不支持的编码版本：${version}`);
  }

  const type = typeById(payload[1]);
  if (!type) throw new Error(`未知业务类型 id=${payload[1]}`);

  const days = readUint16BE(payload, 2);
  const launchAt = fromUtcDayNumber(days);
  const pkgSlot = payload.subarray(4, 4 + PKG_SLOT);

  let packageName;
  if (compressed) {
    const len = pkgSlot[0];
    if (len < 1 || len > PKG_SLOT - 1) throw new Error('压缩包名长度非法');
    const inflated = await inflateRaw(pkgSlot.subarray(1, 1 + len));
    packageName = new TextDecoder().decode(inflated);
  } else {
    packageName = unpackPackageUncompressed(pkgSlot);
  }

  if (!packageName) throw new Error('包名还原为空');

  return {
    packageName,
    /** 应用取值：英文 key */
    appType: type.key,
    appTypeEn: type.en,
    appTypeZh: type.zh,
    /** 展示：English（中文备注） */
    appTypeLabel: formatAppTypeLabel(type),
    launchAt,
    launchISO: launchAt.toISOString(),
    launchDate: launchAt.toISOString().slice(0, 10),
    version,
    compressed,
  };
}

export const CODE_LENGTH = CODE_LEN;
export const PACKAGE_SLOT_BYTES = PKG_SLOT;
