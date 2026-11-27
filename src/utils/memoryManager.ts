type Listener = () => void;

class MemoryManager {
  private urls = new Set<string>();
  private listeners = new Set<Listener>();
  private cleanupCallbacks = new Set<() => void>();
  private externalBytesAttempted = 0;
  private externalRequestsAttempted = 0;

  createManagedUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    this.notify();
    return url;
  }

  revokeManagedUrl(url?: string | null): void {
    if (!url) return;
    if (this.urls.has(url)) {
      URL.revokeObjectURL(url);
      this.urls.delete(url);
      this.notify();
    } else if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }

  registerCleanupCallback(cb: () => void): () => void {
    this.cleanupCallbacks.add(cb);
    return () => {
      this.cleanupCallbacks.delete(cb);
    };
  }

  purgeAllMemory(): number {
    const count = this.urls.size;
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
    for (const cb of this.cleanupCallbacks) {
      try {
        cb();
      } catch {
        // Ignore individual cleanup failures
      }
    }
    this.notify();
    return count;
  }

  getActiveUrlCount(): number {
    return this.urls.size;
  }

  getExternalUploadStats(): { bytes: number; requests: number } {
    return {
      bytes: this.externalBytesAttempted,
      requests: this.externalRequestsAttempted,
    };
  }

  recordExternalUpload(bytes: number): void {
    this.externalRequestsAttempted += 1;
    this.externalBytesAttempted += Math.max(0, bytes);
    this.notify();
  }

  installNetworkAudit(): void {
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
    try {
      const origin = window.location.origin;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const res = entry as PerformanceResourceTiming;
          if (
            res.name &&
            !res.name.startsWith(origin) &&
            !res.name.startsWith('blob:') &&
            !res.name.startsWith('data:')
          ) {
            this.externalRequestsAttempted += 1;
            this.externalBytesAttempted += res.transferSize || 0;
            this.notify();
          }
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // PerformanceObserver unsupported in test/restricted environments
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

export const memoryManager = new MemoryManager();

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke shortly after browser initiates download
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
