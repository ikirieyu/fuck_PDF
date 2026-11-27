// Web Worker for raster image decoding, resizing, EXIF stripping, and encoding via OffscreenCanvas
interface ImageWorkerRequest {
  id: string;
  file: File;
  targetFormat: 'jpg' | 'png' | 'webp' | 'avif' | 'ico';
  quality: number;
  width?: number;
  height?: number;
}

function buildIcoFromPng(pngBytes: Uint8Array, width: number, height: number): Blob {
  // ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes) + PNG data
  const w = width >= 256 ? 0 : width;
  const h = height >= 256 ? 0 : height;
  const header = new ArrayBuffer(22);
  const view = new DataView(header);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type = 1 (ICO)
  view.setUint16(4, 1, true); // count = 1 image

  view.setUint8(6, w); // width
  view.setUint8(7, h); // height
  view.setUint8(8, 0); // color count
  view.setUint8(9, 0); // reserved
  view.setUint16(10, 1, true); // planes
  view.setUint16(12, 32, true); // bit count
  view.setUint32(14, pngBytes.byteLength, true); // bytes in res
  view.setUint32(18, 22, true); // offset

  return new Blob([header, pngBytes.slice().buffer as ArrayBuffer], {
    type: 'image/x-icon',
  });
}

self.onmessage = async (event: MessageEvent<ImageWorkerRequest>) => {
  const { id, file, targetFormat, quality, width, height } = event.data;
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      throw new Error('FALLBACK_MAIN_THREAD');
    }

    const bitmap = await createImageBitmap(file);
    let targetW = width && width > 0 ? Math.round(width) : bitmap.width;
    let targetH = height && height > 0 ? Math.round(height) : bitmap.height;

    if (width && !height) {
      targetH = Math.max(1, Math.round((bitmap.height / bitmap.width) * targetW));
    } else if (!width && height) {
      targetW = Math.max(1, Math.round((bitmap.width / bitmap.height) * targetH));
    }

    if (targetFormat === 'ico') {
      const side = Math.min(256, Math.max(16, Math.min(targetW, targetH)));
      targetW = side;
      targetH = side;
    }

    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Gagal membuat konteks OffscreenCanvas.');

    if (targetFormat === 'jpg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      avif: 'image/avif',
      ico: 'image/png',
    };

    const q = Math.min(1, Math.max(0.1, quality / 100));
    const blob = await canvas.convertToBlob({
      type: mimeMap[targetFormat],
      quality: targetFormat === 'png' || targetFormat === 'ico' ? undefined : q,
    });

    if (targetFormat === 'ico') {
      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      const icoBlob = buildIcoFromPng(pngBytes, targetW, targetH);
      self.postMessage({ id, ok: true, blob: icoBlob });
      return;
    }

    self.postMessage({ id, ok: true, blob });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'Worker image conversion failed',
    });
  }
};
