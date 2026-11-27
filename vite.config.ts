import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icon-app.png',
        'logo-horizontal.png',
        'logo-vertical.png',
        'wasm/*.wasm',
        'wasm/*.js',
      ],
      manifest: {
        name: 'fuck_PDF — Local-First File Workbench',
        short_name: 'fuck_PDF',
        description:
          'Utilitas web local-first untuk membuka arsip & PDF berpassword, mengonversi media/dokumen, dan mengedit PDF 100% di browser tanpa unggah server.',
        theme_color: '#F4F3EF',
        background_color: '#F4F3EF',
        display: 'standalone',
        icons: [
          {
            src: '/icon-app.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,wasm,mjs}'],
      },
    }),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  worker: {
    format: 'es',
  },
});
