/** Reading a saved block layout. Separate from Blockly, and safe on any JSON a draft might hold. */
import { newId } from '../../lib/ids'

export type Layout = Record<string, unknown>

export type BlockState = { type?: unknown; fields?: Record<string, unknown>; inputs?: Record<string, { block?: BlockState; shadow?: BlockState } | null>; next?: { block?: BlockState } }

const MAX_DEPTH = 5000

export function topBlocks(layout: Layout): BlockState[] {
  const blocks = (layout.blocks as { blocks?: unknown } | null | undefined)?.blocks
  return Array.isArray(blocks) ? blocks.filter((b): b is BlockState => typeof b === 'object' && b !== null) : []
}

/** Every block in a layout, counted the same way as the server. */
export function countBlocks(layout: Layout): number {
  const walk = (b: BlockState | undefined, depth: number): number => {
    if (!b || depth > MAX_DEPTH) return 0
    let n = 1
    for (const slot of Object.values(b.inputs ?? {})) n += walk(slot?.block, depth + 1) + walk(slot?.shadow, depth + 1)
    return n + walk(b.next?.block, depth + 1)
  }
  return topBlocks(layout).reduce((n, b) => n + walk(b, 0), 0)
}

/** Every block type used in a layout. */
export function blockTypes(layout: Layout): string[] {
  const types: string[] = []
  const walk = (b: BlockState | undefined, depth: number) => {
    if (!b || depth > MAX_DEPTH) return
    types.push(String(b.type))
    for (const slot of Object.values(b.inputs ?? {})) walk(slot?.block, depth + 1)
    walk(b.next?.block, depth + 1)
  }
  topBlocks(layout).forEach((b) => walk(b, 0))
  return types
}

export function moduleName(layout: Layout): string {
  const top = topBlocks(layout).find((b) => b.type === 'ic_module')
  return String(top?.fields?.NAME ?? 'module')
}

export function newModule(existing: string[]): Layout {
  let n = 1
  while (existing.includes(`module${n}`)) n++
  return {
    blocks: {
      languageVersion: 0,
      blocks: [{ type: 'ic_module', id: newId(), x: 24, y: 24, deletable: false, fields: { NAME: `module${n}` } }],
    },
  }
}

/**
 * A blocks-mode canvas: just the strategy block, which can't be deleted.
 * Round 1 falls back to the round's first move; Round 3 sends 5 and sends back 50 %.
 */
export function newStrategy(game: string, moves: string[]): Layout {
  const strategy =
    game === 'foreign_aid'
      ? { type: 'fa_strategy', fields: { SEND_DEFAULT: 5, RETURN_PCT_DEFAULT: 50 } }
      : { type: 'ic_strategy', fields: { FALLBACK: moves[0] ?? 'C' } }
  return { blocks: { languageVersion: 0, blocks: [{ ...strategy, id: newId(), x: 24, y: 24, deletable: false }] } }
}

/** True when a saved layout is a blocks-mode strategy (it opens in Build with blocks), not a Write-code module. */
export const isStrategyLayout = (layout: Layout): boolean => topBlocks(layout).some((b) => b.type === 'ic_strategy' || b.type === 'fa_strategy')

/** True when a layout holds this game's strategy block, so it can open on this game's canvas. */
export const isStrategyFor = (layout: Layout | undefined, game: string): boolean =>
  !!layout && topBlocks(layout).some((b) => b.type === (game === 'foreign_aid' ? 'fa_strategy' : 'ic_strategy'))
