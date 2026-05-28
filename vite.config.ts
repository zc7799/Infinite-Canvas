import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@components': resolve(__dirname, 'src/components'),
    },
  },
  build: {
    outDir: 'static/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'api-settings': resolve(__dirname, 'src/pages/api-settings/index.html'),
        // Additional page entries will be added as they are migrated
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
      '/output': 'http://127.0.0.1:3000',
      '/assets': 'http://127.0.0.1:3000',
    },
  },
})
