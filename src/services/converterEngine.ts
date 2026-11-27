import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import pica from 'pica';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { jsPDF } from 'jspdf';
import { zipSync } from 'fflate';
import type {
  AudioOutputFormat,
  ConversionJob,
  ConverterOptions,
  DocumentOutputFormat,
  ImageOutputFormat,
  VideoOutputFormat,
} from '../types/workbench';
import { replaceExtension } from '../utils/format';

type ProgressCb = (progress: number, etaSeconds?: number) => void;

const picaInstance = pica();
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance;
  if (ffmpegLoadingPromise) return ffmpegLoadingPromise;

  ffmpegLoadingPromise = (async () => {
    const ff = new FFmpeg();
    await ff.load({
      coreURL: '/wasm/ffmpeg-core.js',
      wasmURL: '/wasm/ffmpeg-core.wasm',
    });
    ffmpegInstance = ff;
    return ff;
  })();

  try {
    return await ffmpegLoadingPromise;
  } catch (err) {
    ffmpegLoadingPromise = null;
    throw err;
  }
}

export function resetFFmpegEngine(): void {
  if (ffmpegInstance) {
    try {
      ffmpegInstance.terminate();
    } catch {
      // ignore
    }
    ffmpegInstance = null;
    ffmpegLoadingPromise = null;
  }
}

function buildIcoFromPng(pngBytes: Uint8Array, width: number, height: number): Blob {
  const w = width >= 256 ? 0 : width;
  const h = height >= 256 ? 0 : height;
  const header = new ArrayBuffer(22);
  const view = new DataView(header);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  view.setUint8(6, w);
  view.setUint8(7, h);
  view.setUint8(8, 0);
  view.setUint8(9, 0);
  view.setUint16(10, 1, true);
  view.setUint16(12, 32, true);
  view.setUint32(14, pngBytes.byteLength, true);
  view.setUint32(18, 22, true);
  return new Blob([header, pngBytes.slice().buffer as ArrayBuffer], {
    type: 'image/x-icon',
  });
}

