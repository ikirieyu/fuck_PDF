import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckSquare,
  CloudUpload,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FileKey2,
  FilePenLine,
  FileText,
  Folder,
  KeyRound,
  Lock,
  LockOpen,
  Square,
  Upload,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type * as pdfjsLib from 'pdfjs-dist';
import type { ArchiveEntryItem, ArchiveFormat } from '../types/workbench';
import {
  ArchiveEngineError,
  bundleFilesAsZip,
  extractArchiveFiles,
  inspectArchive,
} from '../services/archiveEngine';
import {
  decryptPdfToBlob,
  inspectAndAutoUnlockPdf,
  inspectAndOpenPdf,
  runSmartPdfRecovery,
  type RecoveryMode,
  type RecoveryProgress,
} from '../services/pdfSecurityEngine';
import { unlockPdfViaCloud } from '../services/ilovePdfService';
import { detectArchiveFormat, formatBytes } from '../utils/format';
import { memoryManager, triggerBlobDownload } from '../utils/memoryManager';
import { vaultSave } from '../utils/passwordVault';
import { useI18n } from '../i18n/I18nContext';

interface BatchPdfItem {
  id: string;
  file: File;
  bytes: Uint8Array;
  status: 'unlocked' | 'unencrypted' | 'needs-password' | 'error';
  elapsedMs?: number;
  unlockedBlob?: Blob;
  errorMsg?: string;
  attempts: number;
}

interface UnlockerWorkspaceProps {
  initialFile?: File | null;
  initialFiles?: File[];
  onSendPdfToEditor: (file: File) => void;
}

