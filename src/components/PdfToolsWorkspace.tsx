import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  CloudUpload,
  Columns2,
  Crop,
  Download,
  EyeOff,
  FileArchive,
  FileCode2,
  FileImage,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  Hash,
  Layers,
  Lock,
  LockOpen,
  Minimize2,
  PenTool,
  QrCode,
  RotateCw,
  ScanText,
  Scissors,
  Shield,
  Stamp,
  Trash2,
  Wrench,
} from 'lucide-react';
import type { PdfToolId, WorkspaceTab } from '../types/workbench';
import { encryptPdfToBlob, repairPdfLocally } from '../services/pdfSecurityEngine';
import {
  compareTwoPdfs,
  imagesToPdfResult,
  pdfToExcelResult,
  pdfToImagesResult,
  pdfToMarkdownResult,
  pdfToWordResult,
  type PdfComparisonResult,
} from '../services/pdfToolsEngine';
import { runIlovePdfTool } from '../services/ilovePdfService';
import { formatBytes } from '../utils/format';
import { triggerBlobDownload } from '../utils/memoryManager';
import { useI18n } from '../i18n/I18nContext';
import { ResiGeneratorPanel } from './ResiGeneratorPanel';

interface PdfToolsWorkspaceProps {
  onNavigateTab: (tab: WorkspaceTab) => void;
  onSelectEditorTool?: (toolId: PdfToolId) => void;
  onFilesDropped?: (files: File[]) => void;
  onActiveToolChange?: (label: string | null) => void;
  resetSignal?: number;
}

type ToolTarget =
  | { kind: 'route'; tab: WorkspaceTab }
  | { kind: 'inline'; panel: InlinePanelId };

type InlinePanelId =
  | 'protect'
  | 'repair'
  | 'ocr'
  | 'pdf-to-jpg'
  | 'pdf-to-markdown'
  | 'pdf-to-word'
  | 'pdf-to-excel'
  | 'pdf-to-pdfa'
  | 'ppt-to-pdf'
  | 'scan-to-pdf'
  | 'compare'
  | 'resi';

interface ToolDef {
  id: PdfToolId;
  label: string;
  desc: string;
  badge: 'LOCAL' | 'CLOUD';
  icon: React.ComponentType<{ className?: string }>;
  target: ToolTarget;
}

interface ToolCategory {
  titleKey: string;
  tools: ToolDef[];
}

