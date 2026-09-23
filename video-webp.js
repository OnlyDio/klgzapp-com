/**
 * 批量：视频 → 动画 WebP（浏览器本地）
 * 抽帧 → canvas 编码静态 WebP → 组装 VP8X + ANIM + ANMF
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

/**
 * 从 canvas.toBlob('image/webp') 得到的 RIFF 中取出可放入 ANMF 的比特流（VP8/VP8L ± ALPH）
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

/**
 * @param {File} file
 * @param {{
 *   fps?: number,
 *   quality?: number,
 *   maxWidth?: number,
 *   maxFrames?: number,
 *   maxDurationSec?: number,
 *   loopCount?: number,
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

  const fps = Math.max(1, Math.min(30, Number(opts.fps) || 10));
  const quality = Math.max(0.1, Math.min(1, Number(opts.quality) ?? 0.8));
  const maxWidth = Math.max(64, Math.min(1920, Number(opts.maxWidth) || 720));
  const maxFrames = Math.max(1, Math.min(300, Number(opts.maxFrames) || 90));
  const maxDurationSec = Math.max(0.5, Math.min(120, Number(opts.maxDurationSec) || 15));
  const loopCount = Number.isFinite(opts.loopCount) ? opts.loopCount : 0;
  const onProgress = opts.onProgress;

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
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 不可用');

    const durationMs = Math.max(1, Math.round(1000 / fps));
    /** @type {Array<{ bitstream: Uint8Array, durationMs: number, width: number, height: number, hasAlpha: boolean }>} */
    const frames = [];

    for (let i = 0; i < times.length; i += 1) {
      onProgress?.({
        phase: 'frame',
        current: i + 1,
        total: times.length,
        message: `${name} · 抽帧 ${i + 1}/${times.length}`,
      });
      await seekVideo(video, times[i]);
      ctx.drawImage(video, 0, 0, width, height);
      const buffer = await canvasToWebpBuffer(canvas, quality);
      const { bitstream, hasAlpha } = extractWebpBitstream(buffer);
      frames.push({ bitstream, durationMs, width, height, hasAlpha });
    }

    onProgress?.({ phase: 'encode', current: 1, total: 1, message: `组装 ${name}` });
    const bytes = assembleAnimatedWebp(frames, { width, height, loopCount });
    const blob = new Blob([bytes], { type: 'image/webp' });
    const truncated = duration < video.duration || frames.length >= maxFrames;

    return {
      blob,
      bytes,
      fileName: outNameFromVideo(name),
      meta: {
        sourceName: name,
        sourceSize: file.size,
        width,
        height,
        fps,
        quality,
        frameCount: frames.length,
        durationSec: (frames.length * durationMs) / 1000,
        sourceDurationSec: video.duration,
        truncated,
        loopCount,
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
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function supportsVideoToWebp() {
  try {
    const c = document.createElement('canvas');
    return typeof c.toBlob === 'function' && c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}
