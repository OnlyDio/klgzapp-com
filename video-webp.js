/**
 * 批量：视频 → 动画 WebP（浏览器本地）
 * 抽帧 → canvas 编码静态 WebP → 组装 VP8X + ANIM + ANMF
 * 默认「保质压缩」：高质量缩放 + 去近似重复帧 + 体积超标时下调质量（不低于下限）
 */

function readFourCC(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function writeFourCC(view, offset, fourCC) {
  view.setUint8(offset, fourCC.charCodeAt(0));
  view.setUint8(offset + 1, fourCC.charCodeAt(1));
  view.setUint8(offset + 2, fourCC.charCodeAt(2));
  view.setUint8(offset + 3, fourCC.charCodeAt(3));
}

function writeUint24LE(view, offset, value) {
  const v = Math.max(0, Math.min(0xffffff, value >>> 0));
  view.setUint8(offset, v & 0xff);
  view.setUint8(offset + 1, (v >>> 8) & 0xff);
  view.setUint8(offset + 2, (v >>> 16) & 0xff);
}

/** @typedef {'balanced' | 'smaller' | 'quality'} CompressPreset */

/** @type {Record<CompressPreset, object>} */
export const COMPRESS_PRESETS = {
  balanced: {
    label: '保质压缩（推荐）',
    fps: 8,
    quality: 0.72,
    qualityFloor: 0.58,
    maxWidth: 640,
    maxFrames: 72,
    maxDurationSec: 12,
    skipSimilar: true,
    similarThreshold: 5,
    // 目标：约每帧每像素字节预算（动画 WebP 有损）
    bytesPerPixel: 0.14,
  },
  smaller: {
    label: '更小体积',
    fps: 6,
    quality: 0.62,
    qualityFloor: 0.48,
    maxWidth: 480,
    maxFrames: 48,
    maxDurationSec: 10,
    skipSimilar: true,
    similarThreshold: 7,
    bytesPerPixel: 0.1,
  },
  quality: {
    label: '更高画质',
    fps: 12,
    quality: 0.85,
    qualityFloor: 0.7,
    maxWidth: 720,
    maxFrames: 90,
    maxDurationSec: 15,
    skipSimilar: true,
    similarThreshold: 3,
    bytesPerPixel: 0.22,
  },
};

/**
 * @param {ArrayBuffer} buffer
 */
export function extractWebpBitstream(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12) throw new Error('WebP 帧过小');
  if (readFourCC(view, 0) !== 'RIFF' || readFourCC(view, 8) !== 'WEBP') {
    throw new Error('不是有效 WebP 帧');
  }

  /** @type {Uint8Array[]} */
  const parts = [];
  let hasAlpha = false;
  let offset = 12;

  while (offset + 8 <= buffer.byteLength) {
    const fourCC = readFourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const padded = size + (size & 1);
    const next = dataOffset + padded;
    if (next > buffer.byteLength) break;

    if (fourCC === 'ALPH' || fourCC === 'VP8 ' || fourCC === 'VP8L') {
      if (fourCC === 'ALPH' || fourCC === 'VP8L') hasAlpha = true;
      parts.push(new Uint8Array(buffer, offset, 8 + padded));
    }
    offset = next;
  }

  if (!parts.length) throw new Error('帧中未找到 VP8/VP8L 数据');

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return { bitstream: out, hasAlpha };
}

/**
 * @param {Array<{ bitstream: Uint8Array, durationMs: number, width: number, height: number, hasAlpha?: boolean }>} frames
 * @param {{ width: number, height: number, loopCount?: number }} canvas
 */
