import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/MonoCalcPRO2.1/',
  plugins: [
    vue(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('firebase')) return 'firebase';
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