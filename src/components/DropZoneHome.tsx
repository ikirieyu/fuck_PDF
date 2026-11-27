import React, { useRef, useState } from 'react';
import { ArrowRight, FileKey2, FilePenLine, RefreshCw, Upload } from 'lucide-react';
import type { WorkspaceTab } from '../types/workbench';
import { useI18n } from '../i18n/I18nContext';

interface DropZoneHomeProps {
  onFilesDropped: (files: File[]) => void;
  onNavigateTab: (tab: WorkspaceTab) => void;
}

export const DropZoneHome: React.FC<DropZoneHomeProps> = ({
  onFilesDropped,
  onNavigateTab,
}) => {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    onFilesDropped(Array.from(fileList));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-col justify-between gap-3 border-b border-[var(--border-hairline)] pb-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[var(--accent-signal)]">
            {t('home.eyebrow')}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink-primary)] sm:text-3xl">
            {t('home.heading')}
          </h1>
        </div>
        <p className="max-w-md text-xs leading-relaxed text-[var(--ink-secondary)]">
          {t('home.subheading')}
        </p>
      </div>

      <div
        role="region"
        aria-label={t('home.dropAria')}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={handleDrop}
        className={`workbench-grid relative border-2 transition-colors ${
          isDragging
            ? 'border-[var(--accent-signal)] bg-[#FFF8F6]'
            : 'border-dashed border-[var(--ink-primary)] bg-[var(--bg-surface)] hover:border-[var(--accent-signal)]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label={t('home.inputAria')}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <div className="flex flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
          <div
            className={`mb-4 flex h-12 w-12 items-center justify-center border ${
              isDragging
                ? 'border-[var(--accent-signal)] bg-[var(--accent-signal)] text-white'
                : 'border-[var(--ink-primary)] bg-[var(--bg-canvas)] text-[var(--ink-primary)]'
            }`}
          >
            <Upload className="h-5 w-5" aria-hidden="true" />
          </div>

          <h2 className="text-lg font-bold text-[var(--ink-primary)] sm:text-xl">
            {isDragging ? t('home.dropActive') : t('home.dropIdle')}
          </h2>
          <p className="mt-1.5 max-w-xl text-xs text-[var(--ink-secondary)] sm:text-sm">
            {t('home.dropDesc')}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-[var(--accent-signal-hover)]"
            >
              <span>{t('home.pickBtn')}</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span className="font-mono text-[11px] text-[var(--ink-muted)]">
              {t('home.pasteHint')} (
              <kbd className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1 py-0.5">
                Ctrl+V
              </kbd>
              )
            </span>
          </div>

          <div className="mt-7 flex flex-wrap justify-center gap-1.5 font-mono text-[11px]">
            {[
              'PDF',
              'ZIP',
              'RAR / RAR5',
              '7Z',
              'JPG / PNG / WebP / HEIC',
              'MP4 / MKV / WebM / MOV',
              'MP3 / FLAC / WAV',
              'DOCX / XLSX / MD / CSV',
            ].map((badge) => (
              <span
                key={badge}
                className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[var(--ink-secondary)]"
              >
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-px border border-[var(--border-hairline)] bg-[var(--border-hairline)] md:grid-cols-3">
        <button
          type="button"
          onClick={() => onNavigateTab('unlocker')}
          className="group flex flex-col justify-between bg-[var(--bg-surface)] p-4 text-left transition-colors hover:bg-[var(--bg-canvas)]"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                {t('home.modA.tag')}
              </span>
              <FileKey2 className="h-4 w-4 text-[var(--ink-primary)]" aria-hidden="true" />
            </div>
            <h3 className="mt-2 text-sm font-bold text-[var(--ink-primary)] group-hover:text-[var(--accent-signal)]">
              {t('home.modA.title')}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-secondary)]">
              {t('home.modA.desc')}
            </p>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-[var(--border-hairline)] pt-2.5 font-mono text-[11px] text-[var(--ink-secondary)]">
            <span>zip.js · unrar · 7z-wasm · qpdf</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('converter')}
          className="group flex flex-col justify-between bg-[var(--bg-surface)] p-4 text-left transition-colors hover:bg-[var(--bg-canvas)]"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                {t('home.modB.tag')}
              </span>
              <RefreshCw className="h-4 w-4 text-[var(--ink-primary)]" aria-hidden="true" />
            </div>
            <h3 className="mt-2 text-sm font-bold text-[var(--ink-primary)] group-hover:text-[var(--accent-signal)]">
              {t('home.modB.title')}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-secondary)]">
              {t('home.modB.desc')}
            </p>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-[var(--border-hairline)] pt-2.5 font-mono text-[11px] text-[var(--ink-secondary)]">
            <span>ffmpeg.wasm · libheif · mammoth</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('editor')}
          className="group flex flex-col justify-between bg-[var(--bg-surface)] p-4 text-left transition-colors hover:bg-[var(--bg-canvas)]"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                {t('home.modC.tag')}
              </span>
              <FilePenLine className="h-4 w-4 text-[var(--ink-primary)]" aria-hidden="true" />
            </div>
            <h3 className="mt-2 text-sm font-bold text-[var(--ink-primary)] group-hover:text-[var(--accent-signal)]">
              {t('home.modC.title')}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-secondary)]">
              {t('home.modC.desc')}
            </p>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-[var(--border-hairline)] pt-2.5 font-mono text-[11px] text-[var(--ink-secondary)]">
            <span>pdf.js · pdf-lib · canvas</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
        </button>
      </div>
    </div>
  );
};
