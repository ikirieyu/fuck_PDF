import { BlobWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';
import { createExtractorFromData, UnrarError } from 'node-unrar-js';
import SevenZip from '7z-wasm';
import { zipSync } from 'fflate';
import type { ArchiveEntryItem, ArchiveFormat } from '../types/workbench';

export interface ArchiveInspectionResult {
  format: ArchiveFormat;
  requiresPassword: boolean;
  headerEncrypted: boolean;
  entries: ArchiveEntryItem[];
}

export class ArchiveEngineError extends Error {
  code: 'WRONG_PASSWORD' | 'PASSWORD_REQUIRED' | 'CORRUPT_FILE' | 'UNSUPPORTED_ENCRYPTION';
  constructor(
    code: 'WRONG_PASSWORD' | 'PASSWORD_REQUIRED' | 'CORRUPT_FILE' | 'UNSUPPORTED_ENCRYPTION',
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

let cachedUnrarWasm: ArrayBuffer | null = null;

async function getUnrarWasmBinary(): Promise<ArrayBuffer> {
  if (cachedUnrarWasm) return cachedUnrarWasm.slice(0);
  const res = await fetch('/wasm/unrar.wasm');
  if (!res.ok) {
    throw new Error('Gagal memuat modul unrar.wasm lokal.');
  }
  cachedUnrarWasm = await res.arrayBuffer();
  return cachedUnrarWasm.slice(0);
}

function getFileName(path: string): string {
  const clean = path.replace(/\/+$/, '');
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

async function readBlobAsUint8Array(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  const ab = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('Gagal membaca file.'));
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(ab);
}

function mapZipError(err: unknown, hadPassword: boolean): ArchiveEngineError {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (
    msg.includes('invalid password') ||
    msg.includes('wrong password') ||
    msg.includes('password') ||
    msg.includes('encrypted')
  ) {
    return new ArchiveEngineError(
      hadPassword ? 'WRONG_PASSWORD' : 'PASSWORD_REQUIRED',
      hadPassword
        ? 'Password ZIP salah. Periksa kembali karakter huruf besar/kecil.'
        : 'File ZIP ini terenkripsi. Masukkan password untuk membukanya.'
    );
  }
  if (msg.includes('unsupported') || msg.includes('compression method')) {
    return new ArchiveEngineError(
      'UNSUPPORTED_ENCRYPTION',
      'Metode enkripsi atau kompresi pada ZIP ini tidak didukung oleh browser.'
    );
  }
  return new ArchiveEngineError(
    'CORRUPT_FILE',
    'Struktur file ZIP korup atau tidak dapat dibaca.'
  );
}

function mapUnrarError(err: unknown, hadPassword: boolean): ArchiveEngineError {
  if (err instanceof UnrarError) {
    switch (err.reason) {
      case 'ERAR_BAD_PASSWORD':
        return new ArchiveEngineError(
          'WRONG_PASSWORD',
          'Password arsip RAR salah. Periksa kembali password Anda.'
        );
      case 'ERAR_MISSING_PASSWORD':
        return new ArchiveEngineError(
          'PASSWORD_REQUIRED',
          'Arsip RAR terenkripsi (termasuk header). Masukkan password untuk membuka daftar file.'
        );
      case 'ERAR_BAD_DATA':
      case 'ERAR_BAD_ARCHIVE':
        if (hadPassword) {
          return new ArchiveEngineError(
            'WRONG_PASSWORD',
            'Password RAR salah atau data terenkripsi gagal diverifikasi.'
          );
        }
        return new ArchiveEngineError(
          'CORRUPT_FILE',
          'File RAR korup atau terpotong (ERAR_BAD_DATA).'
        );
      case 'ERAR_UNKNOWN_FORMAT':
        return new ArchiveEngineError(
          'UNSUPPORTED_ENCRYPTION',
          'Format arsip RAR tidak dikenali atau bukan file RAR/RAR5 yang valid.'
        );
      default:
        return new ArchiveEngineError(
          'CORRUPT_FILE',
          `Gagal membaca arsip RAR (${err.reason}).`
        );
    }
  }
  return new ArchiveEngineError(
    'CORRUPT_FILE',
    err instanceof Error ? err.message : 'Gagal membaca file RAR.'
  );
}

async function runSevenZip(args: string[], archiveBytes: Uint8Array, archiveFilename: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sz = await SevenZip({
    locateFile: (file: string) => `/wasm/${file}`,
    print: (text: string) => stdout.push(text),
    printErr: (text: string) => stderr.push(text),
  });

  const safeName = archiveFilename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'archive.7z';
  const vArchivePath = `/${safeName}`;
  const outDir = '/out_extract';
  try {
    sz.FS.mkdir(outDir);
  } catch {
    // ignore if exists
  }

  sz.FS.writeFile(vArchivePath, archiveBytes);

  let exitCode = 0;
  try {
    sz.callMain([...args.map((a) => (a === '__ARCHIVE__' ? vArchivePath : a === '__OUTDIR__' ? outDir : a))]);
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'status' in e) {
      exitCode = Number((e as { status: number }).status);
    } else {
      exitCode = 2;
    }
  }

  const combinedLog = [...stdout, ...stderr].join('\n');
  return { sz, exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n'), combinedLog, vArchivePath, outDir };
}

function parse7zListing(stdout: string): { entries: ArchiveEntryItem[]; hasEncrypted: boolean } {
  const blocks = stdout.split(/\r?\n\r?\n/);
  const entries: ArchiveEntryItem[] = [];
  let hasEncrypted = false;
  let inFilesSection = false;

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const map: Record<string, string> = {};
    for (const line of lines) {
      if (line.startsWith('----------')) {
        inFilesSection = true;
        continue;
      }
      const eq = line.indexOf(' = ');
      if (eq > 0) {
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 3).trim();
        map[key] = val;
      }
    }
    if (!inFilesSection || !map['Path']) continue;
    const path = map['Path'].replace(/\\/g, '/');
    const isDir = map['Folder'] === '+' || (map['Attributes'] || '').startsWith('D');
    const encrypted = map['Encrypted'] === '+';
    if (encrypted) hasEncrypted = true;

    entries.push({
      id: path,
      path,
      name: getFileName(path),
      isDirectory: isDir,
      compressedSize: Number(map['Packed Size'] || 0) || 0,
      uncompressedSize: Number(map['Size'] || 0) || 0,
      encrypted,
      lastModified: map['Modified'] || undefined,
    });
  }

  return { entries, hasEncrypted };
}

function collectSevenZipOutFiles(
  sz: Awaited<ReturnType<typeof SevenZip>>,
  dirPath: string,
  basePrefix = ''
): { path: string; data: Uint8Array }[] {
  const results: { path: string; data: Uint8Array }[] = [];
  const names = sz.FS.readdir(dirPath);
  for (const name of names) {
    if (name === '.' || name === '..') continue;
    const full = `${dirPath}/${name}`;
    const stat = sz.FS.stat(full);
    const relPath = basePrefix ? `${basePrefix}/${name}` : name;
    if (sz.FS.isDir(stat.mode)) {
      results.push(...collectSevenZipOutFiles(sz, full, relPath));
    } else {
      const data = sz.FS.readFile(full, { encoding: 'binary' });
      results.push({ path: relPath, data: new Uint8Array(data) });
    }
  }
  return results;
}

export async function inspectArchive(
  file: File,
  format: ArchiveFormat,
  password?: string
): Promise<ArchiveInspectionResult> {
  if (format === 'zip') {
    const bytes = await readBlobAsUint8Array(file);
    const reader = new ZipReader(new Uint8ArrayReader(bytes), {
      password: password || undefined,
    });
    try {
      const rawEntries = await reader.getEntries();
      const entries: ArchiveEntryItem[] = rawEntries.map((e) => ({
        id: e.filename,
        path: e.filename,
        name: getFileName(e.filename),
        isDirectory: e.directory,
        compressedSize: e.compressedSize,
        uncompressedSize: e.uncompressedSize,
        encrypted: Boolean(e.encrypted),
        lastModified: e.lastModDate ? e.lastModDate.toISOString().slice(0, 16).replace('T', ' ') : undefined,
      }));
      const requiresPassword = entries.some((e) => e.encrypted);

      // If password was provided and entries are encrypted, test decrypting the smallest non-empty file to validate password immediately
      if (password && requiresPassword) {
        const probe = rawEntries.find((e) => !e.directory && e.encrypted);
        if (probe && 'getData' in probe && typeof probe.getData === 'function') {
          await probe.getData(new BlobWriter(), { password });
        }
      }

      return {
        format: 'zip',
        requiresPassword,
        headerEncrypted: false,
        entries,
      };
    } catch (err) {
      throw mapZipError(err, Boolean(password));
    } finally {
      await reader.close().catch(() => {});
    }
  }

  if (format === 'rar') {
    const [wasmBinary, data] = await Promise.all([
      getUnrarWasmBinary(),
      file.arrayBuffer(),
    ]);
    try {
      const extractor = await createExtractorFromData({
        wasmBinary,
        data,
        password: password || '',
      });
      const list = extractor.getFileList();
      const headers = Array.from(list.fileHeaders);
      const headerEncrypted = Boolean(list.arcHeader.flags.headerEncrypted);
      const hasEncryptedFiles = headers.some((h) => h.flags.encrypted);

      // Probe extraction of first encrypted entry if password was supplied so wrong password fails immediately
      if (password && (hasEncryptedFiles || headerEncrypted)) {
        const probe = headers.find((h) => !h.flags.directory && h.flags.encrypted);
        if (probe) {
          const extracted = extractor.extract({ files: [probe.name], password });
          const files = Array.from(extracted.files);
          if (files[0] && !files[0].extraction) {
            throw new ArchiveEngineError(
              'WRONG_PASSWORD',
              'Password arsip RAR salah. Periksa kembali password Anda.'
            );
          }
        }
      }

      const entries: ArchiveEntryItem[] = headers.map((h) => ({
        id: h.name,
        path: h.name,
        name: getFileName(h.name),
        isDirectory: h.flags.directory,
        compressedSize: h.packSize,
        uncompressedSize: h.unpSize,
        encrypted: h.flags.encrypted || headerEncrypted,
        lastModified: h.time || undefined,
      }));

      return {
        format: 'rar',
        requiresPassword: headerEncrypted || hasEncryptedFiles,
        headerEncrypted,
        entries,
      };
    } catch (err) {
      if (err instanceof ArchiveEngineError) throw err;
      throw mapUnrarError(err, Boolean(password));
    }
  }

  // 7z
  const bytes = new Uint8Array(await file.arrayBuffer());
  const passArg = password ? `-p${password}` : '-p';
  const res = await runSevenZip(['l', '-slt', passArg, '__ARCHIVE__'], bytes, file.name);
  const lower = res.combinedLog.toLowerCase();

  if (lower.includes('wrong password') || lower.includes('can not open encrypted archive')) {
    if (!password) {
      return {
        format: '7z',
        requiresPassword: true,
        headerEncrypted: true,
        entries: [],
      };
    }
    throw new ArchiveEngineError(
      'WRONG_PASSWORD',
      'Password arsip 7z salah. Periksa kembali huruf besar/kecil.'
    );
  }

  if (res.exitCode !== 0 && !res.stdout.includes('Path =')) {
    throw new ArchiveEngineError(
      'CORRUPT_FILE',
      'File 7z korup, terpotong, atau format arsip tidak valid.'
    );
  }

  const parsed = parse7zListing(res.stdout);
  return {
    format: '7z',
    requiresPassword: parsed.hasEncrypted,
    headerEncrypted: false,
    entries: parsed.entries,
  };
}

export async function extractArchiveFiles(
  file: File,
  format: ArchiveFormat,
  selectedPaths?: string[],
  password?: string
): Promise<{ path: string; name: string; data: Uint8Array }[]> {
  if (format === 'zip') {
    const bytes = await readBlobAsUint8Array(file);
    const reader = new ZipReader(new Uint8ArrayReader(bytes), {
      password: password || undefined,
    });
    try {
      const allEntries = await reader.getEntries();
      const targetSet = selectedPaths ? new Set(selectedPaths) : null;
      const targets = allEntries.filter(
        (e) => !e.directory && (!targetSet || targetSet.has(e.filename))
      );
      const output: { path: string; name: string; data: Uint8Array }[] = [];
      for (const entry of targets) {
        if (!('getData' in entry) || typeof entry.getData !== 'function') continue;
        const blob = await entry.getData(new BlobWriter(), {
          password: password || undefined,
        });
        const buf = await readBlobAsUint8Array(blob);
        output.push({
          path: entry.filename,
          name: getFileName(entry.filename),
          data: buf,
        });
      }
      return output;
    } catch (err) {
      throw mapZipError(err, Boolean(password));
    } finally {
      await reader.close().catch(() => {});
    }
  }

  if (format === 'rar') {
    const [wasmBinary, data] = await Promise.all([
      getUnrarWasmBinary(),
      file.arrayBuffer(),
    ]);
    try {
      const extractor = await createExtractorFromData({
        wasmBinary,
        data,
        password: password || '',
      });
      const extracted = extractor.extract({
        files: selectedPaths,
        password: password || '',
      });
      const output: { path: string; name: string; data: Uint8Array }[] = [];
      for (const item of extracted.files) {
        if (item.fileHeader.flags.directory) continue;
        if (!item.extraction) {
          throw new ArchiveEngineError(
            'WRONG_PASSWORD',
            'Password arsip RAR salah atau file terenkripsi gagal diekstrak.'
          );
        }
        output.push({
          path: item.fileHeader.name,
          name: getFileName(item.fileHeader.name),
          data: new Uint8Array(item.extraction),
        });
      }
      return output;
    } catch (err) {
      if (err instanceof ArchiveEngineError) throw err;
      throw mapUnrarError(err, Boolean(password));
    }
  }

  // 7z
  const bytes = new Uint8Array(await file.arrayBuffer());
  const passArg = password ? `-p${password}` : '-p';
  const args = ['x', '-y', passArg, '-o__OUTDIR__', '__ARCHIVE__', ...(selectedPaths || [])];
  const res = await runSevenZip(args, bytes, file.name);
  const lower = res.combinedLog.toLowerCase();

  if (lower.includes('wrong password') || lower.includes('data error in encrypted file')) {
    throw new ArchiveEngineError(
      'WRONG_PASSWORD',
      'Password arsip 7z salah. Gagal mendekripsi data.'
    );
  }
  if (lower.includes('unsupported method')) {
    throw new ArchiveEngineError(
      'UNSUPPORTED_ENCRYPTION',
      'Metode enkripsi atau kompresi pada arsip 7z ini tidak didukung.'
    );
  }
  if (res.exitCode !== 0 && !res.combinedLog.includes('Everything is Ok')) {
    throw new ArchiveEngineError(
      'CORRUPT_FILE',
      'Ekstraksi 7z gagal: file korup atau password tidak cocok.'
    );
  }

  const collected = collectSevenZipOutFiles(res.sz, res.outDir);
  return collected.map((c) => ({
    path: c.path,
    name: getFileName(c.path),
    data: c.data,
  }));
}

export function bundleFilesAsZip(files: { path: string; data: Uint8Array }[]): Blob {
  const zipInput: Record<string, Uint8Array> = {};
  for (const f of files) {
    const cleanPath = f.path.replace(/^\/+/, '');
    zipInput[cleanPath] = f.data;
  }
  const zipped = zipSync(zipInput, { level: 6 });
  return new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' });
}
