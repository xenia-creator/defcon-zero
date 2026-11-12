/**
 * The guided tutorial's card (frontend/docs/BLOCKS.md 2.1): docked over the top right of the canvas,
 * not a modal, so the canvas, toolbox and Python stay usable. Skip is on every step; Esc skips while
 * focus is inside the card, so it never interferes with Blockly.
 *
 * The team can move it out of the way: drag it by its header (or arrow keys with the header focused),
 * Dock puts it back in the top right, and Minimise folds it to its header. Its place is kept for this
 * tab and stays inside the canvas.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Blockly } from './blocks'
import type { Layout } from './layout'
import { TUTORIALS, tutorialProgress, type TutorialEvents, type TutorialGame } from './tutorial'
import { TutorialHighlight } from './TutorialHighlight'

/** A general hint shows after this long with no change on the canvas. */
const GENERAL_HINT_MS = 20_000
/** "✓ Done" stays this long before the next step (none under reduced motion). */
const DONE_MS = 600

export type Point = { x: number; y: number }
export type Size = { width: number; height: number }

/** How far one arrow key press moves the card. */
export const KEY_STEP = 16

/** Keeps a card wholly inside its container, (0, 0) being the container's top left. A card bigger than the container sits at its top left. */
export function clampToBox(at: Point, card: Size, box: Size): Point {
  const fit = (v: number, max: number) => Math.round(Math.min(Math.max(v, 0), Math.max(0, max)))
  return { x: fit(at.x, box.width - card.width), y: fit(at.y, box.height - card.height) }
}

/** Where an arrow key moves the card, or null for any other key. */
export function moveByKey(at: Point, key: string, step = KEY_STEP): Point | null {
  if (key === 'ArrowLeft') return { x: at.x - step, y: at.y }
  if (key === 'ArrowRight') return { x: at.x + step, y: at.y }
  if (key === 'ArrowUp') return { x: at.x, y: at.y - step }
  if (key === 'ArrowDown') return { x: at.x, y: at.y + step }
  return null
}

/** The card's place (null: docked in the top right) and whether it is folded to its header, kept for this tab. */
export type CardState = { pos: Point | null; minimised: boolean }
const DOCKED: CardState = { pos: null, minimised: false }
export const cardKey = (game: TutorialGame) => `dz.tutorial.card.${game}`

export function readCardState(game: TutorialGame): CardState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(cardKey(game)) ?? 'null') as { pos?: { x?: unknown; y?: unknown } | null; minimised?: unknown } | null
    const { x, y } = saved?.pos ?? {}
    const pos = typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
    return { pos, minimised: saved?.minimised === true }
  } catch {
    return DOCKED
  }
}

/** Saves the card's place, or forgets it (null) so the next tutorial starts docked. */
export function writeCardState(game: TutorialGame, state: CardState | null) {
  try {
    if (state === null) sessionStorage.removeItem(cardKey(game))
    else sessionStorage.setItem(cardKey(game), JSON.stringify(state))
  } catch {
    // Storage blocked: the card still moves, it just isn't remembered
  }
}

