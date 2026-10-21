/// <reference types="vitest/config" />
// Dev server on DASHBOARD_PORT (5173); /api is proxied to the engine on PORT (8080).
// Only VITE_* variables could ever reach the browser, and the project defines none: the dashboard gets
// no .env value. PORT and DASHBOARD_PORT are read here, in Node, when started by `npm run dev:ui`.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const enginePort = Number(process.env.PORT) || 8080
const uiPort = Number(process.env.DASHBOARD_PORT) || 5173

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Never load .env files from this folder (there are none; the engine's .env stays at the repo root).
  envDir: 'no-env-files-here',
  server: {
    host: '127.0.0.1',
    port: uiPort,
    strictPort: true,
    // /preview: the engine's page previews (Phase 10 D1), embedded on the approval screen.
    proxy: { '/api': { target: `http://127.0.0.1:${enginePort}`, changeOrigin: false }, '/preview': { target: `http://127.0.0.1:${enginePort}`, changeOrigin: false } }
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: false
  }
})
