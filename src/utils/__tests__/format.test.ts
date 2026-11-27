import { describe, expect, it } from 'vitest';
import {
  detectArchiveFormat,
  detectFileCategory,
  evaluateMemoryRisk,
  formatBytes,
  formatEta,
  getDefaultTargetFormat,
  replaceExtension,
} from '../format';

describe('format & routing utilities', () => {
  it('classifies file categories accurately across all PRD modules', () => {
    expect(detectFileCategory({ name: 'slip_gaji.pdf' })).toBe('pdf');
    expect(detectFileCategory({ name: 'backup.rar' })).toBe('archive');
    expect(detectFileCategory({ name: 'rahasia.7z' })).toBe('archive');
    expect(detectFileCategory({ name: 'foto.HEIC' })).toBe('image');
    expect(detectFileCategory({ name: 'klip.MKV' })).toBe('video');
    expect(detectFileCategory({ name: 'lagu.flac' })).toBe('audio');
    expect(detectFileCategory({ name: 'laporan.docx' })).toBe('document');
    expect(detectFileCategory({ name: 'data.xlsx' })).toBe('document');
    expect(detectFileCategory({ name: 'catatan.md' })).toBe('document');
    expect(detectFileCategory({ name: 'unknown.xyz' })).toBe('unknown');
  });

  it('detects archive formats accurately', () => {
    expect(detectArchiveFormat('a.zip')).toBe('zip');
    expect(detectArchiveFormat('b.RAR')).toBe('rar');
    expect(detectArchiveFormat('c.7z')).toBe('7z');
    expect(detectArchiveFormat('d.pdf')).toBeNull();
  });

  it('formats bytes and ETA cleanly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 250)).toBe('250 MB');
    expect(formatEta(42)).toBe('42 dtk');
    expect(formatEta(125)).toBe('2m 5d');
    expect(formatEta(undefined)).toBe('—');
  });

  it('picks sensible default target formats', () => {
    expect(getDefaultTargetFormat('image', 'png')).toBe('webp');
    expect(getDefaultTargetFormat('image', 'heic')).toBe('png');
    expect(getDefaultTargetFormat('video', 'mkv')).toBe('mp4');
    expect(getDefaultTargetFormat('audio', 'flac')).toBe('mp3');
    expect(getDefaultTargetFormat('document', 'docx')).toBe('pdf');
  });

  it('replaces extensions safely', () => {
    expect(replaceExtension('dokumen.lama.docx', 'pdf')).toBe('dokumen.lama.pdf');
    expect(replaceExtension('readme', 'txt')).toBe('readme.txt');
  });

  it('triggers memory caution for large video files (> 500 MB)', () => {
    const bigVideo = { name: 'film.mp4', size: 650 * 1024 * 1024, type: 'video/mp4' } as File;
    const warning = evaluateMemoryRisk([bigVideo]);
    expect(warning).not.toBeNull();
    expect(warning?.level).toBe('caution');
  });
});
