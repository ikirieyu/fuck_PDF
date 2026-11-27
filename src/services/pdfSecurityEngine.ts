import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { vaultGetAll, vaultSave } from '../utils/passwordVault';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfInspectionResult {
  numPages: number;
  isEncrypted: boolean;
  needsPassword: boolean;
  docProxy?: pdfjsLib.PDFDocumentProxy;
}

export type AutoUnlockStage = 'owner-strip' | 'pattern-guess' | 'manual-fallback';

export interface AutoUnlockResult {
  status: 'unlocked' | 'needs-password';
  method: 'unencrypted' | 'owner-strip' | 'pattern-guess' | 'manual-fallback';
  numPages: number;
  elapsedMs: number;
  matchedPassword?: string;
  triedCandidatesCount?: number;
  docProxy?: pdfjsLib.PDFDocumentProxy;
  unlockedBlob?: Blob;
}

export class PdfSecurityError extends Error {
  code: 'NEED_PASSWORD' | 'INCORRECT_PASSWORD' | 'CORRUPT_PDF' | 'UNSUPPORTED_ENCRYPTION';
  constructor(
    code: 'NEED_PASSWORD' | 'INCORRECT_PASSWORD' | 'CORRUPT_PDF' | 'UNSUPPORTED_ENCRYPTION',
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

type QpdfFactory = (opts: {
  locateFile: () => string;
}) => Promise<{ callMain: (args: string[]) => number; FS: unknown }>;

let cachedQpdfFactory: QpdfFactory | null = null;
let loadingQpdfPromise: Promise<QpdfFactory> | null = null;

/**
 * Loads /wasm/qpdf.js directly via script tag to avoid Vite CJS/ESM interop issues.
 */
async function loadQpdfFactory(): Promise<QpdfFactory> {
  if (cachedQpdfFactory) return cachedQpdfFactory;
  if (loadingQpdfPromise) return loadingQpdfPromise;

  loadingQpdfPromise = new Promise<QpdfFactory>((resolve, reject) => {
    const win = window as unknown as { Module?: QpdfFactory };
    if (typeof win.Module === 'function') {
      cachedQpdfFactory = win.Module;
      resolve(win.Module);
      return;
    }

    const script = document.createElement('script');
    script.src = '/wasm/qpdf.js';
    script.async = true;
    script.onload = () => {
      if (typeof win.Module === 'function') {
        cachedQpdfFactory = win.Module;
        resolve(win.Module);
      } else {
        reject(new Error('qpdf.js loaded but Module factory was not found.'));
      }
    };
    script.onerror = () => {
      loadingQpdfPromise = null;
      reject(new Error('Gagal memuat /wasm/qpdf.js'));
    };
    document.head.appendChild(script);
  });

  return loadingQpdfPromise;
}

/**
 * Checks whether raw PDF bytes contain an /Encrypt dictionary (indicating Owner or User lock).
 */
export function hasPdfEncryptDictionary(bytes: Uint8Array): boolean {
  // Scan the last 64KB (trailer/xref) and first 32KB (linearized) for "/Encrypt"
  const tailStart = Math.max(0, bytes.length - 65536);
  const decoder = new TextDecoder('latin1');
  const tailText = decoder.decode(bytes.subarray(tailStart));
  if (tailText.includes('/Encrypt')) return true;

  const headEnd = Math.min(bytes.length, 32768);
  const headText = decoder.decode(bytes.subarray(0, headEnd));
  return headText.includes('/Encrypt');
}

/**
 * Extracts up to 15 smart password candidates from a PDF filename
 * (e.g., E_Payslip_202601_123456.pdf -> IDs, years, month+year combos, tokens).
 */
export function generateFilenamePasswordCandidates(fileName: string): string[] {
  const baseName = fileName.replace(/\.pdf$/i, '').trim();
  if (!baseName) return [];

  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (val: string) => {
    const trimmed = val.trim();
    if (trimmed.length >= 2 && !seen.has(trimmed) && candidates.length < 15) {
      seen.add(trimmed);
      candidates.push(trimmed);
    }
  };

  // 1. Numeric sequences (IDs, dates, YYYYMM, DDMMYYYY)
  const digitRuns = baseName.match(/\d{4,}/g) ?? [];
  for (const run of digitRuns) {
    add(run);
    if (run.length >= 8) {
      // Try last 6 and last 4 digits (common for NIK / employee ID / DOB)
      add(run.slice(-6));
      add(run.slice(-4));
      add(run.slice(0, 6));
      // Swap YYYYMMDD <-> DDMMYYYY
      if (run.length === 8) {
        const yyyyFirst = /^(19|20)\d{2}/.test(run);
        if (yyyyFirst) {
          add(`${run.slice(6, 8)}${run.slice(4, 6)}${run.slice(0, 4)}`); // DDMMYYYY
          add(`${run.slice(4, 6)}${run.slice(0, 4)}`); // MMYYYY
        } else {
          add(`${run.slice(4, 8)}${run.slice(2, 4)}${run.slice(0, 2)}`); // YYYYMMDD
        }
      }
    } else if (run.length === 6) {
      // Swap YYYYMM <-> MMYYYY
      if (/^(19|20)\d{2}/.test(run)) {
        add(`${run.slice(4, 6)}${run.slice(0, 4)}`);
      } else {
        add(`${run.slice(2, 6)}${run.slice(0, 2)}`);
      }
    }
  }

  // 2. All digits concatenated if there are multiple numeric segments
  const allDigits = baseName.replace(/\D+/g, '');
  if (allDigits.length >= 4 && allDigits.length <= 16) {
    add(allDigits);
    if (allDigits.length > 6) add(allDigits.slice(-6));
    if (allDigits.length > 4) add(allDigits.slice(-4));
  }

  // 3. Year tokens & current/recent year combos
  const yearMatch = baseName.match(/(19|20)\d{2}/);
  if (yearMatch) {
    add(yearMatch[0]);
  }

  // 4. Alphanumeric tokens separated by _, -, space, dot
  const tokens = baseName.split(/[_\-\s.]+/).filter((t) => t.length >= 3);
  for (const tok of tokens) {
    add(tok);
    add(tok.toLowerCase());
    add(tok.toUpperCase());
  }

  // 5. Full baseName without separators
  const compact = baseName.replace(/[_\-\s.]+/g, '');
  add(compact);

  return candidates.slice(0, 15);
}

export async function inspectAndOpenPdf(
  bytes: Uint8Array,
  password?: string
): Promise<PdfInspectionResult> {
  // Clone bytes because pdf.js worker transfers the ArrayBuffer
  const copy = bytes.slice();
  const loadingTask = pdfjsLib.getDocument({
    data: copy,
    password: password || undefined,
  });

  try {
    const doc = await loadingTask.promise;
    return {
      numPages: doc.numPages,
      isEncrypted: Boolean(password) || hasPdfEncryptDictionary(bytes),
      needsPassword: false,
      docProxy: doc,
    };
  } catch (err: unknown) {
    const e = err as { name?: string; code?: number; message?: string };
    if (e?.name === 'PasswordException') {
      if (e.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD) {
        throw new PdfSecurityError(
          'INCORRECT_PASSWORD',
          'Password PDF salah. Periksa kembali password dokumen.'
        );
      }
      throw new PdfSecurityError(
        'NEED_PASSWORD',
        'Dokumen PDF ini dilindungi password. Masukkan password untuk membukanya.'
      );
    }
    if (e?.name === 'InvalidPDFException' || e?.message?.includes('Invalid PDF')) {
      throw new PdfSecurityError(
        'CORRUPT_PDF',
        'File PDF korup, terpotong, atau bukan dokumen PDF yang valid.'
      );
    }
    throw new PdfSecurityError(
      'CORRUPT_PDF',
      e?.message || 'Gagal memuat dokumen PDF.'
    );
  }
}

/**
 * Runs Stage 2 Smart Pattern Guessing inside a Web Worker with a strict 300ms hard-cutoff.
 */
function runPatternGuessWorker(
  bytes: Uint8Array,
  candidates: string[],
  timeoutMs = 300
): Promise<{ matchedPassword: string | null; attempts: number }> {
  if (candidates.length === 0 || typeof Worker === 'undefined') {
    return Promise.resolve({ matchedPassword: null, attempts: 0 });
  }

  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(new URL('../workers/pdfUnlockWorker.ts', import.meta.url), {
      type: 'module',
    });

    const finish = (result: { matchedPassword: string | null; attempts: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ matchedPassword: null, attempts: candidates.length });
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent<{ matchedPassword?: string | null; attempts?: number }>) => {
      if (!e.data || !('matchedPassword' in e.data)) return;
      finish({
        matchedPassword: e.data.matchedPassword ?? null,
        attempts: e.data.attempts ?? 0,
      });
    };

    worker.onerror = () => {
      finish({ matchedPassword: null, attempts: 0 });
    };

    // Zero-copy Transferable ArrayBuffer
    const bufferCopy = bytes.slice().buffer;
    worker.postMessage({ bytes: bufferCopy, candidates }, [bufferCopy]);
  });
}

