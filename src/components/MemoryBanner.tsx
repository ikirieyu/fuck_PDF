import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { MemoryWarning } from '../types/workbench';
import { useI18n } from '../i18n/I18nContext';

interface MemoryBannerProps {
  warning: MemoryWarning | null;
  onDismiss?: () => void;
}

export const MemoryBanner: React.FC<MemoryBannerProps> = ({ warning, onDismiss }) => {
  const { t } = useI18n();
  if (!warning) return null;
  const isCritical = warning.level === 'critical';

  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-3 border px-3.5 py-2.5 text-xs ${
        isCritical
          ? 'border-[#8A2C1D] bg-[#FDF2F0] text-[#681D11]'
          : 'border-[#9A5B00] bg-[#FDF8EC] text-[#6E4000]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">
            {isCritical ? t('memory.criticalTitle') : t('memory.cautionTitle')}
          </p>
          <p className="mt-0.5 leading-relaxed">{warning.message}</p>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 border border-current px-2 py-0.5 font-mono text-[11px] font-medium hover:bg-black/5"
        >
          {t('memory.dismiss')}
        </button>
      )}
    </div>
  );
};