export function assembleAnimatedWebp(frames, canvas) {
  if (!frames.length) throw new Error('没有可编码的帧');
  const width = Math.max(1, Math.round(canvas.width));
  const height = Math.max(1, Math.round(canvas.height));
  const loopCount = Number.isFinite(canvas.loopCount) ? Math.max(0, canvas.loopCount) : 0;
  const anyAlpha = frames.some((f) => f.hasAlpha);

  const vp8x = new Uint8Array(18);
  {
    const view = new DataView(vp8x.buffer);
    writeFourCC(view, 0, 'VP8X');
    view.setUint32(4, 10, true);
    let flags = 0x02;
    if (anyAlpha) flags |= 0x10;
    view.setUint8(8, flags);
    writeUint24LE(view, 12, width - 1);
    writeUint24LE(view, 15, height - 1);
  }

  const anim = new Uint8Array(14);
  {
    const view = new DataView(anim.buffer);
    writeFourCC(view, 0, 'ANIM');
    view.setUint32(4, 6, true);
    view.setUint32(8, 0x00000000, true);
    view.setUint16(12, loopCount, true);
  }

  /** @type {Uint8Array[]} */
  const anmfChunks = [];
  for (const frame of frames) {
    const fw = Math.max(1, Math.round(frame.width));
    const fh = Math.max(1, Math.round(frame.height));
    const duration = Math.max(1, Math.min(0xffffff, Math.round(frame.durationMs || 100)));
    const bitstream = frame.bitstream;
    const payloadSize = 16 + bitstream.length;
    const padded = payloadSize + (payloadSize & 1);
    const chunk = new Uint8Array(8 + padded);
    const view = new DataView(chunk.buffer);
    writeFourCC(view, 0, 'ANMF');
    view.setUint32(4, payloadSize, true);
    writeUint24LE(view, 8, 0);
    writeUint24LE(view, 11, 0);
    writeUint24LE(view, 14, fw - 1);
    writeUint24LE(view, 17, fh - 1);
    writeUint24LE(view, 20, duration);
    view.setUint8(23, 0);
    chunk.set(bitstream, 24);
    anmfChunks.push(chunk);
  }

  let bodyLen = vp8x.length + anim.length;
  for (const c of anmfChunks) bodyLen += c.length;

  const file = new Uint8Array(12 + bodyLen);
  const view = new DataView(file.buffer);
  writeFourCC(view, 0, 'RIFF');
  view.setUint32(4, 4 + bodyLen, true);
  writeFourCC(view, 8, 'WEBP');
  let cursor = 12;
  file.set(vp8x, cursor);
  cursor += vp8x.length;
  file.set(anim, cursor);
  cursor += anim.length;
  for (const c of anmfChunks) {
    file.set(c, cursor);
    cursor += c.length;
  }
  return file;
}

function waitEvent(target, event, errorEvent = 'error') {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`视频 ${event} 失败`));
    };
    const cleanup = () => {
      target.removeEventListener(event, onOk);
      if (errorEvent) target.removeEventListener(errorEvent, onErr);
    };
    target.addEventListener(event, onOk, { once: true });
    if (errorEvent) target.addEventListener(errorEvent, onErr, { once: true });
  });
}

async function seekVideo(video, time) {
  const t = Math.max(0, Math.min(time, Math.max(0, (video.duration || 0) - 0.001)));
  if (Math.abs(video.currentTime - t) < 0.0005) return;
  const done = waitEvent(video, 'seeked');
  video.currentTime = t;
  await done;
}

function canvasToWebpBuffer(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('浏览器无法编码 WebP（请用 Chrome / Edge）'));
          return;
        }
        resolve(await blob.arrayBuffer());
      },
      'image/webp',
      quality,
    );
  });
}

function outNameFromVideo(name) {
  const base = String(name || 'video').replace(/\.[^.]+$/i, '') || 'video';
  return `${base}.webp`;
}

/** 偶数边长，利于 VP8 */
function evenSize(n) {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v - 1;
}

/**
 * 缩略指纹，用于跳过近似重复帧（省体积、几乎不损观感）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 */
function frameFingerprint(ctx, width, height) {
  const sw = 16;
  const sh = 16;
  const tmp = document.createElement('canvas');
  tmp.width = sw;
  tmp.height = sh;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  if (!tctx) return null;
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = 'low';
  tctx.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, sw, sh);
  const { data } = tctx.getImageData(0, 0, sw, sh);
  const fp = new Uint8Array(sw * sh);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    fp[j] = (data[i] * 3 + data[i + 1] * 4 + data[i + 2] * 1) >> 3;
  }
  return fp;
}

function fingerprintsSimilar(a, b, threshold) {
  if (!a || !b || a.length !== b.length) return false;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length <= threshold;
}