/**
 * 3-Stage Auto-Unlock Flow (300ms Hard-Cutoff):
 * 1. Stage 1 (0–50ms): Try empty password "" -> if owner-locked only, strip permissions immediately.
 * 2. Stage 2 (max 300ms): Web Worker tests up to 15 smart filename pattern candidates.
 * 3. Stage 3: Return needs-password for immediate manual password fallback.
 */
export async function inspectAndAutoUnlockPdf(
  bytes: Uint8Array,
  fileName: string,
  onStageChange?: (stage: AutoUnlockStage) => void
): Promise<AutoUnlockResult> {
  const start = performance.now();

  // Stage 1: Instant qpdf --decrypt (handles Owner-Locked PDFs & non-standard /Encrypt like iLovePDF)
  onStageChange?.('owner-strip');
  const hasEncrypt = hasPdfEncryptDictionary(bytes);
  try {
    const unlockedBlob = await decryptPdfToBlob(bytes);
    const unlockedBytes = new Uint8Array(await unlockedBlob.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data: unlockedBytes.slice() }).promise;
    return {
      status: 'unlocked',
      method: hasEncrypt ? 'owner-strip' : 'unencrypted',
      numPages: doc.numPages,
      elapsedMs: Math.round(performance.now() - start),
      matchedPassword: '',
      docProxy: doc,
      unlockedBlob,
    };
  } catch {
    // qpdf --decrypt without password failed; fallback to pdf.js empty-password check
  }

  try {
    const task = pdfjsLib.getDocument({ data: bytes.slice(), password: '' });
    const doc = await task.promise;

    if (hasEncrypt) {
      let unlockedBlob: Blob | undefined;
      try {
        unlockedBlob = await decryptPdfToBlob(bytes, '');
      } catch {
        // Fallback if qpdf fails on edge-case owner lock: keep docProxy open
      }
      return {
        status: 'unlocked',
        method: 'owner-strip',
        numPages: doc.numPages,
        elapsedMs: Math.round(performance.now() - start),
        matchedPassword: '',
        docProxy: doc,
        unlockedBlob,
      };
    }

    return {
      status: 'unlocked',
      method: 'unencrypted',
      numPages: doc.numPages,
      elapsedMs: Math.round(performance.now() - start),
      docProxy: doc,
    };
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    if (e?.name !== 'PasswordException') {
      if (e?.name === 'InvalidPDFException' || e?.message?.includes('Invalid PDF')) {
        throw new PdfSecurityError(
          'CORRUPT_PDF',
          'File PDF korup, terpotong, atau bukan dokumen PDF yang valid.'
        );
      }
      throw new PdfSecurityError('CORRUPT_PDF', e?.message || 'Gagal memuat dokumen PDF.');
    }
  }

  // Stage 2: Vault + Smart Pattern Guessing (300ms hard-cutoff in Web Worker)
  // Spec: AUTO_VAULT_AND_FILENAME_PATTERN — test saved vault keys first, then filename patterns
  onStageChange?.('pattern-guess');
  const vaultKeys = vaultGetAll();
  const filenameCandidates = generateFilenamePasswordCandidates(fileName);
  // Deduplicate: vault keys first (highest probability), then filename patterns not already in vault
  const vaultSet = new Set(vaultKeys);
  const candidates = [
    ...vaultKeys,
    ...filenameCandidates.filter((c) => !vaultSet.has(c)),
  ];
  const guessRes = await runPatternGuessWorker(bytes, candidates, 300);

  if (typeof guessRes.matchedPassword === 'string' && guessRes.matchedPassword.length > 0) {
    try {
      const doc = await pdfjsLib.getDocument({
        data: bytes.slice(),
        password: guessRes.matchedPassword,
      }).promise;
      let unlockedBlob: Blob | undefined;
      try {
        unlockedBlob = await decryptPdfToBlob(bytes, guessRes.matchedPassword);
      } catch {
        // Keep docProxy even if qpdf blob generation fails
      }
      vaultSave(guessRes.matchedPassword); // Auto-save to vault for future documents
      return {
        status: 'unlocked',
        method: 'pattern-guess',
        numPages: doc.numPages,
        elapsedMs: Math.round(performance.now() - start),
        matchedPassword: guessRes.matchedPassword,
        triedCandidatesCount: guessRes.attempts,
        docProxy: doc,
        unlockedBlob,
      };
    } catch {
      // Fall through to Stage 3 manual fallback
    }
  }

  // Stage 3: Manual Password Fallback
  onStageChange?.('manual-fallback');
  return {
    status: 'needs-password',
    method: 'manual-fallback',
    numPages: 0,
    elapsedMs: Math.round(performance.now() - start),
    triedCandidatesCount: guessRes.attempts,
  };
}

