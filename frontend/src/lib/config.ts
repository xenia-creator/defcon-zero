/**
 * Where the backend is: the one place to change it.
 *
 * Ports, on the machine serving this page:
 *   8002  the real backend (the default)
 *   8012  the local mock server, mock/server.mjs (used by `npm run dev:mock`)
 *   8022  the mock the browser tests start for themselves (see playwright.config.ts)
 *
 * Set VITE_API_URL when building or running to point anywhere else, for example
 *   VITE_API_URL=http://192.168.1.10:8002 npm run dev
 */

/**
 * True only when running against the local mock server, which is the only backend
 * with the /__mock/* control routes. Set by `npm run dev:mock` (vite --mode mock).
 * It also requires a dev server, so a production build never shows the demo
 * controls, calls /__mock/*, or defaults to the mock's port.
 */
export const USE_MOCK_API = import.meta.env.DEV && import.meta.env.MODE === 'mock'

const REAL_BACKEND_PORT = 8002
const MOCK_PORT = 8012

const port = USE_MOCK_API ? MOCK_PORT : REAL_BACKEND_PORT
const fallback = typeof window === 'undefined' ? `http://localhost:${port}` : `${window.location.protocol}//${window.location.hostname}:${port}`

export const API_URL = (import.meta.env.VITE_API_URL || fallback).replace(/\/$/, '')