export const UnlockerWorkspace: React.FC<UnlockerWorkspaceProps> = ({
  initialFile,
  initialFiles,
  onSendPdfToEditor,
}) => {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'none' | 'archive' | 'pdf' | 'pdf-batch'>('none');
  const [archiveFormat, setArchiveFormat] = useState<ArchiveFormat>('zip');

  const [needsPassword, setNeedsPassword] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [isOwnerMode, setIsOwnerMode] = useState(false);
  const [cachedBatchPassword, setCachedBatchPassword] = useState<string>('');
  const [batchItems, setBatchItems] = useState<BatchPdfItem[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [entries, setEntries] = useState<ArchiveEntryItem[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [autoUnlockedBlob, setAutoUnlockedBlob] = useState<Blob | null>(null);
  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode>('pin4');
  const [recovering, setRecovering] = useState(false);
  const [recoveryProgress, setRecoveryProgress] = useState<RecoveryProgress | null>(null);
  const recoveryAbortRef = useRef<AbortController | null>(null);
  const [cloudUnlocking, setCloudUnlocking] = useState(false);
  const [cloudStage, setCloudStage] = useState<string>('');
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1.25);

  useEffect(() => {
    return memoryManager.registerCleanupCallback(() => {
      setFile(null);
      setMode('none');
      setNeedsPassword(false);
      setIsUnlocked(false);
      setPassword('');
      setErrorMsg(null);
      setStatusMsg(null);
      setEntries([]);
      setSelectedPaths(new Set());
      setPdfBytes(null);
      setAutoUnlockedBlob(null);
      recoveryAbortRef.current?.abort();
      setRecovering(false);
      setRecoveryProgress(null);
      setBatchItems([]);
      setCachedBatchPassword('');
      if (pdfDoc) {
        pdfDoc.cleanup().catch(() => {});
      }
      setPdfDoc(null);
      setNumPages(0);
    });
  }, [pdfDoc]);

  const loadFile = async (target: File) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setPassword('');
    setEntries([]);
    setSelectedPaths(new Set());
    if (pdfDoc) {
      await pdfDoc.cleanup().catch(() => {});
      setPdfDoc(null);
    }

    const archFmt = detectArchiveFormat(target.name);
    const isPdf = target.name.toLowerCase().endsWith('.pdf') || target.type === 'application/pdf';

    if (!archFmt && !isPdf) {
      setErrorMsg(t('unlocker.unsupportedMsg'));
      return;
    }

    setFile(target);
    setBusy(true);

    if (archFmt) {
      setMode('archive');
      setArchiveFormat(archFmt);
      try {
        const result = await inspectArchive(target, archFmt);
        setEntries(result.entries);
        const filePaths = result.entries.filter((e) => !e.isDirectory).map((e) => e.path);
        setSelectedPaths(new Set(filePaths));
        if (result.requiresPassword) {
          setNeedsPassword(true);
          setIsUnlocked(false);
          setStatusMsg(
            result.headerEncrypted
              ? t('unlocker.headerEncryptedMsg')
              : t('unlocker.archiveEncryptedMsg', { fmt: archFmt.toUpperCase() })
          );
        } else {
          setNeedsPassword(false);
          setIsUnlocked(true);
          setStatusMsg(t('unlocker.archiveReadyMsg', { count: filePaths.length }));
        }
      } catch (err) {
        if (err instanceof ArchiveEngineError && err.code === 'PASSWORD_REQUIRED') {
          setNeedsPassword(true);
          setIsUnlocked(false);
          setStatusMsg(err.message);
        } else {
          setErrorMsg(err instanceof Error ? err.message : 'Error');
        }
      } finally {
        setBusy(false);
      }
    } else {
      setMode('pdf');
      setAutoUnlockedBlob(null);
      try {
        const bytes = new Uint8Array(await target.arrayBuffer());
        setPdfBytes(bytes);
        const res = await inspectAndAutoUnlockPdf(bytes, target.name);
        if (res.status === 'unlocked') {
          setPdfDoc(res.docProxy || null);
          setNumPages(res.numPages);
          setCurrentPage(1);
          setNeedsPassword(false);
          setIsUnlocked(true);
          if (res.matchedPassword) {
            setPassword(res.matchedPassword);
          }
          if (res.unlockedBlob) {
            setAutoUnlockedBlob(res.unlockedBlob);
          }
          if (res.method === 'owner-strip') {
            setStatusMsg(
              t('unlocker.ownerStrippedMsg', { ms: res.elapsedMs, pages: res.numPages })
            );
          } else if (res.method === 'pattern-guess') {
            setStatusMsg(
              t('unlocker.patternGuessedMsg', { ms: res.elapsedMs, pages: res.numPages })
            );
          } else {
            setStatusMsg(t('unlocker.pdfOpenMsg', { pages: res.numPages }));
          }
        } else {
          setNeedsPassword(true);
          setIsUnlocked(false);
          setStatusMsg(
            t('unlocker.manualFallbackMsg', {
              ms: res.elapsedMs,
              count: res.triedCandidatesCount ?? 0,
            })
          );
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Error');
      } finally {
        setBusy(false);
      }
    }
  };

  const loadBatchPdfs = async (targets: File[]) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setPassword('');
    setEntries([]);
    setSelectedPaths(new Set());
    if (pdfDoc) {
      await pdfDoc.cleanup().catch(() => {});
      setPdfDoc(null);
    }

    setFile(targets[0]);
    setMode('pdf-batch');
    setBusy(true);
    setNeedsPassword(false);
    setIsUnlocked(false);

    let activeCache = cachedBatchPassword;
    const results: BatchPdfItem[] = [];

    for (let i = 0; i < targets.length; i++) {
      const f = targets[i];
      const bytes = new Uint8Array(await f.arrayBuffer());
      try {
        const res = await inspectAndAutoUnlockPdf(bytes, f.name);
        await res.docProxy?.cleanup().catch(() => {});
        if (res.status === 'unlocked') {
          results.push({
            id: `${i}-${f.name}`,
            file: f,
            bytes,
            status: res.method === 'unencrypted' ? 'unencrypted' : 'unlocked',
            elapsedMs: res.elapsedMs,
            unlockedBlob:
              res.unlockedBlob ?? new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }),
            attempts: 0,
          });
          continue;
        }

        // Try cached password (fadeltd/pdfunlock directory password cache)
        if (activeCache) {
          try {
            const blob = await decryptPdfToBlob(bytes, activeCache);
            results.push({
              id: `${i}-${f.name}`,
              file: f,
              bytes,
              status: 'unlocked',
              elapsedMs: res.elapsedMs,
              unlockedBlob: blob,
              attempts: 0,
            });
            continue;
          } catch {
            // Invalidate cache on auth failure
            activeCache = '';
            setCachedBatchPassword('');
          }
        }

        results.push({
          id: `${i}-${f.name}`,
          file: f,
          bytes,
          status: 'needs-password',
          elapsedMs: res.elapsedMs,
          attempts: 0,
        });
      } catch (err) {
        results.push({
          id: `${i}-${f.name}`,
          file: f,
          bytes,
          status: 'error',
          errorMsg: err instanceof Error ? err.message : 'Error',
          attempts: 0,
        });
      }
    }

    setBatchItems(results);
    const pendingCount = results.filter((r) => r.status === 'needs-password').length;
    const unlockedCount = results.filter(
      (r) => r.status === 'unlocked' || r.status === 'unencrypted'
    ).length;

    if (pendingCount > 0) {
      setNeedsPassword(true);
      setIsUnlocked(false);
      setStatusMsg(
        t('unlocker.batchNeedPass', {
          unlocked: unlockedCount,
          total: results.length,
          pending: pendingCount,
        })
      );
    } else {
      setNeedsPassword(false);
      setIsUnlocked(true);
      setStatusMsg(t('unlocker.batchAllDone', { count: results.length }));
    }
    setBusy(false);
  };

  const handleFilesSelected = (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    const pdfs = arr.filter(
      (f) => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf'
    );
    if (pdfs.length > 1) {
      void loadBatchPdfs(pdfs);
    } else {
      void loadFile(arr[0]);
    }
  };

  useEffect(() => {
    if (initialFiles && initialFiles.length > 1) {
      void loadBatchPdfs(initialFiles);
    } else if (initialFile) {
      void loadFile(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile, initialFiles]);

  useEffect(() => {
    if (needsPassword && !isUnlocked) {
      setTimeout(() => passwordInputRef.current?.focus(), 40);
    }
  }, [needsPassword, isUnlocked]);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      if (!pdfDoc || !pdfCanvasRef.current) return;
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: zoom });
        const canvas = pdfCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      } catch {
        // Ignore cancelled render
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, currentPage, zoom]);

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setErrorMsg(null);
    setBusy(true);

    if (mode === 'archive') {
      try {
        const res = await inspectArchive(file, archiveFormat, password);
        setEntries(res.entries);
        const filePaths = res.entries.filter((item) => !item.isDirectory).map((item) => item.path);
        setSelectedPaths(new Set(filePaths));
        setIsUnlocked(true);
        setStatusMsg(t('unlocker.archiveUnlockedMsg', { count: filePaths.length }));
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Error');
        passwordInputRef.current?.select();
      } finally {
        setBusy(false);
      }
    } else if (mode === 'pdf' && pdfBytes) {
      try {
        const res = await inspectAndOpenPdf(pdfBytes, password);
        setPdfDoc(res.docProxy || null);
        setNumPages(res.numPages);
        setCurrentPage(1);
        setIsUnlocked(true);
        setNeedsPassword(false);
        vaultSave(password); // Spec: save successful password to Auto-Vault for future docs
        setStatusMsg(t('unlocker.pdfUnlockedMsg', { pages: res.numPages }));
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Error');
        passwordInputRef.current?.select();
      } finally {
        setBusy(false);
      }
    } else if (mode === 'pdf-batch') {
      // fadeltd/pdfunlock: cache password across batch and retry/clear cache on auth failure
      let anySuccess = false;
      let failedAttempts = 0;
      const updated = [...batchItems];

      for (let i = 0; i < updated.length; i++) {
        const item = updated[i];
        if (item.status !== 'needs-password') continue;

        try {
          const blob = await decryptPdfToBlob(item.bytes, password);
          updated[i] = {
            ...item,
            status: 'unlocked',
            unlockedBlob: blob,
            errorMsg: undefined,
          };
          anySuccess = true;
        } catch {
          const nextAttempt = item.attempts + 1;
          failedAttempts = Math.max(failedAttempts, nextAttempt);
          updated[i] = {
            ...item,
            attempts: nextAttempt,
            status: nextAttempt >= 3 ? 'error' : 'needs-password',
            errorMsg: t('unlocker.batchRetryHint', { attempt: Math.min(3, nextAttempt) }),
          };
        }
      }

      if (anySuccess) {
        setCachedBatchPassword(password);
      } else {
        setCachedBatchPassword('');
        if (failedAttempts > 0) {
          setErrorMsg(t('unlocker.batchRetryHint', { attempt: Math.min(3, failedAttempts) }));
        }
        passwordInputRef.current?.select();
      }

      setBatchItems(updated);
      const pendingCount = updated.filter((r) => r.status === 'needs-password').length;
      const unlockedCount = updated.filter(
        (r) => r.status === 'unlocked' || r.status === 'unencrypted'
      ).length;

      if (pendingCount === 0) {
        setNeedsPassword(false);
        setIsUnlocked(true);
        setStatusMsg(t('unlocker.batchAllDone', { count: updated.length }));
      } else {
        setStatusMsg(
          t('unlocker.batchNeedPass', {
            unlocked: unlockedCount,
            total: updated.length,
            pending: pendingCount,
          })
        );
      }
      setBusy(false);
    }
  };

  const handleStartSmartRecovery = async () => {
    const targetBytes =
      mode === 'pdf'
        ? pdfBytes
        : batchItems.find((i) => i.status === 'needs-password')?.bytes ?? null;
    if (!targetBytes) return;

    recoveryAbortRef.current?.abort();
    const controller = new AbortController();
    recoveryAbortRef.current = controller;

    setErrorMsg(null);
    setRecovering(true);
    setRecoveryProgress({ tested: 0, total: recoveryMode === 'pin4' ? 10000 : 14235, elapsedMs: 0 });

    try {
      const res = await runSmartPdfRecovery(
        targetBytes,
        recoveryMode,
        controller.signal,
        (prog) => setRecoveryProgress(prog)
      );

      if (res.found && res.password) {
        setPassword(res.password);
        setStatusMsg(
          t('unlocker.recoveryFound', {
            pw: res.password,
            ms: res.elapsedMs,
            tested: res.tested,
          })
        );
        if (mode === 'pdf') {
          const opened = await inspectAndOpenPdf(targetBytes, res.password);
          setPdfDoc(opened.docProxy || null);
          setNumPages(opened.numPages);
          setCurrentPage(1);
          setIsUnlocked(true);
          setNeedsPassword(false);
        } else if (mode === 'pdf-batch') {
          setCachedBatchPassword(res.password);
          const updated = [...batchItems];
          for (let i = 0; i < updated.length; i++) {
            if (updated[i].status !== 'needs-password') continue;
            try {
              const blob = await decryptPdfToBlob(updated[i].bytes, res.password);
              updated[i] = { ...updated[i], status: 'unlocked', unlockedBlob: blob };
            } catch {
              // Keep needs-password if another file uses a different password
            }
          }
          setBatchItems(updated);
          const remaining = updated.filter((x) => x.status === 'needs-password').length;
          if (remaining === 0) {
            setNeedsPassword(false);
            setIsUnlocked(true);
          }
        }
      } else if (!res.aborted) {
        setErrorMsg(
          t('unlocker.recoveryNotFound', { tested: res.tested, ms: res.elapsedMs })
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setRecovering(false);
    }
  };

  const handleStopSmartRecovery = () => {
    recoveryAbortRef.current?.abort();
    setRecovering(false);
  };

  const handleCloudFallbackUnlock = async () => {
    const targetFile =
      mode === 'pdf'
        ? file
        : batchItems.find((i) => i.status === 'needs-password')?.file ?? null;
    if (!targetFile) return;

    setErrorMsg(null);
    setCloudUnlocking(true);
    setCloudStage('auth');

    try {
      const { blob, bytesUploaded } = await unlockPdfViaCloud(
        targetFile,
        undefined,
        (prog) => setCloudStage(prog.stage)
      );
      const kb = Math.max(1, Math.round(bytesUploaded / 1024));

      if (mode === 'pdf') {
        const unlockedBytes = new Uint8Array(await blob.arrayBuffer());
        const opened = await inspectAndOpenPdf(unlockedBytes);
        setAutoUnlockedBlob(blob);
        setPdfDoc(opened.docProxy || null);
        setNumPages(opened.numPages);
        setCurrentPage(1);
        setIsUnlocked(true);
        setNeedsPassword(false);
        setStatusMsg(
          t('unlocker.cloudFallbackSuccess', {
            pages: opened.numPages,
            kb,
          })
        );
      } else if (mode === 'pdf-batch') {
        const updated = [...batchItems];
        const idx = updated.findIndex((i) => i.file === targetFile);
        if (idx >= 0) {
          updated[idx] = {
            ...updated[idx],
            status: 'unlocked',
            unlockedBlob: blob,
            errorMsg: undefined,
          };
          setBatchItems(updated);
        }
        const remaining = updated.filter((x) => x.status === 'needs-password').length;
        if (remaining === 0) {
          setNeedsPassword(false);
          setIsUnlocked(true);
        }
        setStatusMsg(
          t('unlocker.cloudFallbackSuccess', {
            pages: 1,
            kb,
          })
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error';
      setErrorMsg(t('unlocker.cloudFallbackError', { msg }));
    } finally {
      setCloudUnlocking(false);
      setCloudStage('');
    }
  };

  const handleDownloadBatchZip = async () => {
    const ready = batchItems.filter(
      (item) => (item.status === 'unlocked' || item.status === 'unencrypted') && item.unlockedBlob
    );
    if (ready.length === 0) return;

    setBusy(true);
    try {
      const filesForZip = await Promise.all(
        ready.map(async (item) => ({
          path: item.file.name.replace(/\.pdf$/i, '') + '_unlocked.pdf',
          data: new Uint8Array(await item.unlockedBlob!.arrayBuffer()),
        }))
      );
      const zipBlob = bundleFilesAsZip(filesForZip);
      triggerBlobDownload(zipBlob, 'pdfunlock_batch_unlocked.zip');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const handleExtractSingle = async (entry: ArchiveEntryItem) => {
    if (!file) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const result = await extractArchiveFiles(
        file,
        archiveFormat,
        [entry.path],
        password || undefined
      );
      if (result.length === 0) return;
      const out = result[0];
      const blob = new Blob([out.data.slice().buffer as ArrayBuffer]);
      triggerBlobDownload(blob, out.name);
      setStatusMsg(
        t('unlocker.extractedOneMsg', {
          name: out.name,
          size: formatBytes(out.data.length),
        })
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const handleExtractBundleZip = async (all: boolean) => {
    if (!file) return;
    const targets = all
      ? entries.filter((e) => !e.isDirectory).map((e) => e.path)
      : Array.from(selectedPaths);
    if (targets.length === 0) return;

    setErrorMsg(null);
    setBusy(true);
    try {
      const files = await extractArchiveFiles(
        file,
        archiveFormat,
        all ? undefined : targets,
        password || undefined
      );
      const zipBlob = bundleFilesAsZip(files.map((f) => ({ path: f.path, data: f.data })));
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const zipName = `${baseName}_unlocked.zip`;
      triggerBlobDownload(zipBlob, zipName);
      setStatusMsg(
        t('unlocker.bundledZipMsg', { count: files.length, name: zipName })
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const handleDecryptAndSavePdf = async () => {
    if (!pdfBytes || !file) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const blob = autoUnlockedBlob ?? (await decryptPdfToBlob(pdfBytes, password || undefined));
      const outName = file.name.replace(/\.pdf$/i, '') + '_unlocked.pdf';
      triggerBlobDownload(blob, outName);
      setStatusMsg(
        t('unlocker.savedUnlockedMsg', { name: outName, size: formatBytes(blob.size) })
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenUnlockedInEditor = async () => {
    if (!pdfBytes || !file) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const blob = autoUnlockedBlob ?? (await decryptPdfToBlob(pdfBytes, password || undefined));
      const unlockedFile = new File(
        [blob],
        file.name.replace(/\.pdf$/i, '') + '_unlocked.pdf',
        { type: 'application/pdf' }
      );
      onSendPdfToEditor(unlockedFile);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const allNonDirPaths = entries.filter((e) => !e.isDirectory).map((e) => e.path);
  const allSelected =
    allNonDirPaths.length > 0 && allNonDirPaths.every((p) => selectedPaths.has(p));

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-6">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.zip,.rar,.7z,application/pdf,application/zip"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFilesSelected(e.target.files);
          }
          e.target.value = '';
        }}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-3">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
            {t('unlocker.eyebrow')}
          </span>
          <h2 className="break-words text-lg font-bold text-[var(--ink-primary)]">
            {mode === 'pdf-batch'
              ? t('unlocker.batchTitle', { count: batchItems.length })
              : file
                ? file.name
                : t('unlocker.defaultTitle')}
          </h2>
          {file && mode !== 'pdf-batch' && (
            <p className="font-mono text-xs text-[var(--ink-secondary)] tabular-nums">
              {formatBytes(file.size)} · {mode === 'pdf' ? 'PDF' : archiveFormat.toUpperCase()}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[var(--bg-recessed)]"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{file ? t('unlocker.changeFile') : t('unlocker.pickFile')}</span>
        </button>
      </div>

      {!file && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
              handleFilesSelected(e.dataTransfer.files);
            }
          }}
          className="workbench-grid flex flex-col items-center justify-center border border-dashed border-[var(--ink-primary)] bg-[var(--bg-surface)] px-6 py-16 text-center"
        >
          <FileKey2 className="mb-3 h-8 w-8 text-[var(--ink-primary)]" aria-hidden="true" />
          <p className="text-sm font-bold text-[var(--ink-primary)]">
            {t('unlocker.emptyTitle')}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-secondary)]">
            {t('unlocker.emptyDesc')}
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--accent-signal-hover)]"
          >
            {t('unlocker.chooseFileBtn')}
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 border border-[#8A2C1D] bg-[#FDF2F0] px-3.5 py-2.5 text-xs text-[#681D11]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {statusMsg && !errorMsg && (
        <div className="mb-4 flex items-center gap-2 border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs text-[var(--ink-primary)]">
          {isUnlocked ? (
            <LockOpen className="h-3.5 w-3.5 shrink-0 text-[var(--accent-local)]" aria-hidden="true" />
          ) : (
            <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--accent-warn)]" aria-hidden="true" />
          )}
          <span>{statusMsg}</span>
        </div>
      )}

      {file && needsPassword && !isUnlocked && (
        <form
          onSubmit={handleUnlockSubmit}
          className="mb-6 max-w-md border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] pb-2.5">
            <KeyRound className="h-4 w-4 text-[var(--accent-signal)]" aria-hidden="true" />
            <h3 className="text-sm font-bold text-[var(--ink-primary)]">
              {t('unlocker.enterPassword')}
            </h3>
          </div>

          <div className="mt-3">
            <label
              htmlFor="unlock-password"
              className="block font-mono text-[11px] font-medium uppercase tracking-wider text-[var(--ink-secondary)]"
            >
              {t('unlocker.passwordLabel')}
            </label>
            <div className="mt-1.5 flex">
              <input
                ref={passwordInputRef}
                id="unlock-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('unlocker.passwordPlaceholder')}
                autoFocus
                required
                className="w-full border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 py-2 font-mono text-sm text-[var(--ink-primary)] focus:bg-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? t('unlocker.hidePass') : t('unlocker.showPass')}
                className="border border-l-0 border-[var(--border-strong)] bg-[var(--bg-recessed)] px-3 text-[var(--ink-primary)] hover:bg-[var(--border-hairline)]"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-secondary)]">
              <input
                type="checkbox"
                checked={isOwnerMode}
                onChange={(e) => setIsOwnerMode(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent-signal)]"
              />
              <span className="font-mono text-[11px]">{t('unlocker.ownerModeLabel')}</span>
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className="font-mono text-[11px] text-[var(--ink-muted)]">
              {t('unlocker.localHint')}
            </span>
            <button
              type="submit"
              disabled={busy || recovering || !password}
              className="border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--accent-signal-hover)] disabled:opacity-50"
            >
              {busy ? t('unlocker.unlockingBtn') : t('unlocker.unlockBtn')}
            </button>
          </div>

          {(mode === 'pdf' || mode === 'pdf-batch') && (
            <div className="mt-4 border-t border-[var(--border-hairline)] pt-3">
              <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-secondary)]">
                {t('unlocker.recoveryTitle')}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={recoveryMode}
                  onChange={(e) => setRecoveryMode(e.target.value as RecoveryMode)}
                  disabled={recovering}
                  className="border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 py-1.5 font-mono text-xs text-[var(--ink-primary)]"
                >
                  <option value="pin4">{t('unlocker.recoveryPin4')}</option>
                  <option value="dob">{t('unlocker.recoveryDob')}</option>
                </select>
                {!recovering ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleStartSmartRecovery()}
                    className="border border-[var(--border-strong)] bg-[var(--bg-recessed)] px-3 py-1.5 font-mono text-xs font-semibold text-[var(--ink-primary)] hover:bg-[var(--border-hairline)] disabled:opacity-50"
                  >
                    {t('unlocker.recoveryStart')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStopSmartRecovery}
                    className="border border-[#8A2C1D] bg-[#FDF2F0] px-3 py-1.5 font-mono text-xs font-bold text-[#681D11] hover:bg-[#FBE4DF]"
                  >
                    {t('unlocker.recoveryStop')}
                  </button>
                )}
              </div>
              {recovering && recoveryProgress && (
                <div className="mt-2">
                  <div className="h-1.5 w-full bg-[var(--bg-recessed)]">
                    <div
                      className="h-1.5 bg-[var(--accent-signal)] transition-all"
                      style={{
                        width: `${Math.min(100, Math.round((recoveryProgress.tested / recoveryProgress.total) * 100))}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-[var(--ink-muted)] tabular-nums">
                    {t('unlocker.recoveryProgress', {
                      tested: recoveryProgress.tested,
                      total: recoveryProgress.total,
                      ms: recoveryProgress.elapsedMs,
                    })}
                  </p>
                </div>
              )}
            </div>
          )}

          {(mode === 'pdf' || mode === 'pdf-batch') && (
            <div className="mt-4 border-t border-[var(--border-hairline)] bg-[#FEF9F0] p-3">
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#8A5300]">
                <CloudUpload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t('unlocker.cloudFallbackTitle')}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[#6E4400]">
                {t('unlocker.cloudFallbackWarning')}
              </p>
              <button
                type="button"
                disabled={busy || recovering || cloudUnlocking}
                onClick={() => void handleCloudFallbackUnlock()}
                className="mt-2.5 inline-flex items-center gap-1.5 border border-[#8A5300] bg-white px-3 py-1.5 font-mono text-xs font-bold text-[#8A5300] hover:bg-[#FDF2DC] disabled:opacity-50"
              >
                <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {cloudUnlocking
                    ? t('unlocker.cloudFallbackRunning', { stage: cloudStage || 'auth' })
                    : t('unlocker.cloudFallbackBtn')}
                </span>
              </button>
            </div>
          )}
        </form>
      )}

      {mode === 'pdf-batch' && batchItems.length > 0 && (
        <div className="mb-6 border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2.5">
            <span className="font-mono text-xs text-[var(--ink-secondary)]">
              {t('unlocker.batchSummary', {
                unlocked: batchItems.filter(
                  (i) => i.status === 'unlocked' || i.status === 'unencrypted'
                ).length,
                total: batchItems.length,
              })}
            </span>
            <button
              type="button"
              disabled={
                busy ||
                batchItems.filter(
                  (i) => (i.status === 'unlocked' || i.status === 'unencrypted') && i.unlockedBlob
                ).length === 0
              }
              onClick={() => void handleDownloadBatchZip()}
              className="inline-flex items-center gap-1.5 border border-[var(--ink-primary)] bg-[var(--ink-primary)] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-black disabled:opacity-50"
            >
              <FileArchive className="h-3.5 w-3.5" />
              <span>
                {t('unlocker.batchDownloadAllZip', {
                  count: batchItems.filter(
                    (i) => (i.status === 'unlocked' || i.status === 'unencrypted') && i.unlockedBlob
                  ).length,
                })}
              </span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] font-mono text-[11px] uppercase text-[var(--ink-muted)]">
                  <th className="px-3 py-2">{t('unlocker.colPath')}</th>
                  <th className="px-3 py-2 text-right">{t('unlocker.colOrigSize')}</th>
                  <th className="px-3 py-2">{t('unlocker.colStatus')}</th>
                  <th className="px-3 py-2 text-right">{t('unlocker.colAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)]">
                {batchItems.map((item) => {
                  const unlockedName = item.file.name.replace(/\.pdf$/i, '') + '_unlocked.pdf';
                  const ready =
                    (item.status === 'unlocked' || item.status === 'unencrypted') &&
                    Boolean(item.unlockedBlob);
                  return (
                    <tr key={item.id} className="hover:bg-[var(--bg-canvas)]">
                      <td className="px-3 py-2 font-mono text-[12px] text-[var(--ink-primary)]">
                        <div className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--ink-secondary)]" />
                          <span>{item.file.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--ink-secondary)]">
                        {formatBytes(item.file.size)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {item.status === 'unlocked' && (
                          <span className="inline-flex items-center gap-1 text-[var(--accent-local)]">
                            <LockOpen className="h-3 w-3" /> {t('unlocker.batchStatusUnlocked')}
                            {item.elapsedMs !== undefined ? ` (${item.elapsedMs} ms)` : ''}
                          </span>
                        )}
                        {item.status === 'unencrypted' && (
                          <span className="text-[var(--ink-muted)]">
                            {t('unlocker.batchStatusUnencrypted')}
                          </span>
                        )}
                        {item.status === 'needs-password' && (
                          <span className="inline-flex items-center gap-1 text-[var(--accent-warn)]">
                            <Lock className="h-3 w-3" /> {t('unlocker.batchStatusNeedPass')}
                          </span>
                        )}
                        {item.status === 'error' && (
                          <span className="text-[#8A2C1D]">{item.errorMsg || 'Error'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {ready && (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                onSendPdfToEditor(
                                  new File([item.unlockedBlob!], unlockedName, {
                                    type: 'application/pdf',
                                  })
                                )
                              }
                              className="inline-flex items-center gap-1 border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-[11px] font-medium text-[var(--ink-primary)] hover:bg-[var(--bg-recessed)]"
                            >
                              <FilePenLine className="h-3 w-3" />
                              <span>{t('unlocker.openInEditor')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerBlobDownload(item.unlockedBlob!, unlockedName)}
                              className="inline-flex items-center gap-1 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-2.5 py-1 font-mono text-[11px] font-bold text-white hover:bg-[var(--accent-signal-hover)]"
                            >
                              <Download className="h-3 w-3" />
                              <span>{t('unlocker.extractBtn')}</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {file && mode === 'archive' && isUnlocked && (
        <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (allSelected) setSelectedPaths(new Set());
                  else setSelectedPaths(new Set(allNonDirPaths));
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-primary)]"
              >
                {allSelected ? (
                  <CheckSquare className="h-4 w-4 text-[var(--accent-signal)]" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                <span>
                  {t('unlocker.selectAll')} ({selectedPaths.size}/{allNonDirPaths.length})
                </span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedPaths.size > 0 && selectedPaths.size < allNonDirPaths.length && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleExtractBundleZip(false)}
                  className="inline-flex items-center gap-1.5 border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[var(--bg-recessed)] disabled:opacity-50"
                >
                  <FileArchive className="h-3.5 w-3.5" />
                  <span>{t('unlocker.downloadSelectedZip')}</span>
                </button>
              )}
              <button
                type="button"
                disabled={busy || allNonDirPaths.length === 0}
                onClick={() => void handleExtractBundleZip(true)}
                className="inline-flex items-center gap-1.5 border border-[var(--ink-primary)] bg-[var(--ink-primary)] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-black disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{busy ? t('unlocker.extracting') : t('unlocker.downloadAllZip')}</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] font-mono text-[11px] uppercase text-[var(--ink-muted)]">
                  <th className="w-9 px-3 py-2"></th>
                  <th className="px-3 py-2">{t('unlocker.colPath')}</th>
                  <th className="px-3 py-2 text-right">{t('unlocker.colOrigSize')}</th>
                  <th className="px-3 py-2 text-right">{t('unlocker.colCompSize')}</th>
                  <th className="px-3 py-2">{t('unlocker.colStatus')}</th>
                  <th className="px-3 py-2 text-right">{t('unlocker.colAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)]">
                {entries.map((entry) => {
                  const depth = Math.max(0, entry.path.replace(/\/+$/, '').split('/').length - 1);
                  const checked = selectedPaths.has(entry.path);
                  return (
                    <tr key={entry.id} className="hover:bg-[var(--bg-canvas)]">
                      <td className="px-3 py-2">
                        {!entry.isDirectory && (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelect(entry.path)}
                            aria-label={entry.path}
                            className="h-3.5 w-3.5 accent-[var(--accent-signal)]"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px] text-[var(--ink-primary)]">
                        <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 14}px` }}>
                          {entry.isDirectory ? (
                            <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--ink-secondary)]" />
                          )}
                          <span className="truncate">{entry.name || entry.path}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--ink-secondary)]">
                        {entry.isDirectory ? '—' : formatBytes(entry.uncompressedSize)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--ink-muted)]">
                        {entry.isDirectory ? '—' : formatBytes(entry.compressedSize)}
                      </td>
                      <td className="px-3 py-2">
                        {entry.encrypted ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--accent-local)]">
                            <LockOpen className="h-3 w-3" /> {t('unlocker.statusUnlocked')}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-[var(--ink-muted)]">
                            {t('unlocker.statusStandard')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!entry.isDirectory && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleExtractSingle(entry)}
                            className="inline-flex items-center gap-1 border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1 font-mono text-[11px] font-medium text-[var(--ink-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-recessed)] disabled:opacity-50"
                          >
                            <Download className="h-3 w-3" />
                            <span>{t('unlocker.extractBtn')}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-[var(--ink-muted)]">
                      {t('unlocker.emptyArchive')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {file && mode === 'pdf' && isUnlocked && pdfDoc && (
        <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1.5 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono text-xs tabular-nums">
                {t('unlocker.pageOf', { cur: currentPage, total: numPages })}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                disabled={currentPage >= numPages}
                className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1.5 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>

              <div className="ml-2 flex items-center gap-1 border-l border-[var(--border-hairline)] pl-2">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1.5"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[44px] text-center font-mono text-xs tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
                  className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1.5"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleOpenUnlockedInEditor()}
                className="inline-flex items-center gap-1.5 border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[var(--bg-recessed)] disabled:opacity-50"
              >
                <FilePenLine className="h-3.5 w-3.5" />
                <span>{t('unlocker.openInEditor')}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDecryptAndSavePdf()}
                className="inline-flex items-center gap-1.5 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[var(--accent-signal-hover)] disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{busy ? t('unlocker.saving') : t('unlocker.saveUnlockedPdf')}</span>
              </button>
            </div>
          </div>

          <div className="flex max-h-[68vh] justify-center overflow-auto bg-[var(--bg-mat)] p-6">
            <canvas
              ref={pdfCanvasRef}
              className="border border-[var(--border-hairline)] bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
};
