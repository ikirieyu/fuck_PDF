import React, { useEffect, useRef, useState } from 'react';
import { Eraser, PenTool, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';

interface SignaturePadModalProps {
  open: boolean;
  onClose: () => void;
  onSaveSignature: (dataUrl: string) => void;
}

export const SignaturePadModal: React.FC<SignaturePadModalProps> = ({
  open,
  onClose,
  onSaveSignature,
}) => {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [strokeColor, setStrokeColor] = useState<'#141413' | '#1E4E79'>('#141413');
  const [hasStroke, setHasStroke] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHasStroke(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [open]);

  if (!open) return null;

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);
    drawingRef.current = true;
    setHasStroke(true);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasStroke(false);
    }
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke) return;
    onSaveSignature(canvas.toDataURL('image/png'));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sig-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg border border-[var(--border-strong)] bg-[var(--bg-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-3">
          <div className="flex items-center gap-2">
            <PenTool className="h-4 w-4 text-[var(--ink-primary)]" />
            <h3 id="sig-title" className="font-mono text-xs font-bold uppercase tracking-wider">
              {t('sig.title')}
            </h3>
          </div>
          <button type="button" onClick={onClose} aria-label={t('telemetry.closeAria')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-[var(--ink-muted)]">{t('sig.ink')}</span>
              <button
                type="button"
                onClick={() => setStrokeColor('#141413')}
                className={`border px-2 py-0.5 font-mono text-[11px] ${
                  strokeColor === '#141413'
                    ? 'border-[var(--ink-primary)] bg-[#141413] text-white'
                    : 'border-[var(--border-hairline)]'
                }`}
              >
                {t('sig.black')}
              </button>
              <button
                type="button"
                onClick={() => setStrokeColor('#1E4E79')}
                className={`border px-2 py-0.5 font-mono text-[11px] ${
                  strokeColor === '#1E4E79'
                    ? 'border-[#1E4E79] bg-[#1E4E79] text-white'
                    : 'border-[var(--border-hairline)]'
                }`}
              >
                {t('sig.blue')}
              </button>
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1 border border-[var(--border-hairline)] px-2 py-0.5 font-mono text-[11px] hover:bg-[var(--bg-canvas)]"
            >
              <Eraser className="h-3 w-3" /> {t('sig.clear')}
            </button>
          </div>

          <canvas
            ref={canvasRef}
            width={640}
            height={240}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="w-full touch-none border border-[var(--border-strong)] bg-white"
            style={{
              backgroundImage:
                'radial-gradient(rgba(20,20,19,0.12) 1px, transparent 1px)',
              backgroundSize: '16px 16px',
            }}
          />
          <p className="mt-1.5 font-mono text-[11px] text-[var(--ink-muted)]">{t('sig.hint')}</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium"
          >
            {t('sig.cancel')}
          </button>
          <button
            type="button"
            disabled={!hasStroke}
            onClick={handleSave}
            className="border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-4 py-1.5 text-xs font-bold text-white hover:bg-[var(--accent-signal-hover)] disabled:opacity-45"
          >
            {t('sig.apply')}
          </button>
        </div>
      </div>
    </div>
  );
};
