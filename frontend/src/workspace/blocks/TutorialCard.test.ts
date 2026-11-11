// @vitest-environment jsdom
/** The movable tutorial card's maths: it always stays inside the canvas, arrow keys move it, and its place is kept per tab. */
import { afterEach, describe, expect, it } from 'vitest'
import { KEY_STEP, cardKey, clampToBox, moveByKey, readCardState, writeCardState } from './TutorialCard'

const card = { width: 300, height: 200 }
const box = { width: 1000, height: 600 }

describe('clampToBox', () => {
  it('leaves a card that is already inside where it is', () => {
    expect(clampToBox({ x: 120, y: 80 }, card, box)).toEqual({ x: 120, y: 80 })
  })

  it('stops at every edge', () => {
    expect(clampToBox({ x: -50, y: -10 }, card, box)).toEqual({ x: 0, y: 0 })
    expect(clampToBox({ x: 900, y: 550 }, card, box)).toEqual({ x: 700, y: 400 })
    expect(clampToBox({ x: -50, y: 550 }, card, box)).toEqual({ x: 0, y: 400 })
    expect(clampToBox({ x: 5000, y: -5000 }, card, box)).toEqual({ x: 700, y: 0 })
  })

  it('allows the exact edges', () => {
    expect(clampToBox({ x: 0, y: 0 }, card, box)).toEqual({ x: 0, y: 0 })
    expect(clampToBox({ x: 700, y: 400 }, card, box)).toEqual({ x: 700, y: 400 })
  })

  it('puts a card bigger than the canvas at its top left, never at a negative place', () => {
    expect(clampToBox({ x: 40, y: 40 }, { width: 1200, height: 800 }, box)).toEqual({ x: 0, y: 0 })
    expect(clampToBox({ x: 40, y: 40 }, card, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('re-clamps after the canvas shrinks', () => {
    const before = clampToBox({ x: 650, y: 380 }, card, box)
    expect(clampToBox(before, card, { width: 800, height: 500 })).toEqual({ x: 500, y: 300 })
  })

  it('rounds to whole pixels', () => {
    expect(clampToBox({ x: 10.6, y: 20.2 }, card, box)).toEqual({ x: 11, y: 20 })
  })
})

describe('moveByKey', () => {
  it('moves 16px per arrow key', () => {
    const at = { x: 100, y: 100 }
    expect(KEY_STEP).toBe(16)
    expect(moveByKey(at, 'ArrowLeft')).toEqual({ x: 84, y: 100 })
    expect(moveByKey(at, 'ArrowRight')).toEqual({ x: 116, y: 100 })
    expect(moveByKey(at, 'ArrowUp')).toEqual({ x: 100, y: 84 })
    expect(moveByKey(at, 'ArrowDown')).toEqual({ x: 100, y: 116 })
  })

  it('ignores every other key, Esc and Home included (Home docks, Esc keeps its own behaviour)', () => {
    for (const key of ['Escape', 'Home', 'Enter', ' ', 'a']) expect(moveByKey({ x: 0, y: 0 }, key)).toBeNull()
  })

  it('an arrow press past the edge is clamped back inside', () => {
    expect(clampToBox(moveByKey({ x: 4, y: 0 }, 'ArrowLeft')!, card, box)).toEqual({ x: 0, y: 0 })
  })
})

describe('the card state for this tab', () => {
  afterEach(() => sessionStorage.clear())

  it('starts docked and expanded', () => {
    expect(readCardState('prisoners_dilemma')).toEqual({ pos: null, minimised: false })
  })

  it('round-trips a place and Minimise, separately per round', () => {
    writeCardState('prisoners_dilemma', { pos: { x: 40, y: 60 }, minimised: true })
    expect(readCardState('prisoners_dilemma')).toEqual({ pos: { x: 40, y: 60 }, minimised: true })
    expect(readCardState('foreign_aid')).toEqual({ pos: null, minimised: false })
  })

  it('forgets it when the tutorial ends', () => {
    writeCardState('foreign_aid', { pos: { x: 40, y: 60 }, minimised: false })
    writeCardState('foreign_aid', null)
    expect(sessionStorage.getItem(cardKey('foreign_aid'))).toBeNull()
    expect(readCardState('foreign_aid')).toEqual({ pos: null, minimised: false })
  })

  it('falls back to docked on anything malformed', () => {
    for (const bad of ['{', 'null', '42', '{"pos":{"x":"1","y":2}}', '{"pos":{"x":null,"y":2}}', '{"minimised":"yes"}']) {
      sessionStorage.setItem(cardKey('prisoners_dilemma'), bad)
      expect(readCardState('prisoners_dilemma')).toEqual({ pos: null, minimised: false })
    }
  })
})
