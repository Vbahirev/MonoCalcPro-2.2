import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const rawBasePath = process.env.VITE_BASE_PATH || '/'
const normalizedBasePath = rawBasePath.startsWith('/') ? rawBasePath : `/${rawBasePath}`
const basePath = normalizedBasePath.endsWith('/') ? normalizedBasePath : `${normalizedBasePath}/`

export default defineConfig({
  base: basePath,
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', '.nojekyll'],
      manifest: {
        name: 'MonoCalc Pro',
        short_name: 'MonoCalc',
        description: 'Калькуляторы MonoCalc Pro с поддержкой офлайн-режима',
        theme_color: '#121212',
        background_color: '#F5F5F7',
        display: 'standalone',
        start_url: basePath,
        scope: basePath,
        icons: [
          {
            src: `${basePath}favicon.svg`,
            sizes: 'any',
            type: 'image/svg+xml'
          }
        ]
      },
      workbox: {
        navigateFallback: `${basePath}index.html`,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-pages',
              networkTimeoutSeconds: 5
            }
          },
          {
            urlPattern: ({ request }) => ['script', 'style', 'worker'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'app-static-resources'
            }
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-images',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30
              }
            }
          }
        ]
      }
    }),
  ],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/entry-[hash].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/asset-[hash][extname]',
        manualChunks(id) {
          // --- app code splitting ---
          if (!id.includes('node_modules')) {
            if (id.includes('views/LaserSettings')) return 'view-settings';
            if (id.includes('views/AdminDataAudit')) return 'view-admin';
            if (id.includes('views/ArchiveView')) return 'view-archive';
            if (id.includes('components/DesktopApp')) return 'app-desktop';
            if (id.includes('components/MobileApp')) return 'app-mobile';
            return undefined;
          }

          // --- vendor splitting ---
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) return 'firebase-vendor';
          if (id.includes('vue')) return 'vue-vendor';
          if (id.includes('vuedraggable')) return 'drag-vendor';

          return 'vendor';
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})