/**
 * Fair play signals: full screen exits, tab switches and focus loss, sent in
 * batches. They are signals for invigilators, not a control: a modified client
 * could stay silent, so the network cut and the invigilators are what enforce.
 * Off for now (see lib/features.ts), because docs/api.md has no route for them.
 */
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui'
import { z } from 'zod'
import { ApiError, request } from '../../lib/api'
import { serverNow } from '../../lib/clock'

type Report = { kind: string; detail: string; client_ts: number }

const FLUSH_MS = 5000
const DEDUPE_MS = 2000
const MAX_QUEUED = 200 // also the most the server takes in one batch

export function useFairplayReporting(enabled: boolean) {
  const queue = useRef<Report[]>([])
  const last = useRef<Record<string, number>>({})

  const report = useRef((kind: string, detail = '') => {
    const now = Date.now()
    if (now - (last.current[kind] ?? 0) < DEDUPE_MS) return
    last.current[kind] = now
    queue.current = [...queue.current, { kind, detail, client_ts: serverNow() / 1000 }].slice(-MAX_QUEUED)
  }).current

  useEffect(() => {
    if (!enabled) return
    const onFullscreen = () => {
      if (!document.fullscreenElement) report('fullscreen_exit')
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') report('tab_hidden')
    }
    const onBlur = () => report('focus_lost')
    document.addEventListener('fullscreenchange', onFullscreen)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)

    const flush = setInterval(async () => {
      const batch = queue.current
      if (!batch.length) return
      queue.current = []
      try {
        await request('POST', '/fairplay/events', z.unknown(), { events: batch })
      } catch (err) {
        // A server that refuses this batch would refuse it forever; anything else can be retried
        if (!(err instanceof ApiError && err.status >= 400 && err.status < 500)) {
          queue.current = [...batch, ...queue.current].slice(-MAX_QUEUED)
        }
      }
    }, FLUSH_MS)

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      clearInterval(flush)
    }
  }, [enabled, report])
}

export function FullscreenBanner() {
  const [full, setFull] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  if (full) return null
  return (
    <div className="flex shrink-0 items-center justify-center gap-4 border-b border-amber/40 bg-amber/10 px-4 py-1.5 text-xs text-amber">
      Work in full screen. Leaving it, switching tabs or losing focus is reported to the invigilators.
      <Button className="!px-2 !py-0.5" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
        Full screen
      </Button>
    </div>
  )
}
