import { useEffect, useRef, useState } from 'react'
import { Blockly, theme, toolbox, type Layout } from './blocks'

/**
 * One Blockly workspace for one module. Remount it (with a key) to switch modules.
 * The round's block limit is applied with Blockly's maxBlocks, so the toolbox
 * greys out once the module is full.
 */
export function BlockEditor({
  layout,
  onChange,
  maxBlocks,
  categories,
  game,
}: {
  layout: Layout
  onChange: (layout: Layout) => void
  maxBlocks: number
  categories: string[]
  game: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null)
  const changed = useRef(onChange)
  changed.current = onChange
  // Errors in here happen outside React's render, so rethrow them for the error boundary
  const [failure, setFailure] = useState<unknown>(null)
  if (failure) throw failure

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    // Blockly measures text when it renders, so wait for the app's fonts first
    const faces = ['11px "JetBrains Mono"', 'bold 11px "JetBrains Mono"'].map((f) => document.fonts.load(f))
    Promise.all(faces)
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
    const ws = Blockly.inject(host.current!, {
      toolbox: toolbox(categories, game),
      theme,
      renderer: 'zelos',
      maxBlocks,
      trashcan: true,
      sounds: false,
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: true, wheel: false, startScale: 0.8, maxScale: 2, minScale: 0.4 },
      grid: { spacing: 24, length: 2, colour: '#1c2026', snap: true },
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
    const resize = new ResizeObserver(() => Blockly.svgResize(ws))
    resize.observe(host.current!)
    return () => {
      resize.disconnect()
      ws.dispose()
      workspace.current = null
    }
  }

  // Organisers can change the rules mid-window
  const categoryKey = categories.join(',')
  useEffect(() => {
    const ws = workspace.current
    if (!ws) return
    try {
      ws.options.maxBlocks = maxBlocks
      ws.updateToolbox(toolbox(categoryKey ? categoryKey.split(',') : [], game))
    } catch (err) {
      setFailure(err instanceof Error ? err : new Error(String(err)))
    }
  }, [maxBlocks, categoryKey, game])

  return <div ref={host} className="h-full w-full" />
}
