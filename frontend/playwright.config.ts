import { defineConfig } from '@playwright/test'

// lab.test maps to this machine, so the tests run on plain HTTP like the lab does:
// not localhost, which browsers treat as secure and which hides real failures.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://lab.test:4173',
    channel: 'chrome',
    launchOptions: { args: ['--host-resolver-rules=MAP lab.test 127.0.0.1'] },
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    { command: 'node mock/server.mjs', port: 8001, reuseExistingServer: false },
    { command: 'npm run build && npx vite preview --port 4173', port: 4173, reuseExistingServer: false, timeout: 120_000 },
  ],
})
