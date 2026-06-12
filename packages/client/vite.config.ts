import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// vite-plugin-pwa loads `workbox-build` via a dynamic require at build time.
// Because this package is `"type": "module"`, the config (and the plugin's
// bundled ESM) run in an ESM context where `require` is undefined, which makes
// the plugin throw `Dynamic require of "workbox-build" is not supported`.
// Provide a real CJS `require` on the global scope so that lazy load succeeds.
if (typeof (globalThis as { require?: unknown }).require === 'undefined') {
  (globalThis as { require?: unknown }).require = createRequire(import.meta.url);
}

// workbox-build unconditionally requires `@rollup/plugin-terser`, whose
// `serialize-javascript` dependency runs a bare `crypto.getRandomValues()` at
// module-load time. Under Vite's loader on Node 18 the global `crypto` is not
// present in this scope, so expose the Web Crypto API before the build runs.
// On Node 20+ the global already exists as a getter-only property — assigning
// to it throws, so only shim when it is actually missing.
if (typeof (globalThis as { crypto?: unknown }).crypto === 'undefined') {
  (globalThis as { crypto?: unknown }).crypto = webcrypto;
}

const nodeMajor = Number(process.versions.node.split('.')[0]);

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      // On Node 18 workbox's production mode runs terser in a worker thread
      // where `globalThis.crypto` is undefined, crashing `serialize-javascript`
      // — emit the service worker unminified there. Node 20+ minifies normally.
      workbox: {
        mode: nodeMajor < 20 ? 'development' : 'production',
      },
      manifest: {
        id: '/',
        start_url: '/',
        scope: '/',
        name: 'Задачи команды',
        short_name: 'Задачи',
        description: 'Командный таск-менеджер: задачи для команды из 5 человек',
        lang: 'ru',
        dir: 'ltr',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        categories: ['productivity'],
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
});
