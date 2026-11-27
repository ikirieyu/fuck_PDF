import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { degrees, PDFCheckBox, PDFDocument, PDFTextField, rgb, StandardFonts } from 'pdf-lib';
import type {
  PdfAnnotation,
  PdfFontFamily,
  PdfFormFieldItem,
  PdfImageBlockItem,
  PdfPageItem,
  PdfSourceDoc,
  PdfTextBlockItem,
} from '../types/workbench';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type CompressionPreset = 'none' | 'low' | 'medium' | 'high';

const COMPRESSION_PROFILES: Record<
  Exclude<CompressionPreset, 'none'>,
  { scale: number; jpegQuality: number }
> = {
  low: { scale: 1.8, jpegQuality: 0.85 },
  medium: { scale: 1.35, jpegQuality: 0.7 },
  high: { scale: 0.95, jpegQuality: 0.52 },
};

export function parsePageRanges(input: string, maxPage: number): number[] {
  const result = new Set<number>();
  const parts = input
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (part.includes('-')) {
      const [startRaw, endRaw] = part.split('-').map((n) => parseInt(n.trim(), 10));
      if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) continue;
      const start = Math.max(1, Math.min(startRaw, endRaw));
      const end = Math.min(maxPage, Math.max(startRaw, endRaw));
      for (let i = start; i <= end; i++) {
        result.add(i);
      }
    } else {
      const n = parseInt(part, 10);
      if (Number.isFinite(n) && n >= 1 && n <= maxPage) {
        result.add(n);
      }
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

function hexToRgbTuple(hex = '#141413'): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return [
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0,
  ];
}

export async function loadPdfSourceAndThumbnails(
  file: File
): Promise<{
  sourceDoc: PdfSourceDoc;
  pages: PdfPageItem[];
  pdfjsDoc: pdfjsLib.PDFDocumentProxy;
}> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sourceDoc: PdfSourceDoc = {
    id: crypto.randomUUID(),
    name: file.name,
    bytes,
  };

  const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const pages: PdfPageItem[] = [];

  for (let i = 1; i <= pdfjsDoc.numPages; i++) {
    const page = await pdfjsDoc.getPage(i);
    const baseVp = page.getViewport({ scale: 1 });
    const thumbScale = Math.min(0.45, 220 / baseVp.width);
    const thumbVp = page.getViewport({ scale: thumbScale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(thumbVp.width));
    canvas.height = Math.max(1, Math.floor(thumbVp.height));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport: thumbVp, canvas }).promise;
    }

    pages.push({
      id: crypto.randomUUID(),
      sourceDocId: sourceDoc.id,
      sourcePageIndex: i - 1,
      rotation: 0,
      thumbnailUrl: canvas.toDataURL('image/jpeg', 0.8),
      width: baseVp.width,
      height: baseVp.height,
    });
  }

  return { sourceDoc, pages, pdfjsDoc };
}

function mapFontName(family?: PdfFontFamily) {
  switch (family) {
    case 'TimesRoman':
      return StandardFonts.TimesRoman;
    case 'Courier':
      return StandardFonts.Courier;
    default:
      return StandardFonts.Helvetica;
  }
}