export type RecoveryMode = 'pin4' | 'dob';

export interface RecoveryProgress {
  tested: number;
  total: number;
  elapsedMs: number;
}

export interface RecoveryResult {
  found: boolean;
  password?: string;
  tested: number;
  elapsedMs: number;
  aborted?: boolean;
}

/**
 * Generates candidate passwords for local Smart Recovery:
 * - 'pin4': 0000..9999 (10,000 combinations)
 * - 'dob': DDMMYYYY for years 1970..2008 (~14,235 dates, starting from 1990..2000 outward)
 */
export function buildRecoveryCandidates(mode: RecoveryMode): string[] {
  if (mode === 'pin4') {
    const pins: string[] = [];
    for (let i = 0; i < 10000; i++) {
      pins.push(String(i).padStart(4, '0'));
    }
    return pins;
  }

  // Birth years ordered from most common working-age years outward
  const years: number[] = [];
  for (let y = 1995; y >= 1970; y--) years.push(y);
  for (let y = 1996; y <= 2008; y++) years.push(y);

  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const dates: string[] = [];
  for (const year of years) {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      const maxD = daysInMonth[m - 1];
      for (let d = 1; d <= maxD; d++) {
        const dd = String(d).padStart(2, '0');
        dates.push(`${dd}${mm}${year}`);
      }
    }
  }
  return dates;
}