function resolvePreset(opts = {}) {
  const key = opts.preset && COMPRESS_PRESETS[opts.preset] ? opts.preset : 'balanced';
  const base = COMPRESS_PRESETS[key];
  return {
    preset: key,
    fps: Math.max(1, Math.min(30, Number(opts.fps) || base.fps)),
    quality: Math.max(0.1, Math.min(1, Number(opts.quality) ?? base.quality)),
    qualityFloor: Math.max(0.1, Math.min(1, Number(opts.qualityFloor) ?? base.qualityFloor)),
    maxWidth: Math.max(64, Math.min(1920, Number(opts.maxWidth) || base.maxWidth)),
    maxFrames: Math.max(1, Math.min(300, Number(opts.maxFrames) || base.maxFrames)),
    maxDurationSec: Math.max(0.5, Math.min(120, Number(opts.maxDurationSec) || base.maxDurationSec)),
    loopCount: Number.isFinite(opts.loopCount) ? opts.loopCount : 0,
    skipSimilar: opts.skipSimilar !== false && base.skipSimilar !== false,
    similarThreshold: Number(opts.similarThreshold) || base.similarThreshold,
    bytesPerPixel: Number(opts.bytesPerPixel) || base.bytesPerPixel,
    onProgress: opts.onProgress,
  };
}

/**
 * @param {File} file
 * @param {{
 *   preset?: CompressPreset,
 *   fps?: number,
 *   quality?: number,
 *   qualityFloor?: number,
 *   maxWidth?: number,
 *   maxFrames?: number,
 *   maxDurationSec?: number,
 *   loopCount?: number,
 *   skipSimilar?: boolean,
 *   similarThreshold?: number,
 *   bytesPerPixel?: number,
 *   onProgress?: (info: { phase: string, current: number, total: number, message?: string }) => void,
 * }} [opts]
 */
