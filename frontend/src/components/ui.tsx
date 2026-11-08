import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { formatDuration, useClock, useServerNow, windowRemaining } from '../lib/clock'
import type { Round } from '../lib/contract'
import { defconLevel } from '../lib/rounds'
import { useLive } from '../lib/live'
import { useCurrentRound } from '../lib/queries'

export function Panel({
  title,
  right,
  className = '',
  bodyClass = 'p-4',
  children,
}: {
  title?: ReactNode
  right?: ReactNode
  className?: string
  bodyClass?: string
  children: ReactNode
}) {
  return (
    <section className={`relative flex flex-col border border-steel bg-panel/90 panel-3d ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-steel bg-steel/40 px-4 py-2">
          <h2 className="label !text-paper tracking-[0.18em]">{title}</h2>
          {right}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  )
}

const BUTTON_STYLES = {
  primary: 'bg-fire text-ink border-fire hover:bg-fire-light hover:border-fire-light shadow-[0_2px_0_0_rgb(0_0_0/0.6)] active:translate-y-px active:shadow-none',
  ghost: 'bg-transparent text-paper border-steel-light hover:border-paper hover:text-fire',
  danger: 'bg-transparent text-alert border-alert-dim hover:border-alert hover:bg-alert/10',
}

export function Button({
  variant = 'ghost',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_STYLES }) {
  return (
    <button
      className={`cursor-pointer border px-4 py-2 font-mono text-xs font-semibold uppercase tracking-widest transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  )
}

/**
 * The primary button on a paper sheet (login form, claim form). Enabled: solid fire with ink text, an
 * ink border and an ink drop, the strongest thing on the page. Disabled: no fill, a dashed outline in
 * muted ink (still readable, clearly not ready), instead of a faded fire that reads as broken.
 */
export const paperPrimaryClass =
  'border-2 !border-type-ink !text-type-ink font-bold shadow-[0_3px_0_0_var(--color-type-ink)] hover:!border-type-ink disabled:!opacity-100 disabled:!bg-transparent disabled:border-dashed disabled:!border-type-muted disabled:!text-type-muted disabled:!shadow-none'

export const inputClass =
  'w-full border border-steel-light bg-ink px-3 py-2 font-mono text-sm text-paper outline-none focus:border-fire focus:shadow-[inset_0_0_0_1px_var(--color-fire)] transition-shadow'

const STATUS_TONE: Record<string, string> = {
  active: 'text-khaki border-khaki/50',
  accepted: 'text-coop border-coop/50',
  advanced: 'text-coop border-coop/50',
  published: 'text-coop border-coop/50',
  rejected: 'text-alert border-alert-dim',
  eliminated: 'text-alert border-alert-dim',
  disqualified: 'text-alert border-alert-dim',
  failed: 'text-alert border-alert-dim',
  forfeit: 'text-alert border-alert-dim',
  absent: 'text-muted border-steel-light',
  pending: 'text-amber border-amber/50',
  open: 'text-amber border-amber/50',
  running: 'text-amber border-amber/50',
  verifying: 'text-amber border-amber/50',
  review: 'text-peace border-peace/50',
  locked: 'text-paper border-steel-light',
  draft: 'text-muted border-steel-light',
  taken: 'text-alert border-alert/40',
}

export function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-block border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${STATUS_TONE[status] ?? 'text-muted border-steel'}`}>
      {status}
    </span>
  )
}

const WAITING: Record<string, string> = {
  waiting: 'The window has not opened yet',
  running: 'Matches are being played',
  review: 'Results are under review',
  published: 'Results are published',
}

/** The big timer. Always drawn from server time; the deadline itself is enforced by the server. */
export function WindowTimer({ round }: { round: Round | null | undefined }) {
  const now = useServerNow()
  const synced = useClock((s) => s.synced)
  const seconds = windowRemaining(round, now)
  if (seconds === null) {
    return <p className="py-1 text-sm text-muted">{round ? (WAITING[round.status] ?? round.status) : 'No round is active'}</p>
  }
  const urgent = seconds < 60
  const nearEnd = seconds < 300
  const tone = urgent ? 'text-alert' : nearEnd ? 'text-amber' : 'text-coop'
  return (
    <div data-testid="timer">
      <span className="label !text-[11px] tracking-[0.2em]">{seconds > 0 ? 'Window closes in' : 'Window closing'}</span>
      {/* Never blinks: a blinking number is unreadable half the time, and teams must always see their time left */}
      <p className={`text-4xl font-bold tabular-nums ${tone}`}>{formatDuration(seconds)}</p>
      {!synced && <p className="mt-1 text-xs text-amber">Syncing with the server clock…</p>}
    </div>
  )
}

export function Countdown({ round, large = false }: { round: Round | null | undefined; large?: boolean }) {
  const now = useServerNow()
  const seconds = windowRemaining(round, now)
  if (seconds === null) return <span className="label">{round ? `Round ${round.number}: ${round.status}` : 'No round'}</span>
  const urgent = seconds < 60
  return (
    <span className="flex items-baseline gap-2">
      <span className="label tracking-[0.14em]">{seconds > 0 ? 'Window closes' : 'Window closed'}</span>
      {/* Never blinks, so the time left is always readable */}
      <span className={`font-bold tabular-nums ${large ? 'text-4xl' : 'text-lg'} ${urgent ? 'text-alert' : 'text-amber'}`}>{formatDuration(seconds)}</span>
    </span>
  )
}

/** Whether the last poll reached the server. */
export function ConnectionStatus() {
  const { isPending, isError } = useCurrentRound()
  const status = isError ? 'reconnecting' : isPending ? 'connecting' : 'connected'
  const tone = status === 'connected' ? 'bg-coop' : 'bg-amber blink'
  return (
    <span className="flex items-center gap-2" title="Connection to the server">
      <span className={`h-2 w-2 rounded-full ${tone}`} />
      <span className="label !text-[10px]">{status}</span>
    </span>
  )
}

const DEFCON_CONFIG: Record<number, { label: string; color: string; glowClass: string; border: string }> = {
  3: { label: 'DEFCON', color: 'text-amber', glowClass: 'defcon-glow-3', border: 'border-amber/60' },
  2: { label: 'DEFCON', color: 'text-orange', glowClass: 'defcon-glow-2', border: 'border-orange/60' },
  1: { label: 'DEFCON', color: 'text-alert', glowClass: 'defcon-glow-1', border: 'border-alert/60' },
  0: { label: 'DEFCON', color: 'text-ink font-black', glowClass: 'defcon-glow-0', border: 'border-paper' },
}

/** DEFCON 3, 2, 1 for the three rounds, and ZERO once the final results are out (levels from lib/rounds.ts). */
export function Defcon({ round, compact = false }: { round: Round | null | undefined; compact?: boolean }) {
  const level = defconLevel(round)
  const cfg = DEFCON_CONFIG[level] ?? DEFCON_CONFIG[3]
  return (
    <span
      data-testid="defcon"
      className={`flex items-center gap-2 border transition-all duration-700 ${compact ? 'px-2 py-0.5' : 'px-3 py-1'} ${cfg.border} ${cfg.glowClass}`}
      title="The threat level rises each round"
    >
      <span className={`label !text-[10px] ${level === 0 ? '!text-ink' : ''}`}>{cfg.label}</span>
      <span className={`${compact ? 'text-base' : 'text-xl'} font-bold ${cfg.color}`}>{level === 0 ? 'ZERO' : level}</span>
    </span>
  )
}

/** Stands in for the browser's confirm(), which can be blocked and leaves full screen. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/85 p-4 tactical-grid" role="dialog" aria-modal="true">
      <Panel title={title} className="w-full max-w-md panel-3d">
        <div className="flex flex-col gap-4 text-sm">
          <div className="text-paper">{body}</div>
          <div className="flex justify-end gap-2">
            <Button autoFocus onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  )
}

/** One confirmation at a time: call ask(...), and render the returned dialog. */
export function useConfirm() {
  const [pending, setPending] = useState<{ title: string; body: ReactNode; confirmLabel: string; run: () => void } | null>(null)
  const dialog = pending && (
    <ConfirmDialog
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        setPending(null)
        pending.run()
      }}
    />
  )
  return { dialog, ask: setPending }
}

/** A side panel that fails alone, with the rest of the screen still working. */
export function Guard({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(_, reset) => (
        <Panel title={name}>
          <div className="flex flex-col gap-3 text-sm text-muted">
            <p>This panel hit a problem. Your work is safe.</p>
            <Button onClick={reset}>Try again</Button>
          </div>
        </Panel>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}

/** A failed load, with a way to try again instead of an endless spinner. */
export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted">
      <p>Could not load {what}.</p>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  )
}

/** Bottom left, because Submit and the results are on the right. */
export function Toasts() {
  const toasts = useLive((s) => s.toasts)
  const dismiss = useLive((s) => s.dismiss)
  const tone = { info: 'border-steel-light bg-panel', good: 'border-coop text-coop bg-panel', bad: 'border-alert text-alert bg-panel' }
  return (
    <div role="status" data-testid="toasts" className="fixed bottom-4 left-4 z-40 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <button key={t.id} onClick={() => dismiss(t.id)} className={`border px-3 py-2 text-left text-xs tracking-wide transition-opacity ${tone[t.tone]}`}>
          {t.text}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted tracking-wide">{children}</p>
}