/**
 * Runs local password recovery using a single reused PDFWorker and AbortSignal.
 */
export async function runSmartPdfRecovery(
  bytes: Uint8Array,
  mode: RecoveryMode,
  signal: AbortSignal,
  onProgress?: (progress: RecoveryProgress) => void
): Promise<RecoveryResult> {
  const candidates = buildRecoveryCandidates(mode);
  const total = candidates.length;
  const start = performance.now();
  const sharedWorker = new pdfjsLib.PDFWorker();

  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) {
        return {
          found: false,
          tested: i,
          elapsedMs: Math.round(performance.now() - start),
          aborted: true,
        };
      }

      const candidate = candidates[i];
      try {
        const task = pdfjsLib.getDocument({
          data: bytes.slice(),
          password: candidate,
          worker: sharedWorker,
          disableAutoFetch: true,
          disableStream: true,
        });
        const doc = await task.promise;
        await doc.cleanup().catch(() => {});
        return {
          found: true,
          password: candidate,
          tested: i + 1,
          elapsedMs: Math.round(performance.now() - start),
        };
      } catch {
        // Wrong password; continue
      }

      if ((i + 1) % 25 === 0 || i + 1 === total) {
        onProgress?.({
          tested: i + 1,
          total,
          elapsedMs: Math.round(performance.now() - start),
        });
        // Yield to UI thread so Stop button and progress bar stay responsive
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    return {
      found: false,
      tested: total,
      elapsedMs: Math.round(performance.now() - start),
    };
  } finally {
    sharedWorker.destroy();
  }
}