export async function videoFileToAnimatedWebp(file, opts = {}) {
  if (!file) throw new Error('请选择视频文件');
  const type = file.type || '';
  const name = file.name || 'video.mp4';
  if (type && !type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|mkv)$/i.test(name)) {
    throw new Error(`不支持的文件：${name}`);
  }

  const cfg = resolvePreset(opts);
  const {
    fps,
    maxWidth,
    maxFrames,
    maxDurationSec,
    loopCount,
    skipSimilar,
    similarThreshold,
    bytesPerPixel,
    onProgress,
  } = cfg;
  let quality = cfg.quality;
  const qualityFloor = Math.min(quality, cfg.qualityFloor);

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    onProgress?.({ phase: 'load', current: 0, total: 1, message: `加载 ${name}` });
    await waitEvent(video, 'loadedmetadata');
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('无法读取视频时长（部分编码需转码后再试）');
    }

    const duration = Math.min(video.duration, maxDurationSec);
    const interval = 1 / fps;
    /** @type {number[]} */
    const times = [];
    for (let t = 0; t < duration && times.length < maxFrames; t += interval) {
      times.push(t);
    }
    if (!times.length) times.push(0);
    const last = Math.max(0, duration - 0.001);
    if (times.length < maxFrames && last - times[times.length - 1] > interval * 0.35) {
      times.push(last);
    }

    const srcW = video.videoWidth || 0;
    const srcH = video.videoHeight || 0;
    if (!srcW || !srcH) throw new Error('无法读取视频尺寸');

    const scale = Math.min(1, maxWidth / srcW);
    const width = evenSize(srcW * scale);
    const height = evenSize(srcH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 不可用');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const stepMs = Math.max(1, Math.round(1000 / fps));
    const targetFrameBytes = Math.max(2_000, Math.round(width * height * bytesPerPixel));

    /**
     * @param {number} q
     * @param {(info: any) => void} [progress]
     */
    async function encodePass(q, progress) {
      /** @type {Array<{ bitstream: Uint8Array, durationMs: number, width: number, height: number, hasAlpha: boolean }>} */
      const frames = [];
      /** @type {Uint8Array | null} */
      let prevFp = null;
      let skipped = 0;

      for (let i = 0; i < times.length; i += 1) {
        progress?.({
          phase: 'frame',
          current: i + 1,
          total: times.length,
          message: `${name} · 抽帧 ${i + 1}/${times.length} · q=${q.toFixed(2)}`,
        });
        await seekVideo(video, times[i]);
        ctx.drawImage(video, 0, 0, width, height);

        const fp = skipSimilar ? frameFingerprint(ctx, width, height) : null;
        if (skipSimilar && frames.length && fingerprintsSimilar(prevFp, fp, similarThreshold)) {
          frames[frames.length - 1].durationMs = Math.min(
            0xffffff,
            frames[frames.length - 1].durationMs + stepMs,
          );
          skipped += 1;
          continue;
        }

        const buffer = await canvasToWebpBuffer(canvas, q);
        const { bitstream, hasAlpha } = extractWebpBitstream(buffer);
        frames.push({ bitstream, durationMs: stepMs, width, height, hasAlpha });
        prevFp = fp;
      }

      if (!frames.length) throw new Error('没有可编码的帧');
      const bytes = assembleAnimatedWebp(frames, { width, height, loopCount });
      return { frames, bytes, skipped };
    }

    onProgress?.({ phase: 'encode', current: 0, total: 1, message: `${name} · 保质压缩编码` });
    let pass = await encodePass(quality, onProgress);
    let usedQuality = quality;
    let recompressed = false;

    const avgFrameBytes =
      pass.frames.reduce((s, f) => s + f.bitstream.length, 0) / Math.max(1, pass.frames.length);

    // 体积超标：在质量下限之上再压一档（只重编一次，避免过慢）
    if (avgFrameBytes > targetFrameBytes * 1.25 && quality > qualityFloor + 0.02) {
      const nextQ = Math.max(qualityFloor, Math.round((quality * 0.82) * 100) / 100);
      if (nextQ < quality - 0.01) {
        onProgress?.({
          phase: 'recompress',
          current: 1,
          total: 1,
          message: `${name} · 体积偏大，保质复压 q=${nextQ.toFixed(2)}`,
        });
        pass = await encodePass(nextQ, onProgress);
        usedQuality = nextQ;
        recompressed = true;
      }
    }

    const blob = new Blob([pass.bytes], { type: 'image/webp' });
    const truncated = duration < video.duration || times.length >= maxFrames;
    const totalDurationMs = pass.frames.reduce((s, f) => s + f.durationMs, 0);

    return {
      blob,
      bytes: pass.bytes,
      fileName: outNameFromVideo(name),
      meta: {
        sourceName: name,
        sourceSize: file.size,
        width,
        height,
        fps,
        quality: usedQuality,
        qualityFloor,
        preset: cfg.preset,
        frameCount: pass.frames.length,
        sampledFrames: times.length,
        skippedSimilar: pass.skipped,
        recompressed,
        durationSec: totalDurationMs / 1000,
        sourceDurationSec: video.duration,
        truncated,
        loopCount,
        bytes: pass.bytes.length,
        compressionRatio: file.size > 0 ? pass.bytes.length / file.size : null,
      },
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {File[]} files
 * @param {Parameters<typeof videoFileToAnimatedWebp>[1]} opts
 * @param {{
 *   onFileStart?: (info: { index: number, total: number, file: File }) => void,
 *   onFileDone?: (info: { index: number, total: number, file: File, result?: any, error?: string }) => void,
 * }} [hooks]
 */
export async function convertVideosBatch(files, opts = {}, hooks = {}) {
  const list = Array.from(files || []).filter(Boolean);
  const results = [];
  for (let i = 0; i < list.length; i += 1) {
    const file = list[i];
    hooks.onFileStart?.({ index: i + 1, total: list.length, file });
    try {
      const result = await videoFileToAnimatedWebp(file, {
        ...opts,
        onProgress: (info) => {
          opts.onProgress?.({
            ...info,
            message: info.message || `${file.name} (${i + 1}/${list.length})`,
          });
        },
      });
      results.push({ ok: true, file, result });
      await hooks.onFileDone?.({ index: i + 1, total: list.length, file, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ ok: false, file, error });
      await hooks.onFileDone?.({ index: i + 1, total: list.length, file, error });
    }
  }
  return results;
}

export async function writeBlobToDirectory(dirHandle, name, blob) {
  const handle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download.webp';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延后释放，避免部分浏览器把 blob: 当成导航目标
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function supportsVideoToWebp() {
  try {
    const c = document.createElement('canvas');
    return typeof c.toBlob === 'function' && c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}
