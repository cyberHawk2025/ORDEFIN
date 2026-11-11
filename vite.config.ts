import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Production assets use relative URLs so Electron can load dist/index.html via file://.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', sourcemap: false },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
