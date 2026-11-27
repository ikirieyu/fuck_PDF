import React, { useEffect, useState } from 'react';
import { Database, FileText, Lock, ShieldCheck, Trash2, X } from 'lucide-react';
import { memoryManager } from '../utils/memoryManager';
import { vaultClear, vaultGetAll } from '../utils/passwordVault';

export type LegalTab = 'security' | 'license' | 'privacy';

interface LegalSecurityModalProps {
  open: boolean;
  initialTab?: LegalTab;
  onClose: () => void;
}

export const LegalSecurityModal: React.FC<LegalSecurityModalProps> = ({
  open,
  initialTab = 'security',
  onClose,
}) => {
  const [tab, setTab] = useState<LegalTab>(initialTab);
  const [vaultCount, setVaultCount] = useState(() => vaultGetAll().length);
  const [cacheCount, setCacheCount] = useState<number | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return;
    setVaultCount(vaultGetAll().length);
    setStatusNote(null);
    if (typeof caches !== 'undefined') {
      caches.keys().then((keys) => setCacheCount(keys.length)).catch(() => setCacheCount(0));
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleClearVault = () => {
    vaultClear();
    setVaultCount(0);
    setStatusNote('Password Vault lokal berhasil dikosongkan.');
  };

  const handleClearCaches = async () => {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      setCacheCount(0);
      setStatusNote(`Cache offline (${keys.length} bucket) berhasil dihapus.`);
    }
  };

  const handlePurgeRam = () => {
    const count = memoryManager.purgeAllMemory();
    setStatusNote(`Memori RAM & ${count} Object URL dibersihkan.`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--accent-local)]" />
            <h2 id="legal-modal-title" className="font-mono text-sm font-bold text-[var(--ink-primary)]">
              fuck_PDF · SECURITY, CACHE & LICENSE
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-transparent p-1 text-[var(--ink-secondary)] hover:border-[var(--border-hairline)] hover:text-[var(--ink-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4">
          {(
            [
              { id: 'security', label: 'Security & Cache', icon: Database },
              { id: 'license', label: 'License (MIT & OSS)', icon: FileText },
              { id: 'privacy', label: 'Privacy & Policy', icon: Lock },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 font-mono text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[var(--accent-signal)] text-[var(--ink-primary)]'
                    : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-4 text-xs text-[var(--ink-secondary)] space-y-4">
          {statusNote && (
            <div className="border border-[#B8D4C2] bg-[#F2F8F4] px-3 py-2 font-mono text-[11px] text-[var(--accent-local)]">
              {statusNote}
            </div>
          )}

          {tab === 'security' && (
            <div className="space-y-3">
              <p className="leading-relaxed">
                fuck_PDF berjalan dengan isolasi browser <code className="font-mono">COOP/COEP</code>,
                Service Worker offline cache, dan manajemen memori lokal tanpa penyimpanan server.
              </p>

              <div className="divide-y divide-[var(--border-hairline)] border border-[var(--border-hairline)] bg-[var(--bg-canvas)] font-mono">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div>
                    <div className="font-bold text-[var(--ink-primary)]">Service Worker Cache</div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      {cacheCount !== null ? `${cacheCount} cache bucket tersimpan` : 'Memeriksa cache...'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleClearCaches()}
                    className="inline-flex items-center gap-1 border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold hover:bg-[var(--bg-recessed)]"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Clear Cache</span>
                  </button>
                </div>

                <div className="flex items-center justify-between px-3 py-2.5">
                  <div>
                    <div className="font-bold text-[var(--ink-primary)]">Local Password Vault</div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      {vaultCount} kunci tersimpan di localStorage (maks 50)
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearVault}
                    className="inline-flex items-center gap-1 border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold hover:bg-[var(--bg-recessed)]"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Clear Vault</span>
                  </button>
                </div>

                <div className="flex items-center justify-between px-3 py-2.5">
                  <div>
                    <div className="font-bold text-[var(--ink-primary)]">Active RAM & Object URLs</div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      {memoryManager.getActiveUrlCount()} Object URL aktif di memori
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handlePurgeRam}
                    className="inline-flex items-center gap-1 border border-[var(--accent-signal)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-signal)] hover:bg-[var(--accent-signal)] hover:text-white"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Purge RAM</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'license' && (
            <div className="space-y-3 font-mono text-[11px] leading-relaxed">
              <div className="border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3">
                <p className="font-bold text-[var(--ink-primary)]">MIT License — Copyright (c) 2026 fuck_PDF</p>
                <p className="mt-2">
                  Permission is hereby granted, free of charge, to any person obtaining a copy of this
                  software and associated documentation files, to deal in the Software without
                  restriction, including without limitation the rights to use, copy, modify, merge,
                  publish, distribute, sublicense, and/or sell copies of the Software.
                </p>
                <p className="mt-2 text-[var(--ink-muted)]">
                  THE SOFTWARE IS PROVIDED &quot;AS IS&quot;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
                </p>
              </div>
              <div>
                <p className="font-bold text-[var(--ink-primary)]">Open-Source WASM & JS Engines</p>
                <ul className="mt-1 list-disc pl-5 space-y-0.5">
                  <li>qpdf (Apache-2.0) — PDF encryption, decryption &amp; repair</li>
                  <li>pdfjs-dist (Apache-2.0) — PDF rendering &amp; text extraction</li>
                  <li>pdf-lib (MIT) — PDF creation, merge, watermark &amp; crop</li>
                  <li>ffmpeg.wasm (MIT/LGPL), 7z-wasm (MIT/LGPL), zip.js (BSD-3-Clause), unrar</li>
                  <li>SheetJS / xlsx (Apache-2.0), mammoth (BSD-2-Clause), lucide-react (ISC)</li>
                </ul>
              </div>
            </div>
          )}

          {tab === 'privacy' && (
            <div className="space-y-2.5 leading-relaxed">
              <p>
                <strong className="text-[var(--ink-primary)]">1. Pemrosesan Lokal Utama:</strong>{' '}
                Semua alat berlabel <span className="font-mono font-bold">LOCAL</span> memproses
                dokumen 100% di RAM browser Anda tanpa mengunggah file ke server manapun.
              </p>
              <p>
                <strong className="text-[var(--ink-primary)]">2. Cloud Fallback (Opt-In):</strong>{' '}
                Fitur berlabel <span className="font-mono font-bold">CLOUD</span> atau tombol Cloud
                Fallback hanya mengirim file saat Anda mengklik tombol secara eksplisit setelah
                melihat peringatan. Tugas dihapus segera setelah hasil diunduh.
              </p>
              <p>
                <strong className="text-[var(--ink-primary)]">3. Tanpa Pelacakan:</strong>{' '}
                fuck_PDF tidak menggunakan cookie pelacakan, analitik pihak ketiga, atau telemetri tersembunyi.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="border border-[var(--border-strong)] bg-[var(--ink-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
