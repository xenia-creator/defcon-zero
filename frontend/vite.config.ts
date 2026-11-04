import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// In development the Vite server proxies the API (and WebSocket) to the Command Server
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8000', ws: true },
    },
  },
  // Teams reach the client by the lab machine's name or IP, not localhost
  preview: { host: true, allowedHosts: true },
  build: { chunkSizeWarningLimit: 4000 },
  test: { exclude: ['e2e/**', 'node_modules/**'] },
})
