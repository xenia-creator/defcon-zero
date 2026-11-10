/**
 * The guided tutorial's highlight (frontend/docs/BLOCKS.md 2.1): a 2px amber outline over what the
 * current step points at, pulsing slowly, and still under reduced motion. It only draws on top: it
 * never locks, hides or changes a block or the toolbox, and clicks pass straight through it.
 */
import { useEffect, useState } from 'react'
import { Blockly } from './blocks'
import type { Highlight } from './tutorial'

/** How often the outlines follow the canvas as it scrolls, zooms or changes. */
const FOLLOW_MS = 200
const PAD = 4

type Box = { left: number; top: number; width: number; height: number }

const boxOf = (r: DOMRect | undefined | null): Box | null => (r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null)

/** The first block of a type, in reading order. */
const firstBlock = (ws: Blockly.WorkspaceSvg, type: string) => ws.getBlocksByType(type, true)[0] as Blockly.BlockSvg | undefined

/** A statement slot as it sits on screen: from its notch down to the next row of the block. */
function inputBox(ws: Blockly.WorkspaceSvg, type: string, name: string): Box | null {
  const block = firstBlock(ws, type)
  const input = block?.getInput(name)
  const connection = input?.connection as Blockly.RenderedConnection | null | undefined
  if (!block || !input || !connection) return null
  const blockBox = block.getSvgRoot().getBoundingClientRect()
  const start = Blockly.utils.svgMath.wsToScreenCoordinates(ws, new Blockly.utils.Coordinate(connection.x, connection.y))
  const next = block.inputList[block.inputList.indexOf(input) + 1]
  const nextConnection = next?.connection as Blockly.RenderedConnection | null | undefined
  const nextTop = nextConnection
    ? Blockly.utils.svgMath.wsToScreenCoordinates(ws, new Blockly.utils.Coordinate(nextConnection.x, nextConnection.y)).y
    : (next?.fieldRow[0]?.getSvgRoot()?.getBoundingClientRect().top ?? blockBox.bottom)
  const top = start.y
  return { left: start.x, top, width: Math.max(80, blockBox.right - start.x - 6), height: Math.max(24, nextTop - top) }
}

function locate(ws: Blockly.WorkspaceSvg | null, target: Highlight): Box | null {
  try {
    if (target.kind === 'tour') return boxOf(document.querySelector(`[data-tour="${target.target}"]`)?.getBoundingClientRect())
    if (!ws) return null
    switch (target.kind) {
      case 'category': {
        const item = (ws.getToolbox() as Blockly.Toolbox | null)?.getToolboxItemById(target.id) as (Blockly.ToolboxCategory & { getDiv?: () => Element | null }) | null
        return boxOf(item?.getDiv?.()?.getBoundingClientRect())
      }
      case 'block':
        return boxOf(firstBlock(ws, target.type)?.getSvgRoot().getBoundingClientRect())
      case 'field':
        return boxOf(firstBlock(ws, target.type)?.getField(target.field)?.getSvgRoot()?.getBoundingClientRect())
      case 'input':
        return inputBox(ws, target.type, target.input)
    }
  } catch {
    // A block being dragged or a canvas being rebuilt: no outline for a moment
    return null
  }
}

export function TutorialHighlight({ workspace, targets }: { workspace: Blockly.WorkspaceSvg | null; targets: Highlight[] }) {
  const [boxes, setBoxes] = useState<Box[]>([])
  const key = JSON.stringify(targets)

  useEffect(() => {
    let last = ''
    const follow = () => {
      const next = targets.map((t) => locate(workspace, t)).filter((b): b is Box => b !== null)
      const text = JSON.stringify(next)
      if (text !== last) {
        last = text
        setBoxes(next)
      }
    }
    follow()
    const timer = window.setInterval(follow, FOLLOW_MS)
    return () => window.clearInterval(timer)
    // targets is read through its JSON key, so a new array with the same targets doesn't restart this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, key])

  return (
    <>
      {boxes.map((b, i) => (
        <div
          key={i}
          aria-hidden
          data-testid="tutorial-highlight"
          className="pointer-events-none fixed z-40 outline-2 outline-amber motion-safe:animate-pulse"
          style={{ left: b.left - PAD, top: b.top - PAD, width: b.width + PAD * 2, height: b.height + PAD * 2 }}
        />
      ))}
    </>
  )
}
