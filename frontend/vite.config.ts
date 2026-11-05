import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// In development the Vite server passes API calls to the backend, on port 8001 as in docs/api.md
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      '/api': { target: process.env.API_TARGET ?? 'http://localhost:8001' },
    },
  },
  // Teams reach the client by the lab machine's name or IP, not localhost
  preview: { host: true, allowedHosts: true },
  build: { chunkSizeWarningLimit: 4000 },
  test: { exclude: ['e2e/**', 'node_modules/**'] },
})
