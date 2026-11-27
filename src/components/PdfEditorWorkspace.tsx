import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Eraser,
  FilePlus2,
  Highlighter,
  ImagePlus,
  LayoutGrid,
  Link2,
  MousePointer,
  PenTool,
  Pencil,
  Redo2,
  RotateCcw,
  RotateCw,
  Scissors,
  Square,
  TextCursorInput,
  Trash2,
  Type,
  Underline,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type * as pdfjsLib from 'pdfjs-dist';
import type {
  PdfAnnotation,
  PdfAnnotationType,
  PdfFontFamily,
  PdfFormFieldItem,
  PdfImageBlockItem,
  PdfPageItem,
  PdfSourceDoc,
  PdfTextBlockItem,
} from '../types/workbench';
import {
  exportEditedPdf,
  extractPageImageBlocks,
  extractPageTextBlocks,
  extractPdfFormFields,
  loadPdfSourceAndThumbnails,
  parsePageRanges,
  type CompressionPreset,
  type PdfCropConfig,
  type PdfHeaderFooterConfig,
  type PdfPageNumberConfig,
  type PdfWatermarkConfig,
} from '../services/pdfEditorEngine';
import { formatBytes } from '../utils/format';
import { memoryManager, triggerBlobDownload } from '../utils/memoryManager';
import { SignaturePadModal } from './SignaturePadModal';
import { useI18n } from '../i18n/I18nContext';

interface PdfEditorWorkspaceProps {
  initialFile?: File | null;
  focusedTool?: string | null;
  onBackToTools?: () => void;
}

type ActiveTool = 'select' | 'edit-text' | PdfAnnotationType;

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;

function sampleTextAndBgColor(
  canvas: HTMLCanvasElement | null,
  nx: number,
  ny: number,
  nw: number,
  nh: number
): { textColor: string; bgColor: string } {
  if (!canvas) return { textColor: '#141413', bgColor: '#FFFFFF' };
  const ctx = canvas.getContext('2d');
  if (!ctx) return { textColor: '#141413', bgColor: '#FFFFFF' };
  try {
    const sx = Math.max(0, Math.floor(nx * canvas.width));
    const sy = Math.max(0, Math.floor(ny * canvas.height));
    const sw = Math.max(2, Math.min(canvas.width - sx, Math.floor(nw * canvas.width)));
    const sh = Math.max(2, Math.min(canvas.height - sy, Math.floor(nh * canvas.height)));
    const data = ctx.getImageData(sx, sy, sw, sh).data;

    // Sample top-left corner for background color
    const bgR = data[0];
    const bgG = data[1];
    const bgB = data[2];
    const bgColor = toHex(bgR, bgG, bgB);

    // Find pixel with maximum contrast from background for text color
    let bestDist = 0;
    let bestR = 20;
    let bestG = 20;
    let bestB = 19;
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - bgR;
      const dg = data[i + 1] - bgG;
      const db = data[i + 2] - bgB;
      const dist = dr * dr + dg * dg + db * db;
      if (dist > bestDist) {
        bestDist = dist;
        bestR = data[i];
        bestG = data[i + 1];
        bestB = data[i + 2];
      }
    }
    const textColor = bestDist > 900 ? toHex(bestR, bestG, bestB) : '#141413';
    return { textColor, bgColor };
  } catch {
    return { textColor: '#141413', bgColor: '#FFFFFF' };
  }
}

