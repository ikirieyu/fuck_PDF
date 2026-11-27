import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface UnlockWorkerRequest {
  bytes: ArrayBuffer;
  candidates: string[];
}

self.onmessage = async (event: MessageEvent<UnlockWorkerRequest>) => {
  const { bytes, candidates } = event.data;
  const source = new Uint8Array(bytes);

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const task = pdfjsLib.getDocument({
        data: source.slice(),
        password: candidate,
        disableAutoFetch: true,
        disableStream: true,
      });
      const doc = await task.promise;
      await doc.cleanup().catch(() => {});
      self.postMessage({ matchedPassword: candidate, attempts: i + 1 });
      return;
    } catch {
      // Candidate did not match; continue to next pattern
    }
  }

  self.postMessage({ matchedPassword: null, attempts: candidates.length });
};