async function renderFlattenedPageImage(
  pdfjsDoc: pdfjsLib.PDFDocumentProxy,
  pageIndexZeroBased: number,
  rotation: number,
  annotations: PdfAnnotation[],
  scale: number,
  jpegQuality: number
): Promise<{ imageBytes: Uint8Array; widthPt: number; heightPt: number; isPng: boolean }> {
  const page = await pdfjsDoc.getPage(pageIndexZeroBased + 1);
  const totalRotation = (page.rotate + rotation) % 360;
  const baseVp = page.getViewport({ scale: 1, rotation: totalRotation });
  const renderVp = page.getViewport({ scale, rotation: totalRotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(renderVp.width));
  canvas.height = Math.max(1, Math.floor(renderVp.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Gagal membuat canvas rasterisasi halaman PDF.');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: renderVp, canvas }).promise;

  // Draw annotations onto the canvas so redaction permanently destroys text pixels underneath
  for (const ann of annotations) {
    const px = ann.x * canvas.width;
    const py = ann.y * canvas.height;
    const pw = ann.width * canvas.width;
    const ph = ann.height * canvas.height;

    if (ann.type === 'highlight') {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = ann.color || '#FACC15';
      ctx.fillRect(px, py, pw, ph);
      ctx.restore();
    } else if (ann.type === 'underline') {
      ctx.save();
      ctx.strokeStyle = ann.color || '#C83E2B';
      ctx.lineWidth = Math.max(2, 2.5 * scale);
      ctx.beginPath();
      ctx.moveTo(px, py + ph);
      ctx.lineTo(px + pw, py + ph);
      ctx.stroke();
      ctx.restore();
    } else if (ann.type === 'redaction') {
      ctx.save();
      ctx.fillStyle = ann.redactionColor || '#000000';
      ctx.fillRect(px, py, pw, ph);
      ctx.restore();
    } else if (ann.type === 'image' && ann.imageDataUrl) {
      if (ann.whiteoutBg) {
        const ox = (ann.origX ?? ann.x) * canvas.width;
        const oy = (ann.origY ?? ann.y) * canvas.height;
        const ow = (ann.origWidth ?? ann.width) * canvas.width;
        const oh = (ann.origHeight ?? ann.height) * canvas.height;
        ctx.save();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(ox - 2, oy - 2, ow + 4, oh + 4);
        ctx.restore();
      }
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = ann.imageDataUrl!;
      });
      ctx.drawImage(img, px, py, pw, ph);
    } else if (ann.type === 'link' && ann.text) {
      ctx.save();
      const fontPx = (ann.fontSize || 12) * scale;
      ctx.font = `${fontPx}px sans-serif`;
      ctx.fillStyle = '#1E4E79';
      ctx.textBaseline = 'top';
      ctx.fillText(ann.text, px, py);
      ctx.strokeStyle = '#1E4E79';
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.moveTo(px, py + fontPx + 2);
      ctx.lineTo(px + pw, py + fontPx + 2);
      ctx.stroke();
      ctx.restore();
    } else if (ann.type === 'text' && ann.text) {
      if (ann.whiteoutBg) {
        const ox = (ann.origX ?? ann.x) * canvas.width;
        const oy = (ann.origY ?? ann.y) * canvas.height;
        const ow = (ann.origWidth ?? ann.width) * canvas.width;
        const oh = (ann.origHeight ?? ann.height) * canvas.height;
        ctx.save();
        ctx.fillStyle = ann.maskColor || '#FFFFFF';
        ctx.fillRect(ox - 1, oy - 1, ow + 2, oh + 2);
        ctx.restore();
      }
      ctx.save();
      const fontPx = (ann.fontSize || 14) * scale;
      const cssFamily =
        ann.fontFamily === 'TimesRoman'
          ? 'serif'
          : ann.fontFamily === 'Courier'
          ? 'monospace'
          : 'sans-serif';
      ctx.font = `${fontPx}px ${cssFamily}`;
      ctx.fillStyle = ann.color || '#141413';
      ctx.textBaseline = 'top';
      const lines = ann.text.split('\n');
      lines.forEach((line, idx) => {
        ctx.fillText(line, px, py + idx * fontPx * 1.25);
      });
      ctx.restore();
    } else if (ann.type === 'rect') {
      ctx.save();
      ctx.strokeStyle = ann.color || '#C83E2B';
      ctx.lineWidth = Math.max(1.5, (ann.strokeWidth || 2) * scale);
      ctx.strokeRect(px, py, pw, ph);
      ctx.restore();
    } else if (ann.type === 'draw' && ann.points && ann.points.length > 1) {
      ctx.save();
      ctx.strokeStyle = ann.color || '#141413';
      ctx.lineWidth = Math.max(1.5, (ann.strokeWidth || 2.5) * scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ann.points[0].x * canvas.width, ann.points[0].y * canvas.height);
      for (let i = 1; i < ann.points.length; i++) {
        ctx.lineTo(ann.points[i].x * canvas.width, ann.points[i].y * canvas.height);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Gagal mengenkode halaman terasterisasi.'))),
      'image/jpeg',
      jpegQuality
    );
  });

  return {
    imageBytes: new Uint8Array(await blob.arrayBuffer()),
    widthPt: baseVp.width,
    heightPt: baseVp.height,
    isPng: false,
  };
}

export interface PdfWatermarkConfig {
  enabled: boolean;
  text: string;
  opacity: number; // 0.1 - 0.8
  fontSize: number;
  color: string;
  diagonal: boolean;
}

export interface PdfPageNumberConfig {
  enabled: boolean;
  position: 'bottom-center' | 'bottom-right' | 'top-right';
  format: 'number-only' | 'page-of-total';
  fontSize: number;
}

export interface PdfCropConfig {
  enabled: boolean;
  scope: 'all' | 'current' | 'range';
  pageRange?: string;
  mode: 'margins' | 'uniform-size';
  topPt: number;
  rightPt: number;
  bottomPt: number;
  leftPt: number;
  targetPreset: 'match-first' | 'a4-portrait' | 'a4-landscape' | 'letter-portrait' | 'custom';
  customWidthPt?: number;
  customHeightPt?: number;
}

export interface PdfHeaderFooterConfig {
  enabled: boolean;
  headerText: string;
  footerText: string;
  fontSize: number;
}

export async function extractPageTextBlocks(
  pdfjsDoc: pdfjsLib.PDFDocumentProxy,
  pageIndexZeroBased: number,
  rotation: number
): Promise<PdfTextBlockItem[]> {
  const page = await pdfjsDoc.getPage(pageIndexZeroBased + 1);
  const totalRot = (page.rotate + rotation) % 360;
  const vp = page.getViewport({ scale: 1, rotation: totalRot });
  const content = await page.getTextContent();

  interface RawRun {
    text: string;
    xPt: number;
    yBaselinePt: number;
    wPt: number;
    fontSize: number;
  }

  const runs: RawRun[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
    const fontSize = Math.max(6, Math.hypot(tx[2], tx[3]) || item.height || 10);
    const wPt = Math.max(4, item.width || item.str.length * fontSize * 0.5);
    runs.push({
      text: item.str,
      xPt: tx[4],
      yBaselinePt: tx[5],
      wPt,
      fontSize,
    });
  }

  // Group adjacent runs on the same baseline into clean editable line/field blocks
  runs.sort((a, b) => a.yBaselinePt - b.yBaselinePt || a.xPt - b.xPt);
  const grouped: RawRun[] = [];
  for (const r of runs) {
    const prev = grouped[grouped.length - 1];
    if (
      prev &&
      Math.abs(prev.yBaselinePt - r.yBaselinePt) <= Math.max(3, prev.fontSize * 0.35) &&
      r.xPt - (prev.xPt + prev.wPt) >= -4 &&
      r.xPt - (prev.xPt + prev.wPt) <= Math.max(14, prev.fontSize * 1.4)
    ) {
      const gap = r.xPt - (prev.xPt + prev.wPt);
      prev.text = gap > 2 ? `${prev.text} ${r.text}` : `${prev.text}${r.text}`;
      prev.wPt = Math.max(prev.wPt, r.xPt + r.wPt - prev.xPt);
      prev.fontSize = Math.max(prev.fontSize, r.fontSize);
    } else {
      grouped.push({ ...r });
    }
  }

  return grouped.map((g) => {
    const topPt = g.yBaselinePt - g.fontSize * 0.88;
    const heightPt = g.fontSize * 1.18;
    const x = Math.min(0.98, Math.max(0, g.xPt / vp.width));
    const y = Math.min(0.98, Math.max(0, topPt / vp.height));
    const width = Math.min(1 - x, Math.max(0.02, g.wPt / vp.width));
    const height = Math.min(1 - y, Math.max(0.014, heightPt / vp.height));
    return {
      id: crypto.randomUUID(),
      text: g.text.trim(),
      x,
      y,
      width,
      height,
      fontSize: Math.round(g.fontSize),
    };
  });
}

export async function extractPageImageBlocks(
  pdfjsDoc: pdfjsLib.PDFDocumentProxy,
  pageIndexZeroBased: number,
  rotation: number
): Promise<PdfImageBlockItem[]> {
  try {
    const page = await pdfjsDoc.getPage(pageIndexZeroBased + 1);
    const totalRot = (page.rotate + rotation) % 360;
    const vp = page.getViewport({ scale: 1, rotation: totalRot });
    const opList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;

    const stack: number[][] = [];
    let ctm: number[] = [1, 0, 0, 1, 0, 0];
    const blocks: PdfImageBlockItem[] = [];

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      if (fn === OPS.save) {
        stack.push([...ctm]);
      } else if (fn === OPS.restore) {
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        ctm = pdfjsLib.Util.transform(ctm, args as number[]);
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintImageMaskXObject
      ) {
        const m = pdfjsLib.Util.transform(vp.transform, ctm);
        // Unit square corners (0,0), (1,0), (0,1), (1,1) mapped through m
        const pts = [
          [m[4], m[5]],
          [m[0] + m[4], m[1] + m[5]],
          [m[2] + m[4], m[3] + m[5]],
          [m[0] + m[2] + m[4], m[1] + m[3] + m[5]],
        ];
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const minX = Math.max(0, Math.min(...xs));
        const maxX = Math.min(vp.width, Math.max(...xs));
        const minY = Math.max(0, Math.min(...ys));
        const maxY = Math.min(vp.height, Math.max(...ys));
        const w = (maxX - minX) / vp.width;
        const h = (maxY - minY) / vp.height;
        if (w >= 0.02 && h >= 0.02 && w <= 0.98 && h <= 0.98) {
          blocks.push({
            id: crypto.randomUUID(),
            x: minX / vp.width,
            y: minY / vp.height,
            width: w,
            height: h,
          });
        }
      }
    }
    return blocks;
  } catch {
    return [];
  }
}