/** The card's place, its size and its container's size, as they are on screen now. */
function measure(card: HTMLElement | null) {
  const box = card?.offsetParent as HTMLElement | null | undefined
  if (!card || !box) return null
  return { at: { x: card.offsetLeft, y: card.offsetTop }, card: { width: card.offsetWidth, height: card.offsetHeight }, box: { width: box.clientWidth, height: box.clientHeight } }
}

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
  const moveHintId = useId()

  // Where the team has moved the card, kept for this tab
  const cardRef = useRef<HTMLDivElement>(null)
  const [{ pos, minimised }, setCard] = useState(() => readCardState(game))
  const setPos = (next: Point | null) => setCard((c) => ({ ...c, pos: next }))
  useEffect(() => writeCardState(game, { pos, minimised }), [game, pos, minimised])
  // Clamped again whenever the window, the canvas or the card (a new step, Minimise) changes size
  useLayoutEffect(() => {
    const card = cardRef.current
    const reclamp = () => {
      const m = measure(card)
      if (!m) return
      setCard((c) => {
        if (!c.pos) return c
        const p = clampToBox(c.pos, m.card, m.box)
        return p.x === c.pos.x && p.y === c.pos.y ? c : { ...c, pos: p }
      })
    }
    reclamp()
    window.addEventListener('resize', reclamp)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reclamp)
    if (observer && card) {
      observer.observe(card)
      if (card.offsetParent) observer.observe(card.offsetParent)
    }
    return () => {
      window.removeEventListener('resize', reclamp)
      observer?.disconnect()
    }
  }, [])

  // Dragging by the header. Pointer capture keeps the drag on the card, and stopping propagation keeps it from Blockly.
  const drag = useRef<{ id: number; from: Point; start: Point } | null>(null)
  const [dragging, setDragging] = useState(false)
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Buttons and links in the header click as normal
    if (e.button !== 0 || (e.target as Element).closest('button, a, input, select, textarea')) return
    const m = measure(cardRef.current)
    if (!m) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, from: { x: e.clientX, y: e.clientY }, start: m.at }
    setDragging(true)
  }
  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    e.stopPropagation()
    const m = measure(cardRef.current)
    if (m) setPos(clampToBox({ x: d.start.x + e.clientX - d.from.x, y: d.start.y + e.clientY - d.from.y }, m.card, m.box))
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return
    e.stopPropagation()
    drag.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  // Ending the tutorial forgets the card's place, so the next one starts docked
  const forgetThen = (then: () => void) => () => {
    writeCardState(game, null)
    then()
  }
  const skip = forgetThen(onSkip)
  const keep = forgetThen(onKeep)
  const restore = forgetThen(onRestore)
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
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="tutorial-card"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (ended) keep()
          else skip()
        }
      }}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`paper-sheet absolute ${pos ? '' : 'top-3 right-3'} z-20 flex ${width} flex-col gap-3 p-4`}
    >
      {/* The header is the drag handle: with it focused, arrow keys move the card and Home docks it */}
      <div
        data-testid="tutorial-card-handle"
        tabIndex={0}
        aria-describedby={moveHintId}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => {
          drag.current = null
          setDragging(false)
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Home') {
            e.preventDefault()
            e.stopPropagation()
            setPos(null)
            return
          }
          const m = measure(cardRef.current)
          const next = m && moveByKey(m.at, e.key)
          if (!m || !next) return
          e.preventDefault()
          e.stopPropagation()
          setPos(clampToBox(next, m.card, m.box))
        }}
        className={`flex touch-none flex-col gap-1 select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'} ${minimised ? '' : 'border-b border-type-muted pb-2'} outline-offset-4 focus-visible:outline-2 focus-visible:outline-type-ink`}
      >
        <span id={moveHintId} className="sr-only">
          Drag to move the card. With this focused, the arrow keys move it and Home docks it.
        </span>
        <div className="flex items-center justify-between gap-3">
          <span className="font-label text-xs tracking-[0.08em] text-type-muted uppercase">{!ended && `Step ${viewing + 1} of ${steps.length}`}</span>
          <span className="flex shrink-0 gap-1">
            {pos && (
              <button type="button" onClick={() => setPos(null)} className={HEADER_BUTTON}>
                Dock
              </button>
            )}
            <button type="button" aria-expanded={!minimised} onClick={() => setCard((c) => ({ ...c, minimised: !c.minimised }))} className={HEADER_BUTTON}>
              {minimised ? 'Expand' : 'Minimise'}
            </button>
          </span>
        </div>
        <p id={titleId} className="font-title text-base tracking-[0.04em]">
          {ended ? 'Tutorial done' : step.title}
        </p>
      </div>
      {!minimised && (
      <>
      <div aria-live="polite" className="flex flex-col gap-2">
        {ended ? (
          <p className="font-label text-sm leading-relaxed text-type-ink">
            You built a working strategy. For more ideas, open Start from this below the canvas. Bots built from the same example score about the same, so make it yours.
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
            <button type="button" onClick={restore} className={BACK_CLASS}>
              Put my blocks back
            </button>
          )}
          <button type="button" onClick={keep} className={NEXT_CLASS}>
            Keep this
          </button>
        </div>
      ) : (
      <div className="flex flex-wrap items-center gap-2 border-t border-type-muted pt-3">
        <button
          type="button"
          onClick={skip}
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
      </>
      )}
    </div>
    </>
  )
}

/** Dock and Minimise: small, quiet, so the step's own buttons stay the obvious ones. */
const HEADER_BUTTON =
  'cursor-pointer border border-type-muted px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-type-muted uppercase hover:border-type-ink hover:text-type-ink'

const BACK_CLASS = 'cursor-pointer border border-type-muted px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.16em] text-type-ink uppercase'

/** Fire, the one warm accent, only on the button that moves the tutorial on. */
const NEXT_CLASS =
  'cursor-pointer border border-fire bg-fire px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.16em] text-ink uppercase shadow-[0_2px_0_0_rgb(0_0_0/0.6)] hover:border-fire-light hover:bg-fire-light'
