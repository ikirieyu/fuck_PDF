import React from 'react';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

interface NotFound404Props {
  path: string;
  onGoHome: () => void;
}

export const NotFound404: React.FC<NotFound404Props> = ({ path, onGoHome }) => {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[640px] flex-col items-center justify-center px-4 py-12 text-center">
      <div className="w-full border border-[var(--border-strong)] bg-[var(--bg-surface)] p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center border border-[#8A2C1D] bg-[#FDF2F0] text-[#8A2C1D]">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-[var(--accent-signal)]">
          ERROR 404 · ROUTE NOT FOUND
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[var(--ink-primary)]">
          Halaman Tidak Ditemukan
        </h1>
        <p className="mt-2 font-mono text-xs text-[var(--ink-secondary)]">
          Path <code className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5">{path}</code> tidak tersedia di fuck_PDF.
        </p>
        <button
          type="button"
          onClick={onGoHome}
          className="mt-6 inline-flex items-center gap-2 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--accent-signal-hover)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Kembali ke fuck_PDF</span>
        </button>
      </div>
    </div>
  );
};