export async function decryptPdfToBlob(
  bytes: Uint8Array,
  password?: string
): Promise<Blob> {
  const createQpdfModule = await loadQpdfFactory();
  const qpdf = await createQpdfModule({
    locateFile: () => '/wasm/qpdf.wasm',
  });

  const inputPath = '/input_locked.pdf';
  const outputPath = '/output_unlocked.pdf';
  const fs = qpdf.FS as unknown as {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
  fs.writeFile(inputPath, bytes);

  const args = password
    ? [`--password=${password}`, '--decrypt', inputPath, outputPath]
    : ['--decrypt', inputPath, outputPath];

  let exitCode = 0;
  try {
    exitCode = qpdf.callMain(args);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err) {
      exitCode = Number((err as { status: number }).status);
    } else {
      throw new PdfSecurityError(
        'UNSUPPORTED_ENCRYPTION',
        'Gagal mendekripsi PDF dengan qpdf WASM.'
      );
    }
  }

  // Exit code 0 = success, 3 = success with minor PDF warnings
  if (exitCode !== 0 && exitCode !== 3) {
    if (exitCode === 2) {
      throw new PdfSecurityError(
        'INCORRECT_PASSWORD',
        'Password salah atau metode enkripsi PDF tidak didukung.'
      );
    }
    throw new PdfSecurityError(
      'CORRUPT_PDF',
      `Gagal mendekripsi PDF (kode qpdf ${exitCode}).`
    );
  }

  const decryptedBytes = fs.readFile(outputPath);
  return new Blob([decryptedBytes.slice().buffer as ArrayBuffer], {
    type: 'application/pdf',
  });
}

/**
 * Encrypts a PDF with AES-256 locally using qpdf WASM.
 */
export async function encryptPdfToBlob(
  bytes: Uint8Array,
  userPassword: string,
  ownerPassword?: string
): Promise<Blob> {
  if (!userPassword.trim()) {
    throw new PdfSecurityError('NEED_PASSWORD', 'Password tidak boleh kosong.');
  }
  const createQpdfModule = await loadQpdfFactory();
  const qpdf = await createQpdfModule({
    locateFile: () => '/wasm/qpdf.wasm',
  });

  const inputPath = '/input_plain.pdf';
  const outputPath = '/output_protected.pdf';
  const fs = qpdf.FS as unknown as {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
  fs.writeFile(inputPath, bytes);

  const ownerPw = ownerPassword?.trim() || userPassword;
  const args = [
    '--encrypt',
    userPassword,
    ownerPw,
    '256',
    '--',
    inputPath,
    outputPath,
  ];

  let exitCode = 0;
  try {
    exitCode = qpdf.callMain(args);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err) {
      exitCode = Number((err as { status: number }).status);
    } else {
      throw new PdfSecurityError('UNSUPPORTED_ENCRYPTION', 'Gagal mengenkripsi PDF dengan qpdf WASM.');
    }
  }

  if (exitCode !== 0 && exitCode !== 3) {
    throw new PdfSecurityError('CORRUPT_PDF', `Gagal mengenkripsi PDF (kode qpdf ${exitCode}).`);
  }

  const outBytes = fs.readFile(outputPath);
  return new Blob([outBytes.slice().buffer as ArrayBuffer], {
    type: 'application/pdf',
  });
}

/**
 * Attempts to repair a damaged PDF locally by rebuilding xref/object streams via qpdf WASM.
 */
export async function repairPdfLocally(bytes: Uint8Array): Promise<Blob> {
  const createQpdfModule = await loadQpdfFactory();
  const qpdf = await createQpdfModule({
    locateFile: () => '/wasm/qpdf.wasm',
  });

  const inputPath = '/input_damaged.pdf';
  const outputPath = '/output_repaired.pdf';
  const fs = qpdf.FS as unknown as {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
  fs.writeFile(inputPath, bytes);

  let exitCode = 0;
  try {
    exitCode = qpdf.callMain(['--linearize', inputPath, outputPath]);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err) {
      exitCode = Number((err as { status: number }).status);
    } else {
      throw new PdfSecurityError('CORRUPT_PDF', 'Gagal memperbaiki PDF secara lokal.');
    }
  }

  if (exitCode !== 0 && exitCode !== 3) {
    throw new PdfSecurityError('CORRUPT_PDF', `PDF terlalu rusak untuk diperbaiki lokal (kode ${exitCode}).`);
  }

  const outBytes = fs.readFile(outputPath);
  return new Blob([outBytes.slice().buffer as ArrayBuffer], {
    type: 'application/pdf',
  });
}
