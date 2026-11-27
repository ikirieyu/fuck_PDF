/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'turndown' {
  class TurndownService {
    constructor(options?: { headingStyle?: 'setext' | 'atx' });
    turndown(html: string): string;
  }
  export default TurndownService;
}

declare module 'libheif-js/wasm-bundle' {
  const libheif: {
    HeifDecoder: new () => {
      decode(buffer: Uint8Array): Array<{
        get_width(): number;
        get_height(): number;
        display(
          imageData: ImageData,
          callback: (displayData: ImageData | null) => void
        ): void;
      }>;
    };
  };
  export default libheif;
}
