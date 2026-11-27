import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileArchive,
  Loader2,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  ConversionJob,
  ConverterOptions,
  ConverterOutputFormat,
  MemoryWarning,
} from '../types/workbench';
import {
  detectFileCategory,
  evaluateMemoryRisk,
  formatBytes,
  formatEta,
  getAllowedOutputFormats,
  getDefaultTargetFormat,
  getExtension,
} from '../utils/format';
import { memoryManager, triggerBlobDownload } from '../utils/memoryManager';
import {
  createBatchDownloadZip,
  resetFFmpegEngine,
  runConversionJob,
} from '../services/converterEngine';
import { MemoryBanner } from './MemoryBanner';
import { useI18n } from '../i18n/I18nContext';

interface ConverterWorkspaceProps {
  initialFiles?: File[];
}

const DEFAULT_OPTIONS: ConverterOptions = {
  imageQuality: 85,
  stripExif: true,
  videoResolution: 'original',
  videoFps: 'original',
  muteAudio: false,
  audioBitrate: '192k',
  paperSize: 'a4',
  paperOrientation: 'portrait',
};

const MAX_BATCH_FILES = 20;

export const ConverterWorkspace: React.FC<ConverterWorkspaceProps> = ({
  initialFiles,
}) => {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [batchWarning, setBatchWarning] = useState<string | null>(null);
  const [memoryWarning, setMemoryWarning] = useState<MemoryWarning | null>(null);

  const enqueueFiles = (incoming: File[]) => {
    setBatchWarning(null);
    const validJobs: ConversionJob[] = [];
    const rejectedNames: string[] = [];

    for (const file of incoming) {
      const cat = detectFileCategory(file);
      if (cat === 'image' || cat === 'video' || cat === 'audio' || cat === 'document') {
        const ext = getExtension(file.name);
        validJobs.push({
          id: crypto.randomUUID(),
          file,
          category: cat,
          inputExt: ext,
          targetFormat: getDefaultTargetFormat(cat, ext),
          options: { ...DEFAULT_OPTIONS },
          status: 'queued',
          progress: 0,
        });
      } else {
        rejectedNames.push(file.name);
      }
    }

    if (rejectedNames.length > 0) {
      setBatchWarning(rejectedNames.join(', '));
    }

    setJobs((prev) => {
      const available = MAX_BATCH_FILES - prev.length;
      if (available <= 0) return prev;
      const sliced = validJobs.slice(0, available);
      const next = [...prev, ...sliced];
      setMemoryWarning(evaluateMemoryRisk(next.map((j) => j.file)));
      if (!selectedJobId && sliced.length > 0) {
        setSelectedJobId(sliced[0].id);
      }
      return next;
    });
  };

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      enqueueFiles(initialFiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  useEffect(() => {
    return memoryManager.registerCleanupCallback(() => {
      setJobs((prev) => {
        for (const j of prev) {
          memoryManager.revokeManagedUrl(j.outputUrl);
        }
        return [];
      });
      setSelectedJobId(null);
      setBatchWarning(null);
      setMemoryWarning(null);
      resetFFmpegEngine();
    });
  }, []);

  const updateJob = (id: string, updater: (job: ConversionJob) => ConversionJob) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? updater(j) : j)));
  };

  const removeJob = (id: string) => {
    setJobs((prev) => {
      const target = prev.find((j) => j.id === id);
      if (target?.outputUrl) memoryManager.revokeManagedUrl(target.outputUrl);
      const next = prev.filter((j) => j.id !== id);
      if (selectedJobId === id) {
        setSelectedJobId(next[0]?.id ?? null);
      }
      setMemoryWarning(evaluateMemoryRisk(next.map((j) => j.file)));
      return next;
    });
  };

  const runQueue = async () => {
    if (isRunning) return;
    setIsRunning(true);

    const queue = jobs.filter((j) => j.status === 'queued' || j.status === 'error');
    for (const item of queue) {
      updateJob(item.id, (j) => ({
        ...j,
        status: 'processing',
        progress: 2,
        errorMessage: undefined,
      }));
      try {
        const result = await runConversionJob(item, (progress, etaSeconds) => {
          updateJob(item.id, (j) => ({ ...j, progress, etaSeconds }));
        });
        const outputUrl = memoryManager.createManagedUrl(result.blob);
        updateJob(item.id, (j) => ({
          ...j,
          status: 'done',
          progress: 100,
          etaSeconds: 0,
          outputBlob: result.blob,
          outputUrl,
          outputName: result.outputName,
          outputSize: result.blob.size,
        }));
      } catch (err) {
        updateJob(item.id, (j) => ({
          ...j,
          status: 'error',
          progress: 0,
          errorMessage: err instanceof Error ? err.message : 'Error',
        }));
      }
    }

    setIsRunning(false);
  };

  const handleDownloadAllZip = async () => {
    const doneCount = jobs.filter((j) => j.status === 'done' && j.outputBlob).length;
    if (doneCount === 0) return;
    const zipBlob = await createBatchDownloadZip(jobs);
    triggerBlobDownload(zipBlob, `fuck_pdf_batch_${doneCount}_files.zip`);
  };

  const activeJob = jobs.find((j) => j.id === selectedJobId) || jobs[0] || null;
  const doneJobs = jobs.filter((j) => j.status === 'done');
  const pendingCount = jobs.filter((j) => j.status === 'queued' || j.status === 'error').length;

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-5 sm:px-6">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,.heic,.heif,.mkv,.avi,.flac,.docx,.txt,.md,.markdown,.html,.htm,.csv,.xlsx"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) enqueueFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-3">
        <div>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
            {t('conv.eyebrow')}
          </span>
          <h2 className="text-lg font-bold text-[var(--ink-primary)]">
            {t('conv.title', { count: jobs.length, max: MAX_BATCH_FILES })}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={jobs.length >= MAX_BATCH_FILES}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[var(--bg-recessed)] disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('conv.addFiles')}</span>
          </button>

          {doneJobs.length > 0 && (
            <button
              type="button"
              onClick={() => void handleDownloadAllZip()}
              className="inline-flex items-center gap-1.5 border border-[var(--border-strong)] bg-[var(--ink-primary)] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-black"
            >
              <FileArchive className="h-3.5 w-3.5" />
              <span>{t('conv.downloadAllZip', { count: doneJobs.length })}</span>
            </button>
          )}

          <button
            type="button"
            disabled={isRunning || pendingCount === 0}
            onClick={() => void runQueue()}
            className="inline-flex items-center gap-1.5 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--accent-signal-hover)] disabled:opacity-45"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span>{isRunning ? t('conv.converting') : t('conv.convertBtn', { count: pendingCount })}</span>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <MemoryBanner warning={memoryWarning} onDismiss={() => setMemoryWarning(null)} />
        {batchWarning && (
          <div
            role="status"
            className="flex items-center gap-2 border border-[#9A5B00] bg-[#FDF8EC] px-3.5 py-2 text-xs text-[#6E4000]"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{batchWarning}</span>
          </div>
        )}
      </div>

      {jobs.length === 0 ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) enqueueFiles(Array.from(e.dataTransfer.files));
          }}
          className="workbench-grid mt-4 flex flex-col items-center justify-center border border-dashed border-[var(--ink-primary)] bg-[var(--bg-surface)] px-6 py-16 text-center"
        >
          <p className="text-sm font-bold text-[var(--ink-primary)]">
            {t('conv.emptyTitle')}
          </p>
          <p className="mt-1 max-w-lg text-xs text-[var(--ink-secondary)]">
            {t('conv.emptyDesc')}
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--accent-signal-hover)]"
          >
            {t('conv.pickBatchBtn')}
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) enqueueFiles(Array.from(e.dataTransfer.files));
          }}
          className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12"
        >
          <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] lg:col-span-8">
            <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
              {t('conv.queueHeader')}
            </div>
            <div className="divide-y divide-[var(--border-hairline)]">
              {jobs.map((job) => {
                const isSelected = activeJob?.id === job.id;
                const formats = getAllowedOutputFormats(job.category);
                return (
                  <div
                    key={job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    className={`cursor-pointer p-3 transition-colors ${
                      isSelected ? 'bg-[#F8F6F0]' : 'hover:bg-[var(--bg-canvas)]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-[var(--ink-secondary)]">
                            {job.category}
                          </span>
                          <span className="truncate text-xs font-bold text-[var(--ink-primary)]">
                            {job.file.name}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[11px] text-[var(--ink-muted)] tabular-nums">
                          <span>
                            {t('conv.origSize')}: {formatBytes(job.file.size)}
                          </span>
                          {job.outputSize !== undefined && (
                            <span className="text-[var(--accent-local)]">
                              {t('conv.outSize')}: {formatBytes(job.outputSize)}
                            </span>
                          )}
                          {job.status === 'processing' && (
                            <span className="text-[var(--ink-primary)]">
                              {job.progress}% · ETA {formatEta(job.etaSeconds)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <select
                          id={`fmt-${job.id}`}
                          aria-label={job.file.name}
                          value={job.targetFormat}
                          disabled={job.status === 'processing'}
                          onChange={(e) =>
                            updateJob(job.id, (j) => ({
                              ...j,
                              targetFormat: e.target.value as ConverterOutputFormat,
                              status: j.status === 'done' ? 'queued' : j.status,
                              progress: j.status === 'done' ? 0 : j.progress,
                            }))
                          }
                          className="border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-xs text-[var(--ink-primary)]"
                        >
                          {formats.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>

                        {job.status === 'done' && job.outputBlob && job.outputName && (
                          <button
                            type="button"
                            onClick={() => triggerBlobDownload(job.outputBlob!, job.outputName!)}
                            className="inline-flex items-center gap-1 border border-[var(--accent-local)] bg-[#F2F8F4] px-2.5 py-1 font-mono text-[11px] font-bold text-[var(--accent-local)] hover:bg-[#E1F0E7]"
                          >
                            <Download className="h-3 w-3" />
                            <span>{t('conv.download')}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={job.status === 'processing'}
                          onClick={() => removeJob(job.id)}
                          className="border border-[var(--border-hairline)] p-1 text-[var(--ink-muted)] hover:border-[#8A2C1D] hover:text-[#8A2C1D] disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-2">
                      <div className="h-1.5 w-full bg-[var(--bg-recessed)]">
                        <div
                          className={`h-full transition-all ${
                            job.status === 'error'
                              ? 'bg-[#8A2C1D]'
                              : job.status === 'done'
                              ? 'bg-[var(--accent-local)]'
                              : 'bg-[var(--accent-signal)]'
                          }`}
                          style={{ width: `${job.status === 'done' ? 100 : job.progress}%` }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px]">
                        {job.status === 'queued' && (
                          <span className="font-mono text-[var(--ink-muted)]">
                            {t('conv.statusQueued')}
                          </span>
                        )}
                        {job.status === 'processing' && (
                          <span className="flex items-center gap-1 font-mono text-[var(--accent-signal)]">
                            <Loader2 className="h-3 w-3 animate-spin" /> {t('conv.statusProcessing')}
                          </span>
                        )}
                        {job.status === 'done' && (
                          <span className="flex items-center gap-1 font-mono text-[var(--accent-local)]">
                            <CheckCircle2 className="h-3 w-3" /> {t('conv.statusDone')} · {job.outputName}
                          </span>
                        )}
                        {job.status === 'error' && (
                          <span className="flex items-center gap-1 text-[#8A2C1D]">
                            <AlertCircle className="h-3 w-3" /> {job.errorMessage}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] lg:col-span-4">
            <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
              {t('conv.inspectorHeader')}
            </div>

            {activeJob ? (
              <div className="space-y-4 p-4 text-xs">
                <div className="border-b border-[var(--border-hairline)] pb-3">
                  <p className="truncate font-bold text-[var(--ink-primary)]">
                    {activeJob.file.name}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--ink-muted)]">
                    {activeJob.inputExt.toUpperCase()} → {activeJob.targetFormat.toUpperCase()}
                  </p>
                </div>

                {activeJob.category === 'image' && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between font-mono text-[11px]">
                        <label htmlFor="img-quality">{t('conv.imgQuality')}</label>
                        <span>{activeJob.options.imageQuality}%</span>
                      </div>
                      <input
                        id="img-quality"
                        type="range"
                        min={10}
                        max={100}
                        value={activeJob.options.imageQuality}
                        onChange={(e) =>
                          updateJob(activeJob.id, (j) => ({
                            ...j,
                            status: j.status === 'done' ? 'queued' : j.status,
                            options: { ...j.options, imageQuality: Number(e.target.value) },
                          }))
                        }
                        className="mt-1 w-full accent-[var(--accent-signal)]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="img-w" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                          {t('conv.imgWidth')}
                        </label>
                        <input
                          id="img-w"
                          type="number"
                          min={1}
                          placeholder={t('conv.originalPlaceholder')}
                          value={activeJob.options.imageWidth ?? ''}
                          onChange={(e) =>
                            updateJob(activeJob.id, (j) => ({
                              ...j,
                              status: j.status === 'done' ? 'queued' : j.status,
                              options: {
                                ...j.options,
                                imageWidth: e.target.value ? Number(e.target.value) : undefined,
                              },
                            }))
                          }
                          className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor="img-h" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                          {t('conv.imgHeight')}
                        </label>
                        <input
                          id="img-h"
                          type="number"
                          min={1}
                          placeholder={t('conv.originalPlaceholder')}
                          value={activeJob.options.imageHeight ?? ''}
                          onChange={(e) =>
                            updateJob(activeJob.id, (j) => ({
                              ...j,
                              status: j.status === 'done' ? 'queued' : j.status,
                              options: {
                                ...j.options,
                                imageHeight: e.target.value ? Number(e.target.value) : undefined,
                              },
                            }))
                          }
                          className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        checked={activeJob.options.stripExif}
                        onChange={(e) =>
                          updateJob(activeJob.id, (j) => ({
                            ...j,
                            options: { ...j.options, stripExif: e.target.checked },
                          }))
                        }
                        className="accent-[var(--accent-signal)]"
                      />
                      <span>{t('conv.stripExif')}</span>
                    </label>
                  </div>
                )}

                {activeJob.category === 'video' && (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="vid-res" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                        {t('conv.vidRes')}
                      </label>
                      <select
                        id="vid-res"
                        value={activeJob.options.videoResolution}
                        onChange={(e) =>
                          updateJob(activeJob.id, (j) => ({
                            ...j,
                            status: j.status === 'done' ? 'queued' : j.status,
                            options: {
                              ...j.options,
                              videoResolution: e.target.value as ConverterOptions['videoResolution'],
                            },
                          }))
                        }
                        className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                      >
                        <option value="original">{t('conv.vidResOrig')}</option>
                        <option value="1080p">1080p (Full HD)</option>
                        <option value="720p">720p (HD)</option>
                        <option value="480p">480p (SD)</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="vid-fps" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                        {t('conv.vidFps')}
                      </label>
                      <select
                        id="vid-fps"
                        value={activeJob.options.videoFps}
                        onChange={(e) =>
                          updateJob(activeJob.id, (j) => ({
                            ...j,
                            status: j.status === 'done' ? 'queued' : j.status,
                            options: {
                              ...j.options,
                              videoFps: e.target.value as ConverterOptions['videoFps'],
                            },
                          }))
                        }
                        className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                      >
                        <option value="original">{t('conv.originalPlaceholder')}</option>
                        <option value="60">60 FPS</option>
                        <option value="30">30 FPS</option>
                        <option value="24">24 FPS</option>
                        <option value="15">15 FPS</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="vid-start" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                          {t('conv.trimStart')}
                        </label>
                        <input
                          id="vid-start"
                          type="number"
                          min={0}
                          placeholder="0"
                          value={activeJob.options.trimStartSec ?? ''}
                          onChange={(e) =>
                            updateJob(activeJob.id, (j) => ({
                              ...j,
                              options: {
                                ...j.options,
                                trimStartSec: e.target.value ? Number(e.target.value) : undefined,
                              },
                            }))
                          }
                          className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor="vid-end" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                          {t('conv.trimEnd')}
                        </label>
                        <input
                          id="vid-end"
                          type="number"
                          min={0}
                          placeholder={t('conv.trimEndPlaceholder')}
                          value={activeJob.options.trimEndSec ?? ''}
                          onChange={(e) =>
                            updateJob(activeJob.id, (j) => ({
                              ...j,
                              options: {
                                ...j.options,
                                trimEndSec: e.target.value ? Number(e.target.value) : undefined,
                              },
                            }))
                          }
                          className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        checked={activeJob.options.muteAudio}
                        onChange={(e) =>
                          updateJob(activeJob.id, (j) => ({
                            ...j,
                            options: { ...j.options, muteAudio: e.target.checked },
                          }))
                        }
                        className="accent-[var(--accent-signal)]"
                      />
                      <span>{t('conv.muteAudio')}</span>
                    </label>
                  </div>
                )}

                {activeJob.category === 'audio' && (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="aud-bitrate" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                        {t('conv.audBitrate')}
                      </label>
                      <select
                        id="aud-bitrate"
                        value={activeJob.options.audioBitrate}
                        onChange={(e) =>
                          updateJob(activeJob.id, (j) => ({
                            ...j,
                            options: {
                              ...j.options,
                              audioBitrate: e.target.value as ConverterOptions['audioBitrate'],
                            },
                          }))
                        }
                        className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                      >
                        <option value="128k">128 kbps</option>
                        <option value="192k">192 kbps</option>
                        <option value="320k">320 kbps</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="aud-start" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                          {t('conv.trimStart')}
                        </label>
                        <input
                          id="aud-start"
                          type="number"
                          min={0}
                          placeholder="0"
                          value={activeJob.options.trimStartSec ?? ''}
                          onChange={(e) =>
                            updateJob(activeJob.id, (j) => ({
                              ...j,
                              options: {
                                ...j.options,
                                trimStartSec: e.target.value ? Number(e.target.value) : undefined,
                              },
                            }))
                          }
                          className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor="aud-end" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                          {t('conv.trimEnd')}
                        </label>
                        <input
                          id="aud-end"
                          type="number"
                          min={0}
                          placeholder={t('conv.trimEndPlaceholder')}
                          value={activeJob.options.trimEndSec ?? ''}
                          onChange={(e) =>
                            updateJob(activeJob.id, (j) => ({
                              ...j,
                              options: {
                                ...j.options,
                                trimEndSec: e.target.value ? Number(e.target.value) : undefined,
                              },
                            }))
                          }
                          className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeJob.category === 'document' && (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="doc-paper" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                        {t('conv.docPaper')}
                      </label>
                      <select
                        id="doc-paper"
                        value={activeJob.options.paperSize}
                        disabled={activeJob.targetFormat !== 'pdf'}
                        onChange={(e) =>
                          updateJob(activeJob.id, (j) => ({
                            ...j,
                            options: {
                              ...j.options,
                              paperSize: e.target.value as ConverterOptions['paperSize'],
                            },
                          }))
                        }
                        className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs disabled:opacity-50"
                      >
                        <option value="a4">A4 (210 × 297 mm)</option>
                        <option value="letter">Letter (8.5 × 11 in)</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="doc-orient" className="block font-mono text-[11px] text-[var(--ink-secondary)]">
                        {t('conv.docOrient')}
                      </label>
                      <select
                        id="doc-orient"
                        value={activeJob.options.paperOrientation}
                        disabled={activeJob.targetFormat !== 'pdf'}
                        onChange={(e) =>
                          updateJob(activeJob.id, (j) => ({
                            ...j,
                            options: {
                              ...j.options,
                              paperOrientation: e.target.value as ConverterOptions['paperOrientation'],
                            },
                          }))
                        }
                        className="mt-1 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-1.5 font-mono text-xs disabled:opacity-50"
                      >
                        <option value="portrait">{t('conv.orientPortrait')}</option>
                        <option value="landscape">{t('conv.orientLandscape')}</option>
                      </select>
                    </div>
                  </div>
                )}

                {activeJob.status === 'done' && activeJob.outputUrl && (
                  <div className="border-t border-[var(--border-hairline)] pt-3">
                    <p className="mb-2 font-mono text-[11px] font-bold uppercase text-[var(--ink-muted)]">
                      {t('conv.previewTitle')}
                    </p>
                    {activeJob.category === 'image' && (
                      <img
                        src={activeJob.outputUrl}
                        alt={activeJob.outputName}
                        className="max-h-48 w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] object-contain"
                      />
                    )}
                    {activeJob.category === 'audio' && (
                      <audio controls src={activeJob.outputUrl} className="w-full" />
                    )}
                    {activeJob.category === 'video' && activeJob.targetFormat !== 'gif' && (
                      <video
                        controls
                        src={activeJob.outputUrl}
                        className="max-h-48 w-full border border-[var(--border-hairline)] bg-black"
                      />
                    )}
                    {activeJob.category === 'video' && activeJob.targetFormat === 'gif' && (
                      <img
                        src={activeJob.outputUrl}
                        alt={activeJob.outputName}
                        className="max-h-48 w-full border border-[var(--border-hairline)] object-contain"
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="p-4 text-xs text-[var(--ink-muted)]">{t('conv.inspectorEmpty')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
