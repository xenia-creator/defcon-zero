/**
 * Server time. Every round answer carries server_time, and the offset is that
 * minus the midpoint of the round trip. Countdowns are always drawn from server
 * time, never the browser's clock; deadlines are only enforced on the server.
 */
import { useEffect, useState } from 'react'
import { create } from 'zustand'

// Ordinary network jitter must not make the countdown jump
const IGNORE_DRIFT_MS = 500

export const useClock = create<{ offset: number; synced: boolean }>(() => ({ offset: 0, synced: false }))

export function offsetFrom(sentAt: number, serverMs: number, receivedAt: number) {
  return serverMs - (sentAt + receivedAt) / 2
}

export function syncClock(sentAt: number, serverMs: number | null, receivedAt: number) {
  if (serverMs === null) return
  const offset = offsetFrom(sentAt, serverMs, receivedAt)
  const { offset: current, synced } = useClock.getState()
  if (!synced || Math.abs(offset - current) > IGNORE_DRIFT_MS) useClock.setState({ offset, synced: true })
}

export const serverNow = () => Date.now() + useClock.getState().offset

export function useServerNow(intervalMs = 250) {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Seconds left in a round's window, or null when no window is running. */
export function windowRemaining(round: { status: string; closesAt: number | null } | null | undefined, nowMs: number): number | null {
  if (!round || round.status !== 'open' || round.closesAt === null) return null
  return Math.max(0, (round.closesAt - nowMs) / 1000)
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}