export async function extractPdfFormFields(bytes: Uint8Array): Promise<PdfFormFieldItem[]> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const form = doc.getForm();
    const fields = form.getFields();
    const out: PdfFormFieldItem[] = [];
    for (const f of fields) {
      if (f instanceof PDFTextField) {
        out.push({ name: f.getName(), type: 'text', value: f.getText() || '' });
      } else if (f instanceof PDFCheckBox) {
        out.push({ name: f.getName(), type: 'checkbox', value: f.isChecked() });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function exportEditedPdf(params: {
  sourceDocs: Map<string, PdfSourceDoc>;
  pdfjsDocs: Map<string, pdfjsLib.PDFDocumentProxy>;
  pages: PdfPageItem[];
  annotations: PdfAnnotation[];
  compression: CompressionPreset;
  selectedPageIndicesOneBased?: number[];
  watermark?: PdfWatermarkConfig;
  pageNumbers?: PdfPageNumberConfig;
  crop?: PdfCropConfig;
  currentPageOneBased?: number;
  headerFooter?: PdfHeaderFooterConfig;
  formValues?: Record<string, string | boolean>;
}): Promise<Blob> {
  const {
    sourceDocs,
    pdfjsDocs,
    pages,
    annotations,
    compression,
    selectedPageIndicesOneBased,
    watermark,
    pageNumbers,
    crop,
    currentPageOneBased,
    headerFooter,
    formValues,
  } = params;

  const targetPages = selectedPageIndicesOneBased
    ? selectedPageIndicesOneBased
        .map((num) => pages[num - 1])
        .filter((p): p is PdfPageItem => Boolean(p))
    : pages;

  if (targetPages.length === 0) {
    throw new Error('Tidak ada halaman yang dipilih untuk diekspor.');
  }

  const outPdf = await PDFDocument.create();
  const loadedPdfLibDocs = new Map<string, PDFDocument>();

  const fontCache = new Map<PdfFontFamily, Awaited<ReturnType<PDFDocument['embedFont']>>>();
  const getFont = async (family: PdfFontFamily = 'Helvetica') => {
    if (fontCache.has(family)) return fontCache.get(family)!;
    const embedded = await outPdf.embedFont(mapFontName(family));
    fontCache.set(family, embedded);
    return embedded;
  };

  for (const pageItem of targetPages) {
    const pageAnns = annotations.filter((a) => a.pageId === pageItem.id);
    const hasRedaction = pageAnns.some((a) => a.type === 'redaction');

    // Rasterize page if it has permanent redaction OR if compression preset is active
    if (hasRedaction || compression !== 'none') {
      const pdfjsDoc = pdfjsDocs.get(pageItem.sourceDocId);
      if (!pdfjsDoc) throw new Error('Dokumen sumber PDF tidak ditemukan di memori.');

      const profile =
        compression === 'none'
          ? { scale: 2.4, jpegQuality: 0.92 }
          : COMPRESSION_PROFILES[compression];

      const flattened = await renderFlattenedPageImage(
        pdfjsDoc,
        pageItem.sourcePageIndex,
        pageItem.rotation,
        pageAnns,
        profile.scale,
        profile.jpegQuality
      );

      const embeddedImg = await outPdf.embedJpg(flattened.imageBytes);
      const page = outPdf.addPage([flattened.widthPt, flattened.heightPt]);
      page.drawImage(embeddedImg, {
        x: 0,
        y: 0,
        width: flattened.widthPt,
        height: flattened.heightPt,
      });
      continue;
    }

    // Pure vector copy + vector annotations
    let srcPdfLib = loadedPdfLibDocs.get(pageItem.sourceDocId);
    if (!srcPdfLib) {
      const srcDoc = sourceDocs.get(pageItem.sourceDocId);
      if (!srcDoc) throw new Error('Buffer sumber PDF tidak tersedia.');
      srcPdfLib = await PDFDocument.load(srcDoc.bytes, { ignoreEncryption: true });
      loadedPdfLibDocs.set(pageItem.sourceDocId, srcPdfLib);
    }

    const [copiedPage] = await outPdf.copyPages(srcPdfLib, [pageItem.sourcePageIndex]);
    if (pageItem.rotation !== 0) {
      const existingAngle = copiedPage.getRotation().angle;
      copiedPage.setRotation(degrees((existingAngle + pageItem.rotation) % 360));
    }
    outPdf.addPage(copiedPage);

    const { width, height } = copiedPage.getSize();

    for (const ann of pageAnns) {
      const pdfX = ann.x * width;
      const pdfW = ann.width * width;
      const pdfH = ann.height * height;
      // PDF y-axis starts at bottom-left
      const pdfY = height - (ann.y * height + pdfH);

      if (ann.type === 'highlight') {
        const [r, g, b] = hexToRgbTuple(ann.color || '#FACC15');
        copiedPage.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
          color: rgb(r, g, b),
          opacity: 0.35,
        });
      } else if (ann.type === 'underline') {
        const [r, g, b] = hexToRgbTuple(ann.color || '#C83E2B');
        copiedPage.drawLine({
          start: { x: pdfX, y: pdfY },
          end: { x: pdfX + pdfW, y: pdfY },
          thickness: 2,
          color: rgb(r, g, b),
        });
      } else if (ann.type === 'text' && ann.text) {
        if (ann.whiteoutBg) {
          const ox = (ann.origX ?? ann.x) * width;
          const ow = (ann.origWidth ?? ann.width) * width;
          const oh = (ann.origHeight ?? ann.height) * height;
          const oy = height - ((ann.origY ?? ann.y) * height + oh);
          const [mr, mg, mb] = hexToRgbTuple(ann.maskColor || '#FFFFFF');
          copiedPage.drawRectangle({
            x: Math.max(0, ox - 1),
            y: Math.max(0, oy - 1),
            width: ow + 2,
            height: oh + 2,
            color: rgb(mr, mg, mb),
          });
        }
        const font = await getFont(ann.fontFamily || 'Helvetica');
        const fontSize = ann.fontSize || 14;
        const [r, g, b] = hexToRgbTuple(ann.color || '#141413');
        const topY = height - ann.y * height - fontSize;
        const lines = ann.text.split('\n');
        lines.forEach((line, idx) => {
          copiedPage.drawText(line, {
            x: pdfX,
            y: topY - idx * fontSize * 1.25,
            size: fontSize,
            font,
            color: rgb(r, g, b),
          });
        });
      } else if (ann.type === 'rect') {
        const [r, g, b] = hexToRgbTuple(ann.color || '#C83E2B');
        copiedPage.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
          borderColor: rgb(r, g, b),
          borderWidth: ann.strokeWidth || 2,
        });
      } else if (ann.type === 'draw' && ann.points && ann.points.length > 1) {
        const [r, g, b] = hexToRgbTuple(ann.color || '#141413');
        const sw = ann.strokeWidth || 2;
        for (let i = 1; i < ann.points.length; i++) {
          const p0 = ann.points[i - 1];
          const p1 = ann.points[i];
          copiedPage.drawLine({
            start: { x: p0.x * width, y: height - p0.y * height },
            end: { x: p1.x * width, y: height - p1.y * height },
            thickness: sw,
            color: rgb(r, g, b),
          });
        }
      } else if (ann.type === 'image' && ann.imageDataUrl) {
        if (ann.whiteoutBg) {
          const ox = (ann.origX ?? ann.x) * width;
          const ow = (ann.origWidth ?? ann.width) * width;
          const oh = (ann.origHeight ?? ann.height) * height;
          const oy = height - ((ann.origY ?? ann.y) * height + oh);
          copiedPage.drawRectangle({
            x: Math.max(0, ox - 2),
            y: Math.max(0, oy - 2),
            width: ow + 4,
            height: oh + 4,
            color: rgb(1, 1, 1),
          });
        }
        const resp = await fetch(ann.imageDataUrl);
        const imgBytes = new Uint8Array(await resp.arrayBuffer());
        const isPng = ann.imageDataUrl.startsWith('data:image/png');
        const embedded = isPng
          ? await outPdf.embedPng(imgBytes)
          : await outPdf.embedJpg(imgBytes);
        copiedPage.drawImage(embedded, {
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
        });
      } else if (ann.type === 'link' && ann.text) {
        const font = await getFont('Helvetica');
        const fontSize = ann.fontSize || 12;
        const topY = height - ann.y * height - fontSize;
        copiedPage.drawText(ann.text, {
          x: pdfX,
          y: topY,
          size: fontSize,
          font,
          color: rgb(0.12, 0.31, 0.47),
        });
        copiedPage.drawLine({
          start: { x: pdfX, y: topY - 2 },
          end: { x: pdfX + pdfW, y: topY - 2 },
          thickness: 1,
          color: rgb(0.12, 0.31, 0.47),
        });
      }
    }
  }

  const totalExported = outPdf.getPageCount();
  if (
    (watermark?.enabled && watermark.text.trim()) ||
    pageNumbers?.enabled ||
    crop?.enabled ||
    headerFooter?.enabled
  ) {
    const helv = await getFont('Helvetica');
    const outPages = outPdf.getPages();
    for (let i = 0; i < outPages.length; i++) {
      const p = outPages[i];
      const { width, height } = p.getSize();

      if (headerFooter?.enabled) {
        const fs = headerFooter.fontSize || 9;
        if (headerFooter.headerText.trim()) {
          p.drawText(headerFooter.headerText.trim(), {
            x: 28,
            y: Math.max(20, height - 24),
            size: fs,
            font: helv,
            color: rgb(0.3, 0.3, 0.3),
          });
        }
        if (headerFooter.footerText.trim()) {
          p.drawText(headerFooter.footerText.trim(), {
            x: 28,
            y: 18,
            size: fs,
            font: helv,
            color: rgb(0.3, 0.3, 0.3),
          });
        }
      }

      if (crop?.enabled) {
        const cropTargets =
          crop.scope === 'current'
            ? new Set([Math.max(1, currentPageOneBased || 1)])
            : crop.scope === 'range'
              ? new Set(parsePageRanges(crop.pageRange || '1', totalExported))
              : null;

        if (!cropTargets || cropTargets.has(i + 1)) {
          if (crop.mode === 'uniform-size') {
            let targetW = 595;
            let targetH = 842;
            if (crop.targetPreset === 'match-first') {
              const firstSize = outPages[0].getSize();
              targetW = firstSize.width;
              targetH = firstSize.height;
            } else if (crop.targetPreset === 'a4-landscape') {
              targetW = 842;
              targetH = 595;
            } else if (crop.targetPreset === 'letter-portrait') {
              targetW = 612;
              targetH = 792;
            } else if (crop.targetPreset === 'custom') {
              targetW = Math.max(100, crop.customWidthPt || 595);
              targetH = Math.max(100, crop.customHeightPt || 842);
            }
            const scale = Math.min(targetW / width, targetH / height);
            const dx = (targetW - width * scale) / 2;
            const dy = (targetH - height * scale) / 2;
            p.scaleContent(scale, scale);
            p.translateContent(dx, dy);
            p.setSize(targetW, targetH);
            p.setMediaBox(0, 0, targetW, targetH);
            p.setCropBox(0, 0, targetW, targetH);
          } else {
            const l = Math.max(0, crop.leftPt || 0);
            const b = Math.max(0, crop.bottomPt || 0);
            const r = Math.max(0, crop.rightPt || 0);
            const t = Math.max(0, crop.topPt || 0);
            const newW = Math.max(50, width - l - r);
            const newH = Math.max(50, height - t - b);
            p.setCropBox(l, b, newW, newH);
          }
        }
      }

      if (watermark?.enabled && watermark.text.trim()) {
        const [wr, wg, wb] = hexToRgbTuple(watermark.color || '#C83E2B');
        const fs = watermark.fontSize || 42;
        const textWidth = helv.widthOfTextAtSize(watermark.text, fs);
        p.drawText(watermark.text, {
          x: Math.max(20, (width - textWidth) / 2),
          y: height / 2,
          size: fs,
          font: helv,
          color: rgb(wr, wg, wb),
          opacity: Math.min(0.9, Math.max(0.05, watermark.opacity || 0.25)),
          rotate: watermark.diagonal ? degrees(35) : degrees(0),
        });
      }

      if (pageNumbers?.enabled) {
        const label =
          pageNumbers.format === 'page-of-total'
            ? `${i + 1} / ${totalExported}`
            : `${i + 1}`;
        const fs = pageNumbers.fontSize || 10;
        const textWidth = helv.widthOfTextAtSize(label, fs);
        let x = (width - textWidth) / 2;
        let y = 20;
        if (pageNumbers.position === 'bottom-right') {
          x = Math.max(20, width - textWidth - 28);
          y = 20;
        } else if (pageNumbers.position === 'top-right') {
          x = Math.max(20, width - textWidth - 28);
          y = Math.max(20, height - 28);
        }
        p.drawText(label, {
          x,
          y,
          size: fs,
          font: helv,
          color: rgb(0.2, 0.2, 0.2),
        });
      }
    }
  }

  if (formValues && Object.keys(formValues).length > 0) {
    try {
      const form = outPdf.getForm();
      for (const [name, val] of Object.entries(formValues)) {
        try {
          const field = form.getField(name);
          if (field instanceof PDFTextField && typeof val === 'string') {
            field.setText(val);
          } else if (field instanceof PDFCheckBox && typeof val === 'boolean') {
            if (val) field.check();
            else field.uncheck();
          }
        } catch {
          // ignore missing/incompatible field
        }
      }
    } catch {
      // ignore if PDF has no AcroForm
    }
  }

  const savedBytes = await outPdf.save({ useObjectStreams: true });
  return new Blob([savedBytes.slice().buffer as ArrayBuffer], {
    type: 'application/pdf',
  });
}
