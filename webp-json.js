/**
 * WebP → Lottie JSON（浏览器本地）
 * - 解析 RIFF 元数据（尺寸 / 是否动画 / 帧时长）
 * - ImageDecoder 拆帧为 PNG，组装 Bodymovin / Lottie 兼容 JSON
 */

function readFourCC(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readUint24LE(view, offset) {
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
}

/**
 * @param {ArrayBuffer} buffer
 */
export function parseWebpRiff(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12) throw new Error('文件过小，不是有效 WebP');
  if (readFourCC(view, 0) !== 'RIFF') throw new Error('不是 RIFF / WebP 文件');
  if (readFourCC(view, 8) !== 'WEBP') throw new Error('不是 WebP 容器');

  const meta = {
    animated: false,
    width: null,
    height: null,
    loopCount: null,
    frameCount: 0,
    /** @type {number[]} ANMF 时长（ms） */
    frameDurationsMs: [],
    chunks: [],
  };

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const fourCC = readFourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const next = dataOffset + size + (size & 1);

    meta.chunks.push({ fourCC, size });

    if (fourCC === 'VP8X' && size >= 10) {
      const flags = view.getUint8(dataOffset);
      meta.animated = (flags & 0x02) !== 0;
      meta.width = readUint24LE(view, dataOffset + 4) + 1;
      meta.height = readUint24LE(view, dataOffset + 7) + 1;
    } else if (fourCC === 'ANIM' && size >= 6) {
      meta.loopCount = view.getUint16(dataOffset + 4, true);
    } else if (fourCC === 'ANMF' && size >= 16) {
      meta.frameCount += 1;
      if (meta.width == null) {
        meta.width = readUint24LE(view, dataOffset + 6) + 1;
        meta.height = readUint24LE(view, dataOffset + 9) + 1;
      }
      // ANMF: x,y,w,h 各 3 字节后为 duration(ms) uint24
      meta.frameDurationsMs.push(Math.max(1, readUint24LE(view, dataOffset + 12)));
    }

    offset = next;
  }

  if (!meta.animated) meta.frameCount = Math.max(meta.frameCount, 1);
  return meta;
}

function bytesToBase64(bytes) {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function canvasToPngBase64(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png');
  });
  const buf = new Uint8Array(await blob.arrayBuffer());
  return bytesToBase64(buf);
}

function supportsImageDecoder() {
  return typeof ImageDecoder === 'function';
}

/**
 * @param {ImageBitmap} bitmap
 * @param {{ x?: number, y?: number, width?: number, height?: number }} [canvasSize]
 */
async function bitmapToPngFrame(bitmap, canvasSize) {
  const width = canvasSize?.width || bitmap.width;
  const height = canvasSize?.height || bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 Canvas');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, canvasSize?.x ?? 0, canvasSize?.y ?? 0);
  const data = await canvasToPngBase64(canvas);
  bitmap.close?.();
  return { width, height, data };
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ maxFrames?: number, frameDurationsMs?: number[] }} [opts]
 */
async function decodeFramesWithImageDecoder(buffer, opts = {}) {
  const maxFrames = opts.maxFrames ?? 120;
  const decoder = new ImageDecoder({ data: buffer, type: 'image/webp' });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  const frameCount = track?.frameCount ?? 1;
  const width = track?.displayWidth || null;
  const height = track?.displayHeight || null;
  const limit = Math.min(frameCount, maxFrames);
  const frames = [];
  const riffDurs = opts.frameDurationsMs || [];

  for (let i = 0; i < limit; i += 1) {
    const result = await decoder.decode({ frameIndex: i });
    const image = result.image;
    const bitmap = await createImageBitmap(image);
    image.close?.();
    const png = await bitmapToPngFrame(bitmap, {
      width: width || bitmap.width,
      height: height || bitmap.height,
    });
    let durationMs = null;
    if (typeof result.duration === 'number' && result.duration > 0) {
      durationMs = Math.max(1, Math.round(result.duration / 1000));
    } else if (riffDurs[i] > 0) {
      durationMs = riffDurs[i];
    }
    frames.push({ index: i, durationMs, ...png });
  }

  decoder.close?.();
  return { width, height, frameCount, truncated: frameCount > limit, frames };
}

/**
 * @param {string} objectUrl
 */
async function decodeStaticViaImage(objectUrl) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('浏览器无法解码该 WebP'));
    el.src = objectUrl;
  });
  const bitmap = await createImageBitmap(img);
  const png = await bitmapToPngFrame(bitmap);
  return {
    width: img.naturalWidth || png.width,
    height: img.naturalHeight || png.height,
    frameCount: 1,
    truncated: false,
    frames: [{ index: 0, durationMs: null, ...png }],
  };
}

