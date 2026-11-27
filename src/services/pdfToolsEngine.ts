/**
 * pdfToolsEngine.ts
 * Local-first engines for the extended iLovePDF-equivalent toolset:
 * - PDF to JPG / PNG (rendered locally via pdfjs-dist, bundled as ZIP if multi-page)
 * - PDF to Markdown (.md)
 * - PDF to Word (.doc HTML-Word)
 * - PDF to Excel (.xlsx via SheetJS)
 * - Images / Scans to PDF (via pdf-lib)
 * - Compare Two PDFs (visual page previews + line-by-line text diff)
 */
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { bundleFilesAsZip } from './archiveEngine';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function pdfToImagesResult(
  file: File,
  format: 'jpg' | 'png' = 'jpg',
  scale = 2.0
): Promise<{ blob: Blob; filename: string; pageCount: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const baseName = file.name.replace(/\.pdf$/i, '');
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';

  const rendered: { path: string; data: Uint8Array }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (format === 'jpg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Gagal merender halaman PDF'))),
        mime,
        0.92
      );
    });
    rendered.push({
      path: `${baseName}_page_${String(i).padStart(3, '0')}.${ext}`,
      data: new Uint8Array(await blob.arrayBuffer()),
    });
  }

  const pageCount = doc.numPages;
  await doc.cleanup().catch(() => {});

  if (rendered.length === 1) {
    return {
      blob: new Blob([rendered[0].data.slice().buffer as ArrayBuffer], { type: mime }),
      filename: rendered[0].path,
      pageCount,
    };
  }

  return {
    blob: bundleFilesAsZip(rendered),
    filename: `${baseName}_${ext}_pages.zip`,
    pageCount,
  };
}

interface ExtractedPageLines {
  pageNum: number;
  lines: { text: string; maxHeight: number }[];
}

async function extractStructuredLines(file: File): Promise<ExtractedPageLines[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages: ExtractedPageLines[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group text items by rounded Y coordinate (same line)
    const rowMap = new Map<number, { x: number; str: string; h: number }[]>();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const str = item.str;
      if (!str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      const x = item.transform[4];
      const h = item.height || 10;
      const list = rowMap.get(y) ?? [];
      list.push({ x, str, h });
      rowMap.set(y, list);
    }

    const sortedYs = Array.from(rowMap.keys()).sort((a, b) => b - a);
    const lines = sortedYs.map((y) => {
      const items = rowMap.get(y)!.sort((a, b) => a.x - b.x);
      const text = items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
      const maxHeight = Math.max(...items.map((it) => it.h));
      return { text, maxHeight };
    });

    pages.push({ pageNum: i, lines });
  }

  await doc.cleanup().catch(() => {});
  return pages;
}

export async function pdfToMarkdownResult(file: File): Promise<{ blob: Blob; filename: string }> {
  const pages = await extractStructuredLines(file);
  const baseName = file.name.replace(/\.pdf$/i, '');
  const parts: string[] = [`# ${baseName}\n`];

  for (const p of pages) {
    parts.push(`\n<!-- Page ${p.pageNum} -->\n`);
    for (const line of p.lines) {
      if (line.maxHeight >= 18) {
        parts.push(`## ${line.text}`);
      } else if (line.maxHeight >= 14) {
        parts.push(`### ${line.text}`);
      } else {
        parts.push(line.text);
      }
    }
  }

  return {
    blob: new Blob([parts.join('\n')], { type: 'text/markdown;charset=utf-8' }),
    filename: `${baseName}.md`,
  };
}