async function decodeHeicToCanvas(file: File): Promise<HTMLCanvasElement> {
  const mod = await import('libheif-js/wasm-bundle');
  const libheif = mod.default || mod;
  const decoder = new libheif.HeifDecoder();
  const data = new Uint8Array(await file.arrayBuffer());
  const images = decoder.decode(data);
  if (!images || images.length === 0) {
    throw new Error('File HEIC tidak berisi gambar yang dapat didekode.');
  }
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Gagal membuat canvas untuk HEIC.');
  const imageData = ctx.createImageData(width, height);

  await new Promise<void>((resolve, reject) => {
    image.display(imageData, (displayData: ImageData | null) => {
      if (!displayData) reject(new Error('Gagal merender piksel gambar HEIC.'));
      else resolve();
    });
  });

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function decodeDomImageToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Gagal memuat gambar "${file.name}".`));
      el.src = url;
    });
    const w = img.naturalWidth || 1024;
    const h = img.naturalHeight || 1024;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Gagal membuat canvas 2D.');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function convertImageOnMainThread(
  file: File,
  ext: string,
  targetFormat: ImageOutputFormat,
  options: ConverterOptions,
  onProgress: ProgressCb
): Promise<Blob> {
  onProgress(20);
  const srcCanvas =
    ext === 'heic' || ext === 'heif'
      ? await decodeHeicToCanvas(file)
      : await decodeDomImageToCanvas(file);

  onProgress(55);
  let targetW =
    options.imageWidth && options.imageWidth > 0 ? Math.round(options.imageWidth) : srcCanvas.width;
  let targetH =
    options.imageHeight && options.imageHeight > 0
      ? Math.round(options.imageHeight)
      : srcCanvas.height;

  if (options.imageWidth && !options.imageHeight) {
    targetH = Math.max(1, Math.round((srcCanvas.height / srcCanvas.width) * targetW));
  } else if (!options.imageWidth && options.imageHeight) {
    targetW = Math.max(1, Math.round((srcCanvas.width / srcCanvas.height) * targetH));
  }

  if (targetFormat === 'ico') {
    const side = Math.min(256, Math.max(16, Math.min(targetW, targetH)));
    targetW = side;
    targetH = side;
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = targetW;
  outCanvas.height = targetH;

  if (targetW !== srcCanvas.width || targetH !== srcCanvas.height) {
    await picaInstance.resize(srcCanvas, outCanvas);
  } else {
    const ctx = outCanvas.getContext('2d');
    if (!ctx) throw new Error('Gagal membuat konteks canvas output.');
    if (targetFormat === 'jpg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(srcCanvas, 0, 0);
  }

  if (targetFormat === 'jpg') {
    // Ensure opaque white backdrop if source had transparency
    const opaqueCanvas = document.createElement('canvas');
    opaqueCanvas.width = targetW;
    opaqueCanvas.height = targetH;
    const octx = opaqueCanvas.getContext('2d');
    if (octx) {
      octx.fillStyle = '#FFFFFF';
      octx.fillRect(0, 0, targetW, targetH);
      octx.drawImage(outCanvas, 0, 0);
      outCanvas.getContext('2d')?.drawImage(opaqueCanvas, 0, 0);
    }
  }

  onProgress(85);
  const mimeMap: Record<ImageOutputFormat, string> = {
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/png',
  };

  const q = Math.min(1, Math.max(0.1, options.imageQuality / 100));
  const blob = await new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob(
      (b) => {
        if (!b) reject(new Error(`Browser tidak mendukung encoding ke format ${targetFormat.toUpperCase()}.`));
        else resolve(b);
      },
      mimeMap[targetFormat],
      targetFormat === 'png' || targetFormat === 'ico' ? undefined : q
    );
  });

  if (targetFormat === 'ico') {
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    return buildIcoFromPng(pngBytes, targetW, targetH);
  }

  return blob;
}

async function convertImage(
  file: File,
  ext: string,
  targetFormat: ImageOutputFormat,
  options: ConverterOptions,
  onProgress: ProgressCb
): Promise<Blob> {
  // SVG and HEIC require DOM or libheif decoder; raster formats without custom resize run in OffscreenCanvas worker
  const canUseWorker =
    ext !== 'heic' &&
    ext !== 'heif' &&
    ext !== 'svg' &&
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined';

  if (canUseWorker) {
    try {
      onProgress(20);
      const blob = await new Promise<Blob>((resolve, reject) => {
        const worker = new Worker(new URL('../workers/imageWorker.ts', import.meta.url), {
          type: 'module',
        });
        const id = crypto.randomUUID();
        worker.onmessage = (e) => {
          worker.terminate();
          if (e.data.ok) resolve(e.data.blob);
          else reject(new Error(e.data.error));
        };
        worker.onerror = (err) => {
          worker.terminate();
          reject(new Error(err.message || 'Worker error'));
        };
        worker.postMessage({
          id,
          file,
          targetFormat,
          quality: options.imageQuality,
          width: options.imageWidth,
          height: options.imageHeight,
        });
      });
      onProgress(100, 0);
      return blob;
    } catch {
      // Fallback seamlessly to main-thread canvas + pica
    }
  }

  const blob = await convertImageOnMainThread(file, ext, targetFormat, options, onProgress);
  onProgress(100, 0);
  return blob;
}

async function convertMediaWithFFmpeg(
  file: File,
  inputExt: string,
  category: 'video' | 'audio',
  targetFormat: VideoOutputFormat | AudioOutputFormat,
  options: ConverterOptions,
  onProgress: ProgressCb
): Promise<Blob> {
  onProgress(5);
  const ff = await getFFmpeg();
  const startedAt = Date.now();
  const uid = Math.random().toString(36).slice(2, 8);
  const inName = `in_${uid}.${inputExt || 'bin'}`;
  const outName = `out_${uid}.${targetFormat}`;

  const progressHandler = ({ progress }: { progress: number }) => {
    const pct = Math.min(98, Math.max(8, Math.round(progress * 100)));
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const eta = progress > 0.05 ? (elapsedSec / progress) * (1 - progress) : undefined;
    onProgress(pct, eta);
  };

  ff.on('progress', progressHandler);

  try {
    await ff.writeFile(inName, await fetchFile(file));

    const args: string[] = [];
    if (options.trimStartSec !== undefined && options.trimStartSec > 0) {
      args.push('-ss', String(options.trimStartSec));
    }
    args.push('-i', inName);
    if (
      options.trimEndSec !== undefined &&
      options.trimEndSec > (options.trimStartSec || 0)
    ) {
      const duration = options.trimEndSec - (options.trimStartSec || 0);
      args.push('-t', String(duration));
    }

    if (category === 'video') {
      const vfParts: string[] = [];
      if (options.videoResolution === '1080p') vfParts.push('scale=-2:1080');
      else if (options.videoResolution === '720p') vfParts.push('scale=-2:720');
      else if (options.videoResolution === '480p') vfParts.push('scale=-2:480');

      if (targetFormat === 'gif') {
        const gifFps = options.videoFps !== 'original' ? options.videoFps : '12';
        vfParts.push(`fps=${gifFps}`);
        if (options.videoResolution === 'original') {
          vfParts.push('scale=min(640\\,iw):-2:flags=lanczos');
        }
        args.push('-vf', vfParts.join(','), '-loop', '0');
      } else {
        if (vfParts.length > 0) {
          args.push('-vf', vfParts.join(','));
        }
        if (options.videoFps !== 'original') {
          args.push('-r', options.videoFps);
        }
        if (options.muteAudio) {
          args.push('-an');
        }
        if (targetFormat === 'mp4') {
          args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
          if (!options.muteAudio) args.push('-c:a', 'aac', '-b:a', '128k');
          args.push('-movflags', '+faststart');
        } else if (targetFormat === 'webm') {
          args.push('-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime');
          if (!options.muteAudio) args.push('-c:a', 'libvorbis');
        }
      }
    } else {
      // Audio
      args.push('-vn');
      if (targetFormat === 'mp3') {
        args.push('-c:a', 'libmp3lame', '-b:a', options.audioBitrate);
      } else if (targetFormat === 'wav') {
        args.push('-c:a', 'pcm_s16le');
      } else if (targetFormat === 'ogg') {
        args.push('-c:a', 'libvorbis', '-b:a', options.audioBitrate);
      } else if (targetFormat === 'm4a') {
        args.push('-c:a', 'aac', '-b:a', options.audioBitrate);
      }
    }

    args.push(outName);
    const code = await ff.exec(args);
    if (code !== 0) {
      throw new Error(`FFmpeg berhenti dengan kode keluar ${code}.`);
    }

    const outData = await ff.readFile(outName);
    const mimeMap: Record<string, string> = {
      mp4: 'video/mp4',
      webm: 'video/webm',
      gif: 'image/gif',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
    };
    const uint8 = outData instanceof Uint8Array ? outData : new TextEncoder().encode(outData);
    onProgress(100, 0);
    return new Blob([uint8.slice().buffer as ArrayBuffer], {
      type: mimeMap[targetFormat] || 'application/octet-stream',
    });
  } finally {
    ff.off('progress', progressHandler);
    await ff.deleteFile(inName).catch(() => {});
    await ff.deleteFile(outName).catch(() => {});
  }
}

function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent?.trim() || '';
}

async function convertDocument(
  file: File,
  inputExt: string,
  targetFormat: DocumentOutputFormat,
  options: ConverterOptions,
  onProgress: ProgressCb
): Promise<Blob> {
  onProgress(20);
  let plainText = '';
  let htmlContent = '';
  let csvContent = '';

  if (inputExt === 'docx') {
    const ab = await file.arrayBuffer();
    const res = await mammoth.convertToHtml({ arrayBuffer: ab });
    htmlContent = res.value;
    plainText = htmlToPlainText(htmlContent);
  } else if (inputExt === 'xlsx' || inputExt === 'csv') {
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: 'array' });
    const firstSheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[firstSheetName];
    csvContent = XLSX.utils.sheet_to_csv(sheet);
    htmlContent = XLSX.utils.sheet_to_html(sheet);
    plainText = csvContent;
  } else if (inputExt === 'md' || inputExt === 'markdown') {
    const raw = await file.text();
    htmlContent = await marked.parse(raw);
    plainText = raw;
  } else if (inputExt === 'html' || inputExt === 'htm') {
    htmlContent = await file.text();
    plainText = htmlToPlainText(htmlContent);
  } else {
    // txt or fallback
    plainText = await file.text();
    const escaped = plainText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    htmlContent = `<pre style="font-family:monospace;white-space:pre-wrap">${escaped}</pre>`;
  }

  onProgress(65);

  if (targetFormat === 'txt') {
    onProgress(100, 0);
    return new Blob([plainText], { type: 'text/plain;charset=utf-8' });
  }

  if (targetFormat === 'html') {
    const fullHtml = `<!doctype html>\n<html lang="id">\n<head><meta charset="utf-8"><title>${file.name}</title><style>body{font-family:system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.6;color:#141413}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d5d2ca;padding:6px 10px;text-align:left}</style></head>\n<body>\n${htmlContent}\n</body>\n</html>`;
    onProgress(100, 0);
    return new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
  }

  if (targetFormat === 'md') {
    const td = new TurndownService({ headingStyle: 'atx' });
    const md = inputExt === 'md' ? plainText : td.turndown(htmlContent || plainText);
    onProgress(100, 0);
    return new Blob([md], { type: 'text/markdown;charset=utf-8' });
  }

  if (targetFormat === 'csv') {
    const csv =
      csvContent ||
      plainText
        .split(/\r?\n/)
        .map((line) => `"${line.replace(/"/g, '""')}"`)
        .join('\n');
    onProgress(100, 0);
    return new Blob([csv], { type: 'text/csv;charset=utf-8' });
  }

  // Output PDF via jsPDF
  const doc = new jsPDF({
    orientation: options.paperOrientation,
    unit: 'pt',
    format: options.paperSize,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 15;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);

  const lines = doc.splitTextToSize(plainText || '(Dokumen kosong)', maxWidth) as string[];
  let cursorY = margin;

  for (const line of lines) {
    if (cursorY + lineHeight > pageHeight - margin) {
      doc.addPage();
      cursorY = margin;
    }
    doc.text(line, margin, cursorY);
    cursorY += lineHeight;
  }

  onProgress(100, 0);
  return doc.output('blob');
}

export async function runConversionJob(
  job: ConversionJob,
  onProgress: ProgressCb
): Promise<{ blob: Blob; outputName: string }> {
  const { file, category, inputExt, targetFormat, options } = job;
  let blob: Blob;

  if (category === 'image') {
    blob = await convertImage(
      file,
      inputExt,
      targetFormat as ImageOutputFormat,
      options,
      onProgress
    );
  } else if (category === 'video' || category === 'audio') {
    blob = await convertMediaWithFFmpeg(
      file,
      inputExt,
      category,
      targetFormat as VideoOutputFormat | AudioOutputFormat,
      options,
      onProgress
    );
  } else {
    blob = await convertDocument(
      file,
      inputExt,
      targetFormat as DocumentOutputFormat,
      options,
      onProgress
    );
  }

  return {
    blob,
    outputName: replaceExtension(file.name, targetFormat),
  };
}

export async function createBatchDownloadZip(jobs: ConversionJob[]): Promise<Blob> {
  const filesMap: Record<string, Uint8Array> = {};
  const usedNames = new Map<string, number>();

  for (const job of jobs) {
    if (job.status !== 'done' || !job.outputBlob || !job.outputName) continue;
    let name = job.outputName;
    const count = usedNames.get(name) || 0;
    usedNames.set(name, count + 1);
    if (count > 0) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
    }
    filesMap[name] = new Uint8Array(await job.outputBlob.arrayBuffer());
  }

  const zipped = zipSync(filesMap, { level: 6 });
  return new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' });
}
