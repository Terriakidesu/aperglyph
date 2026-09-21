import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const configuredBasePath = process.env.VITE_BASE_PATH ?? '/';
const basePath = configuredBasePath.endsWith('/') ? configuredBasePath : `${configuredBasePath}/`;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'AperGlyph',
        short_name: 'AperGlyph',
        description: 'A local-first diagram studio for the open web.',
        theme_color: '#0b0d13',
        background_color: '#0b0d13',
        display: 'standalone',
        start_url: basePath,
        scope: basePath,
        icons: [
          { src: `${basePath}pwa-192.svg`, sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: `${basePath}pwa-512.svg`, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm,woff2}'],
      },
    }),
  ],
  server: {
    watch: {
      ignored: ['**/target/**'],
    },
  },
});
