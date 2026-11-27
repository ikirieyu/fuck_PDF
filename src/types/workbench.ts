export type WorkspaceTab = 'home' | 'tools' | 'unlocker' | 'converter' | 'editor';

export type PdfToolId =
  | 'merge'
  | 'split'
  | 'remove-pages'
  | 'extract-pages'
  | 'organize'
  | 'scan-to-pdf'
  | 'compress'
  | 'repair'
  | 'ocr'
  | 'jpg-to-pdf'
  | 'word-to-pdf'
  | 'ppt-to-pdf'
  | 'excel-to-pdf'
  | 'html-to-pdf'
  | 'pdf-to-jpg'
  | 'pdf-to-word'
  | 'pdf-to-excel'
  | 'pdf-to-pdfa'
  | 'pdf-to-markdown'
  | 'rotate'
  | 'page-numbers'
  | 'watermark'
  | 'crop'
  | 'edit'
  | 'unlock'
  | 'protect'
  | 'sign'
  | 'redact'
  | 'compare'
  | 'resi';

export type FileCategory =
  | 'pdf'
  | 'archive'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'unknown';

export type ArchiveFormat = 'zip' | 'rar' | '7z';

export interface ArchiveEntryItem {
  id: string;
  path: string;
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
  encrypted: boolean;
  lastModified?: string;
}

export type ImageOutputFormat = 'jpg' | 'png' | 'webp' | 'avif' | 'ico';
export type VideoOutputFormat = 'mp4' | 'webm' | 'gif';
export type AudioOutputFormat = 'mp3' | 'wav' | 'ogg' | 'm4a';
export type DocumentOutputFormat = 'pdf' | 'txt' | 'html' | 'md' | 'csv';

export type ConverterOutputFormat =
  | ImageOutputFormat
  | VideoOutputFormat
  | AudioOutputFormat
  | DocumentOutputFormat;

export interface ConverterOptions {
  // Image options
  imageQuality: number; // 10 - 100
  imageWidth?: number;
  imageHeight?: number;
  stripExif: boolean;
  // Video options
  videoResolution: 'original' | '1080p' | '720p' | '480p';
  videoFps: 'original' | '60' | '30' | '24' | '15';
  trimStartSec?: number;
  trimEndSec?: number;
  muteAudio: boolean;
  // Audio options
  audioBitrate: '128k' | '192k' | '320k';
  // Document options
  paperSize: 'a4' | 'letter';
  paperOrientation: 'portrait' | 'landscape';
}

export type JobStatus = 'queued' | 'processing' | 'done' | 'error';

export interface ConversionJob {
  id: string;
  file: File;
  category: 'image' | 'video' | 'audio' | 'document';
  inputExt: string;
  targetFormat: ConverterOutputFormat;
  options: ConverterOptions;
  status: JobStatus;
  progress: number; // 0 - 100
  etaSeconds?: number;
  errorMessage?: string;
  outputBlob?: Blob;
  outputUrl?: string;
  outputName?: string;
  outputSize?: number;
}

export type PdfFontFamily = 'Helvetica' | 'TimesRoman' | 'Courier';

export type PdfAnnotationType =
  | 'text'
  | 'image'
  | 'highlight'
  | 'underline'
  | 'redaction'
  | 'draw'
  | 'rect'
  | 'link';

export interface PdfAnnotation {
  id: string;
  pageId: string;
  type: PdfAnnotationType;
  // Normalized coordinates (0..1 relative to rotated page display box)
  x: number;
  y: number;
  width: number;
  height: number;
  // Text properties
  text?: string;
  fontSize?: number;
  fontFamily?: PdfFontFamily;
  color?: string;
  whiteoutBg?: boolean;
  maskColor?: string;
  origX?: number;
  origY?: number;
  origWidth?: number;
  origHeight?: number;
  // Link property
  linkUrl?: string;
  // Freehand / shape properties
  points?: { x: number; y: number }[];
  strokeWidth?: number;
  // Image / signature properties
  imageDataUrl?: string;
  // Redaction fill color
  redactionColor?: '#000000' | '#FFFFFF';
}

export interface PdfTextBlockItem {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface PdfImageBlockItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfFormFieldItem {
  name: string;
  type: 'text' | 'checkbox';
  value: string | boolean;
}

export interface PdfPageItem {
  id: string;
  sourceDocId: string;
  sourcePageIndex: number; // 0-based in source PDF
  rotation: 0 | 90 | 180 | 270;
  thumbnailUrl?: string;
  width: number;
  height: number;
}

export interface PdfSourceDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
}

export interface MemoryWarning {
  level: 'caution' | 'critical';
  message: string;
  deviceMemoryGb: number | null;
  isMobile: boolean;
}
