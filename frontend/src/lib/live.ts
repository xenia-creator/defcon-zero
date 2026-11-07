/** Toasts: the short messages that pop up and disappear. */
import { create } from 'zustand'

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
