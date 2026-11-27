import React, { useEffect } from 'react';
import { Activity, Cpu, HardDrive, ShieldCheck, Wifi, WifiOff, X } from 'lucide-react';
import { memoryManager } from '../utils/memoryManager';
import { useI18n } from '../i18n/I18nContext';

interface TelemetryModalProps {
  open: boolean;
  onClose: () => void;
}

export const TelemetryModal: React.FC<TelemetryModalProps> = ({ open, onClose }) => {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const stats = memoryManager.getExternalUploadStats();
  const activeUrls = memoryManager.getActiveUrlCount();
  const nav = navigator as Navigator & { deviceMemory?: number };
  const deviceMemory = nav.deviceMemory ? `~${nav.deviceMemory} GB` : t('telemetry.notReported');
  const cores = navigator.hardwareConcurrency || t('telemetry.unknown');
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  const swActive =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="telemetry-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg border border-[var(--border-strong)] bg-[var(--bg-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--accent-local)]" aria-hidden="true" />
            <h2 id="telemetry-title" className="font-mono text-sm font-bold text-[var(--ink-primary)]">
              {t('telemetry.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-transparent p-1 text-[var(--ink-secondary)] hover:border-[var(--border-hairline)] hover:text-[var(--ink-primary)]"
            aria-label={t('telemetry.closeAria')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4 text-xs text-[var(--ink-secondary)]">
          <p className="leading-relaxed">{t('telemetry.desc')}</p>

          <div className="divide-y divide-[var(--border-hairline)] border border-[var(--border-hairline)] bg-[var(--bg-canvas)] font-mono">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2 text-[var(--ink-primary)]">
                <Activity className="h-3.5 w-3.5 text-[var(--accent-local)]" aria-hidden="true" />
                {t('telemetry.externalData')}
              </span>
              <span
                className={`font-bold tabular-nums ${
                  stats.bytes > 0 ? 'text-[var(--accent-warn)]' : 'text-[var(--accent-local)]'
                }`}
              >
                {stats.bytes > 0 ? `${Math.max(1, Math.round(stats.bytes / 1024))} KB` : '0 KB'} ({stats.requests} req)
              </span>
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2 text-[var(--ink-primary)]">
                {navigator.onLine ? (
                  <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {t('telemetry.networkCache')}
              </span>
              <span className="tabular-nums">
                {navigator.onLine ? t('telemetry.online') : t('telemetry.offline')} · SW{' '}
                {swActive ? t('telemetry.swActive') : t('telemetry.swStandard')}
              </span>
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2 text-[var(--ink-primary)]">
                <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                {t('telemetry.deviceRam')}
              </span>
              <span className="tabular-nums">
                {deviceMemory} · {cores} thread · {isolated ? 'Isolated' : 'Single-Thread'}
              </span>
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2 text-[var(--ink-primary)]">
                <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
                {t('telemetry.activeUrls')}
              </span>
              <span className="tabular-nums">{activeUrls}</span>
            </div>
          </div>

          <p className="border-l-2 border-[var(--ink-primary)] pl-3 text-[11px] leading-relaxed text-[var(--ink-muted)]">
            {t('telemetry.verifyNote')}
          </p>
        </div>

        <div className="flex justify-end border-t border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="border border-[var(--border-strong)] bg-[var(--ink-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
          >
            {t('telemetry.ack')}
          </button>
        </div>
      </div>
    </div>
  );
};