export async function pdfToWordResult(file: File): Promise<{ blob: Blob; filename: string }> {
  const pages = await extractStructuredLines(file);
  const baseName = file.name.replace(/\.pdf$/i, '');
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const body = pages
    .map((p) => {
      const paras = p.lines
        .map((l) =>
          l.maxHeight >= 16
            ? `<h2>${esc(l.text)}</h2>`
            : `<p>${esc(l.text)}</p>`
        )
        .join('\n');
      return `<section>${paras}</section><hr/>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(baseName)}</title></head><body>${body}</body></html>`;
  return {
    blob: new Blob([html], { type: 'application/msword;charset=utf-8' }),
    filename: `${baseName}.doc`,
  };
}

export async function pdfToExcelResult(file: File): Promise<{ blob: Blob; filename: string }> {
  const pages = await extractStructuredLines(file);
  const baseName = file.name.replace(/\.pdf$/i, '');
  const wb = XLSX.utils.book_new();

  for (const p of pages) {
    const rows = p.lines.map((l) => l.text.split(/\s{2,}|\t/).map((cell) => cell.trim()));
    const ws = XLSX.utils.aoa_to_sheet(rows.length > 0 ? rows : [['']]);
    XLSX.utils.book_append_sheet(wb, ws, `Page_${p.pageNum}`);
  }

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return {
    blob: new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename: `${baseName}.xlsx`,
  };
}

export async function imagesToPdfResult(files: File[]): Promise<{ blob: Blob; filename: string }> {
  if (files.length === 0) throw new Error('Pilih minimal 1 gambar.');
  const pdfDoc = await PDFDocument.create();

  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const lower = f.name.toLowerCase();
    let img;
    if (lower.endsWith('.png') || f.type === 'image/png') {
      img = await pdfDoc.embedPng(bytes);
    } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || f.type === 'image/jpeg') {
      img = await pdfDoc.embedJpg(bytes);
    } else {
      // Fallback: convert via canvas to PNG
      const url = URL.createObjectURL(f);
      const bmp = await new Promise<HTMLImageElement>((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => rej(new Error(`Gagal memuat gambar ${f.name}`));
        el.src = url;
      });
      URL.revokeObjectURL(url);
      const c = document.createElement('canvas');
      c.width = bmp.naturalWidth;
      c.height = bmp.naturalHeight;
      c.getContext('2d')?.drawImage(bmp, 0, 0);
      const pngBlob = await new Promise<Blob>((res, rej) =>
        c.toBlob((b) => (b ? res(b) : rej(new Error('Canvas encode failed'))), 'image/png')
      );
      img = await pdfDoc.embedPng(new Uint8Array(await pngBlob.arrayBuffer()));
    }

    const page = pdfDoc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  const baseName = files[0].name.replace(/\.[^.]+$/, '');
  return {
    blob: new Blob([outBytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }),
    filename: files.length > 1 ? `scanned_${files.length}_pages.pdf` : `${baseName}.pdf`,
  };
}

export interface PdfComparisonResult {
  pagesA: number;
  pagesB: number;
  previewA?: string;
  previewB?: string;
  addedLines: string[];
  removedLines: string[];
  identical: boolean;
}

export async function compareTwoPdfs(
  fileA: File,
  fileB: File,
  pageToPreview = 1
): Promise<PdfComparisonResult> {
  const [structA, structB] = await Promise.all([
    extractStructuredLines(fileA),
    extractStructuredLines(fileB),
  ]);

  const linesA = structA.flatMap((p) => p.lines.map((l) => l.text));
  const linesB = structB.flatMap((p) => p.lines.map((l) => l.text));
  const setA = new Set(linesA);
  const setB = new Set(linesB);

  const removedLines = linesA.filter((l) => !setB.has(l)).slice(0, 100);
  const addedLines = linesB.filter((l) => !setA.has(l)).slice(0, 100);

  const renderThumb = async (file: File, pageNum: number) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const clamped = Math.min(Math.max(1, pageNum), doc.numPages);
    const page = await doc.getPage(clamped);
    const vp = page.getViewport({ scale: 1.0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    }
    const url = canvas.toDataURL('image/png');
    await doc.cleanup().catch(() => {});
    return url;
  };

  const [previewA, previewB] = await Promise.all([
    renderThumb(fileA, pageToPreview),
    renderThumb(fileB, pageToPreview),
  ]);

  return {
    pagesA: structA.length,
    pagesB: structB.length,
    previewA,
    previewB,
    addedLines,
    removedLines,
    identical:
      structA.length === structB.length &&
      addedLines.length === 0 &&
      removedLines.length === 0,
  };
}