export const PdfEditorWorkspace: React.FC<PdfEditorWorkspaceProps> = ({
  initialFile,
  focusedTool,
  onBackToTools,
}) => {
  const { t } = useI18n();
  const openInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pageCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [sourceDocs, setSourceDocs] = useState<Map<string, PdfSourceDoc>>(new Map());
  const [pdfjsDocs, setPdfjsDocs] = useState<Map<string, pdfjsLib.PDFDocumentProxy>>(new Map());
  const [pages, setPages] = useState<PdfPageItem[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'annotate'>('grid');

  const [annotations, setAnnotationsState] = useState<PdfAnnotation[]>([]);
  const [annHistory, setAnnHistory] = useState<PdfAnnotation[][]>([[]]);
  const [annHistoryIdx, setAnnHistoryIdx] = useState(0);
  const [canvasScale, setCanvasScale] = useState(1);

  const setAnnotations: React.Dispatch<React.SetStateAction<PdfAnnotation[]>> = (updater) => {
    setAnnotationsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next !== prev) {
        setAnnHistory((h) => [...h.slice(0, annHistoryIdx + 1), next].slice(-50));
        setAnnHistoryIdx((idx) => Math.min(49, idx + 1));
      }
      return next;
    });
  };

  const canUndo = annHistoryIdx > 0;
  const canRedo = annHistoryIdx < annHistory.length - 1;

  const handleUndo = () => {
    if (!canUndo) return;
    const nextIdx = annHistoryIdx - 1;
    setAnnHistoryIdx(nextIdx);
    setAnnotationsState(annHistory[nextIdx]);
    setEditingAnnId(null);
  };

  const handleRedo = () => {
    if (!canRedo) return;
    const nextIdx = annHistoryIdx + 1;
    setAnnHistoryIdx(nextIdx);
    setAnnotationsState(annHistory[nextIdx]);
    setEditingAnnId(null);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (viewMode !== 'annotate') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, annHistoryIdx, annHistory]);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [textBlocks, setTextBlocks] = useState<PdfTextBlockItem[]>([]);
  const [imageBlocks, setImageBlocks] = useState<PdfImageBlockItem[]>([]);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [formFields, setFormFields] = useState<PdfFormFieldItem[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});

  const [textValue, setTextValue] = useState('Text');
  const [fontFamily, setFontFamily] = useState<PdfFontFamily>('Helvetica');
  const [fontSize, setFontSize] = useState(14);
  const [inkColor, setInkColor] = useState('#141413');
  const [redactionFill, setRedactionFill] = useState<'#000000' | '#FFFFFF'>('#000000');

  const [signatureOpen, setSignatureOpen] = useState(false);
  const [splitRange, setSplitRange] = useState('1');
  const [compression, setCompression] = useState<CompressionPreset>('none');
  const [watermark, setWatermark] = useState<PdfWatermarkConfig>({
    enabled: false,
    text: 'CONFIDENTIAL',
    opacity: 0.25,
    fontSize: 42,
    color: '#C83E2B',
    diagonal: true,
  });
  const [pageNumbers, setPageNumbers] = useState<PdfPageNumberConfig>({
    enabled: false,
    position: 'bottom-center',
    format: 'page-of-total',
    fontSize: 10,
  });
  const [crop, setCrop] = useState<PdfCropConfig>({
    enabled: false,
    scope: 'all',
    pageRange: '1',
    mode: 'uniform-size',
    topPt: 20,
    rightPt: 20,
    bottomPt: 20,
    leftPt: 20,
    targetPreset: 'a4-portrait',
    customWidthPt: 595,
    customHeightPt: 842,
  });
  const [headerFooter, setHeaderFooter] = useState<PdfHeaderFooterConfig>({
    enabled: false,
    headerText: '',
    footerText: '',
    fontSize: 9,
  });

  const [primaryName, setPrimaryName] = useState<string>('document.pdf');
  const [originalSize, setOriginalSize] = useState<number>(0);
  const [lastExportInfo, setLastExportInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [dragPageIdx, setDragPageIdx] = useState<number | null>(null);
  const [drawBox, setDrawBox] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);

  const draggingAnnRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const cropDragRef = useRef<'top' | 'right' | 'bottom' | 'left' | null>(null);

  const cleanupDocs = (docs: Map<string, pdfjsLib.PDFDocumentProxy>) => {
    for (const d of docs.values()) {
      d.cleanup().catch(() => {});
    }
  };

  useEffect(() => {
    return memoryManager.registerCleanupCallback(() => {
      cleanupDocs(pdfjsDocs);
      setSourceDocs(new Map());
      setPdfjsDocs(new Map());
      setPages([]);
      setAnnotations([]);
      setSelectedPageId(null);
      setSelectedAnnId(null);
      setOriginalSize(0);
      setLastExportInfo(null);
      setErrorMsg(null);
    });
  }, [pdfjsDocs]);

  const openPrimaryPdf = async (file: File) => {
    setBusy(true);
    setErrorMsg(null);
    setLastExportInfo(null);
    try {
      cleanupDocs(pdfjsDocs);
      const { sourceDoc, pages: loadedPages, pdfjsDoc } = await loadPdfSourceAndThumbnails(file);
      setSourceDocs(new Map([[sourceDoc.id, sourceDoc]]));
      setPdfjsDocs(new Map([[sourceDoc.id, pdfjsDoc]]));
      setPages(loadedPages);
      setAnnotationsState([]);
      setAnnHistory([[]]);
      setAnnHistoryIdx(0);
      setSelectedPageId(loadedPages[0]?.id ?? null);
      setSelectedAnnId(null);
      setPrimaryName(file.name);
      setOriginalSize(file.size);
      setSplitRange(loadedPages.length > 1 ? `1-${loadedPages.length}` : '1');
      const fields = await extractPdfFormFields(sourceDoc.bytes);
      setFormFields(fields);
      const initialVals: Record<string, string | boolean> = {};
      fields.forEach((f) => {
        initialVals[f.name] = f.value;
      });
      setFormValues(initialVals);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const mergeAnotherPdf = async (file: File) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const { sourceDoc, pages: extraPages, pdfjsDoc } = await loadPdfSourceAndThumbnails(file);
      setSourceDocs((prev) => new Map(prev).set(sourceDoc.id, sourceDoc));
      setPdfjsDocs((prev) => new Map(prev).set(sourceDoc.id, pdfjsDoc));
      setPages((prev) => {
        const next = [...prev, ...extraPages];
        if (!selectedPageId && next.length > 0) setSelectedPageId(next[0].id);
        return next;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const openMultiplePdfs = async (fileList: File[], replaceAll: boolean) => {
    const pdfs = fileList.filter(
      (f) => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf'
    );
    if (pdfs.length === 0) return;
    if (replaceAll) {
      await openPrimaryPdf(pdfs[0]);
      for (let i = 1; i < pdfs.length; i++) {
        await mergeAnotherPdf(pdfs[i]);
      }
    } else {
      for (const f of pdfs) {
        await mergeAnotherPdf(f);
      }
    }
  };

  useEffect(() => {
    if (initialFile) {
      void openPrimaryPdf(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  useEffect(() => {
    if (!focusedTool) return;
    if (focusedTool === 'sign') {
      setViewMode('annotate');
      setActiveTool('select');
    } else if (focusedTool === 'redact') {
      setViewMode('annotate');
      setActiveTool('redaction');
    } else if (focusedTool === 'edit') {
      setViewMode('annotate');
      setActiveTool('text');
    } else if (
      focusedTool === 'merge' ||
      focusedTool === 'split' ||
      focusedTool === 'remove-pages' ||
      focusedTool === 'extract-pages' ||
      focusedTool === 'organize' ||
      focusedTool === 'rotate'
    ) {
      setViewMode('grid');
    } else if (focusedTool === 'watermark') {
      setWatermark((w) => ({ ...w, enabled: true }));
    } else if (focusedTool === 'page-numbers') {
      setPageNumbers((p) => ({ ...p, enabled: true }));
    } else if (focusedTool === 'crop') {
      setViewMode('annotate');
      setCrop((c) => ({ ...c, enabled: true, mode: 'margins' }));
    } else if (focusedTool === 'compress') {
      setCompression('medium');
    }
  }, [focusedTool]);

  const activePage = pages.find((p) => p.id === selectedPageId) || pages[0] || null;
  const activePageIndex = activePage ? pages.findIndex((p) => p.id === activePage.id) : -1;

  useEffect(() => {
    let cancelled = false;
    const renderActive = async () => {
      if (viewMode !== 'annotate' || !activePage || !pageCanvasRef.current) return;
      const doc = pdfjsDocs.get(activePage.sourceDocId);
      if (!doc) return;
      try {
        const page = await doc.getPage(activePage.sourcePageIndex + 1);
        if (cancelled) return;
        const totalRot = (page.rotate + activePage.rotation) % 360;
        const baseVp = page.getViewport({ scale: 1, rotation: totalRot });
        const targetScale = Math.min(1.6, 760 / baseVp.width) * canvasZoom;
        if (!cancelled) setCanvasScale(targetScale);
        const vp = page.getViewport({ scale: targetScale, rotation: totalRot });
        const canvas = pageCanvasRef.current;
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
        const [blocks, imgs] = await Promise.all([
          extractPageTextBlocks(doc, activePage.sourcePageIndex, activePage.rotation),
          extractPageImageBlocks(doc, activePage.sourcePageIndex, activePage.rotation),
        ]);
        if (!cancelled) {
          setTextBlocks(blocks);
          setImageBlocks(imgs);
        }
      } catch {
        // ignore cancelled render
      }
    };
    void renderActive();
    return () => {
      cancelled = true;
    };
  }, [viewMode, activePage, pdfjsDocs, canvasZoom]);

  const movePage = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || toIdx < 0 || toIdx >= pages.length) return;
    setPages((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  const rotatePage = (pageId: string, delta: 90 | -90) => {
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId
          ? { ...p, rotation: (((p.rotation + delta) % 360) + 360) % 360 as 0 | 90 | 180 | 270 }
          : p
      )
    );
  };

  const deletePage = (pageId: string) => {
    if (pages.length <= 1) return;
    setPages((prev) => {
      const idx = prev.findIndex((p) => p.id === pageId);
      const next = prev.filter((p) => p.id !== pageId);
      if (selectedPageId === pageId) {
        setSelectedPageId(next[Math.min(idx, next.length - 1)]?.id ?? null);
      }
      return next;
    });
    setAnnotations((prev) => prev.filter((a) => a.pageId !== pageId));
  };

  const getNormalizedPoint = (clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activePage) return;
    const pt = getNormalizedPoint(e.clientX, e.clientY);

    if (activeTool === 'text') {
      const newAnn: PdfAnnotation = {
        id: crypto.randomUUID(),
        pageId: activePage.id,
        type: 'text',
        x: Math.min(0.85, pt.x),
        y: Math.min(0.9, pt.y),
        width: 0.25,
        height: 0.06,
        text: textValue || 'Text',
        fontFamily,
        fontSize,
        color: inkColor,
      };
      setAnnotations((prev) => [...prev, newAnn]);
      setSelectedAnnId(newAnn.id);
      setEditingAnnId(newAnn.id);
      setActiveTool('select');
      return;
    }

    if (activeTool === 'link') {
      const newAnn: PdfAnnotation = {
        id: crypto.randomUUID(),
        pageId: activePage.id,
        type: 'link',
        x: Math.min(0.85, pt.x),
        y: Math.min(0.9, pt.y),
        width: 0.22,
        height: 0.04,
        text: 'https://example.com',
        linkUrl: 'https://example.com',
        fontSize: 12,
      };
      setAnnotations((prev) => [...prev, newAnn]);
      setSelectedAnnId(newAnn.id);
      setActiveTool('select');
      return;
    }

    if (activeTool === 'draw') {
      setDrawPoints([pt]);
      return;
    }

    if (
      activeTool === 'highlight' ||
      activeTool === 'underline' ||
      activeTool === 'redaction' ||
      activeTool === 'rect'
    ) {
      setDrawBox({ startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y });
      return;
    }

    setEditingAnnId(null);
    setSelectedAnnId(null);
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = getNormalizedPoint(e.clientX, e.clientY);

    if (cropDragRef.current && activePage) {
      const isRot = activePage.rotation === 90 || activePage.rotation === 270;
      const pw = isRot ? activePage.height : activePage.width;
      const ph = isRot ? activePage.width : activePage.height;
      const edge = cropDragRef.current;
      setCrop((c) => {
        if (edge === 'top') {
          const maxTop = Math.max(0, ph - c.bottomPt - 50);
          return { ...c, topPt: Math.round(Math.min(maxTop, Math.max(0, pt.y * ph))) };
        }
        if (edge === 'bottom') {
          const maxBot = Math.max(0, ph - c.topPt - 50);
          return { ...c, bottomPt: Math.round(Math.min(maxBot, Math.max(0, (1 - pt.y) * ph))) };
        }
        if (edge === 'left') {
          const maxLeft = Math.max(0, pw - c.rightPt - 50);
          return { ...c, leftPt: Math.round(Math.min(maxLeft, Math.max(0, pt.x * pw))) };
        }
        const maxRight = Math.max(0, pw - c.leftPt - 50);
        return { ...c, rightPt: Math.round(Math.min(maxRight, Math.max(0, (1 - pt.x) * pw))) };
      });
      return;
    }

    if (drawPoints) {
      setDrawPoints((prev) => (prev ? [...prev, pt] : null));
      return;
    }

    if (draggingAnnRef.current) {
      const { id, offsetX, offsetY } = draggingAnnRef.current;
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                x: Math.min(1 - a.width, Math.max(0, pt.x - offsetX)),
                y: Math.min(1 - a.height, Math.max(0, pt.y - offsetY)),
              }
            : a
        )
      );
      return;
    }

    if (drawBox) {
      setDrawBox((prev) => (prev ? { ...prev, curX: pt.x, curY: pt.y } : null));
    }
  };

  const handleStagePointerUp = () => {
    draggingAnnRef.current = null;
    cropDragRef.current = null;
    if (drawPoints && activePage) {
      if (drawPoints.length > 1) {
        const xs = drawPoints.map((p) => p.x);
        const ys = drawPoints.map((p) => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const newAnn: PdfAnnotation = {
          id: crypto.randomUUID(),
          pageId: activePage.id,
          type: 'draw',
          x: minX,
          y: minY,
          width: Math.max(0.01, Math.max(...xs) - minX),
          height: Math.max(0.01, Math.max(...ys) - minY),
          points: drawPoints,
          color: inkColor,
          strokeWidth: 2.5,
        };
        setAnnotations((prev) => [...prev, newAnn]);
        setSelectedAnnId(newAnn.id);
      }
      setDrawPoints(null);
      return;
    }
    if (!drawBox || !activePage) return;

    const x = Math.min(drawBox.startX, drawBox.curX);
    const y = Math.min(drawBox.startY, drawBox.curY);
    const width = Math.max(0.03, Math.abs(drawBox.curX - drawBox.startX));
    const height = Math.max(0.02, Math.abs(drawBox.curY - drawBox.startY));

    if (
      activeTool === 'highlight' ||
      activeTool === 'underline' ||
      activeTool === 'redaction' ||
      activeTool === 'rect'
    ) {
      const newAnn: PdfAnnotation = {
        id: crypto.randomUUID(),
        pageId: activePage.id,
        type: activeTool,
        x,
        y,
        width,
        height: activeTool === 'underline' ? 0.025 : height,
        color:
          activeTool === 'highlight'
            ? '#FACC15'
            : activeTool === 'rect'
              ? inkColor
              : '#C83E2B',
        strokeWidth: activeTool === 'rect' ? 2 : undefined,
        redactionColor: activeTool === 'redaction' ? redactionFill : undefined,
      };
      setAnnotations((prev) => [...prev, newAnn]);
      setSelectedAnnId(newAnn.id);
    }
    setDrawBox(null);
  };

  const insertImageAnnotation = (dataUrl: string) => {
    if (!activePage) return;
    const newAnn: PdfAnnotation = {
      id: crypto.randomUUID(),
      pageId: activePage.id,
      type: 'image',
      x: 0.35,
      y: 0.72,
      width: 0.25,
      height: 0.1,
      imageDataUrl: dataUrl,
    };
    setAnnotations((prev) => [...prev, newAnn]);
    setSelectedAnnId(newAnn.id);
    setViewMode('annotate');
    setActiveTool('select');
  };

  const handleUploadImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        insertImageAnnotation(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleExport = async (onlySplitRange = false) => {
    if (pages.length === 0) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const rangeIndices = onlySplitRange ? parsePageRanges(splitRange, pages.length) : undefined;
      if (onlySplitRange && (!rangeIndices || rangeIndices.length === 0)) {
        setBusy(false);
        return;
      }

      const blob = await exportEditedPdf({
        sourceDocs,
        pdfjsDocs,
        pages,
        annotations,
        compression,
        selectedPageIndicesOneBased: rangeIndices,
        watermark,
        pageNumbers,
        crop,
        currentPageOneBased: activePageIndex >= 0 ? activePageIndex + 1 : 1,
        headerFooter,
        formValues,
      });

      const base = primaryName.replace(/\.pdf$/i, '');
      const suffix = onlySplitRange ? `_p_${splitRange.replace(/[^0-9,-]/g, '')}` : '_edited';
      const outName = `${base}${suffix}.pdf`;
      triggerBlobDownload(blob, outName);

      const savedPct =
        originalSize > 0
          ? Math.round(((originalSize - blob.size) / originalSize) * 100)
          : 0;
      setLastExportInfo(
        compression !== 'none' && savedPct > 0
          ? t('ed.exportedSavedInfo', { name: outName, size: formatBytes(blob.size), pct: savedPct })
          : t('ed.exportedInfo', { name: outName, size: formatBytes(blob.size) })
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const pageAnns = activePage ? annotations.filter((a) => a.pageId === activePage.id) : [];
  const selectedAnn = annotations.find((a) => a.id === selectedAnnId) || null;
  const redactionCount = annotations.filter((a) => a.type === 'redaction').length;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <input
        ref={openInputRef}
        type="file"
        multiple
        accept=".pdf,application/pdf"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void openMultiplePdfs(Array.from(e.target.files), true);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={mergeInputRef}
        type="file"
        multiple
        accept=".pdf,application/pdf"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void openMultiplePdfs(Array.from(e.target.files), false);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUploadImageFile(f);
          e.target.value = '';
        }}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-3">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
            {t('ed.eyebrow')}{focusedTool ? ` · ${focusedTool.toUpperCase()}` : ''}
          </span>
          <h2 className="break-words text-lg font-bold text-[var(--ink-primary)]">
            {pages.length > 0
              ? t('ed.pagesLabel', { name: primaryName, count: pages.length })
              : t('ed.defaultTitle')}
          </h2>
          {lastExportInfo && (
            <p className="font-mono text-xs text-[var(--accent-local)]">{lastExportInfo}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onBackToTools && (
            <button
              type="button"
              onClick={onBackToTools}
              className="inline-flex items-center gap-1.5 border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--bg-recessed)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{t('tools.backToAll')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => openInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--bg-recessed)]"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>{pages.length > 0 ? t('ed.openOther') : t('ed.openPdf')}</span>
          </button>

          {pages.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => mergeInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--border-strong)]"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                <span>{t('ed.mergePdf')}</span>
              </button>

              <div className="flex border border-[var(--border-strong)] bg-[var(--bg-surface)]">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${
                    viewMode === 'grid'
                      ? 'bg-[var(--ink-primary)] text-white'
                      : 'text-[var(--ink-primary)] hover:bg-[var(--bg-canvas)]'
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span>{t('ed.viewGrid')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('annotate')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${
                    viewMode === 'annotate'
                      ? 'bg-[var(--ink-primary)] text-white'
                      : 'text-[var(--ink-primary)] hover:bg-[var(--bg-canvas)]'
                  }`}
                >
                  <PenTool className="h-3.5 w-3.5" />
                  <span>{t('ed.viewAnnotate')}</span>
                </button>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleExport(false)}
                className="inline-flex items-center gap-1.5 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--accent-signal-hover)] disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{busy ? t('ed.saving') : t('ed.savePdf')}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 border border-[#8A2C1D] bg-[#FDF2F0] px-3.5 py-2.5 text-xs text-[#681D11]"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {pages.length === 0 ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
              void openMultiplePdfs(Array.from(e.dataTransfer.files), true);
            }
          }}
          className="workbench-grid flex flex-col items-center justify-center border border-dashed border-[var(--ink-primary)] bg-[var(--bg-surface)] px-6 py-16 text-center"
        >
          <p className="text-sm font-bold text-[var(--ink-primary)]">{t('ed.emptyTitle')}</p>
          <p className="mt-1 text-xs text-[var(--ink-secondary)]">{t('ed.emptyDesc')}</p>
          <button
            type="button"
            onClick={() => openInputRef.current?.click()}
            className="mt-4 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--accent-signal-hover)]"
          >
            {t('ed.pickPdfBtn')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-9">
            {viewMode === 'grid' ? (
              <div className="border border-[var(--border-hairline)] bg-[var(--bg-mat)] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-secondary)]">
                  <span>{t('ed.gridHint')}</span>
                  <span className="font-mono text-[11px] tabular-nums">
                    {formatBytes(originalSize)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {pages.map((page, index) => {
                    const isSelected = activePage?.id === page.id;
                    const pageAnnCount = annotations.filter((a) => a.pageId === page.id).length;
                    return (
                      <div
                        key={page.id}
                        draggable
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            movePage(index, index - 1);
                          } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                            e.preventDefault();
                            movePage(index, index + 1);
                          } else if (e.key === 'Enter') {
                            setSelectedPageId(page.id);
                            setViewMode('annotate');
                          } else if (e.key === 'Delete') {
                            deletePage(page.id);
                          }
                        }}
                        onDragStart={() => setDragPageIdx(index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragPageIdx !== null) {
                            movePage(dragPageIdx, index);
                            setDragPageIdx(null);
                          }
                        }}
                        onClick={() => setSelectedPageId(page.id)}
                        className={`group cursor-grab border bg-white p-2 transition-colors active:cursor-grabbing ${
                          isSelected
                            ? 'border-[var(--accent-signal)] ring-1 ring-[var(--accent-signal)]'
                            : 'border-[var(--border-hairline)] hover:border-[var(--border-strong)]'
                        }`}
                      >
                        <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden border border-[var(--border-hairline)] bg-[var(--bg-canvas)]">
                          {page.thumbnailUrl && (
                            <img
                              src={page.thumbnailUrl}
                              alt={`${index + 1}`}
                              className="max-h-full max-w-full object-contain transition-transform"
                              style={{ transform: `rotate(${page.rotation}deg)` }}
                            />
                          )}
                          <span className="absolute top-1 left-1 border border-[var(--border-hairline)] bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums">
                            {index + 1}
                          </span>
                          {pageAnnCount > 0 && (
                            <span className="absolute top-1 right-1 bg-[var(--accent-signal)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                              {pageAnnCount}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-1">
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                movePage(index, index - 1);
                              }}
                              disabled={index === 0}
                              className="border border-[var(--border-hairline)] p-1 hover:bg-[var(--bg-canvas)] disabled:opacity-30"
                            >
                              <ArrowLeft className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                movePage(index, index + 1);
                              }}
                              disabled={index === pages.length - 1}
                              className="border border-[var(--border-hairline)] p-1 hover:bg-[var(--bg-canvas)] disabled:opacity-30"
                            >
                              <ArrowRight className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                rotatePage(page.id, -90);
                              }}
                              className="border border-[var(--border-hairline)] p-1 hover:bg-[var(--bg-canvas)]"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                rotatePage(page.id, 90);
                              }}
                              className="border border-[var(--border-hairline)] p-1 hover:bg-[var(--bg-canvas)]"
                            >
                              <RotateCw className="h-3 w-3" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPageId(page.id);
                                setViewMode('annotate');
                              }}
                              className="border border-[var(--border-hairline)] px-1.5 py-0.5 font-mono text-[10px] font-semibold hover:border-[var(--border-strong)]"
                            >
                              {t('ed.editBtn')}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deletePage(page.id);
                              }}
                              className="border border-[var(--border-hairline)] p-1 text-[var(--ink-muted)] hover:border-[#8A2C1D] hover:text-[#8A2C1D]"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        { id: 'select', label: t('ed.toolSelect'), icon: MousePointer },
                        { id: 'edit-text', label: 'Edit Objek (Teks & Gambar)', icon: TextCursorInput },
                        { id: 'text', label: t('ed.toolText'), icon: Type },
                        { id: 'link', label: 'Link', icon: Link2 },
                        { id: 'draw', label: 'Gambar Bebas', icon: Pencil },
                        { id: 'rect', label: 'Kotak', icon: Square },
                        { id: 'highlight', label: t('ed.toolHighlight'), icon: Highlighter },
                        { id: 'underline', label: t('ed.toolUnderline'), icon: Underline },
                        { id: 'redaction', label: t('ed.toolRedaction'), icon: Eraser },
                      ] as const
                    ).map((tool) => {
                      const Icon = tool.icon;
                      const active = activeTool === tool.id;
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => setActiveTool(tool.id)}
                          className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium ${
                            active
                              ? 'border-[var(--border-strong)] bg-[var(--ink-primary)] text-white'
                              : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--ink-primary)] hover:bg-[var(--bg-recessed)]'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{tool.label}</span>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => {
                        if (!activePage) return;
                        const ann: PdfAnnotation = {
                          id: crypto.randomUUID(),
                          pageId: activePage.id,
                          type: 'text',
                          x: 0.45,
                          y: 0.45,
                          width: 0.06,
                          height: 0.05,
                          text: '✓',
                          fontSize: 20,
                          color: '#1F6E43',
                        };
                        setAnnotations((p) => [...p, ann]);
                        setSelectedAnnId(ann.id);
                        setActiveTool('select');
                      }}
                      title="Tempel Centang (Fill & Sign)"
                      className="inline-flex items-center gap-1 border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 py-1 text-xs font-bold text-[#1F6E43] hover:bg-[var(--bg-recessed)]"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!activePage) return;
                        const ann: PdfAnnotation = {
                          id: crypto.randomUUID(),
                          pageId: activePage.id,
                          type: 'text',
                          x: 0.45,
                          y: 0.45,
                          width: 0.06,
                          height: 0.05,
                          text: '✗',
                          fontSize: 20,
                          color: '#C83E2B',
                        };
                        setAnnotations((p) => [...p, ann]);
                        setSelectedAnnId(ann.id);
                        setActiveTool('select');
                      }}
                      title="Tempel Silang (Fill & Sign)"
                      className="inline-flex items-center gap-1 border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 py-1 text-xs font-bold text-[#C83E2B] hover:bg-[var(--bg-recessed)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setSignatureOpen(true)}
                      className="inline-flex items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--bg-recessed)]"
                    >
                      <PenTool className="h-3.5 w-3.5" />
                      <span>{t('ed.toolSignature')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--bg-recessed)]"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      <span>{t('ed.toolImage')}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <button
                      type="button"
                      disabled={!canUndo}
                      onClick={handleUndo}
                      title="Undo (Ctrl+Z)"
                      className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1 hover:bg-[var(--bg-recessed)] disabled:opacity-35"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={!canRedo}
                      onClick={handleRedo}
                      title="Redo (Ctrl+Y)"
                      className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1 hover:bg-[var(--bg-recessed)] disabled:opacity-35"
                    >
                      <Redo2 className="h-3.5 w-3.5" />
                    </button>
                    <span className="mx-0.5 text-[var(--border-hairline)]">|</span>
                    <button
                      type="button"
                      onClick={() => setCanvasZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
                      className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1 hover:bg-[var(--bg-recessed)]"
                      title="Zoom Out"
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <span className="tabular-nums text-[11px]">{Math.round(canvasZoom * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => setCanvasZoom((z) => Math.min(2.0, Number((z + 0.25).toFixed(2))))}
                      className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1 hover:bg-[var(--bg-recessed)]"
                      title="Zoom In"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    <span className="mx-1 text-[var(--border-hairline)]">|</span>
                    <button
                      type="button"
                      disabled={activePageIndex <= 0}
                      onClick={() =>
                        activePageIndex > 0 && setSelectedPageId(pages[activePageIndex - 1].id)
                      }
                      className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1 disabled:opacity-40"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="tabular-nums">
                      {t('ed.pageShort', { cur: activePageIndex + 1, total: pages.length })}
                    </span>
                    <button
                      type="button"
                      disabled={activePageIndex >= pages.length - 1}
                      onClick={() =>
                        activePageIndex < pages.length - 1 &&
                        setSelectedPageId(pages[activePageIndex + 1].id)
                      }
                      className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1 disabled:opacity-40"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex max-h-[72vh] items-start justify-center overflow-auto bg-[var(--bg-mat)] p-6">
                  <div
                    ref={stageRef}
                    onPointerDown={handleStagePointerDown}
                    onPointerMove={handleStagePointerMove}
                    onPointerUp={handleStagePointerUp}
                    className={`relative inline-block shrink-0 self-start select-none border border-[var(--border-hairline)] bg-white ${
                      activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair'
                    }`}
                  >
                    <canvas ref={pageCanvasRef} className="block max-w-full" />

                    {/* Live whiteout/background masks at original positions of moved/edited PDF objects */}
                    {pageAnns
                      .filter((a) => a.whiteoutBg && a.origX !== undefined && a.origY !== undefined)
                      .map((a) => (
                        <div
                          key={`mask-${a.id}`}
                          className="pointer-events-none absolute"
                          style={{
                            backgroundColor: a.maskColor || '#FFFFFF',
                            left: `${(a.origX ?? a.x) * 100}%`,
                            top: `${(a.origY ?? a.y) * 100}%`,
                            width: `${(a.origWidth ?? a.width) * 100}%`,
                            height: `${(a.origHeight ?? a.height) * 100}%`,
                          }}
                        />
                      ))}

                    {/* Acrobat-style clickable existing text blocks */}
                    {activeTool === 'edit-text' &&
                      activePage &&
                      textBlocks.map((blk) => (
                        <button
                          key={blk.id}
                          type="button"
                          title={`Edit: ${blk.text}`}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            const { textColor, bgColor } = sampleTextAndBgColor(
                              pageCanvasRef.current,
                              blk.x,
                              blk.y,
                              blk.width,
                              blk.height
                            );
                            const tightH = Math.max(0.012, blk.height * 0.88);
                            const newAnn: PdfAnnotation = {
                              id: crypto.randomUUID(),
                              pageId: activePage.id,
                              type: 'text',
                              x: blk.x,
                              y: blk.y,
                              width: Math.max(0.06, blk.width),
                              height: tightH,
                              text: blk.text,
                              fontSize: blk.fontSize,
                              fontFamily: 'Helvetica',
                              color: textColor,
                              whiteoutBg: true,
                              maskColor: bgColor,
                              origX: blk.x,
                              origY: blk.y,
                              origWidth: blk.width,
                              origHeight: tightH,
                            };
                            setAnnotations((prev) => [...prev, newAnn]);
                            setSelectedAnnId(newAnn.id);
                            setEditingAnnId(newAnn.id);
                            setActiveTool('select');
                          }}
                          style={{
                            left: `${blk.x * 100}%`,
                            top: `${blk.y * 100}%`,
                            width: `${blk.width * 100}%`,
                            height: `${blk.height * 100}%`,
                          }}
                          className="absolute border border-dashed border-[#1E4E79]/60 bg-[#1E4E79]/5 hover:border-[#C83E2B] hover:bg-[#C83E2B]/10"
                        />
                      ))}

                    {/* Acrobat-style clickable existing image objects */}
                    {activeTool === 'edit-text' &&
                      activePage &&
                      imageBlocks.map((imgBlk) => (
                        <button
                          key={imgBlk.id}
                          type="button"
                          title="Klik untuk edit / geser / hapus gambar ini"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            const canvas = pageCanvasRef.current;
                            if (!canvas) return;
                            const sx = Math.floor(imgBlk.x * canvas.width);
                            const sy = Math.floor(imgBlk.y * canvas.height);
                            const sw = Math.max(4, Math.floor(imgBlk.width * canvas.width));
                            const sh = Math.max(4, Math.floor(imgBlk.height * canvas.height));
                            const tmp = document.createElement('canvas');
                            tmp.width = sw;
                            tmp.height = sh;
                            tmp.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
                            const dataUrl = tmp.toDataURL('image/png');
                            const newAnn: PdfAnnotation = {
                              id: crypto.randomUUID(),
                              pageId: activePage.id,
                              type: 'image',
                              x: imgBlk.x,
                              y: imgBlk.y,
                              width: imgBlk.width,
                              height: imgBlk.height,
                              imageDataUrl: dataUrl,
                              whiteoutBg: true,
                              origX: imgBlk.x,
                              origY: imgBlk.y,
                              origWidth: imgBlk.width,
                              origHeight: imgBlk.height,
                            };
                            setAnnotations((prev) => [...prev, newAnn]);
                            setSelectedAnnId(newAnn.id);
                            setActiveTool('select');
                          }}
                          style={{
                            left: `${imgBlk.x * 100}%`,
                            top: `${imgBlk.y * 100}%`,
                            width: `${imgBlk.width * 100}%`,
                            height: `${imgBlk.height * 100}%`,
                          }}
                          className="absolute border-2 border-dashed border-[#1F6E43]/70 bg-[#1F6E43]/5 hover:border-[#C83E2B] hover:bg-[#C83E2B]/10"
                        />
                      ))}

                    {/* Freehand SVG live + saved strokes */}
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    >
                      {pageAnns
                        .filter((a) => a.type === 'draw' && a.points && a.points.length > 1)
                        .map((a) => (
                          <polyline
                            key={a.id}
                            fill="none"
                            stroke={a.color || '#141413'}
                            strokeWidth="0.45"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={a.points!.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                          />
                        ))}
                      {drawPoints && drawPoints.length > 1 && (
                        <polyline
                          fill="none"
                          stroke={inkColor || '#141413'}
                          strokeWidth="0.45"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={drawPoints.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                        />
                      )}
                    </svg>

                    {pageAnns.map((ann) => {
                      const isSel = selectedAnnId === ann.id;
                      const isEditing = editingAnnId === ann.id;
                      return (
                        <div
                          key={ann.id}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (ann.type === 'text') setEditingAnnId(ann.id);
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setSelectedAnnId(ann.id);
                            if (activeTool === 'select' && !isEditing) {
                              const pt = getNormalizedPoint(e.clientX, e.clientY);
                              draggingAnnRef.current = {
                                id: ann.id,
                                offsetX: pt.x - ann.x,
                                offsetY: pt.y - ann.y,
                              };
                            }
                          }}
                          style={{
                            left: `${ann.x * 100}%`,
                            top: `${ann.y * 100}%`,
                            width: ann.type === 'text' ? 'max-content' : `${ann.width * 100}%`,
                            minWidth: ann.type === 'text' ? `${ann.width * 100}%` : undefined,
                            maxWidth: ann.type === 'text' ? '92%' : undefined,
                            height: ann.type === 'text' ? 'auto' : `${ann.height * 100}%`,
                          }}
                          className={`absolute ${
                            isSel ? 'ring-2 ring-[var(--accent-signal)]' : ''
                          } ${activeTool === 'select' ? 'cursor-move' : ''}`}
                        >
                          {ann.type === 'highlight' && (
                            <div
                              className="h-full w-full"
                              style={{ backgroundColor: ann.color || '#FACC15', opacity: 0.35 }}
                            />
                          )}
                          {ann.type === 'underline' && (
                            <div
                              className="h-full w-full border-b-2"
                              style={{ borderColor: ann.color || '#C83E2B' }}
                            />
                          )}
                          {ann.type === 'rect' && (
                            <div
                              className="h-full w-full border-2"
                              style={{ borderColor: ann.color || '#C83E2B' }}
                            />
                          )}
                          {ann.type === 'redaction' && (
                            <div
                              className="h-full w-full border border-[#8A2C1D]"
                              style={{ backgroundColor: ann.redactionColor || '#000000' }}
                            />
                          )}
                          {ann.type === 'image' && ann.imageDataUrl && (
                            <img
                              src={ann.imageDataUrl}
                              alt="Annotation"
                              draggable={false}
                              className="h-full w-full object-contain"
                            />
                          )}
                          {ann.type === 'link' && (
                            <div className="truncate font-mono text-xs text-[#1E4E79] underline">
                              {ann.text || ann.linkUrl}
                            </div>
                          )}
                          {ann.type === 'text' &&
                            (isEditing ? (
                              <textarea
                                autoFocus
                                rows={Math.max(1, (ann.text || '').split('\n').length)}
                                value={ann.text || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setAnnotations((prev) =>
                                    prev.map((a) => (a.id === ann.id ? { ...a, text: val } : a))
                                  );
                                }}
                                onBlur={() => setEditingAnnId(null)}
                                className="w-full resize bg-transparent px-0.5 leading-tight outline-none"
                                style={{
                                  color: ann.color || '#141413',
                                  fontSize: `${(ann.fontSize || 14) * canvasScale}px`,
                                  fontFamily:
                                    ann.fontFamily === 'TimesRoman'
                                      ? 'serif'
                                      : ann.fontFamily === 'Courier'
                                      ? 'monospace'
                                      : 'sans-serif',
                                }}
                              />
                            ) : (
                              <div
                                className="whitespace-pre-wrap px-0.5 leading-tight"
                                style={{
                                  color: ann.color || '#141413',
                                  fontSize: `${(ann.fontSize || 14) * canvasScale}px`,
                                  fontFamily:
                                    ann.fontFamily === 'TimesRoman'
                                      ? 'serif'
                                      : ann.fontFamily === 'Courier'
                                      ? 'monospace'
                                      : 'sans-serif',
                                }}
                              >
                                {ann.text}
                              </div>
                            ))}
                        </div>
                      );
                    })}

                    {drawBox && (
                      <div
                        className="pointer-events-none absolute border border-dashed border-[var(--accent-signal)] bg-[#C83E2B]/15"
                        style={{
                          left: `${Math.min(drawBox.startX, drawBox.curX) * 100}%`,
                          top: `${Math.min(drawBox.startY, drawBox.curY) * 100}%`,
                          width: `${Math.abs(drawBox.curX - drawBox.startX) * 100}%`,
                          height: `${Math.abs(drawBox.curY - drawBox.startY) * 100}%`,
                        }}
                      />
                    )}

                    {/* Interactive Draggable Crop Frame */}
                    {crop.enabled && crop.mode === 'margins' && activePage && (() => {
                      const isRot = activePage.rotation === 90 || activePage.rotation === 270;
                      const pw = isRot ? activePage.height : activePage.width;
                      const ph = isRot ? activePage.width : activePage.height;
                      const lPct = Math.min(90, Math.max(0, (crop.leftPt / pw) * 100));
                      const rPct = Math.min(90, Math.max(0, (crop.rightPt / pw) * 100));
                      const tPct = Math.min(90, Math.max(0, (crop.topPt / ph) * 100));
                      const bPct = Math.min(90, Math.max(0, (crop.bottomPt / ph) * 100));
                      const wPct = Math.max(5, 100 - lPct - rPct);
                      const hPct = Math.max(5, 100 - tPct - bPct);

                      return (
                        <>
                          <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/30" style={{ height: `${tPct}%` }} />
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/30" style={{ height: `${bPct}%` }} />
                          <div className="pointer-events-none absolute left-0 bg-black/30" style={{ top: `${tPct}%`, height: `${hPct}%`, width: `${lPct}%` }} />
                          <div className="pointer-events-none absolute right-0 bg-black/30" style={{ top: `${tPct}%`, height: `${hPct}%`, width: `${rPct}%` }} />
                          <div
                            className="pointer-events-none absolute border-2 border-dashed border-[var(--accent-signal)]"
                            style={{ left: `${lPct}%`, top: `${tPct}%`, width: `${wPct}%`, height: `${hPct}%` }}
                          >
                            <div
                              onPointerDown={(e) => { e.stopPropagation(); cropDragRef.current = 'top'; }}
                              title="Geser batas atas crop"
                              className="pointer-events-auto absolute -top-1.5 left-1/2 h-3 w-10 -translate-x-1/2 cursor-ns-resize border border-white bg-[var(--accent-signal)]"
                            />
                            <div
                              onPointerDown={(e) => { e.stopPropagation(); cropDragRef.current = 'bottom'; }}
                              title="Geser batas bawah crop"
                              className="pointer-events-auto absolute -bottom-1.5 left-1/2 h-3 w-10 -translate-x-1/2 cursor-ns-resize border border-white bg-[var(--accent-signal)]"
                            />
                            <div
                              onPointerDown={(e) => { e.stopPropagation(); cropDragRef.current = 'left'; }}
                              title="Geser batas kiri crop"
                              className="pointer-events-auto absolute top-1/2 -left-1.5 h-10 w-3 -translate-y-1/2 cursor-ew-resize border border-white bg-[var(--accent-signal)]"
                            />
                            <div
                              onPointerDown={(e) => { e.stopPropagation(); cropDragRef.current = 'right'; }}
                              title="Geser batas kanan crop"
                              className="pointer-events-auto absolute top-1/2 -right-1.5 h-10 w-3 -translate-y-1/2 cursor-ew-resize border border-white bg-[var(--accent-signal)]"
                            />
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 lg:col-span-3">
            <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
              <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                {t('ed.propsHeader')}
              </div>

              <div className="space-y-3 p-3.5 text-xs">
                {(activeTool === 'text' || selectedAnn?.type === 'text') && (
                  <div className="space-y-2.5 border-b border-[var(--border-hairline)] pb-3">
                    <label className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                      {t('ed.textContent')}
                      <textarea
                        rows={2}
                        value={selectedAnn?.type === 'text' ? selectedAnn.text || '' : textValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (selectedAnn?.type === 'text') {
                            setAnnotations((prev) =>
                              prev.map((a) => (a.id === selectedAnn.id ? { ...a, text: val } : a))
                            );
                          } else {
                            setTextValue(val);
                          }
                        }}
                        className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-2 text-xs"
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                        {t('ed.fontLabel')}
                        <select
                          value={
                            selectedAnn?.type === 'text'
                              ? selectedAnn.fontFamily || 'Helvetica'
                              : fontFamily
                          }
                          onChange={(e) => {
                            const f = e.target.value as PdfFontFamily;
                            if (selectedAnn?.type === 'text') {
                              setAnnotations((prev) =>
                                prev.map((a) =>
                                  a.id === selectedAnn.id ? { ...a, fontFamily: f } : a
                                )
                              );
                            } else {
                              setFontFamily(f);
                            }
                          }}
                          className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-1 text-xs"
                        >
                          <option value="Helvetica">Helvetica</option>
                          <option value="TimesRoman">Times Roman</option>
                          <option value="Courier">Courier</option>
                        </select>
                      </label>

                      <label className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                        {t('ed.fontSizeLabel')}
                        <input
                          type="number"
                          min={8}
                          max={72}
                          value={
                            selectedAnn?.type === 'text'
                              ? selectedAnn.fontSize || 14
                              : fontSize
                          }
                          onChange={(e) => {
                            const sz = Math.max(8, Math.min(72, Number(e.target.value) || 14));
                            if (selectedAnn?.type === 'text') {
                              setAnnotations((prev) =>
                                prev.map((a) =>
                                  a.id === selectedAnn.id ? { ...a, fontSize: sz } : a
                                )
                              );
                            } else {
                              setFontSize(sz);
                            }
                          }}
                          className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1 font-mono text-xs"
                        />
                      </label>
                    </div>

                    <label className="flex items-center justify-between font-mono text-[11px] text-[var(--ink-secondary)]">
                      <span>{t('ed.textColorLabel')}</span>
                      <input
                        type="color"
                        value={
                          selectedAnn?.type === 'text' ? selectedAnn.color || '#141413' : inkColor
                        }
                        onChange={(e) => {
                          const col = e.target.value;
                          if (selectedAnn?.type === 'text') {
                            setAnnotations((prev) =>
                              prev.map((a) => (a.id === selectedAnn.id ? { ...a, color: col } : a))
                            );
                          } else {
                            setInkColor(col);
                          }
                        }}
                        className="h-6 w-10 border border-[var(--border-hairline)]"
                      />
                    </label>
                  </div>
                )}

                {activeTool === 'redaction' && (
                  <div className="space-y-2 border-b border-[var(--border-hairline)] pb-3">
                    <p className="font-mono text-[11px] font-bold text-[#8A2C1D]">
                      {t('ed.redactionTitle')}
                    </p>
                    <p className="text-[11px] leading-relaxed text-[var(--ink-secondary)]">
                      {t('ed.redactionDesc')}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setRedactionFill('#000000')}
                        className={`flex-1 border py-1 font-mono text-[11px] ${
                          redactionFill === '#000000'
                            ? 'border-[var(--ink-primary)] bg-black text-white'
                            : 'border-[var(--border-hairline)]'
                        }`}
                      >
                        {t('ed.redactBlack')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRedactionFill('#FFFFFF')}
                        className={`flex-1 border py-1 font-mono text-[11px] ${
                          redactionFill === '#FFFFFF'
                            ? 'border-[var(--ink-primary)] bg-white font-bold'
                            : 'border-[var(--border-hairline)]'
                        }`}
                      >
                        {t('ed.redactWhite')}
                      </button>
                    </div>
                  </div>
                )}

                {selectedAnn && (
                  <div className="space-y-2 border-b border-[var(--border-hairline)] pb-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-bold uppercase">
                        {t('ed.selectedItem', { type: selectedAnn.type })}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAnnotations((prev) => prev.filter((a) => a.id !== selectedAnn.id));
                          setSelectedAnnId(null);
                        }}
                        className="inline-flex items-center gap-1 border border-[#8A2C1D] px-2 py-0.5 font-mono text-[11px] text-[#8A2C1D] hover:bg-[#FDF2F0]"
                      >
                        <Trash2 className="h-3 w-3" /> {t('ed.delete')}
                      </button>
                    </div>
                    {selectedAnn.type === 'image' && (
                      <div>
                        <label className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                          {t('ed.imgWidthPct', { pct: Math.round(selectedAnn.width * 100) })}
                        </label>
                        <input
                          type="range"
                          min={5}
                          max={80}
                          value={Math.round(selectedAnn.width * 100)}
                          onChange={(e) => {
                            const ratio = Number(e.target.value) / 100;
                            const aspect = selectedAnn.height / selectedAnn.width || 0.4;
                            setAnnotations((prev) =>
                              prev.map((a) =>
                                a.id === selectedAnn.id
                                  ? { ...a, width: ratio, height: ratio * aspect }
                                  : a
                              )
                            );
                          }}
                          className="mt-1 w-full accent-[var(--accent-signal)]"
                        />
                      </div>
                    )}
                  </div>
                )}

                {redactionCount > 0 && (
                  <p className="border-l-2 border-[#8A2C1D] pl-2.5 text-[11px] text-[#681D11]">
                    {t('ed.redactionCountNote', { count: redactionCount })}
                  </p>
                )}

                {!selectedAnn && activeTool === 'select' && (
                  <p className="text-[11px] text-[var(--ink-muted)]">{t('ed.propsHint')}</p>
                )}
              </div>
            </div>

            {formFields.length > 0 && (
              <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
                <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                  PDF Forms ({formFields.length})
                </div>
                <div className="max-h-56 space-y-2.5 overflow-y-auto p-3.5 text-xs">
                  {formFields.map((field) => (
                    <div key={field.name}>
                      {field.type === 'checkbox' ? (
                        <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px]">
                          <input
                            type="checkbox"
                            checked={Boolean(formValues[field.name])}
                            onChange={(e) =>
                              setFormValues((prev) => ({ ...prev, [field.name]: e.target.checked }))
                            }
                            className="h-3.5 w-3.5 accent-[var(--accent-signal)]"
                          />
                          <span className="truncate">{field.name}</span>
                        </label>
                      ) : (
                        <label className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                          <span className="block truncate">{field.name}</span>
                          <input
                            type="text"
                            value={String(formValues[field.name] ?? '')}
                            onChange={(e) =>
                              setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                            }
                            className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1 text-xs text-[var(--ink-primary)]"
                          />
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
              <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                {t('ed.compressSplitHeader')}
              </div>

              <div className="space-y-4 p-3.5 text-xs">
                <div>
                  <label
                    htmlFor="pdf-compress"
                    className="block font-mono text-[11px] text-[var(--ink-secondary)]"
                  >
                    {t('ed.compressLevel')}
                  </label>
                  <select
                    id="pdf-compress"
                    value={compression}
                    onChange={(e) => setCompression(e.target.value as CompressionPreset)}
                    className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                  >
                    <option value="none">{t('ed.compNone')}</option>
                    <option value="low">{t('ed.compLow')}</option>
                    <option value="medium">{t('ed.compMed')}</option>
                    <option value="high">{t('ed.compHigh')}</option>
                  </select>
                </div>

                <div className="border-t border-[var(--border-hairline)] pt-3">
                  <label
                    htmlFor="pdf-split"
                    className="block font-mono text-[11px] text-[var(--ink-secondary)]"
                  >
                    {t('ed.splitLabel')}
                  </label>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      id="pdf-split"
                      type="text"
                      value={splitRange}
                      onChange={(e) => setSplitRange(e.target.value)}
                      placeholder={t('ed.splitPlaceholder')}
                      className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleExport(true)}
                      className="inline-flex shrink-0 items-center gap-1 border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 font-mono text-[11px] font-semibold hover:bg-[var(--bg-recessed)] disabled:opacity-45"
                    >
                      <Scissors className="h-3.5 w-3.5" />
                      <span>{t('ed.splitBtn')}</span>
                    </button>
                  </div>
                </div>

                {/* Header & Footer */}
                <div className="border-t border-[var(--border-hairline)] pt-3">
                  <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] font-semibold text-[var(--ink-primary)]">
                    <input
                      type="checkbox"
                      checked={headerFooter.enabled}
                      onChange={(e) =>
                        setHeaderFooter((hf) => ({ ...hf, enabled: e.target.checked }))
                      }
                      className="h-3.5 w-3.5 accent-[var(--accent-signal)]"
                    />
                    <span>Header &amp; Footer</span>
                  </label>
                  {headerFooter.enabled && (
                    <div className="mt-2 space-y-1.5">
                      <input
                        type="text"
                        value={headerFooter.headerText}
                        onChange={(e) =>
                          setHeaderFooter((hf) => ({ ...hf, headerText: e.target.value }))
                        }
                        placeholder="Header teks..."
                        className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1 font-mono text-xs"
                      />
                      <input
                        type="text"
                        value={headerFooter.footerText}
                        onChange={(e) =>
                          setHeaderFooter((hf) => ({ ...hf, footerText: e.target.value }))
                        }
                        placeholder="Footer teks..."
                        className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1 font-mono text-xs"
                      />
                    </div>
                  )}
                </div>

                {/* Watermark */}
                <div className="border-t border-[var(--border-hairline)] pt-3">
                  <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] font-semibold text-[var(--ink-primary)]">
                    <input
                      type="checkbox"
                      checked={watermark.enabled}
                      onChange={(e) => setWatermark((w) => ({ ...w, enabled: e.target.checked }))}
                      className="h-3.5 w-3.5 accent-[var(--accent-signal)]"
                    />
                    <span>{t('ed.watermarkToggle')}</span>
                  </label>
                  {watermark.enabled && (
                    <div className="mt-2 space-y-2">
                      <input
                        type="text"
                        value={watermark.text}
                        onChange={(e) => setWatermark((w) => ({ ...w, text: e.target.value }))}
                        placeholder="CONFIDENTIAL"
                        className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1 font-mono text-xs"
                      />
                      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={watermark.diagonal}
                            onChange={(e) =>
                              setWatermark((w) => ({ ...w, diagonal: e.target.checked }))
                            }
                            className="h-3 w-3 accent-[var(--accent-signal)]"
                          />
                          <span>{t('ed.watermarkDiagonal')}</span>
                        </label>
                        <span>{Math.round(watermark.opacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={0.8}
                        step={0.05}
                        value={watermark.opacity}
                        onChange={(e) =>
                          setWatermark((w) => ({ ...w, opacity: Number(e.target.value) }))
                        }
                        className="w-full accent-[var(--accent-signal)]"
                      />
                    </div>
                  )}
                </div>

                {/* Page Numbers */}
                <div className="border-t border-[var(--border-hairline)] pt-3">
                  <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] font-semibold text-[var(--ink-primary)]">
                    <input
                      type="checkbox"
                      checked={pageNumbers.enabled}
                      onChange={(e) => setPageNumbers((p) => ({ ...p, enabled: e.target.checked }))}
                      className="h-3.5 w-3.5 accent-[var(--accent-signal)]"
                    />
                    <span>{t('ed.pageNumToggle')}</span>
                  </label>
                  {pageNumbers.enabled && (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <select
                        value={pageNumbers.position}
                        onChange={(e) =>
                          setPageNumbers((p) => ({
                            ...p,
                            position: e.target.value as PdfPageNumberConfig['position'],
                          }))
                        }
                        className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-1 font-mono text-[11px]"
                      >
                        <option value="bottom-center">{t('ed.posBottomCenter')}</option>
                        <option value="bottom-right">{t('ed.posBottomRight')}</option>
                        <option value="top-right">{t('ed.posTopRight')}</option>
                      </select>
                      <select
                        value={pageNumbers.format}
                        onChange={(e) =>
                          setPageNumbers((p) => ({
                            ...p,
                            format: e.target.value as PdfPageNumberConfig['format'],
                          }))
                        }
                        className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-1 font-mono text-[11px]"
                      >
                        <option value="page-of-total">1 / N</option>
                        <option value="number-only">1, 2, 3</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Crop Margins */}
                <div className="border-t border-[var(--border-hairline)] pt-3">
                  <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] font-semibold text-[var(--ink-primary)]">
                    <input
                      type="checkbox"
                      checked={crop.enabled}
                      onChange={(e) => setCrop((c) => ({ ...c, enabled: e.target.checked }))}
                      className="h-3.5 w-3.5 accent-[var(--accent-signal)]"
                    />
                    <span>{t('ed.cropToggle')}</span>
                  </label>
                  {crop.enabled && (
                    <div className="mt-2 space-y-2 font-mono text-[11px]">
                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          value={crop.scope}
                          onChange={(e) =>
                            setCrop((c) => ({ ...c, scope: e.target.value as PdfCropConfig['scope'] }))
                          }
                          className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-1 text-[11px]"
                        >
                          <option value="all">Semua Halaman (Bulk)</option>
                          <option value="current">Halaman Aktif (Hal {activePageIndex + 1})</option>
                          <option value="range">Rentang Halaman</option>
                        </select>
                        <select
                          value={crop.mode}
                          onChange={(e) =>
                            setCrop((c) => ({ ...c, mode: e.target.value as PdfCropConfig['mode'] }))
                          }
                          className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-1 text-[11px]"
                        >
                          <option value="uniform-size">Samakan Ukuran</option>
                          <option value="margins">Potong Margin (pt)</option>
                        </select>
                      </div>

                      {crop.scope === 'range' && (
                        <input
                          type="text"
                          value={crop.pageRange || ''}
                          onChange={(e) => setCrop((c) => ({ ...c, pageRange: e.target.value }))}
                          placeholder="Contoh: 1-3, 5"
                          className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1 text-xs"
                        />
                      )}

                      {crop.mode === 'uniform-size' ? (
                        <div className="space-y-1.5">
                          <select
                            value={crop.targetPreset}
                            onChange={(e) =>
                              setCrop((c) => ({
                                ...c,
                                targetPreset: e.target.value as PdfCropConfig['targetPreset'],
                              }))
                            }
                            className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1 text-[11px]"
                          >
                            <option value="a4-portrait">A4 Portrait (595 × 842 pt)</option>
                            <option value="a4-landscape">A4 Landscape (842 × 595 pt)</option>
                            <option value="letter-portrait">Letter (612 × 792 pt)</option>
                            <option value="match-first">Samakan dengan Halaman 1</option>
                            <option value="custom">Custom (pt)</option>
                          </select>
                          {crop.targetPreset === 'custom' && (
                            <div className="grid grid-cols-2 gap-1.5">
                              <label className="flex items-center justify-between gap-1">
                                <span>W</span>
                                <input
                                  type="number"
                                  min={100}
                                  value={crop.customWidthPt || 595}
                                  onChange={(e) =>
                                    setCrop((c) => ({
                                      ...c,
                                      customWidthPt: Number(e.target.value) || 595,
                                    }))
                                  }
                                  className="w-16 border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-right"
                                />
                              </label>
                              <label className="flex items-center justify-between gap-1">
                                <span>H</span>
                                <input
                                  type="number"
                                  min={100}
                                  value={crop.customHeightPt || 842}
                                  onChange={(e) =>
                                    setCrop((c) => ({
                                      ...c,
                                      customHeightPt: Number(e.target.value) || 842,
                                    }))
                                  }
                                  className="w-16 border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-right"
                                />
                              </label>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          <label className="flex items-center justify-between gap-1">
                            <span>Top</span>
                            <input
                              type="number"
                              min={0}
                              max={200}
                              value={crop.topPt}
                              onChange={(e) =>
                                setCrop((c) => ({ ...c, topPt: Number(e.target.value) || 0 }))
                              }
                              className="w-14 border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-right"
                            />
                          </label>
                          <label className="flex items-center justify-between gap-1">
                            <span>Right</span>
                            <input
                              type="number"
                              min={0}
                              max={200}
                              value={crop.rightPt}
                              onChange={(e) =>
                                setCrop((c) => ({ ...c, rightPt: Number(e.target.value) || 0 }))
                              }
                              className="w-14 border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-right"
                            />
                          </label>
                          <label className="flex items-center justify-between gap-1">
                            <span>Bottom</span>
                            <input
                              type="number"
                              min={0}
                              max={200}
                              value={crop.bottomPt}
                              onChange={(e) =>
                                setCrop((c) => ({ ...c, bottomPt: Number(e.target.value) || 0 }))
                              }
                              className="w-14 border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-right"
                            />
                          </label>
                          <label className="flex items-center justify-between gap-1">
                            <span>Left</span>
                            <input
                              type="number"
                              min={0}
                              max={200}
                              value={crop.leftPt}
                              onChange={(e) =>
                                setCrop((c) => ({ ...c, leftPt: Number(e.target.value) || 0 }))
                              }
                              className="w-14 border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-right"
                            />
                          </label>
                          {viewMode !== 'annotate' && (
                            <button
                              type="button"
                              onClick={() => setViewMode('annotate')}
                              className="col-span-2 mt-1 border border-[var(--accent-signal)] bg-[#FFF8F6] px-2 py-1 text-center font-bold text-[var(--accent-signal)] hover:bg-[var(--accent-signal)] hover:text-white"
                            >
                              Sesuaikan Garis Crop di Kanvas →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <SignaturePadModal
        open={signatureOpen}
        onClose={() => setSignatureOpen(false)}
        onSaveSignature={insertImageAnnotation}
      />
    </div>
  );
};