/**
 * 将 PNG 帧序列组装为 Bodymovin / Lottie JSON
 * @param {{
 *   name: string,
 *   width: number,
 *   height: number,
 *   frames: Array<{ data: string, durationMs?: number|null }>,
 *   fr?: number,
 * }} input
 */
export function framesToLottie(input) {
  const fr = Math.max(1, Math.min(120, Number(input.fr) || 30));
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));
  const frames = input.frames || [];
  if (!frames.length) throw new Error('没有可导出的帧');

  const assets = [];
  const layers = [];
  let cursor = 0;
  const defaultMs = Math.max(1, Math.round(1000 / fr));

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    const id = `img_${i}`;
    assets.push({
      id,
      w: width,
      h: height,
      u: '',
      p: `data:image/png;base64,${frame.data}`,
      e: 1,
    });

    const durMs = frame.durationMs > 0 ? frame.durationMs : defaultMs;
    const len = Math.max(1, Math.round((durMs / 1000) * fr));
    const ip = cursor;
    const op = cursor + len;
    layers.push({
      ddd: 0,
      ind: i + 1,
      ty: 2,
      nm: `Frame ${i + 1}`,
      cl: '',
      refId: id,
      sr: 1,
      ks: {
        o: { a: 0, k: 100, ix: 11 },
        r: { a: 0, k: 0, ix: 10 },
        p: { a: 0, k: [width / 2, height / 2, 0], ix: 2, l: 2 },
        a: { a: 0, k: [width / 2, height / 2, 0], ix: 1, l: 2 },
        s: { a: 0, k: [100, 100, 100], ix: 6, l: 2 },
      },
      ao: 0,
      ip,
      op,
      st: ip,
      bm: 0,
    });
    cursor = op;
  }

  return {
    v: '5.7.4',
    fr,
    ip: 0,
    op: cursor,
    w: width,
    h: height,
    nm: String(input.name || 'webp').replace(/\.webp$/i, '') || 'webp',
    ddd: 0,
    assets,
    // Lottie 约定：数组靠前的图层在上层；按时序反转便于阅读
    layers: layers.reverse(),
    markers: [],
  };
}

/**
 * @param {File} file
 * @param {{ maxFrames?: number, pretty?: boolean, fr?: number }} [opts]
 */
export async function webpFileToJson(file, opts = {}) {
  if (!file) throw new Error('请选择 WebP 文件');
  const name = file.name || 'image.webp';
  const lower = name.toLowerCase();
  if (!lower.endsWith('.webp') && file.type && file.type !== 'image/webp') {
    throw new Error('请上传 .webp 文件');
  }

  const buffer = await file.arrayBuffer();
  const riff = parseWebpRiff(buffer);
  const objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'image/webp' }));

  /** @type {{ width: number|null, height: number|null, frames: any[], truncated?: boolean, note?: string }} */
  let decoded = { width: riff.width, height: riff.height, frames: [] };

  try {
    if (supportsImageDecoder()) {
      const result = await decodeFramesWithImageDecoder(buffer, {
        maxFrames: opts.maxFrames,
        frameDurationsMs: riff.frameDurationsMs,
      });
      decoded = {
        width: result.width ?? riff.width,
        height: result.height ?? riff.height,
        frames: result.frames,
        truncated: result.truncated,
        note: result.truncated ? `帧数超过上限 ${opts.maxFrames ?? 120}，已截断` : undefined,
      };
    } else if (!riff.animated) {
      const result = await decodeStaticViaImage(objectUrl);
      decoded = {
        width: result.width,
        height: result.height,
        frames: result.frames,
        note: '当前浏览器无 ImageDecoder，已按静态单帧导出',
      };
    } else {
      throw new Error('当前浏览器不支持 ImageDecoder，无法拆分动画 WebP 为 Lottie。请使用 Chrome / Edge。');
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  if (!decoded.frames.length) throw new Error('未能解码出任何帧');
  const width = decoded.width || decoded.frames[0].width;
  const height = decoded.height || decoded.frames[0].height;
  if (!width || !height) throw new Error('无法确定画布尺寸');

  const lottie = framesToLottie({
    name,
    width,
    height,
    frames: decoded.frames,
    fr: opts.fr,
  });

  const text = JSON.stringify(lottie, null, opts.pretty === false ? 0 : 2);
  return {
    doc: lottie,
    text,
    meta: {
      sourceName: name,
      sourceSize: file.size,
      animated: riff.animated,
      loopCount: riff.loopCount,
      webpFrameCount: riff.frameCount,
      exportedFrames: decoded.frames.length,
      width,
      height,
      fr: lottie.fr,
      durationFrames: lottie.op,
      durationSec: lottie.op / lottie.fr,
      note: decoded.note,
    },
  };
}
