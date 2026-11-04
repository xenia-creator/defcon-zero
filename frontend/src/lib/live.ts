/**
 * Toasts, and the WebSocket events the team screens react to. Server data that
 * has a REST endpoint is refreshed through TanStack Query.
 */
import type { QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import type { Schemas } from './api'
import type { Envelope } from './realtime'

export type Toast = { id: number; tone: 'info' | 'good' | 'bad'; text: string }

type LiveState = {
  toasts: Toast[]
  toast: (tone: Toast['tone'], text: string) => void
  dismiss: (id: number) => void
}

let toastId = 0

export const useLive = create<LiveState>((set) => ({
  toasts: [],
  toast: (tone, text) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.slice(-1), { id, tone, text }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 6000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

const isRound = (value: unknown): value is Schemas['RoundOut'] =>
  typeof value === 'object' && value !== null && typeof (value as Schemas['RoundOut']).index === 'number'

export function handleEvent(message: Envelope, queries: QueryClient) {
  const p = message.payload
  const live = useLive.getState()
  switch (message.type) {
    case 'hello':
      // Sent on every connect. Anything that failed or went stale while offline loads again
      queries.invalidateQueries()
      break
    case 'round.status':
    case 'window.updated': {
      const round = p.round
      if (!isRound(round)) break
      queries.setQueryData(['round', 'current'], (old: Schemas['RoundOut'] | null | undefined) =>
        !old || old.index <= round.index ? round : old,
      )
      break
    }
    case 'team.updated':
      queries.invalidateQueries({ queryKey: ['teams'] })
      queries.invalidateQueries({ queryKey: ['countries'] })
      break
    case 'submission.result': {
      const s = p.submission as Partial<Schemas['SubmissionOut']> | undefined
      queries.invalidateQueries({ queryKey: ['submissions'] })
      if (s?.version !== undefined && message.seq && Date.now() / 1000 - message.ts < 30) {
        live.toast(s.status === 'accepted' ? 'good' : 'bad', `Version ${s.version} ${s.status}`)
      }
      break
    }
    case 'standings.published':
      // A fallen team finds out here, and the next round's window comes with it
      queries.invalidateQueries({ queryKey: ['teams'] })
      queries.invalidateQueries({ queryKey: ['round'] })
      break
    case 'penalty.issued':
      live.toast('bad', `Penalty: ${String(p.points)} points. ${String(p.reason)}`)
      break
  }
}
