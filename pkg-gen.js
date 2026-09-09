/**
 * 生图业务立项：项目名（首字母大写）+ Android 包名 + Google Play 占用检查。
 * 占用判定：Play 详情页 404 / Not Found → 未上架；能读到应用标题 → 已被占用。
 * 说明：未上架但已在 Play Console 预留的包名无法从公开页确认。
 */

export const IMAGE_APP_TYPE = 'ART_AND_DESIGN';
export const IMAGE_APP_TYPE_LABEL = 'Art & Design（艺术与设计）';

const RESERVED_SLUGS = new Set([
  'lovita', 'amspire', 'pixia', 'blushy', 'novagirl', 'novi', 'crushon', 'miva',
  'viswap', 'instagram', 'google', 'android', 'adobe', 'canva', 'midjourney',
  'openai', 'lensa', 'prisma', 'picsart', 'vsco', 'lightroom', 'photoleap',
  'wonder', 'starryai', 'leonardo', 'runway', 'kling', 'chatgpt', 'gemini',
  'apple', 'samsung', 'facebook', 'whatsapp', 'tiktok', 'youtube',
]);

const STEMS = [
  'pix', 'vis', 'lum', 'art', 'glow', 'muse', 'aura', 'bloom', 'spark', 'dream',
  'chrom', 'prism', 'vivid', 'sketch', 'canvas', 'render', 'imagine', 'aether',
  'halo', 'ink', 'hue', 'tint', 'flare', 'ember', 'opal', 'velvet', 'silk',
  'pearl', 'nimbus', 'solis', 'luna', 'astro', 'orbit', 'quark', 'neon', 'ion',
  'flux', 'iris', 'lyra', 'nova', 'mira', 'cleo', 'sage', 'rune', 'vale',
  'dawn', 'dusk', 'mist', 'coral', 'amber', 'jade', 'onyx', 'azure', 'lilac',
];

const TAILS = [
  'a', 'ia', 'ora', 'iva', 'on', 'el', 'ix', 'ly', 'sy', 'en', 'is', 'um',
  'or', 'ico', 'ara', 'elle', 'ette', 'yne', 'ora', 'een', 'ify', 'ory',
];

const PACKAGE_PATTERNS = {
  'com.android': (slug) => `com.${slug}.android`,
  'com.app': (slug) => `com.${slug}.app`,
  'ai.app': (slug) => `ai.${slug}.app`,
};

export function titleCaseName(raw) {
  const letters = String(raw || '').replace(/[^A-Za-z]/g, '');
  if (!letters) return '';
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

export function slugFromName(name) {
  return titleCaseName(name).toLowerCase();
}

export function isValidAndroidPackage(pkg) {
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,}$/.test(String(pkg || ''));
}

export function packageFromName(name, pattern = 'com.android') {
  const slug = slugFromName(name);
  if (slug.length < 3) throw new Error('项目名至少 3 个英文字母');
  const build = PACKAGE_PATTERNS[pattern] || PACKAGE_PATTERNS['com.android'];
  const pkg = build(slug);
  if (!isValidAndroidPackage(pkg)) throw new Error('包名不合法');
  return pkg;
}

function randInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function pick(list) {
  return list[randInt(list.length)];
}

function looksPronounceable(slug) {
  if (slug.length < 5 || slug.length > 10) return false;
  if (!/^[a-z]+$/.test(slug)) return false;
  if (/(.)\1\1/.test(slug)) return false;
  const vowels = (slug.match(/[aeiou]/g) || []).length;
  return vowels >= 2 && vowels <= slug.length - 2;
}

export function generateProjectName(seed = '', used = new Set()) {
  const seedSlug = slugFromName(seed);
  for (let i = 0; i < 80; i += 1) {
    let slug;
    if (seedSlug && i % 2 === 0) {
      slug = `${seedSlug}${pick(TAILS)}`;
      if (slug.length < 5) slug = `${seedSlug}${pick(STEMS).slice(0, 3)}`;
    } else {
      slug = `${pick(STEMS)}${pick(TAILS)}`;
    }
    slug = slug.replace(/[^a-z]/g, '').slice(0, 10);
    if (/(.)\1/.test(slug)) continue;
    if (!looksPronounceable(slug)) continue;
    if (RESERVED_SLUGS.has(slug) || used.has(slug)) continue;
    used.add(slug);
    return titleCaseName(slug);
  }
  throw new Error('暂时生成不出可用项目名，请换一个关键词再试');
}

function playDetailsUrl(packageName) {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}&hl=en&gl=US`;
}

function parsePlayBody(text) {
  const body = String(text || '');
  const notFound =
    /not found/i.test(body) &&
    (/requested url was not found/i.test(body) || /we're sorry/i.test(body) || /<title>\s*not found/i.test(body));
  if (notFound) return { occupied: false, title: '', developer: '' };

  const title =
    body.match(/Title:\s*(.+?)\s+-\s*Apps on Google Play/i)?.[1]?.trim() ||
    body.match(/<title>([^<]+?)\s+-\s*Apps on Google Play/i)?.[1]?.trim() ||
    body.match(/"name"\s*:\s*"([^"]{2,80})"/)?.[1] ||
    '';
  const developer =
    body.match(/Offered by[:\s]+(.+)/i)?.[1]?.trim().split('\n')[0] ||
    body.match(/"author"\s*:\s*"([^"]{2,80})"/)?.[1] ||
    '';

  if (title) return { occupied: true, title, developer };
  if (/apps on google play/i.test(body) && !/not found/i.test(body)) {
    return { occupied: true, title: title || packageHint(body), developer };
  }
  return null;
}

function packageHint(body) {
  return body.match(/id=([a-z][a-z0-9_.]+)/)?.[1] || '';
}

async function fetchText(url, timeoutMs = 18000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkPlayOccupancy(packageName) {
  if (!isValidAndroidPackage(packageName)) {
    throw new Error('包名格式无效（需小写，至少两段，如 com.pixora.android）');
  }
  const playUrl = playDetailsUrl(packageName);
  const sources = [
    `https://r.jina.ai/${playUrl}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(playUrl)}`,
  ];

  let lastError = '';
  for (const url of sources) {
    try {
      const { status, text } = await fetchText(url);
      if (status === 404) {
        return { occupied: false, title: '', developer: '', playUrl, source: url };
      }
      const parsed = parsePlayBody(text);
      if (parsed) return { ...parsed, playUrl, source: url };
      lastError = `代理返回无法识别的内容（HTTP ${status}）`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    occupied: null,
    title: '',
    developer: '',
    playUrl,
    error: lastError || '无法自动查询 Google Play',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateAvailableApps({
  count = 3,
  seed = '',
  pattern = 'com.android',
  usedNames = new Set(),
  onProgress,
} = {}) {
  const want = Math.min(12, Math.max(1, Number(count) || 1));
  const found = [];
  const log = [];
  const maxAttempts = want * 10;

  for (let i = 0; i < maxAttempts && found.length < want; i += 1) {
    const name = generateProjectName(seed, usedNames);
    const packageName = packageFromName(name, pattern);
    onProgress?.({ phase: 'checking', name, packageName, index: i + 1, found: found.length, want });
    const check = await checkPlayOccupancy(packageName);
    const row = { name, packageName, ...check };
    log.push(row);
    if (check.occupied === false) found.push(row);
    onProgress?.({ phase: 'checked', row, found: found.length, want });
    if (i < maxAttempts - 1 && found.length < want) await sleep(280);
  }

  return { found, log, want };
}
