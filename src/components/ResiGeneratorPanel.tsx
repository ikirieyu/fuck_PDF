import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { Download, QrCode, RotateCcw } from 'lucide-react';
import { triggerBlobDownload } from '../utils/memoryManager';

interface ResiData {
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  shopUrl: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  product: string;
}

const STORAGE_KEY = 'fuck_pdf_resi_sender_v1';

const DEFAULT_DATA: ResiData = {
  senderName: 'Nama Pengirim',
  senderPhone: '012345678',
  senderAddress: 'Jl. Contoh',
  shopUrl: 'alamat / link olshop',
  recipientName: 'Nama Penerina',
  recipientPhone: '012345678',
  recipientAddress: 'Jl. Contoh',
  product: 'Nama Barang',
};

function loadInitialData(): ResiData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DATA;
    const saved = JSON.parse(raw) as Partial<ResiData>;
    return { ...DEFAULT_DATA, ...saved };
  } catch {
    return DEFAULT_DATA;
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${current} ${words[i]}`;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

async function renderResiToPdfBlob(
  data: ResiData,
  qrDataUrl: string,
  paperSize: 'thermal' | 'a4'
): Promise<Blob> {
  // High-DPI canvas: 150mm x 100mm @ 12px/mm = 1800 x 1200
  const W = 1800;
  const H = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak tersedia');

  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Outer rounded border
  const pad = 24;
  const r = 28;
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(pad, pad, W - pad * 2, H - pad * 2, r);
  ctx.stroke();

  // Header divider (top sender bar)
  const headerBottom = 165;
  ctx.beginPath();
  ctx.moveTo(pad, headerBottom);
  ctx.lineTo(W - pad, headerBottom);
  ctx.stroke();

  // Vertical column divider (62% left / 38% right)
  const colX = Math.round(W * 0.62);
  ctx.beginPath();
  ctx.moveTo(colX, headerBottom);
  ctx.lineTo(colX, H - pad);
  ctx.stroke();

  // ── Header: Pengirim (Nama, Telp, Alamat) ──────────────────────────────────
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(`Pengirim: ${data.senderName || '-'}`, pad + 32, pad + 22);

  ctx.font = '24px sans-serif';
  const senderContact = [
    data.senderPhone ? `Telp: ${data.senderPhone}` : '',
    data.senderAddress ? `Alamat: ${data.senderAddress}` : '',
  ]
    .filter(Boolean)
    .join('  |  ');
  const senderLines = wrapText(ctx, senderContact, W - pad * 2 - 64).slice(0, 2);
  senderLines.forEach((line, i) => {
    ctx.fillText(line, pad + 32, pad + 72 + i * 30);
  });

  // ── Left Column: Penerima, Nomor, Alamat ───────────────────────────────────
  const leftPad = pad + 32;
  const valX = leftPad + 195;
  const maxValW = colX - valX - 28;

  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('Penerima', leftPad, headerBottom + 36);
  ctx.fillText(':', leftPad + 165, headerBottom + 36);
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText(data.recipientName || '-', valX, headerBottom + 35);

  ctx.font = '28px sans-serif';
  ctx.fillText('Nomor', leftPad, headerBottom + 96);
  ctx.fillText(':', leftPad + 165, headerBottom + 96);
  ctx.font = 'italic 29px sans-serif';
  ctx.fillText(data.recipientPhone || '-', valX, headerBottom + 96);

  ctx.font = '28px sans-serif';
  ctx.fillText('Alamat', leftPad, headerBottom + 156);
  ctx.fillText(':', leftPad + 165, headerBottom + 156);
  ctx.font = '27px sans-serif';
  const addrLines = wrapText(ctx, data.recipientAddress || '-', maxValW).slice(0, 4);
  addrLines.forEach((line, idx) => {
    ctx.fillText(line, valX, headerBottom + 156 + idx * 38);
  });

  // Dotted divider 1 (Left)
  const drawDotted = (x1: number, x2: number, y: number) => {
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.restore();
  };

  const thankTopY = 580;
  drawDotted(pad + 48, colX - 48, thankTopY);

  // "Thank you! For Order"
  ctx.font = 'italic 64px Georgia, serif';
  ctx.fillText('Thank you!', leftPad + 50, thankTopY + 34);
  ctx.font = 'bold 46px sans-serif';
  ctx.fillText('For Order', leftPad + 420, thankTopY + 48);

  const thankBotY = 735;
  drawDotted(pad + 48, colX - 48, thankBotY);

  // Warning Triangle + Unboxing Disclaimer
  const triX = leftPad + 100;
  const triY = 805;
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#111111';
  ctx.beginPath();
  ctx.moveTo(triX, triY);
  ctx.lineTo(triX + 95, triY + 175);
  ctx.lineTo(triX - 95, triY + 175);
  ctx.closePath();
  ctx.stroke();
  ctx.font = 'bold 96px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('!', triX, triY + 56);

  ctx.textAlign = 'center';
  ctx.font = 'bold 24px sans-serif';
  const warnText = [
    'TIDAK MENERIMA RETURN/KOMPLAIN APAPUN BILA',
    'TIDAK MENYERTAKAN VIDEO UNBOXING PAKET,',
    'REKAM VIDEO DENGAN JELAS MULAI SEBELUM DIBUKA',
    'SAMPAI SELESAI, TIDAK MENERIMA REKAMAN VIDEO',
    'PAKET YANG SUDAH DIBUNGKUS ULANG.',
  ];
  warnText.forEach((line, idx) => {
    ctx.fillText(line, (leftPad + 210 + (colX - 24)) / 2, 815 + idx * 34);
  });

  // ── Right Column: Produk + QR Barcode Toko + Handle With Care ──────────────
  const rightCenter = colX + (W - pad - colX) / 2;
  ctx.textAlign = 'center';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('Produk:', rightCenter, headerBottom + 28);

  ctx.font = 'bold 32px sans-serif';
  const prodLines = wrapText(ctx, data.product || '-', W - pad - colX - 48).slice(0, 3);
  prodLines.forEach((line, idx) => {
    ctx.fillText(line, rightCenter, headerBottom + 78 + idx * 38);
  });

  drawDotted(colX + 36, W - pad - 36, 385);

  // QR Code Toko / Olshop
  if (qrDataUrl) {
    const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = qrDataUrl;
    });
    const qrSize = 210;
    ctx.drawImage(qrImg, rightCenter - qrSize / 2, 405, qrSize, qrSize);
  }
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('SCAN LINK TOKO / OLSHOP', rightCenter, 622);

  drawDotted(colX + 36, W - pad - 36, 665);

  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('PLEASE HANDLE WITH CARE', rightCenter, 690);

  // 6 Handling Icons Grid (3x2)
  const boxSize = 150;
  const gap = 16;
  const gridW = boxSize * 3 + gap * 2;
  const gridX0 = rightCenter - gridW / 2;
  const gridY0 = 755;

  const drawBox = (col: number, row: number) => {
    const bx = gridX0 + col * (boxSize + gap);
    const by = gridY0 + row * (boxSize + gap);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#111111';
    ctx.strokeRect(bx, by, boxSize, boxSize);
    return { bx, by };
  };

  // 1. This Way Up (Two Arrows Up)
  {
    const { bx, by } = drawBox(0, 0);
    ctx.fillStyle = '#111111';
    [bx + 45, bx + 105].forEach((ax) => {
      ctx.fillRect(ax - 7, by + 55, 14, 70);
      ctx.beginPath();
      ctx.moveTo(ax, by + 22);
      ctx.lineTo(ax - 22, by + 58);
      ctx.lineTo(ax + 22, by + 58);
      ctx.closePath();
      ctx.fill();
    });
  }
  // 2. Do Not Step
  {
    const { bx, by } = drawBox(1, 0);
    ctx.fillStyle = '#111111';
    ctx.fillRect(bx + 25, by + 115, 100, 12);
    ctx.beginPath();
    ctx.moveTo(bx + 55, by + 25);
    ctx.lineTo(bx + 90, by + 25);
    ctx.lineTo(bx + 90, by + 80);
    ctx.lineTo(bx + 115, by + 95);
    ctx.lineTo(bx + 115, by + 108);
    ctx.lineTo(bx + 45, by + 108);
    ctx.lineTo(bx + 45, by + 75);
    ctx.closePath();
    ctx.fill();
  }
  // 3. Fragile (Wine Glass)
  {
    const { bx, by } = drawBox(2, 0);
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.moveTo(bx + 45, by + 22);
    ctx.lineTo(bx + 105, by + 22);
    ctx.quadraticCurveTo(bx + 105, by + 85, bx + 75, by + 85);
    ctx.quadraticCurveTo(bx + 45, by + 85, bx + 45, by + 22);
    ctx.fill();
    ctx.fillRect(bx + 70, by + 82, 10, 42);
    ctx.fillRect(bx + 50, by + 122, 50, 8);
  }
  // 4. No Hook
  {
    const { bx, by } = drawBox(0, 1);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(bx + 75, by + 25);
    ctx.lineTo(bx + 75, by + 70);
    ctx.arc(bx + 75, by + 92, 22, -Math.PI / 2, Math.PI, false);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(bx + 28, by + 28);
    ctx.lineTo(bx + 122, by + 122);
    ctx.moveTo(bx + 122, by + 28);
    ctx.lineTo(bx + 28, by + 122);
    ctx.stroke();
  }
  // 5. Keep Dry (Umbrella)
  {
    const { bx, by } = drawBox(1, 1);
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(bx + 75, by + 78, 50, Math.PI, 0, false);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(bx + 75, by + 78);
    ctx.lineTo(bx + 75, by + 122);
    ctx.arc(bx + 63, by + 122, 12, 0, Math.PI, false);
    ctx.stroke();
  }
  // 6. Handle With Care (Hands + Box)
  {
    const { bx, by } = drawBox(2, 1);
    ctx.fillStyle = '#111111';
    ctx.fillRect(bx + 50, by + 35, 50, 45);
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(bx + 28, by + 65);
    ctx.lineTo(bx + 28, by + 115);
    ctx.lineTo(bx + 65, by + 128);
    ctx.moveTo(bx + 122, by + 65);
    ctx.lineTo(bx + 122, by + 115);
    ctx.lineTo(bx + 85, by + 128);
    ctx.stroke();
  }

  const imgData = canvas.toDataURL('image/png');
  if (paperSize === 'thermal') {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [150, 100] });
    pdf.addImage(imgData, 'PNG', 0, 0, 150, 100);
    return pdf.output('blob');
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  // Place crisp 180 x 120 mm label at top of A4
  pdf.addImage(imgData, 'PNG', 15, 15, 180, 120);
  return pdf.output('blob');
}

export const ResiGeneratorPanel: React.FC = () => {
  const [data, setData] = useState<ResiData>(() => loadInitialData());
  const [paperSize, setPaperSize] = useState<'thermal' | 'a4'>('thermal');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          senderName: data.senderName,
          senderPhone: data.senderPhone,
          senderAddress: data.senderAddress,
          shopUrl: data.shopUrl,
        })
      );
    } catch {
      // ignore
    }
  }, [data.senderName, data.senderPhone, data.senderAddress, data.shopUrl]);

  useEffect(() => {
    const target = data.shopUrl.trim() || data.senderAddress.trim() || 'https://fuckpdf.app';
    QRCode.toDataURL(target, { width: 240, margin: 1 })
      .then((url) => setQrDataUrl(url))
      .catch(() => {});
  }, [data.shopUrl, data.senderAddress]);

  const update = (field: keyof ResiData, val: string) =>
    setData((prev) => ({ ...prev, [field]: val }));

  const handleDownloadPdf = async () => {
    setBusy(true);
    try {
      const blob = await renderResiToPdfBlob(data, qrDataUrl, paperSize);
      const safeName = (data.recipientName || 'resi').replace(/[^a-zA-Z0-9_-]/g, '_');
      triggerBlobDownload(blob, `resi_${safeName}.pdf`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Form */}
      <div className="space-y-4 border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 lg:col-span-5">
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] pb-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--ink-primary)]">
            Data Resi Pengiriman
          </span>
          <button
            type="button"
            onClick={() => setData(DEFAULT_DATA)}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>

        <div className="space-y-2.5 text-xs">
          <p className="font-mono text-[10px] font-bold uppercase text-[var(--ink-muted)]">
            Pengirim &amp; Barcode Toko (Tersimpan Otomatis)
          </p>
          <input
            type="text"
            value={data.senderName}
            onChange={(e) => update('senderName', e.target.value)}
            placeholder="Nama Pengirim / Toko"
            className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.senderPhone}
            onChange={(e) => update('senderPhone', e.target.value)}
            placeholder="No. Telpon Pengirim"
            className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1.5 font-mono"
          />
          <textarea
            rows={2}
            value={data.senderAddress}
            onChange={(e) => update('senderAddress', e.target.value)}
            placeholder="Alamat Pengirim"
            className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1.5"
          />
          <div className="flex items-center gap-2 border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1.5">
            <QrCode className="h-4 w-4 shrink-0 text-[var(--accent-signal)]" />
            <input
              type="text"
              value={data.shopUrl}
              onChange={(e) => update('shopUrl', e.target.value)}
              placeholder="Link Olshop / Google Maps Toko (untuk QR Barcode)"
              className="w-full bg-transparent font-mono text-xs focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-2.5 border-t border-[var(--border-hairline)] pt-3 text-xs">
          <p className="font-mono text-[10px] font-bold uppercase text-[var(--ink-muted)]">
            Penerima &amp; Produk
          </p>
          <input
            type="text"
            value={data.recipientName}
            onChange={(e) => update('recipientName', e.target.value)}
            placeholder="Nama Penerima"
            className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.recipientPhone}
            onChange={(e) => update('recipientPhone', e.target.value)}
            placeholder="No. Telpon Penerima"
            className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1.5 font-mono"
          />
          <textarea
            rows={2}
            value={data.recipientAddress}
            onChange={(e) => update('recipientAddress', e.target.value)}
            placeholder="Alamat Lengkap Penerima"
            className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.product}
            onChange={(e) => update('product', e.target.value)}
            placeholder="Produk (contoh: FD10(1), Paket A)"
            className="w-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1.5 font-mono"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-hairline)] pt-3">
          <select
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as 'thermal' | 'a4')}
            className="border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 py-2 font-mono text-xs"
          >
            <option value="thermal">Stiker Thermal (150 × 100 mm)</option>
            <option value="a4">Kertas A4</option>
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDownloadPdf()}
            className="inline-flex items-center gap-2 border border-[var(--ink-primary)] bg-[var(--accent-signal)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-[var(--accent-signal-hover)] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{busy ? 'Membuat PDF...' : 'Download Resi PDF'}</span>
          </button>
        </div>
      </div>

      {/* Live Preview */}
      <div className="lg:col-span-7">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
          Pratinjau Label Resi (150 × 100 mm)
        </div>
        <div className="overflow-x-auto bg-[var(--bg-mat)] p-3 sm:p-5">
          <div className="mx-auto min-w-[540px] max-w-[680px] rounded-xl border-2 border-[#111111] bg-white text-[#111111]">
            {/* Top Header */}
            <div className="border-b-2 border-[#111111] px-4 py-2.5">
              <div className="text-sm font-bold">
                Pengirim: <span>{data.senderName || '-'}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-[#333333]">
                {data.senderPhone && <span>Telp: {data.senderPhone}</span>}
                {data.senderPhone && data.senderAddress && <span className="mx-1.5">|</span>}
                {data.senderAddress && <span>Alamat: {data.senderAddress}</span>}
              </div>
            </div>

            {/* 2-Column Body */}
            <div className="grid grid-cols-[1.55fr_1fr]">
              {/* Left Column */}
              <div className="flex flex-col justify-between border-r-2 border-[#111111] p-3.5">
                <div className="space-y-1.5 text-xs">
                  <div className="grid grid-cols-[74px_10px_1fr]">
                    <span>Penerima</span>
                    <span>:</span>
                    <span className="font-bold">{data.recipientName || '-'}</span>
                  </div>
                  <div className="grid grid-cols-[74px_10px_1fr]">
                    <span>Nomor</span>
                    <span>:</span>
                    <span className="italic">{data.recipientPhone || '-'}</span>
                  </div>
                  <div className="grid grid-cols-[74px_10px_1fr]">
                    <span>Alamat</span>
                    <span>:</span>
                    <span className="break-words">{data.recipientAddress || '-'}</span>
                  </div>
                </div>

                <div className="my-3 border-y border-dotted border-[#111111] py-2.5 text-center">
                  <span className="font-serif text-2xl italic">Thank you!</span>
                  <span className="ml-3 text-lg font-extrabold tracking-tight">For Order</span>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <svg viewBox="0 0 64 58" className="h-14 w-14 shrink-0" aria-hidden="true">
                    <polygon
                      points="32,4 60,54 4,54"
                      fill="none"
                      stroke="#111111"
                      strokeWidth="4.5"
                    />
                    <text
                      x="32"
                      y="46"
                      textAnchor="middle"
                      fontSize="30"
                      fontWeight="bold"
                      fill="#111111"
                    >
                      !
                    </text>
                  </svg>
                  <p className="text-center text-[9px] font-extrabold leading-snug uppercase">
                    TIDAK MENERIMA RETURN/KOMPLAIN APAPUN BILA TIDAK MENYERTAKAN VIDEO UNBOXING
                    PAKET, REKAM VIDEO DENGAN JELAS MULAI SEBELUM DIBUKA SAMPAI SELESAI, TIDAK
                    MENERIMA REKAMAN VIDEO PAKET YANG SUDAH DIBUNGKUS ULANG.
                  </p>
                </div>
              </div>

              {/* Right Column */}
              <div className="flex flex-col justify-between p-3 text-center">
                <div>
                  <div className="text-xs font-bold">Produk:</div>
                  <div className="mt-1 text-sm font-bold break-words">{data.product || '-'}</div>
                </div>

                <div className="my-2 border-y border-dotted border-[#111111] py-2">
                  {qrDataUrl && (
                    <img
                      src={qrDataUrl}
                      alt="QR Link Toko"
                      className="mx-auto h-20 w-20 object-contain"
                    />
                  )}
                  <div className="mt-1 text-[9px] font-bold tracking-wider uppercase">
                    SCAN LINK TOKO / OLSHOP
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-[10px] font-extrabold uppercase">
                    PLEASE HANDLE WITH CARE
                  </div>
                  <div className="mx-auto grid max-w-[168px] grid-cols-3 gap-1">
                    {/* 6 Crisp Handling Icons */}
                    <div className="flex h-12 items-center justify-center border border-[#111111]">
                      <span className="text-lg font-black">↑↑</span>
                    </div>
                    <div className="flex h-12 items-center justify-center border border-[#111111]">
                      <span className="text-[9px] font-bold leading-tight">DO NOT<br/>STEP</span>
                    </div>
                    <div className="flex h-12 items-center justify-center border border-[#111111]">
                      <span className="text-base">🍷</span>
                    </div>
                    <div className="flex h-12 items-center justify-center border border-[#111111]">
                      <span className="text-[9px] font-bold leading-tight">NO<br/>HOOK</span>
                    </div>
                    <div className="flex h-12 items-center justify-center border border-[#111111]">
                      <span className="text-base">☂</span>
                    </div>
                    <div className="flex h-12 items-center justify-center border border-[#111111]">
                      <span className="text-base">📦</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