const CATEGORIES: ToolCategory[] = [
  {
    titleKey: 'tools.catOrganize',
    tools: [
      { id: 'merge', label: 'Merge PDF', desc: 'Gabungkan beberapa PDF', badge: 'LOCAL', icon: Layers, target: { kind: 'route', tab: 'editor' } },
      { id: 'split', label: 'Split PDF', desc: 'Pisahkan rentang halaman', badge: 'LOCAL', icon: Scissors, target: { kind: 'route', tab: 'editor' } },
      { id: 'remove-pages', label: 'Remove Pages', desc: 'Hapus halaman tertentu', badge: 'LOCAL', icon: Trash2, target: { kind: 'route', tab: 'editor' } },
      { id: 'extract-pages', label: 'Extract Pages', desc: 'Ekstrak halaman pilihan', badge: 'LOCAL', icon: FileText, target: { kind: 'route', tab: 'editor' } },
      { id: 'organize', label: 'Organize PDF', desc: 'Urutkan ulang halaman', badge: 'LOCAL', icon: Layers, target: { kind: 'route', tab: 'editor' } },
      { id: 'scan-to-pdf', label: 'Scan to PDF', desc: 'Foto/scan ke PDF multi-halaman', badge: 'LOCAL', icon: Camera, target: { kind: 'inline', panel: 'scan-to-pdf' } },
    ],
  },
  {
    titleKey: 'tools.catOptimize',
    tools: [
      { id: 'compress', label: 'Compress PDF', desc: 'Perkecil ukuran DPI PDF', badge: 'LOCAL', icon: Minimize2, target: { kind: 'route', tab: 'editor' } },
      { id: 'repair', label: 'Repair PDF', desc: 'Perbaiki struktur PDF rusak', badge: 'LOCAL', icon: Wrench, target: { kind: 'inline', panel: 'repair' } },
      { id: 'ocr', label: 'OCR PDF', desc: 'Jadikan PDF hasil scan bisa dicari', badge: 'CLOUD', icon: ScanText, target: { kind: 'inline', panel: 'ocr' } },
    ],
  },
  {
    titleKey: 'tools.catConvertTo',
    tools: [
      { id: 'jpg-to-pdf', label: 'JPG to PDF', desc: 'Konversi gambar ke PDF', badge: 'LOCAL', icon: FileImage, target: { kind: 'inline', panel: 'scan-to-pdf' } },
      { id: 'word-to-pdf', label: 'WORD to PDF', desc: 'DOCX ke PDF lokal', badge: 'LOCAL', icon: FileText, target: { kind: 'route', tab: 'converter' } },
      { id: 'ppt-to-pdf', label: 'POWERPOINT to PDF', desc: 'PPT/PPTX ke PDF (Cloud)', badge: 'CLOUD', icon: FileArchive, target: { kind: 'inline', panel: 'ppt-to-pdf' } },
      { id: 'excel-to-pdf', label: 'EXCEL to PDF', desc: 'XLSX/CSV ke PDF lokal', badge: 'LOCAL', icon: FileSpreadsheet, target: { kind: 'route', tab: 'converter' } },
      { id: 'html-to-pdf', label: 'HTML to PDF', desc: 'HTML/Markdown ke PDF lokal', badge: 'LOCAL', icon: FileCode2, target: { kind: 'route', tab: 'converter' } },
      { id: 'resi', label: 'Buat Resi Otomatis', desc: 'Label pengiriman PDF + QR Link Toko', badge: 'LOCAL', icon: QrCode, target: { kind: 'inline', panel: 'resi' } },
    ],
  },
  {
    titleKey: 'tools.catConvertFrom',
    tools: [
      { id: 'pdf-to-jpg', label: 'PDF to JPG / PNG', desc: 'Render halaman PDF ke gambar', badge: 'LOCAL', icon: FileImage, target: { kind: 'inline', panel: 'pdf-to-jpg' } },
      { id: 'pdf-to-word', label: 'PDF to WORD', desc: 'Ekstrak teks PDF ke .doc', badge: 'LOCAL', icon: FileText, target: { kind: 'inline', panel: 'pdf-to-word' } },
      { id: 'pdf-to-excel', label: 'PDF to EXCEL', desc: 'Ekstrak tabel/baris ke .xlsx', badge: 'LOCAL', icon: FileSpreadsheet, target: { kind: 'inline', panel: 'pdf-to-excel' } },
      { id: 'pdf-to-pdfa', label: 'PDF to PDF/A', desc: 'Konversi arsip ISO PDF/A', badge: 'CLOUD', icon: FileArchive, target: { kind: 'inline', panel: 'pdf-to-pdfa' } },
      { id: 'pdf-to-markdown', label: 'PDF to Markdown', desc: 'Ekstrak struktur ke .md', badge: 'LOCAL', icon: FileCode2, target: { kind: 'inline', panel: 'pdf-to-markdown' } },
    ],
  },
  {
    titleKey: 'tools.catEdit',
    tools: [
      { id: 'rotate', label: 'Rotate PDF', desc: 'Putar orientasi halaman', badge: 'LOCAL', icon: RotateCw, target: { kind: 'route', tab: 'editor' } },
      { id: 'page-numbers', label: 'Add Page Numbers', desc: 'Tambah nomor halaman otomatis', badge: 'LOCAL', icon: Hash, target: { kind: 'route', tab: 'editor' } },
      { id: 'watermark', label: 'Add Watermark', desc: 'Tambah teks watermark', badge: 'LOCAL', icon: Stamp, target: { kind: 'route', tab: 'editor' } },
      { id: 'crop', label: 'Crop PDF', desc: 'Potong margin halaman PDF', badge: 'LOCAL', icon: Crop, target: { kind: 'route', tab: 'editor' } },
      { id: 'edit', label: 'Edit PDF', desc: 'Teks, highlight, gambar', badge: 'LOCAL', icon: FilePenLine, target: { kind: 'route', tab: 'editor' } },
    ],
  },
  {
    titleKey: 'tools.catSecurity',
    tools: [
      { id: 'unlock', label: 'Unlock PDF', desc: 'Hapus password & izin PDF', badge: 'LOCAL', icon: LockOpen, target: { kind: 'route', tab: 'unlocker' } },
      { id: 'protect', label: 'Protect PDF', desc: 'Enkripsi PDF dengan AES-256', badge: 'LOCAL', icon: Shield, target: { kind: 'inline', panel: 'protect' } },
      { id: 'sign', label: 'Sign PDF', desc: 'Tanda tangan kanvas PNG', badge: 'LOCAL', icon: PenTool, target: { kind: 'route', tab: 'editor' } },
      { id: 'redact', label: 'Redact PDF', desc: 'Sensor permanen (rasterized)', badge: 'LOCAL', icon: EyeOff, target: { kind: 'route', tab: 'editor' } },
      { id: 'compare', label: 'Compare PDF', desc: 'Bandingkan teks & visual 2 PDF', badge: 'LOCAL', icon: Columns2, target: { kind: 'inline', panel: 'compare' } },
    ],
  },
];

