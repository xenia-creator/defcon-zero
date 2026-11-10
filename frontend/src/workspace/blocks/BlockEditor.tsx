import { useEffect, useRef, useState } from 'react'
import { BLOCK_FONT_CSS, Blockly, GRID, setBlockEndowment, setBlockMoves, theme, toolbox, type Layout } from './blocks'

/**
 * One Blockly workspace for one module. Remount it (with a key) to switch modules.
 * The block limit is applied with Blockly's maxBlocks, so the toolbox greys out
 * once the limit is reached.
 */
export function BlockEditor({
  layout,
  onChange,
  maxBlocks,
  moves,
  game = 'prisoners_dilemma',
  endowment = 10,
  onWorkspace,
}: {
  layout: Layout
  onChange: (layout: Layout) => void
  maxBlocks: number
  moves: string[]
  /** Picks the toolbox: Round 1's blocks, or Round 3's. */
  game?: string
  /** Round 3's most a bot can send (config.endowment), for the send fields' limit. */
  endowment?: number
  /** Hands the Blockly workspace up while it exists (null once it is gone), so the guided tutorial can point at blocks and categories. */
  onWorkspace?: (workspace: Blockly.WorkspaceSvg | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null)
  const changed = useRef(onChange)
  changed.current = onChange
  const announce = useRef(onWorkspace)
  announce.current = onWorkspace
  // Errors in here happen outside React's render, so rethrow them for the error boundary
  const [failure, setFailure] = useState<unknown>(null)
  if (failure) throw failure

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    // Blockly measures text when it renders, so wait for the block font first
    document.fonts
      .load(BLOCK_FONT_CSS)
      .catch(() => {})
      .then(() => {
        if (disposed) return
        try {
          cleanup = mount()
        } catch (err) {
          setFailure(err instanceof Error ? err : new Error(String(err)))
        }
      })
    return () => {
      disposed = true
      cleanup()
    }
    // The layout is only read on mount; later edits come from Blockly itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function mount() {
    setBlockMoves(moves)
    setBlockEndowment(endowment)
    const ws = Blockly.inject(host.current!, {
      toolbox: toolbox(game),
      // Blockly's icons (zoom, trash) and cursors from this app, never from static.blockly.com
      media: `${import.meta.env.BASE_URL}blockly-media/`,
      theme,
      renderer: 'zelos',
      maxBlocks,
      trashcan: true,
      sounds: false,
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: true, wheel: false, startScale: 0.8, maxScale: 2, minScale: 0.4 },
      grid: GRID,
    })
    workspace.current = ws
    Blockly.Events.disable()
    try {
      Blockly.serialization.workspaces.load(layout, ws)
    } catch (err) {
      ws.dispose()
      workspace.current = null
      throw err
    } finally {
      Blockly.Events.enable()
    }
    ws.addChangeListener((event) => {
      if (event.isUiEvent || event.type === Blockly.Events.FINISHED_LOADING) return
      changed.current(Blockly.serialization.workspaces.save(ws) as Layout)
    })
    // Every size change (a window resize, Build with blocks opening again) re-fits the canvas, so the
    // toolbox, its flyout, the trash and the zoom controls sit where they should. In the next frame,
    // so the resize never re-triggers the observer within the same frame.
    let frame = 0
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => Blockly.svgResize(ws))
    })
    resize.observe(host.current!)
    // Once every font has loaded, measure each field again, in case one was still loading
    document.fonts.ready.then(() => {
      if (workspace.current !== ws) return
      for (const block of ws.getAllBlocks(false)) for (const input of block.inputList) for (const field of input.fieldRow) field.forceRerender()
    })
    announce.current?.(ws)
    return () => {
      announce.current?.(null)
      cancelAnimationFrame(frame)
      resize.disconnect()
      ws.dispose()
      workspace.current = null
    }
  }

  // The limit can change as other modules change, or if organisers change the rules mid-window
  const moveKey = moves.join(',')
  useEffect(() => {
    const ws = workspace.current
    if (!ws) return
    try {
      setBlockMoves(moveKey.split(','))
      setBlockEndowment(endowment)
      ws.options.maxBlocks = maxBlocks
      ws.updateToolbox(toolbox(game))
    } catch (err) {
      setFailure(err instanceof Error ? err : new Error(String(err)))
    }
  }, [maxBlocks, moveKey, game, endowment])

  // isolate: Blockly's own z-indexes (its toolbox is 70) stay inside the canvas, so dialogs always cover it
  return <div ref={host} className="isolate h-full w-full" />
}
