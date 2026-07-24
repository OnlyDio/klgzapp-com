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
 * 业务类型 = Google Play 应用/游戏类别（Play Console）。
 * key = Google 类别 ID（英文，应用时用）；en/zh 仅展示。
 * 参考：https://support.google.com/googleplay/android-developer/answer/9859673
 */
export const APP_TYPES = [
  // Apps
  { id: 0, key: 'ART_AND_DESIGN', en: 'Art & Design', zh: '艺术与设计', group: 'Apps' },
  { id: 1, key: 'AUTO_AND_VEHICLES', en: 'Auto & Vehicles', zh: '汽车与交通工具', group: 'Apps' },
  { id: 2, key: 'BEAUTY', en: 'Beauty', zh: '美容时尚', group: 'Apps' },
  { id: 3, key: 'BOOKS_AND_REFERENCE', en: 'Books & Reference', zh: '图书与工具书', group: 'Apps' },
  { id: 4, key: 'BUSINESS', en: 'Business', zh: '商务', group: 'Apps' },
  { id: 5, key: 'COMICS', en: 'Comics', zh: '动漫', group: 'Apps' },
  { id: 6, key: 'COMMUNICATION', en: 'Communication', zh: '通讯', group: 'Apps' },
  { id: 7, key: 'DATING', en: 'Dating', zh: '交友', group: 'Apps' },
  { id: 8, key: 'EDUCATION', en: 'Education', zh: '教育', group: 'Apps' },
  { id: 9, key: 'ENTERTAINMENT', en: 'Entertainment', zh: '娱乐', group: 'Apps' },
  { id: 10, key: 'EVENTS', en: 'Events', zh: '活动', group: 'Apps' },
  { id: 11, key: 'FINANCE', en: 'Finance', zh: '财经', group: 'Apps' },
  { id: 12, key: 'FOOD_AND_DRINK', en: 'Food & Drink', zh: '食品与饮料', group: 'Apps' },
  { id: 13, key: 'HEALTH_AND_FITNESS', en: 'Health & Fitness', zh: '健康与健身', group: 'Apps' },
  { id: 14, key: 'HOUSE_AND_HOME', en: 'House & Home', zh: '家居', group: 'Apps' },
  { id: 15, key: 'LIBRARIES_AND_DEMO', en: 'Libraries & Demo', zh: '软件库与演示', group: 'Apps' },
  { id: 16, key: 'LIFESTYLE', en: 'Lifestyle', zh: '生活时尚', group: 'Apps' },
  { id: 17, key: 'MAPS_AND_NAVIGATION', en: 'Maps & Navigation', zh: '地图和导航', group: 'Apps' },
  { id: 18, key: 'MEDICAL', en: 'Medical', zh: '医疗', group: 'Apps' },
  { id: 19, key: 'MUSIC_AND_AUDIO', en: 'Music & Audio', zh: '音乐和音频', group: 'Apps' },
  { id: 20, key: 'NEWS_AND_MAGAZINES', en: 'News & Magazines', zh: '新闻与杂志', group: 'Apps' },
  { id: 21, key: 'PARENTING', en: 'Parenting', zh: '育儿', group: 'Apps' },
  { id: 22, key: 'PERSONALIZATION', en: 'Personalization', zh: '个性化', group: 'Apps' },
  { id: 23, key: 'PHOTOGRAPHY', en: 'Photography', zh: '摄影', group: 'Apps' },
  { id: 24, key: 'PRODUCTIVITY', en: 'Productivity', zh: '工作效率', group: 'Apps' },
  { id: 25, key: 'SHOPPING', en: 'Shopping', zh: '购物', group: 'Apps' },
  { id: 26, key: 'SOCIAL', en: 'Social', zh: '社交', group: 'Apps' },
  { id: 27, key: 'SPORTS', en: 'Sports', zh: '体育', group: 'Apps' },
  { id: 28, key: 'TOOLS', en: 'Tools', zh: '工具', group: 'Apps' },
  { id: 29, key: 'TRAVEL_AND_LOCAL', en: 'Travel & Local', zh: '旅游与本地出行', group: 'Apps' },
  { id: 30, key: 'VIDEO_PLAYERS', en: 'Video Players & Editors', zh: '视频播放器与编辑器', group: 'Apps' },
  { id: 31, key: 'WEATHER', en: 'Weather', zh: '天气', group: 'Apps' },
  // Games
  { id: 32, key: 'GAME_ACTION', en: 'Action', zh: '动作', group: 'Games' },
  { id: 33, key: 'GAME_ADVENTURE', en: 'Adventure', zh: '冒险', group: 'Games' },
  { id: 34, key: 'GAME_ARCADE', en: 'Arcade', zh: '街机', group: 'Games' },
  { id: 35, key: 'GAME_BOARD', en: 'Board', zh: '桌面和棋类', group: 'Games' },
  { id: 36, key: 'GAME_CARD', en: 'Card', zh: '卡牌', group: 'Games' },
  { id: 37, key: 'GAME_CASINO', en: 'Casino', zh: '赌场', group: 'Games' },
  { id: 38, key: 'GAME_CASUAL', en: 'Casual', zh: '休闲', group: 'Games' },
  { id: 39, key: 'GAME_EDUCATIONAL', en: 'Educational', zh: '教育', group: 'Games' },
  { id: 40, key: 'GAME_MUSIC', en: 'Music', zh: '音乐', group: 'Games' },
  { id: 41, key: 'GAME_PUZZLE', en: 'Puzzle', zh: '益智', group: 'Games' },
  { id: 42, key: 'GAME_RACING', en: 'Racing', zh: '竞速', group: 'Games' },
  { id: 43, key: 'GAME_ROLE_PLAYING', en: 'Role Playing', zh: '角色扮演', group: 'Games' },
  { id: 44, key: 'GAME_SIMULATION', en: 'Simulation', zh: '模拟', group: 'Games' },
  { id: 45, key: 'GAME_SPORTS', en: 'Sports', zh: '体育', group: 'Games' },
  { id: 46, key: 'GAME_STRATEGY', en: 'Strategy', zh: '策略', group: 'Games' },
  { id: 47, key: 'GAME_TRIVIA', en: 'Trivia', zh: '知识问答', group: 'Games' },
  { id: 48, key: 'GAME_WORD', en: 'Word', zh: '文字', group: 'Games' },
];

/** 下拉/还原展示：English（中文备注） */
export function formatAppTypeLabel(type) {
  return `${type.en}（${type.zh}）`;
}

/** v2：业务类型改为 Google Play 全部分类 */
const VERSION = 2;
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
