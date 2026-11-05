/**
 * Where the backend is: the one place to change it.
 *
 * Set VITE_API_URL when building or running, for example
 *   VITE_API_URL=http://192.168.1.10:8002 npm run dev
 * Without it, the backend is expected on the same machine that serves this page, on port 8002.
 */
const fallback = typeof window === 'undefined' ? 'http://localhost:8002' : `${window.location.protocol}//${window.location.hostname}:8002`

export const API_URL = (import.meta.env.VITE_API_URL || fallback).replace(/\/$/, '')
