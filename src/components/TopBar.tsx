import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  Globe,
  LayoutGrid,
  ShieldCheck,
  Trash2,
  WifiOff,
} from 'lucide-react';
import type { WorkspaceTab } from '../types/workbench';
import { memoryManager } from '../utils/memoryManager';
import { useI18n } from '../i18n/I18nContext';
import { LOCALE_OPTIONS, type Locale } from '../i18n/translations';

interface TopBarProps {
  activeTab: WorkspaceTab;
  activeToolLabel?: string | null;
  onSelectTab: (tab: WorkspaceTab) => void;
  hasActiveWork: boolean;
  onPurgeMemory: () => void;
  onOpenTelemetry: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  activeToolLabel,
  onSelectTab,
  hasActiveWork,
  onPurgeMemory,
  onOpenTelemetry,
}) => {
  const { locale, setLocale, t } = useI18n();
  const [urlCount, setUrlCount] = useState(() => memoryManager.getActiveUrlCount());
  const [extStats, setExtStats] = useState(() => memoryManager.getExternalUploadStats());
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const unsub = memoryManager.subscribe(() => {
      setUrlCount(memoryManager.getActiveUrlCount());
      setExtStats(memoryManager.getExternalUploadStats());
    });
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      unsub();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-5">
        {/* Left: Brand Logo */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onSelectTab('home')}
            className="group flex items-center gap-2.5 text-left focus-visible:outline-2"
            aria-label={t('nav.homeLogoAria')}
          >
            <span className="inline-flex items-center py-0.5 transition-opacity group-hover:opacity-85">
              <img
                src="/logo-horizontal.png"
                alt="fuck_PDF — Local-First File Utility"
                className="h-7 w-auto object-contain sm:h-8"
              />
            </span>
          </button>
          <span className="hidden border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--ink-secondary)] md:inline-block">
            WASM · CLIENT-ONLY
          </span>
        </div>

        {/* Center: Dynamic Tool Navigation */}
        <nav
          aria-label={t('nav.ariaLabel')}
          className="order-3 flex w-full items-center gap-1.5 overflow-x-auto border-t border-[var(--border-hairline)] pt-2 lg:order-2 lg:w-auto lg:border-t-0 lg:pt-0"
        >
          <button
            type="button"
            onClick={() => onSelectTab('home')}
            aria-current={activeTab === 'home' && !activeToolLabel ? 'page' : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'home' && !activeToolLabel
                ? 'border-[var(--border-strong)] bg-[var(--ink-primary)] text-[var(--bg-surface)]'
                : 'border-transparent bg-transparent text-[var(--ink-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-canvas)] hover:text-[var(--ink-primary)]'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('nav.tools')}</span>
          </button>

          {(activeTab !== 'home' || activeToolLabel) && (
            <>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />
              <span
                aria-current="page"
                className="inline-flex max-w-[180px] shrink-0 items-center truncate border border-[var(--border-strong)] bg-[var(--ink-primary)] px-2.5 py-1.5 font-mono text-xs font-semibold text-[var(--bg-surface)] sm:max-w-none"
              >
                {activeToolLabel ||
                  (activeTab === 'unlocker'
                    ? t('nav.unlocker')
                    : activeTab === 'converter'
                      ? t('nav.converter')
                      : activeTab === 'editor'
                        ? t('nav.editor')
                        : t('nav.tools'))}
              </span>
            </>
          )}
        </nav>

        {/* Right: Language Switcher + Honest Telemetry + Purge Memory */}
        <div className="order-2 flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2 lg:order-3">
          <div className="inline-flex items-center border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5">
            <Globe className="mr-1 h-3 w-3 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />
            <label htmlFor="lang-select" className="sr-only">
              {t('nav.language')}
            </label>
            <select
              id="lang-select"
              aria-label={t('nav.language')}
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="max-w-[96px] truncate bg-transparent font-mono text-[11px] font-semibold text-[var(--ink-primary)] focus:outline-none sm:max-w-none"
            >
              {LOCALE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.short} · {opt.label}
                </option>
              ))}
            </select>
          </div>

          {!isOnline && (
            <span className="inline-flex items-center gap-1 border border-[var(--border-hairline)] bg-[var(--bg-recessed)] px-2 py-1 font-mono text-[11px] font-medium text-[var(--ink-primary)]">
              <WifiOff className="h-3 w-3" aria-hidden="true" />
              <span>OFFLINE</span>
            </span>
          )}

          <button
            type="button"
            onClick={onOpenTelemetry}
            title={t('telemetry.badgeTitle')}
            className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              extStats.bytes > 0
                ? 'border-[#D9A760] bg-[#FEF9F0] text-[#8A5300] hover:border-[#8A5300]'
                : 'border-[#B8D4C2] bg-[#F2F8F4] text-[var(--accent-local)] hover:border-[var(--accent-local)]'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t('telemetry.localPrefix')}{' '}
              <strong className="font-mono tabular-nums">
                {extStats.bytes > 0 ? `${Math.max(1, Math.round(extStats.bytes / 1024))} KB` : '0 KB'}
              </strong>{' '}
              {t('telemetry.sentSuffix')}
            </span>
            <span className="font-mono sm:hidden">
              {extStats.bytes > 0
                ? `${Math.max(1, Math.round(extStats.bytes / 1024))} KB`
                : t('telemetry.mobileZero')}
            </span>
          </button>

          {(hasActiveWork || urlCount > 0) && (
            <button
              type="button"
              onClick={onPurgeMemory}
              className="inline-flex items-center gap-1.5 border border-[var(--accent-signal)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-signal)] transition-colors hover:bg-[var(--accent-signal)] hover:text-white"
              title={t('memory.purgeTitle')}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t('memory.purgeFull')}</span>
              <span className="sm:hidden">{t('memory.purgeShort')}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
