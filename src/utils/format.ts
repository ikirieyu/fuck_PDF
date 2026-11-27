import type {
  ArchiveFormat,
  ConverterOutputFormat,
  FileCategory,
  MemoryWarning,
} from '../types/workbench';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'svg', 'bmp']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']);
const DOC_EXTS = new Set(['docx', 'txt', 'md', 'markdown', 'html', 'htm', 'csv', 'xlsx']);
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z']);

export function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() || '' : '';
}

export function detectFileCategory(file: { name: string; type?: string }): FileCategory {
  const ext = getExtension(file.name);
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (IMAGE_EXTS.has(ext) || file.type?.startsWith('image/')) return 'image';
  if (VIDEO_EXTS.has(ext) || file.type?.startsWith('video/')) return 'video';
  if (AUDIO_EXTS.has(ext) || file.type?.startsWith('audio/')) return 'audio';
  if (DOC_EXTS.has(ext)) return 'document';
  return 'unknown';
}

export function detectArchiveFormat(filename: string): ArchiveFormat | null {
  const ext = getExtension(filename);
  if (ext === 'zip' || ext === 'rar' || ext === '7z') return ext;
  return null;
}

export function getDefaultTargetFormat(
  category: 'image' | 'video' | 'audio' | 'document',
  inputExt: string
): ConverterOutputFormat {
  switch (category) {
    case 'image':
      return inputExt === 'png' ? 'webp' : 'png';
    case 'video':
      return inputExt === 'mp4' ? 'webm' : 'mp4';
    case 'audio':
      return inputExt === 'mp3' ? 'wav' : 'mp3';
    case 'document':
      return inputExt === 'pdf' ? 'txt' : 'pdf';
  }
}

export function getAllowedOutputFormats(
  category: 'image' | 'video' | 'audio' | 'document'
): { value: ConverterOutputFormat; label: string }[] {
  switch (category) {
    case 'image':
      return [
        { value: 'png', label: 'PNG' },
        { value: 'jpg', label: 'JPG' },
        { value: 'webp', label: 'WebP' },
        { value: 'avif', label: 'AVIF' },
        { value: 'ico', label: 'ICO (Icon)' },
      ];
    case 'video':
      return [
        { value: 'mp4', label: 'MP4 (H.264)' },
        { value: 'webm', label: 'WebM (VP9)' },
        { value: 'gif', label: 'GIF (Animasi)' },
      ];
    case 'audio':
      return [
        { value: 'mp3', label: 'MP3' },
        { value: 'wav', label: 'WAV' },
        { value: 'ogg', label: 'OGG' },
        { value: 'm4a', label: 'M4A' },
      ];
    case 'document':
      return [
        { value: 'pdf', label: 'PDF' },
        { value: 'txt', label: 'TXT (Plain Text)' },
        { value: 'html', label: 'HTML' },
        { value: 'md', label: 'Markdown (.md)' },
        { value: 'csv', label: 'CSV' },
      ];
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 100 || exp === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[exp]}`;
}

export function formatEta(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)} dtk`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}d`;
}

export function evaluateMemoryRisk(files: File[]): MemoryWarning | null {
  if (files.length === 0) return null;
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const maxFileBytes = Math.max(...files.map((f) => f.size));
  const hasVideo = files.some((f) => detectFileCategory(f) === 'video');

  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const deviceMemoryGb = nav?.deviceMemory ?? null;
  const isMobile =
    typeof navigator !== 'undefined' &&
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  const mb = 1024 * 1024;
  const gb = 1024 * mb;

  if (isMobile && (maxFileBytes > 500 * mb || totalBytes > 750 * mb)) {
    return {
      level: 'critical',
      deviceMemoryGb,
      isMobile,
      message: `Peringatan Memori Perangkat Mobile: File berukuran ${formatBytes(maxFileBytes)} mendekati batas heap WebAssembly browser mobile (~1–2 GB). ${hasVideo ? 'Video > 500 MB pada perangkat mobile berisiko menyebabkan tab crash (Out of Memory).' : 'Pertimbangkan memproses file satu per satu.'}`,
    };
  }

  if (deviceMemoryGb !== null && deviceMemoryGb <= 4 && totalBytes > 600 * mb) {
    return {
      level: 'caution',
      deviceMemoryGb,
      isMobile,
      message: `Perangkat terdeteksi memiliki RAM ~${deviceMemoryGb} GB. Total beban file ${formatBytes(totalBytes)} memerlukan alokasi buffer WebAssembly yang besar.`,
    };
  }

  if (maxFileBytes > 1.2 * gb || totalBytes > 1.8 * gb) {
    return {
      level: 'critical',
      deviceMemoryGb,
      isMobile,
      message: `Batas Memori WebAssembly Browser: Ukuran file (${formatBytes(maxFileBytes)}) mendekati batas memori tab WASM 32-bit (~2 GB). Proses dapat gagal dengan Out of Memory.`,
    };
  }

  if (hasVideo && maxFileBytes > 500 * mb) {
    return {
      level: 'caution',
      deviceMemoryGb,
      isMobile,
      message: `File video besar (${formatBytes(maxFileBytes)}) akan dimuat ke RAM browser untuk transcoding lokal FFmpeg WASM. Pastikan tab lain tidak memakan banyak memori.`,
    };
  }

  return null;
}

export function replaceExtension(filename: string, newExt: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}.${newExt}`;
}