export const PdfToolsWorkspace: React.FC<PdfToolsWorkspaceProps> = ({
  onNavigateTab,
  onSelectEditorTool,
  onFilesDropped,
  onActiveToolChange,
  resetSignal,
}) => {
  const { t } = useI18n();
  const [activePanel, setActivePanel] = useState<InlinePanelId | null>(null);
  const [activeToolTitle, setActiveToolTitle] = useState<string>('');
  const [activeToolDesc, setActiveToolDesc] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);

  React.useEffect(() => {
    if (resetSignal) {
      setActivePanel(null);
      setActiveToolTitle('');
      setActiveToolDesc('');
      onActiveToolChange?.(null);
    }
  }, [resetSignal, onActiveToolChange]);
  const [files, setFiles] = useState<File[]>([]);
  const [compareFileB, setCompareFileB] = useState<File | null>(null);
  const [protectPw, setProtectPw] = useState('');
  const [protectOwnerPw, setProtectOwnerPw] = useState('');
  const [imgFormat, setImgFormat] = useState<'jpg' | 'png'>('jpg');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [compareRes, setCompareRes] = useState<PdfComparisonResult | null>(null);

  const singleInputRef = useRef<HTMLInputElement>(null);
  const compareBInputRef = useRef<HTMLInputElement>(null);

  const openPanel = (panel: InlinePanelId, title: string, desc: string) => {
    setActivePanel(panel);
    setActiveToolTitle(title);
    setActiveToolDesc(desc);
    onActiveToolChange?.(title);
    setFiles([]);
    setCompareFileB(null);
    setCompareRes(null);
    setErrorMsg(null);
    setStatusMsg(null);
    setProtectPw('');
    setProtectOwnerPw('');
  };

  const runToolAction = async () => {
    if (!activePanel || files.length === 0) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const f = files[0];
      const base = f.name.replace(/\.[^.]+$/, '');

      if (activePanel === 'protect') {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const blob = await encryptPdfToBlob(bytes, protectPw, protectOwnerPw || undefined);
        const outName = `${base}_protected.pdf`;
        triggerBlobDownload(blob, outName);
        setStatusMsg(`${outName} (${formatBytes(blob.size)})`);
      } else if (activePanel === 'repair') {
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const blob = await repairPdfLocally(bytes);
          const outName = `${base}_repaired.pdf`;
          triggerBlobDownload(blob, outName);
          setStatusMsg(`${outName} (${formatBytes(blob.size)})`);
        } catch {
          // Fallback to iLovePDF repair if local fails
          const { blob } = await runIlovePdfTool('repair', [f]);
          const outName = `${base}_repaired_cloud.pdf`;
          triggerBlobDownload(blob, outName);
          setStatusMsg(`${outName} (${formatBytes(blob.size)})`);
        }
      } else if (activePanel === 'ocr') {
        const { blob } = await runIlovePdfTool('ocr', [f]);
        const outName = `${base}_ocr.pdf`;
        triggerBlobDownload(blob, outName);
        setStatusMsg(`${outName} (${formatBytes(blob.size)})`);
      } else if (activePanel === 'pdf-to-pdfa') {
        const { blob } = await runIlovePdfTool('pdfa', [f]);
        const outName = `${base}_pdfa.pdf`;
        triggerBlobDownload(blob, outName);
        setStatusMsg(`${outName} (${formatBytes(blob.size)})`);
      } else if (activePanel === 'ppt-to-pdf') {
        const { blob } = await runIlovePdfTool('officepdf', [f]);
        const outName = `${base}.pdf`;
        triggerBlobDownload(blob, outName);
        setStatusMsg(`${outName} (${formatBytes(blob.size)})`);
      } else if (activePanel === 'pdf-to-jpg') {
        const res = await pdfToImagesResult(f, imgFormat);
        triggerBlobDownload(res.blob, res.filename);
        setStatusMsg(`${res.filename} (${res.pageCount} pages · ${formatBytes(res.blob.size)})`);
      } else if (activePanel === 'pdf-to-markdown') {
        const res = await pdfToMarkdownResult(f);
        triggerBlobDownload(res.blob, res.filename);
        setStatusMsg(`${res.filename} (${formatBytes(res.blob.size)})`);
      } else if (activePanel === 'pdf-to-word') {
        const res = await pdfToWordResult(f);
        triggerBlobDownload(res.blob, res.filename);
        setStatusMsg(`${res.filename} (${formatBytes(res.blob.size)})`);
      } else if (activePanel === 'pdf-to-excel') {
        const res = await pdfToExcelResult(f);
        triggerBlobDownload(res.blob, res.filename);
        setStatusMsg(`${res.filename} (${formatBytes(res.blob.size)})`);
      } else if (activePanel === 'scan-to-pdf') {
        const res = await imagesToPdfResult(files);
        triggerBlobDownload(res.blob, res.filename);
        setStatusMsg(`${res.filename} (${formatBytes(res.blob.size)})`);
      } else if (activePanel === 'compare') {
        if (!compareFileB) throw new Error('Pilih File PDF B untuk dibandingkan.');
        const res = await compareTwoPdfs(f, compareFileB, 1);
        setCompareRes(res);
        setStatusMsg(
          res.identical
            ? t('tools.compareIdentical')
            : t('tools.compareDiffSummary', {
                added: res.addedLines.length,
                removed: res.removedLines.length,
              })
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const isCloudPanel =
    activePanel === 'ocr' || activePanel === 'pdf-to-pdfa' || activePanel === 'ppt-to-pdf';

  const acceptAttr =
    activePanel === 'scan-to-pdf'
      ? 'image/*,.jpg,.jpeg,.png,.webp'
      : activePanel === 'ppt-to-pdf'
        ? '.ppt,.pptx'
        : '.pdf,application/pdf';

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-5 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-3">
        <div>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
            {t('tools.eyebrow')}
          </span>
          <h2 className="text-lg font-bold text-[var(--ink-primary)]">
            {activePanel ? activeToolTitle : t('tools.title')}
          </h2>
          {activePanel && activeToolDesc && (
            <p className="mt-0.5 text-xs text-[var(--ink-secondary)]">{activeToolDesc}</p>
          )}
        </div>
        {activePanel && (
          <button
            type="button"
            onClick={() => {
              setActivePanel(null);
              setActiveToolTitle('');
              onActiveToolChange?.(null);
            }}
            className="inline-flex items-center gap-1.5 border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[var(--bg-recessed)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t('tools.backToAll')}</span>
          </button>
        )}
      </div>

      {!activePanel ? (
        <div className="space-y-6">
          {onFilesDropped && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files.length > 0) {
                  onFilesDropped(Array.from(e.dataTransfer.files));
                }
              }}
              className={`workbench-grid flex flex-wrap items-center justify-between gap-3 border-2 px-4 py-3 transition-colors ${
                isDragging
                  ? 'border-[var(--accent-signal)] bg-[#FFF8F6]'
                  : 'border-dashed border-[var(--ink-primary)] bg-[var(--bg-surface)]'
              }`}
            >
              <div>
                <p className="text-xs font-bold text-[var(--ink-primary)]">
                  {isDragging ? t('home.dropActive') : t('home.dropIdle')}
                </p>
                <p className="text-[11px] text-[var(--ink-secondary)]">
                  PDF, ZIP/RAR/7z, Gambar, Video/Audio, DOCX/XLSX — otomatis masuk ke workspace yang sesuai.
                </p>
              </div>
              <label className="w-full cursor-pointer border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-3.5 py-2 text-center font-mono text-[11px] font-bold uppercase tracking-wider text-white hover:bg-[var(--accent-signal-hover)] sm:w-auto sm:py-1.5">
                <span>{t('home.pickBtn')}</span>
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      onFilesDropped(Array.from(e.target.files));
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((cat) => (
              <div
                key={cat.titleKey}
                className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4"
              >
                <h3 className="mb-3 border-b border-[var(--border-hairline)] pb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                  {t(cat.titleKey as Parameters<typeof t>[0])}
                </h3>
                <div className="space-y-1.5">
                  {cat.tools.map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => {
                          if (tool.target.kind === 'route') {
                            if (tool.target.tab === 'editor' && onSelectEditorTool) {
                              onSelectEditorTool(tool.id);
                            } else {
                              onNavigateTab(tool.target.tab);
                            }
                          } else {
                            openPanel(tool.target.panel, tool.label, tool.desc);
                          }
                        }}
                        className="flex w-full items-center justify-between gap-2 border border-transparent px-2.5 py-2 text-left transition-colors hover:border-[var(--border-hairline)] hover:bg-[var(--bg-canvas)]"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <Icon className="h-4 w-4 shrink-0 text-[var(--accent-signal)]" />
                          <div className="min-w-0 flex-1">
                            <div className="break-words text-xs font-bold text-[var(--ink-primary)]">
                              {tool.label}
                            </div>
                            <div className="break-words text-[11px] text-[var(--ink-secondary)]">
                              {tool.desc}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 border px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                            tool.badge === 'CLOUD'
                              ? 'border-[#D9A760] bg-[#FEF9F0] text-[#8A5300]'
                              : 'border-[#B8D4C2] bg-[#F2F8F4] text-[var(--accent-local)]'
                          }`}
                        >
                          {tool.badge}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : activePanel === 'resi' ? (
        <ResiGeneratorPanel />
      ) : (
        <div className="border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5">
          <input
            ref={singleInputRef}
            type="file"
            multiple={activePanel === 'scan-to-pdf'}
            accept={acceptAttr}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) setFiles(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
          <input
            ref={compareBInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.[0]) setCompareFileB(e.target.files[0]);
              e.target.value = '';
            }}
          />

          {isCloudPanel && (
            <div className="mb-4 flex items-start gap-2 border border-[#D9A760] bg-[#FEF9F0] px-3.5 py-2.5 text-xs text-[#6E4400]">
              <CloudUpload className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('unlocker.cloudFallbackWarning')}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => singleInputRef.current?.click()}
              className="max-w-full truncate border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-4 py-2 font-mono text-xs font-semibold hover:bg-[var(--bg-recessed)]"
            >
              {activePanel === 'compare'
                ? files[0]
                  ? `PDF A: ${files[0].name}`
                  : t('tools.pickPdfA')
                : files.length > 0
                  ? `${files.length} file: ${files[0].name}`
                  : t('tools.pickFile')}
            </button>

            {activePanel === 'compare' && (
              <button
                type="button"
                onClick={() => compareBInputRef.current?.click()}
                className="border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-4 py-2 font-mono text-xs font-semibold hover:bg-[var(--bg-recessed)]"
              >
                {compareFileB ? `PDF B: ${compareFileB.name}` : t('tools.pickPdfB')}
              </button>
            )}

            {activePanel === 'pdf-to-jpg' && (
              <select
                value={imgFormat}
                onChange={(e) => setImgFormat(e.target.value as 'jpg' | 'png')}
                className="border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 py-2 font-mono text-xs"
              >
                <option value="jpg">JPG (92%)</option>
                <option value="png">PNG (Lossless)</option>
              </select>
            )}
          </div>

          {activePanel === 'protect' && (
            <div className="mt-4 grid max-w-md gap-3">
              <div>
                <label className="block font-mono text-[11px] uppercase text-[var(--ink-secondary)]">
                  User Password (Wajib)
                </label>
                <input
                  type="password"
                  value={protectPw}
                  onChange={(e) => setProtectPw(e.target.value)}
                  placeholder="Password buka PDF..."
                  className="mt-1 w-full border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block font-mono text-[11px] uppercase text-[var(--ink-secondary)]">
                  Owner Password (Opsional)
                </label>
                <input
                  type="password"
                  value={protectOwnerPw}
                  onChange={(e) => setProtectOwnerPw(e.target.value)}
                  placeholder="Kosongkan untuk sama dengan User Password"
                  className="mt-1 w-full border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 py-2 font-mono text-xs"
                />
              </div>
            </div>
          )}

          <div className="mt-5">
            <button
              type="button"
              disabled={
                busy ||
                files.length === 0 ||
                (activePanel === 'protect' && !protectPw) ||
                (activePanel === 'compare' && !compareFileB)
              }
              onClick={() => void runToolAction()}
              className="inline-flex items-center gap-2 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--accent-signal-hover)] disabled:opacity-50"
            >
              {activePanel === 'protect' ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>{busy ? t('tools.processing') : t('tools.runBtn')}</span>
            </button>
          </div>

          {errorMsg && (
            <div className="mt-4 flex items-start gap-2 border border-[#8A2C1D] bg-[#FDF2F0] px-3.5 py-2.5 text-xs text-[#681D11]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {statusMsg && !errorMsg && (
            <div className="mt-4 flex items-center gap-2 border border-[#B8D4C2] bg-[#F2F8F4] px-3.5 py-2.5 text-xs text-[var(--accent-local)]">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{statusMsg}</span>
            </div>
          )}

          {compareRes && (
            <div className="mt-5 space-y-4 border-t border-[var(--border-hairline)] pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-2">
                  <div className="mb-1 font-mono text-[11px] font-bold">
                    PDF A ({compareRes.pagesA} hal)
                  </div>
                  {compareRes.previewA && (
                    <img src={compareRes.previewA} alt="PDF A" className="w-full border" />
                  )}
                </div>
                <div className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-2">
                  <div className="mb-1 font-mono text-[11px] font-bold">
                    PDF B ({compareRes.pagesB} hal)
                  </div>
                  {compareRes.previewB && (
                    <img src={compareRes.previewB} alt="PDF B" className="w-full border" />
                  )}
                </div>
              </div>
              {!compareRes.identical && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 font-mono text-[11px]">
                  <div className="border border-[#8A2C1D] bg-[#FDF2F0] p-3">
                    <div className="font-bold text-[#681D11] mb-1">
                      - Removed ({compareRes.removedLines.length})
                    </div>
                    <div className="max-h-48 overflow-auto space-y-1">
                      {compareRes.removedLines.map((l, i) => (
                        <div key={i}>- {l}</div>
                      ))}
                    </div>
                  </div>
                  <div className="border border-[#B8D4C2] bg-[#F2F8F4] p-3">
                    <div className="font-bold text-[var(--accent-local)] mb-1">
                      + Added ({compareRes.addedLines.length})
                    </div>
                    <div className="max-h-48 overflow-auto space-y-1">
                      {compareRes.addedLines.map((l, i) => (
                        <div key={i}>+ {l}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
