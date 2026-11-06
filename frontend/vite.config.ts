import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The backend address is in src/lib/config.ts
  server: { host: true },
  // Teams reach the client by the lab machine's name or IP, not localhost
  preview: { host: true, allowedHosts: true },
  build: { chunkSizeWarningLimit: 4000 },
  test: { exclude: ['e2e/**', 'node_modules/**'] },
})
