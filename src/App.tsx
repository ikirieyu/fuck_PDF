import React, { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { MemoryWarning, PdfToolId, WorkspaceTab } from './types/workbench';
import { detectFileCategory, evaluateMemoryRisk } from './utils/format';
import { memoryManager } from './utils/memoryManager';
import {
  hasPdfEncryptDictionary,
  inspectAndOpenPdf,
  PdfSecurityError,
} from './services/pdfSecurityEngine';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { TopBar } from './components/TopBar';
import { UnlockerWorkspace } from './components/UnlockerWorkspace';
import { ConverterWorkspace } from './components/ConverterWorkspace';
import { PdfEditorWorkspace } from './components/PdfEditorWorkspace';
import { PdfToolsWorkspace } from './components/PdfToolsWorkspace';
import { TelemetryModal } from './components/TelemetryModal';
import { MemoryBanner } from './components/MemoryBanner';
import { LegalSecurityModal, type LegalTab } from './components/LegalSecurityModal';
import { NotFound404 } from './components/NotFound404';

const AppShell: React.FC = () => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('home');
  const [unlockerFile, setUnlockerFile] = useState<File | null>(null);
  const [unlockerBatch, setUnlockerBatch] = useState<File[]>([]);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [editorFocusedTool, setEditorFocusedTool] = useState<PdfToolId | null>(null);
  const [activeToolLabel, setActiveToolLabel] = useState<string | null>(null);
  const [toolsResetSignal, setToolsResetSignal] = useState(0);
  const [converterBatch, setConverterBatch] = useState<File[]>([]);
  const [globalMemoryWarning, setGlobalMemoryWarning] = useState<MemoryWarning | null>(null);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalTab>('security');
  const [routePath, setRoutePath] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const onPop = () => setRoutePath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const isNotFound = routePath !== '/' && routePath !== '/index.html';

  const openLegal = (tab: LegalTab) => {
    setLegalTab(tab);
    setLegalOpen(true);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 3500);
  };

  const routeDroppedFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const risk = evaluateMemoryRisk(files);
    setGlobalMemoryWarning(risk);

    const first = files[0];
    const cat = detectFileCategory(first);

    if (files.length === 1 && cat === 'archive') {
      setUnlockerFile(first);
      setActiveTab('unlocker');
      return;
    }

    if (files.length === 1 && cat === 'pdf') {
      // Quick check if PDF has /Encrypt (owner-lock or user-password) to auto-route cleanly
      try {
        const bytes = new Uint8Array(await first.arrayBuffer());
        if (hasPdfEncryptDictionary(bytes)) {
          setUnlockerFile(first);
          setActiveTab('unlocker');
          return;
        }
        const res = await inspectAndOpenPdf(bytes);
        await res.docProxy?.cleanup().catch(() => {});
        // Not encrypted: open in Editor, also keep reference for Unlocker
        setEditorFile(first);
        setUnlockerFile(first);
        setActiveTab('editor');
      } catch (err) {
        if (err instanceof PdfSecurityError && err.code === 'NEED_PASSWORD') {
          setUnlockerFile(first);
          setActiveTab('unlocker');
        } else {
          setUnlockerFile(first);
          setActiveTab('unlocker');
        }
      }
      return;
    }

    // Multiple files or media/document files -> Converter batch
    const mediaOrDocs = files.filter((f) => {
      const c = detectFileCategory(f);
      return c === 'image' || c === 'video' || c === 'audio' || c === 'document';
    });

    if (mediaOrDocs.length > 0) {
      setConverterBatch(mediaOrDocs);
      setActiveTab('converter');
      return;
    }

    // If multiple PDFs dropped: if > 1 PDF, route to Unlocker Batch (fadeltd/pdfunlock style)
    const pdfs = files.filter((f) => detectFileCategory(f) === 'pdf');
    if (pdfs.length > 1) {
      setUnlockerBatch(pdfs);
      setUnlockerFile(null);
      setActiveTab('unlocker');
      return;
    }
    if (pdfs.length === 1) {
      setEditorFile(pdfs[0]);
      setActiveTab('editor');
      return;
    }

    const archives = files.filter((f) => detectFileCategory(f) === 'archive');
    if (archives.length > 0) {
      setUnlockerFile(archives[0]);
      setActiveTab('unlocker');
      return;
    }

    showToast(t('unknownFormatToast', { name: first.name }));
  };

  // Global Ctrl+V clipboard paste support
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.files;
      if (items && items.length > 0) {
        void routeDroppedFiles(Array.from(items));
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePurgeMemory = () => {
    const revoked = memoryManager.purgeAllMemory();
    setUnlockerFile(null);
    setUnlockerBatch([]);
    setEditorFile(null);
    setEditorFocusedTool(null);
    setActiveToolLabel(null);
    setToolsResetSignal((n) => n + 1);
    setConverterBatch([]);
    setGlobalMemoryWarning(null);
    setActiveTab('home');
    showToast(t('memory.purgedToast', { count: revoked }));
  };

  const handleSelectTab = (tab: WorkspaceTab) => {
    if (tab === 'home' || tab === 'tools') {
      setActiveToolLabel(null);
      setEditorFocusedTool(null);
      setToolsResetSignal((n) => n + 1);
      setActiveTab('home');
    } else {
      setActiveTab(tab);
    }
  };

  const hasActiveWork =
    Boolean(unlockerFile) ||
    unlockerBatch.length > 0 ||
    Boolean(editorFile) ||
    converterBatch.length > 0 ||
    Boolean(activeToolLabel) ||
    activeTab !== 'home';

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-canvas)] text-[var(--ink-primary)]">
      <TopBar
        activeTab={activeTab}
        activeToolLabel={activeToolLabel}
        onSelectTab={handleSelectTab}
        hasActiveWork={hasActiveWork}
        onPurgeMemory={handlePurgeMemory}
        onOpenTelemetry={() => setTelemetryOpen(true)}
      />

      {globalMemoryWarning && activeTab !== 'converter' && (
        <div className="mx-auto mt-3 w-full max-w-[1360px] px-4 sm:px-6">
          <MemoryBanner
            warning={globalMemoryWarning}
            onDismiss={() => setGlobalMemoryWarning(null)}
          />
        </div>
      )}

      <main className="flex-1">
        {isNotFound ? (
          <NotFound404
            path={routePath}
            onGoHome={() => {
              window.history.pushState({}, '', '/');
              setRoutePath('/');
              setActiveTab('home');
            }}
          />
        ) : (
          <>
            {(activeTab === 'home' || activeTab === 'tools') && (
              <PdfToolsWorkspace
                onNavigateTab={(tab) => {
                  setActiveToolLabel(null);
                  setActiveTab(tab);
                }}
                onSelectEditorTool={(toolId) => {
                  setEditorFocusedTool(toolId);
                  setActiveToolLabel(toolId.replace(/-/g, ' ').toUpperCase());
                  setActiveTab('editor');
                }}
                onFilesDropped={(files) => void routeDroppedFiles(files)}
                onActiveToolChange={setActiveToolLabel}
                resetSignal={toolsResetSignal}
              />
            )}

            {activeTab === 'unlocker' && (
              <UnlockerWorkspace
                initialFile={unlockerFile}
                initialFiles={unlockerBatch}
                onSendPdfToEditor={(unlockedFile) => {
                  setEditorFile(unlockedFile);
                  setActiveTab('editor');
                }}
              />
            )}

            {activeTab === 'converter' && (
              <ConverterWorkspace initialFiles={converterBatch} />
            )}

            {activeTab === 'editor' && (
              <PdfEditorWorkspace
                initialFile={editorFile}
                focusedTool={editorFocusedTool}
                onBackToTools={() => {
                  setEditorFocusedTool(null);
                  setActiveToolLabel(null);
                  setActiveTab('home');
                }}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-3 text-[11px] text-[var(--ink-muted)] sm:px-6">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 font-mono">
          <span>{t('footer.left')}</span>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => openLegal('security')}
              className="underline decoration-dotted hover:text-[var(--ink-primary)]"
            >
              Security &amp; Cache
            </button>
            <button
              type="button"
              onClick={() => openLegal('license')}
              className="underline decoration-dotted hover:text-[var(--ink-primary)]"
            >
              License (MIT)
            </button>
            <button
              type="button"
              onClick={() => openLegal('privacy')}
              className="underline decoration-dotted hover:text-[var(--ink-primary)]"
            >
              Privacy
            </button>
            <a
              href="https://sociabuzz.com/ikirieyu"
              target="_blank"
              rel="noopener noreferrer"
              className="border border-[var(--accent-signal)] bg-[#FFF8F6] px-2 py-0.5 font-semibold text-[var(--accent-signal)] hover:bg-[var(--accent-signal)] hover:text-white"
            >
              Donasi / Support ↗
            </a>
            <span className="hidden sm:inline">· {t('footer.right')}</span>
          </div>
        </div>
      </footer>

      <TelemetryModal open={telemetryOpen} onClose={() => setTelemetryOpen(false)} />
      <LegalSecurityModal
        open={legalOpen}
        initialTab={legalTab}
        onClose={() => setLegalOpen(false)}
      />

      {toastMessage && (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-50 flex items-center gap-2 border border-[var(--border-strong)] bg-[var(--ink-primary)] px-3.5 py-2.5 text-xs font-medium text-white"
        >
          <CheckCircle2 className="h-4 w-4 text-[#5CE097]" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

export const App: React.FC = () => (
  <I18nProvider>
    <AppShell />
  </I18nProvider>
);

export default App;
