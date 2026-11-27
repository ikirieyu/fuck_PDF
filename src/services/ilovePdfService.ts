/**
 * ilovePdfService.ts
 * Cloud Fallback: iLovePDF API — Unlock PDF via cloud (opt-in, with explicit consent)
 *
 * Flow:
 *  1. POST /v1/auth (public_key) → JWT token
 *  2. GET  /v1/start/unlock (Bearer token) → { server, task }
 *  3. POST https://{server}/v1/upload (task + file) → { server_filename }
 *  4. POST https://{server}/v1/process (task, tool, files)
 *  5. GET  https://{server}/v1/download/{task} → PDF Blob
 *  6. DELETE https://{server}/v1/task/{task} (cleanup)
 */

import { memoryManager } from '../utils/memoryManager';

const AUTH_URL = 'https://api.ilovepdf.com/v1/auth';
const API_BASE = 'https://api.ilovepdf.com/v1';

async function fetchCloudAuthToken(signal?: AbortSignal): Promise<string> {
  let proxyError = '';
  // 1. Prefer Vercel serverless proxy (/api/cloud-auth) so key never sits in client bundle
  try {
    const proxyRes = await fetch('/api/cloud-auth', {
      method: 'POST',
      signal,
    });
    if (proxyRes.ok) {
      const data = (await proxyRes.json()) as { token?: string; error?: string };
      if (data.token) return data.token;
    } else {
      const txt = await proxyRes.text().catch(() => proxyRes.statusText);
      proxyError = `Proxy /api/cloud-auth (${proxyRes.status}): ${txt}`;
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    proxyError = err instanceof Error ? err.message : 'Proxy unreachable';
  }

  // 2. Fallback for local `vite dev` via .env.local (gitignored)
  const localKey = import.meta.env.VITE_CLOUD_PDF_PUBLIC_KEY as string | undefined;
  if (!localKey) {
    throw new Error(
      proxyError ||
        'Cloud Engine key belum dikonfigurasi. Set CLOUD_PDF_PUBLIC_KEY di Vercel lalu Redeploy.'
    );
  }

  const authRes = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_key: localKey }),
    signal,
  });
  if (!authRes.ok) {
    const txt = await authRes.text().catch(() => authRes.statusText);
    throw new Error(`Cloud Engine auth failed (${authRes.status}): ${txt}`);
  }
  const authData = (await authRes.json()) as { token?: string; error?: string };
  if (!authData.token) {
    throw new Error(`Cloud Engine auth: no token returned. ${authData.error ?? ''}`);
  }
  return authData.token;
}

export type IlovePdfToolName =
  | 'unlock'
  | 'repair'
  | 'ocr'
  | 'pdfa'
  | 'officepdf'
  | 'compress'
  | 'protect'
  | 'merge'
  | 'split'
  | 'pdfjpg';

export interface IlovePdfProgress {
  stage: 'auth' | 'start' | 'upload' | 'process' | 'download' | 'cleanup';
  pct: number; // 0–100
}

export type IlovePdfProgressCallback = (p: IlovePdfProgress) => void;

/** Bytes sent to iLovePDF for telemetry tracking */
export let ilovePdfBytesSent = 0;

function resetBytesSent() {
  ilovePdfBytesSent = 0;
}

/**
 * Unlocks a PDF via the iLovePDF cloud API.
 * Returns a Blob of the unlocked PDF, plus the actual bytes uploaded.
 */
export async function unlockPdfViaCloud(
  file: File,
  signal?: AbortSignal,
  onProgress?: IlovePdfProgressCallback
): Promise<{ blob: Blob; bytesUploaded: number }> {
  return runIlovePdfTool('unlock', [file], undefined, signal, onProgress);
}

/**
 * Generic iLovePDF Cloud API runner for any supported tool (unlock, repair, ocr, pdfa, officepdf, etc.).
 */
export async function runIlovePdfTool(
  tool: IlovePdfToolName,
  files: File[],
  extraParams?: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: IlovePdfProgressCallback
): Promise<{ blob: Blob; bytesUploaded: number }> {
  resetBytesSent();
  const report = (stage: IlovePdfProgress['stage'], pct: number) =>
    onProgress?.({ stage, pct });

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  report('auth', 5);
  const token = await fetchCloudAuthToken(signal);

  // ── 2. Start task ──────────────────────────────────────────────────────────
  report('start', 15);
  const startRes = await fetch(`${API_BASE}/start/${tool}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!startRes.ok) {
    const txt = await startRes.text().catch(() => startRes.statusText);
    throw new Error(`Cloud Engine start(${tool}) failed (${startRes.status}): ${txt}`);
  }
  const startData = (await startRes.json()) as {
    server?: string;
    task?: string;
    error?: string;
  };
  const { server, task } = startData;
  if (!server || !task) {
    throw new Error(`Cloud Engine start: missing server/task. ${startData.error ?? ''}`);
  }

  // ── 3. Upload ──────────────────────────────────────────────────────────────
  report('upload', 30);
  const uploadedFiles: { server_filename: string; filename: string }[] = [];
  let totalUploaded = 0;

  for (const f of files) {
    const form = new FormData();
    form.append('task', task);
    form.append('file', f, f.name);
    ilovePdfBytesSent += f.size;
    totalUploaded += f.size;
    memoryManager.recordExternalUpload(f.size);

    const uploadRes = await fetch(`https://${server}/v1/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal,
    });
    if (!uploadRes.ok) {
      const txt = await uploadRes.text().catch(() => uploadRes.statusText);
      throw new Error(`Cloud Engine upload failed (${uploadRes.status}): ${txt}`);
    }
    const uploadData = (await uploadRes.json()) as {
      server_filename?: string;
      error?: string;
    };
    if (!uploadData.server_filename) {
      throw new Error(`Cloud Engine upload: no server_filename. ${uploadData.error ?? ''}`);
    }
    uploadedFiles.push({ server_filename: uploadData.server_filename, filename: f.name });
  }

  // ── 4. Process ─────────────────────────────────────────────────────────────
  report('process', 55);
  const processRes = await fetch(`https://${server}/v1/process`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      task,
      tool,
      files: uploadedFiles,
      ...(extraParams ?? {}),
    }),
    signal,
  });
  if (!processRes.ok) {
    const txt = await processRes.text().catch(() => processRes.statusText);
    throw new Error(`Cloud Engine process(${tool}) failed (${processRes.status}): ${txt}`);
  }

  // ── 5. Download ────────────────────────────────────────────────────────────
  report('download', 75);
  const downloadRes = await fetch(`https://${server}/v1/download/${task}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!downloadRes.ok) {
    const txt = await downloadRes.text().catch(() => downloadRes.statusText);
    throw new Error(`Cloud Engine download failed (${downloadRes.status}): ${txt}`);
  }
  const blob = await downloadRes.blob();

  // ── 6. Cleanup (best-effort) ───────────────────────────────────────────────
  report('cleanup', 92);
  try {
    await fetch(`https://${server}/v1/task/${task}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // ignore cleanup failures
  }

  report('cleanup', 100);
  return { blob, bytesUploaded: totalUploaded };
}
