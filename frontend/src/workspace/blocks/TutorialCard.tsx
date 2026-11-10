/**
 * The guided tutorial's card (frontend/docs/BLOCKS.md 2.1): docked over the top right of the canvas,
 * not a modal, so the canvas, toolbox and Python stay usable. Skip is on every step; Esc skips while
 * focus is inside the card, so it never interferes with Blockly.
 */
import { useEffect, useId, useState } from 'react'
import type { Blockly } from './blocks'
import type { Layout } from './layout'
import { TUTORIALS, tutorialProgress, type TutorialEvents, type TutorialGame } from './tutorial'
import { TutorialHighlight } from './TutorialHighlight'

/** A general hint shows after this long with no change on the canvas. */
const GENERAL_HINT_MS = 20_000
/** "✓ Done" stays this long before the next step (none under reduced motion). */
const DONE_MS = 600

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function TutorialCard({
  game,
  layout,
  events,
  workspace,
  canRestore,
  onRead,
  onSkip,
  onKeep,
  onRestore,
}: {
  game: TutorialGame
  layout: Layout
  events: TutorialEvents
  /** The Blockly canvas, so the highlight can point at blocks and toolbox categories. */
  workspace: Blockly.WorkspaceSvg | null
  /** The tutorial was replayed over the team's own blocks, which can be put back. */
  canRestore: boolean
  /** Next on a reading step, or Finish on the submit step while the window is closed. */
  onRead: (stepId: string) => void
  onSkip: () => void
  /** The end card's Keep this. */
  onKeep: () => void
  /** The end card's Put my blocks back. */
  onRestore: () => void
}) {
  const steps = TUTORIALS[game]
  const progress = tutorialProgress(game, layout, events)
  const titleId = useId()
  const ended = progress.finished

  // "✓ Done" when a check passes, then the next step
  const [shown, setShown] = useState(progress.index)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (progress.index > shown && !steps[shown]?.read) {
      if (reducedMotion()) {
        setShown(progress.index)
        return
      }
      setFlash(true)
      const t = window.setTimeout(() => {
        setFlash(false)
        setShown(progress.index)
      }, DONE_MS)
      return () => window.clearTimeout(t)
    }
    setFlash(false)
    setShown(progress.index)
  }, [progress.index, shown, steps])

  // Back re-shows an earlier card's text; it never undoes blocks
  const [back, setBack] = useState(0)
  useEffect(() => setBack(0), [shown])
  const viewing = Math.max(0, shown - back)
  const step = steps[viewing]
  const isCurrent = viewing === shown

  // A general hint after 20 seconds with no change
  const [stale, setStale] = useState(false)
  const layoutKey = JSON.stringify(layout)
  useEffect(() => {
    setStale(false)
    const t = window.setTimeout(() => setStale(true), GENERAL_HINT_MS)
    return () => window.clearTimeout(t)
  }, [layoutKey, shown])

  const hint = isCurrent ? (progress.hint ?? (stale ? step.general : null)) : null
  const closedSubmit = isCurrent && step.submit && events.windowClosed

  const highlight = ended ? [{ kind: 'tour' as const, target: 'examples' as const }].filter(() => !!document.querySelector('[data-tour="examples"]')) : flash ? [] : step.highlight
  // Narrower in Round 3, so the card clears the canvas's zoom buttons
  const width = game === 'foreign_aid' ? 'w-[min(19rem,calc(100%-1.5rem))]' : 'w-[min(22rem,calc(100%-1.5rem))]'

  return (
    <>
    <TutorialHighlight workspace={workspace} targets={isCurrent ? highlight : []} />
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="tutorial-card"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (ended) onKeep()
          else onSkip()
        }
      }}
      className={`paper-sheet absolute top-3 right-3 z-20 flex ${width} flex-col gap-3 p-4`}
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-type-muted pb-2">
        <p id={titleId} className="font-title text-base tracking-[0.04em]">
          {ended ? 'Tutorial done' : step.title}
        </p>
        {!ended && (
          <span className="shrink-0 font-label text-xs tracking-[0.08em] text-type-muted uppercase">
            Step {viewing + 1} of {steps.length}
          </span>
        )}
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {ended ? (
          <p className="font-label text-sm leading-relaxed text-type-ink">
            You built a working strategy. For more ideas, open Start from this below the canvas. Identical bots tie, and ties are a coin toss, so change it to
            make it yours.
          </p>
        ) : flash ? (
          <p className="font-label text-sm font-bold text-type-ink">✓ Done</p>
        ) : (
          <>
            <p className="font-label text-sm leading-relaxed text-type-ink">
              {closedSubmit ? "Submit opens when the round's submission window does. Your strategy is saved here until then." : step.text}
            </p>
            {hint && <p className="border-l-2 border-type-red pl-3 font-label text-sm text-type-red">{hint}</p>}
          </>
        )}
      </div>
      {ended ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-type-muted pt-3">
          {canRestore && (
            <button type="button" onClick={onRestore} className={BACK_CLASS}>
              Put my blocks back
            </button>
          )}
          <button type="button" onClick={onKeep} className={NEXT_CLASS}>
            Keep this
          </button>
        </div>
      ) : (
      <div className="flex flex-wrap items-center gap-2 border-t border-type-muted pt-3">
        <button
          type="button"
          onClick={onSkip}
          className="cursor-pointer py-1 font-label text-sm text-type-ink underline decoration-type-muted underline-offset-[3px] hover:text-type-red"
        >
          Skip tutorial
        </button>
        <span className="ml-auto flex gap-2">
          {viewing > 0 && (
            <button
              type="button"
              onClick={() => setBack((b) => Math.min(shown, b + 1))}
              className={BACK_CLASS}
            >
              Back
            </button>
          )}
          {!isCurrent ? (
            <button type="button" onClick={() => setBack((b) => b - 1)} className={NEXT_CLASS}>
              Next
            </button>
          ) : step.read && !flash ? (
            <button type="button" onClick={() => onRead(step.id)} className={NEXT_CLASS}>
              Next
            </button>
          ) : closedSubmit ? (
            <button type="button" onClick={() => onRead(step.id)} className={NEXT_CLASS}>
              Finish
            </button>
          ) : null}
        </span>
      </div>
      )}
    </div>
    </>
  )
}

const BACK_CLASS = 'cursor-pointer border border-type-muted px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.16em] text-type-ink uppercase'

/** Fire, the one warm accent, only on the button that moves the tutorial on. */
const NEXT_CLASS =
  'cursor-pointer border border-fire bg-fire px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.16em] text-ink uppercase shadow-[0_2px_0_0_rgb(0_0_0/0.6)] hover:border-fire-light hover:bg-fire-light'
