import { describe, expect, it, vi } from 'vitest';
import { parsePageRanges } from '../pdfEditorEngine';
import { bundleFilesAsZip, inspectArchive, extractArchiveFiles } from '../archiveEngine';
import {
  generateFilenamePasswordCandidates,
  hasPdfEncryptDictionary,
} from '../pdfSecurityEngine';
import { memoryManager } from '../../utils/memoryManager';

describe('PDF page range parser & archive ZIP roundtrip', () => {
  it('parses and clamps split page ranges accurately', () => {
    expect(parsePageRanges('1-3, 5', 8)).toEqual([1, 2, 3, 5]);
    expect(parsePageRanges('4-2, 10, 0', 6)).toEqual([2, 3, 4]);
    expect(parsePageRanges('invalid', 5)).toEqual([]);
  });

  it('bundles files into a ZIP and inspects/extracts them locally', async () => {
    const payload = new TextEncoder().encode('Data rahasia lokal 100%');
    const zipBlob = bundleFilesAsZip([
      { path: 'folder/catatan.txt', data: payload },
    ]);
    const zipFile = new File([zipBlob], 'test.zip', { type: 'application/zip' });

    const inspected = await inspectArchive(zipFile, 'zip');
    expect(inspected.format).toBe('zip');
    expect(inspected.requiresPassword).toBe(false);
    expect(inspected.entries.some((e) => e.path === 'folder/catatan.txt')).toBe(true);

    const extracted = await extractArchiveFiles(zipFile, 'zip', ['folder/catatan.txt']);
    expect(extracted).toHaveLength(1);
    expect(new TextDecoder().decode(extracted[0].data)).toBe('Data rahasia lokal 100%');
  });

  it('tracks and purges managed Object URLs and cleanup callbacks', () => {
    const spy = vi.fn();
    const unsub = memoryManager.registerCleanupCallback(spy);
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-1');
    URL.revokeObjectURL = vi.fn();

    try {
      const url = memoryManager.createManagedUrl(new Blob(['abc']));
      expect(url).toBe('blob:mock-1');
      expect(memoryManager.getActiveUrlCount()).toBe(1);

      const purged = memoryManager.purgeAllMemory();
      expect(purged).toBe(1);
      expect(memoryManager.getActiveUrlCount()).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      unsub();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it('extracts up to 15 smart password candidates from filename and detects /Encrypt dict', () => {
    const candidates = generateFilenamePasswordCandidates('E_Payslip_202601_19950817.pdf');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(15);
    expect(candidates).toContain('202601');
    expect(candidates).toContain('19950817');
    expect(candidates).toContain('17081995');

    const encryptedHeader = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >> endobj');
    const plainHeader = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj');
    expect(hasPdfEncryptDictionary(encryptedHeader)).toBe(true);
    expect(hasPdfEncryptDictionary(plainHeader)).toBe(false);
  });
});
