/**
 * WebP → JSON（浏览器本地）
 * - 解析 RIFF 元数据（尺寸 / 是否动画 / 帧数 / 循环）
 * - 有 ImageDecoder 时抽出各帧为 PNG base64
 * - 否则回退为整文件 base64
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
    } else if (fourCC === 'ANMF') {
      meta.frameCount += 1;
      if (meta.width == null && size >= 12) {
        meta.width = readUint24LE(view, dataOffset + 6) + 1;
        meta.height = readUint24LE(view, dataOffset + 9) + 1;
      }
    } else if ((fourCC === 'VP8 ' || fourCC === 'VP8L') && meta.width == null) {
      // 静态图尺寸留给 ImageDecoder / Image 回填
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
  const dx = canvasSize?.x ?? 0;
  const dy = canvasSize?.y ?? 0;
  ctx.drawImage(bitmap, dx, dy);
  const data = await canvasToPngBase64(canvas);
  bitmap.close?.();
  return {
    width: bitmap.width,
    height: bitmap.height,
    mimeType: 'image/png',
    encoding: 'base64',
    data,
  };
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ maxFrames?: number }} [opts]
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

  for (let i = 0; i < limit; i += 1) {
    const result = await decoder.decode({ frameIndex: i });
    const image = result.image;
    const bitmap = await createImageBitmap(image);
    image.close?.();
    const png = await bitmapToPngFrame(bitmap, { width: width || bitmap.width, height: height || bitmap.height });
    const durationUs = typeof result.duration === 'number' ? result.duration : null;
    frames.push({
      index: i,
      durationMs: durationUs == null ? null : Math.max(1, Math.round(durationUs / 1000)),
      ...png,
    });
  }

  decoder.close?.();
  return {
    width,
    height,
    frameCount,
    truncated: frameCount > limit,
    frames,
  };
}

/**
 * 静态 WebP：用 Image 解码单帧
 * @param {ArrayBuffer} buffer
 * @param {string} objectUrl
 */
async function decodeStaticViaImage(buffer, objectUrl) {
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
 * @param {File} file
 * @param {{ maxFrames?: number, pretty?: boolean }} [opts]
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
  const bytes = new Uint8Array(buffer);
  const objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'image/webp' }));

  /** @type {any} */
  const doc = {
    version: 1,
    tool: 'klgzapp-webp-json',
    source: {
      name,
      size: file.size,
      mimeType: file.type || 'image/webp',
    },
    image: {
      width: riff.width,
      height: riff.height,
      animated: riff.animated,
      loopCount: riff.loopCount,
      frameCount: riff.frameCount,
    },
    frames: /** @type {any[]} */ ([]),
  };

  try {
    if (supportsImageDecoder()) {
      const decoded = await decodeFramesWithImageDecoder(buffer, { maxFrames: opts.maxFrames });
      doc.image.width = decoded.width ?? doc.image.width;
      doc.image.height = decoded.height ?? doc.image.height;
      doc.image.frameCount = decoded.frameCount;
      doc.frames = decoded.frames;
      if (decoded.truncated) {
        doc.note = `帧数超过上限 ${opts.maxFrames ?? 120}，已截断`;
      }
    } else if (!riff.animated) {
      const decoded = await decodeStaticViaImage(buffer, objectUrl);
      doc.image.width = decoded.width;
      doc.image.height = decoded.height;
      doc.image.frameCount = 1;
      doc.frames = decoded.frames;
      doc.note = '当前浏览器无 ImageDecoder，已按静态单帧导出 PNG';
    } else {
      doc.blob = {
        mimeType: 'image/webp',
        encoding: 'base64',
        data: bytesToBase64(bytes),
      };
      doc.note = '当前浏览器不支持 ImageDecoder，动画帧无法拆分；已附整文件 base64（blob）';
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const text = JSON.stringify(doc, null, opts.pretty === false ? 0 : 2);
  return { doc, text };
}
