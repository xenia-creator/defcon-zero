import Editor, { type OnMount } from '@monaco-editor/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { Button, Empty, Guard, Panel, WindowTimer, inputClass, useConfirm } from '../../components/ui'
import { ApiError, errorMessage, request } from '../../lib/api'
import { newId } from '../../lib/ids'
import { serverNow, windowRemaining } from '../../lib/clock'
import { SubmissionDetail, Submitted, isChecked, type ClaimedTeam, type Round } from '../../lib/contract'
import { useLive } from '../../lib/live'
import { keys, useCurrentRound, useStandings, useSubmission, useSubmissions } from '../../lib/queries'
import { BlockEditor } from '../blocks/BlockEditor'
import { MODULE_ARGS, TOOLBOX, moveLabel } from '../blocks/categories'
import { exampleLayout, examplesFor } from '../blocks/examples'
import { assemble, generateModules } from '../blocks/generate'
import { countBlocks, moduleName, newModule, type Layout } from '../blocks/layout'
import { History, LatestResult, agentFromDetail, toSubmission } from './SidePanels'
import { MAX_BLOCKS_BYTES, MAX_CODE_LENGTH, blocksBytes, loadDraft, saveDraft, utf8Bytes, type Agent } from './drafts'
import { DEFAULT_GAME, TOTAL_ROUNDS, UNTIL_ROUND_ARRIVES, gameInfo } from './games'
import { TroopPlacement } from './TroopPlacement'
import { allocationCode, allocationProblems, parseAllocation, regionNames } from './troops'
import { moveOption } from '../../lib/rounds'
import { monaco, setModuleNames, setMoveHints } from './monaco'

const AUTOSAVE_MS = 2000
const LAST_GAME = 'ic.game'
const DEADLINE_WARNINGS = [300, 60]

/** Teams heads-down in their code may not be watching the timer. */
function useDeadlineWarnings(round: Round | null | undefined) {
  const toast = useLive((s) => s.toast)
  const before = useRef<number | null>(null)
  useEffect(() => {
    const tick = () => {
      const seconds = windowRemaining(round, serverNow())
      if (seconds === null) {
        before.current = null
        return
      }
      // Only the closest one, if organisers cut the time past both at once
      const passed = DEADLINE_WARNINGS.filter((mark) => before.current !== null && before.current > mark && seconds <= mark)
      if (passed.length) {
        const mark = Math.min(...passed)
        toast('bad', `${mark / 60} minute${mark > 60 ? 's' : ''} left. Only submitted versions play, so submit now.`)
      }
      before.current = seconds
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [round, toast])
}

/** The last game seen, so a reload with the server down still opens the right draft. */
function lastGame() {
  try {
    return localStorage.getItem(LAST_GAME) ?? DEFAULT_GAME
  } catch {
    return DEFAULT_GAME
  }
}

type Editor = Parameters<OnMount>[0]

/** Retries network and gateway failures with the same key, so a blip at the deadline doesn't lose a submission or store it twice. */
async function submitAgent(agent: Agent, moves: string[], roundId: number) {
  const key = newId()
  for (let attempt = 0; ; attempt++) {
    try {
      return await request('POST', '/submissions', Submitted, toSubmission(agent, moves, roundId), { 'Idempotency-Key': key })
    } catch (err) {
      if ((err instanceof ApiError && err.status < 500) || attempt >= 2) throw err
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
}

function submitFailure(err: unknown): string {
  if (!(err instanceof ApiError) || err.status >= 500 || err.code === 'INTERNAL_ERROR') {
    return 'Could not reach the server. Your draft is saved here, so try again.'
  }
  switch (err.code) {
    case 'ROUND_NOT_OPEN':
      return err.message || 'The submission window is closed.'
    case 'TEAM_DISQUALIFIED':
      return err.message || 'Your team has been disqualified and cannot submit.'
    case 'FORBIDDEN':
      return err.message || 'Your team cannot submit in this round.'
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'This submission conflicted with an earlier attempt. Please try submitting again.'
    case 'VALIDATION_ERROR':
      return err.message || 'Your submission did not pass server validation (check code and block limits).'
    default:
      return err.message
  }
}

/** The server reports errors as "Line 3: ...". Where it names a line, mark it in the editor. */
function useErrorMarker(editor: Editor | null, message: string | null) {
  useEffect(() => {
    const model = editor?.getModel()
    if (!model) return
    const line = Number(message?.match(/^Line (\d+):/)?.[1] ?? 0)
    const onFile = message && line >= 1 && line <= model.getLineCount()
    monaco.editor.setModelMarkers(model, 'server', onFile ? [{ severity: monaco.MarkerSeverity.Error, message, startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: model.getLineMaxColumn(line) }] : [])
  }, [editor, message])
}

/** If Monaco itself fails, a plain text box keeps the team able to work and submit. */
function CodeEditor({ value, onChange, onMount }: { value: string; onChange: (code: string) => void; onMount: (editor: Editor) => void }) {
  return (
    <ErrorBoundary
      fallback={() => (
        <div className="flex h-full flex-col">
          <p className="border-b border-amber/40 bg-amber/10 px-4 py-1.5 text-xs text-amber">The code editor could not start, so this is a plain text box. Everything still works.</p>
          <textarea
            aria-label="Strategy code"
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-[#0b0d0f] p-4 font-mono text-sm text-paper outline-none"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
    >
      <Editor
        language="python"
        theme="iron"
        // The editor owns its text. Passing it back on every change can overwrite keys typed in between
        defaultValue={value}
        loading={<Empty>Starting the editor…</Empty>}
        onChange={(v) => onChange(v ?? '')}
        onMount={onMount}
        options={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 14,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          tabSize: 4,
          insertSpaces: true,
          automaticLayout: true,
        }}
      />
    </ErrorBoundary>
  )
}

type Tab = 'code' | number

/** Each game gets a fresh workspace. Leaving one saves its draft, so nothing is lost when the round moves on. */
/** Only for a claimed team: everything here (drafts, sent markers, submissions) is keyed by its team id. */
export function Workspace({ team }: { team: ClaimedTeam }) {
  const { data: round } = useCurrentRound()
  const toast = useLive((s) => s.toast)
  const key = round?.game
  const shown = useRef(key)
  useEffect(() => {
    if (!key) return
    try {
      localStorage.setItem(LAST_GAME, key)
    } catch {
      // only a convenience for reloading while offline
    }
    if (shown.current && shown.current !== key) toast('info', `The round has moved on to ${gameInfo(key).name}. Your earlier code is saved with its own round.`)
    shown.current = key
  }, [key, toast])

  // Never wait for the round: with the server down the team still needs their draft
  const gameKey = key ?? lastGame()
  return <RoundWorkspace key={gameKey} team={team} gameKey={gameKey} />
}

function RoundWorkspace({ team, gameKey }: { team: ClaimedTeam; gameKey: string }) {
  const { data: round, isError: roundFailed, error: roundError } = useCurrentRound()
  const { data: standings } = useStandings()
  const { data: submissions, isError: submissionsFailed } = useSubmissions(round?.id)
  const ownStanding = standings?.nations.find((n) => n.team_id === team.team_id)
  const ownScore = ownStanding?.score
  // Rounds 2 and 3 read their limits (troops, regions, endowment, multiplier) from the round's config
  const roundConfig = round?.config
  const game = useMemo(() => gameInfo(gameKey, roundConfig), [gameKey, roundConfig])
  const serverMoves = round?.config.moves
  const moves = useMemo(() => serverMoves ?? game.moves, [serverMoves, game.moves])
  useEffect(() => setMoveHints(moves), [moves])
  const newest = submissions?.[0]
  const { data: latestDetail } = useSubmission(newest?.id)
  const latestFinished = !!latestDetail && latestDetail.id === newest?.id && isChecked(latestDetail.status)
  const toast = useLive((s) => s.toast)
  const queries = useQueryClient()
  useDeadlineWarnings(round)
  // What was last sent, to tell a team when their editor no longer matches it. Lost if storage is blocked, which only over-warns
  const sentKey = `sent:${team.team_id}:${gameKey}`
  const [lastSent, setLastSent] = useState<string | null>(() => {
    try {
      return localStorage.getItem(sentKey)
    } catch {
      return null
    }
  })
  const markSent = useCallback(
    (sent: Agent) => {
      const text = JSON.stringify(sent)
      setLastSent(text)
      try {
        localStorage.setItem(sentKey, text)
      } catch {
        // see above
      }
    },
    [sentKey],
  )
  const [agent, setAgent] = useState<Agent | null>(null)
  const [tab, setTab] = useState<Tab>('code')

  // Round 2 (Theatre of War) is played on the map by default: the troop split becomes a fixed strategy.
  // The code editor stays one click away for an adaptive strategy. Whichever is open is what gets submitted.
  const placesTroops = gameKey === 'theatre_of_war'
  const troops = round?.config.troops ?? UNTIL_ROUND_ARRIVES.troops
  const regions = round?.config.regions ?? UNTIL_ROUND_ARRIVES.regions
  const modeKey = `play:${team.team_id}:${gameKey}`
  const troopsKey = `troops:${team.team_id}:${gameKey}`
  const [playMode, setPlayModeState] = useState<'map' | 'code'>(() => {
    try {
      return localStorage.getItem(modeKey) === 'code' ? 'code' : 'map'
    } catch {
      return 'map'
    }
  })
  const setPlayMode = useCallback(
    (mode: 'map' | 'code') => {
      setPlayModeState(mode)
      try {
        localStorage.setItem(modeKey, mode)
      } catch {
        // only remembers the choice across reloads
      }
    },
    [modeKey],
  )
  const [allocation, setAllocationState] = useState<number[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(troopsKey) ?? 'null')
      if (Array.isArray(stored) && stored.every(Number.isInteger)) return stored
    } catch {
      // a fresh map
    }
    return []
  })
  // A placement made for a different number of regions starts again
  const placement = useMemo(() => (allocation.length === regions ? allocation : Array.from({ length: regions }, () => 0)), [allocation, regions])
  const setAllocation = useCallback(
    (next: number[]) => {
      setAllocationState(next)
      try {
        localStorage.setItem(troopsKey, JSON.stringify(next))
      } catch {
        // only remembers the placement across reloads
      }
    },
    [troopsKey],
  )
  const mapMode = placesTroops && playMode === 'map'
  const placementProblems = useMemo(() => allocationProblems(placement, troops, regions), [placement, troops, regions])
  const mapAgent = useMemo<Agent>(() => ({ hand_code: allocationCode(placement, regionNames(regions)), modules: [] }), [placement, regions])
  const [moduleKeys, setModuleKeys] = useState<string[]>([])
  const [loadCount, setLoadCount] = useState(0)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const [draftState, setDraftState] = useState<'idle' | 'saved' | 'failed'>('idle')
  const saved = useRef<Agent | null>(null)
  const restoring = useRef(false)
  const sending = useRef(false)
  const latest = useRef<Agent | null>(null)
  latest.current = agent
  const { dialog, ask } = useConfirm()

  const generated = useMemo(() => generateModules(agent?.modules ?? [], moves), [agent, moves])
  const assembledBytes = useMemo(
    () => (agent ? utf8Bytes(assemble(agent.hand_code, generated)) : 0),
    [agent, generated],
  )
  const modulesBytes = useMemo(() => (agent ? blocksBytes(agent.modules) : 0), [agent])
  const tooLong = assembledBytes > MAX_CODE_LENGTH || modulesBytes > MAX_BLOCKS_BYTES

  const maxModules = game.blocks ? (round?.config.max_modules ?? 3) : 0
  const blockLimit = round?.config.block_limit ?? 40
  const totalBlocks = (agent?.modules ?? []).reduce((n, layout) => n + countBlocks(layout), 0)
  const overLimit = totalBlocks > blockLimit
  const blockProblems = generated.reduce((n, m) => n + m.problems.length, 0) + (overLimit ? 1 : 0)
  const noStrategy = agent !== null && !/^\s*def\s+strategy\s*\(/m.test(agent.hand_code)
  useErrorMarker(editor, latestDetail?.status === 'rejected' ? latestDetail.error : null)

  // The server's result arrives by polling, so say when it does
  const waitingOn = useRef<number | null>(null)
  useEffect(() => {
    if (newest && !isChecked(newest.status)) waitingOn.current = newest.id
    if (latestFinished && waitingOn.current === latestDetail.id) {
      waitingOn.current = null
      toast(latestDetail.status === 'accepted' ? 'good' : 'bad', `Version ${latestDetail.version} ${latestDetail.status}`)
    }
  }, [newest, latestDetail, latestFinished, toast])
  const names = useMemo(() => agent?.modules.map(moduleName) ?? [], [agent])
  useEffect(() => setModuleNames(names), [names])

  const hasBlocks = game.blocks
  const load = useCallback((loaded: Agent) => {
    const next = hasBlocks ? loaded : { ...loaded, modules: [] } // another game's modules can't play here
    const placed = placesTroops ? parseAllocation(next.hand_code, regions) : null
    if (placed) setAllocation(placed)
    saved.current = next // no need to save what just came from storage or the server
    setAgent(next)
    setLoadCount((n) => n + 1) // a fresh editor shows what was loaded
    setModuleKeys(next.modules.map(() => newId()))
    setTab('code')
    return next
  }, [hasBlocks, placesTroops, regions, setAllocation])

  // Restore: the autosaved draft, else the latest version on the server, else the template.
  // If the server can't be reached the team still gets an editor and can load a version later.
  const [stored, setStored] = useState<Agent | null | undefined>(undefined)
  useEffect(() => {
    let current = true
    loadDraft(team.team_id, gameKey).then((draft) => current && setStored(draft ?? null))
    return () => {
      current = false
    }
  }, [team.team_id, gameKey])

  const serverAnswered = roundFailed || round === null || submissions !== undefined || submissionsFailed
  useEffect(() => {
    if (restoring.current || stored === undefined) return
    if (stored) {
      restoring.current = true
      load(stored)
      return
    }
    if (!serverAnswered) return
    restoring.current = true
    ;(async () => {
      if (newest) {
        try {
          const restored = agentFromDetail(await request('GET', `/submissions/${newest.id}`, SubmissionDetail))
          if (restored) return markSent(load(restored))
        } catch {
          toast('bad', `Could not fetch version ${newest.version}. Use Load in the version history to try again.`)
        }
      }
      load({ hand_code: game.template, modules: [] })
    })()
  }, [stored, serverAnswered, newest, game.template, load, markSent, toast])

  const flush = useCallback(() => {
    const current = latest.current
    if (current === null || current === saved.current) return
    saved.current = current
    saveDraft(team.team_id, gameKey, current).then((ok) => setDraftState(ok ? 'saved' : 'failed'))
  }, [team.team_id, gameKey])

  useEffect(() => {
    const id = setInterval(flush, AUTOSAVE_MS)
    window.addEventListener('pagehide', flush)
    return () => {
      clearInterval(id)
      window.removeEventListener('pagehide', flush)
      flush() // logging out or switching team
    }
  }, [flush])

  // Pressing save out of habit saves the draft, rather than opening the browser's save-page dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        flush()
        toast('info', 'Draft saved here. Submit to send it to the server.')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [flush, toast])

  const setCode = useCallback((code: string) => setAgent((a) => a && { ...a, hand_code: code }), [])
  const setModule = (index: number, layout: Layout) =>
    setAgent((a) => a && { ...a, modules: a.modules.map((m, i) => (i === index ? layout : m)) })

  function addModule() {
    if (!agent || agent.modules.length >= maxModules) return
    setAgent({ ...agent, modules: [...agent.modules, newModule(names)] })
    setModuleKeys((k) => [...k, newId()])
    setTab(agent.modules.length)
  }

  function removeModule(index: number) {
    ask({
      title: 'Delete module',
      body: `Delete the module '${names[index]}'? This can't be undone.`,
      confirmLabel: 'Delete',
      run: () => {
        setAgent((a) => a && { ...a, modules: a.modules.filter((_, i) => i !== index) })
        setModuleKeys((k) => k.filter((_, i) => i !== index))
        setTab('code')
      },
    })
  }

  /** A module whose saved layout won't open starts again, with a fresh Blockly. */
  function resetModule(index: number) {
    setModule(index, newModule(names.filter((_, i) => i !== index)))
    setModuleKeys((k) => k.map((key, i) => (i === index ? newId() : key)))
  }

  function applyExample(index: number, picked: string) {
    const example = examples.find((e) => e.name === picked)
    if (!example) return
    const apply = () => {
      setModule(index, exampleLayout(example, names[index]))
      setModuleKeys((k) => k.map((key, i) => (i === index ? newId() : key)))
    }
    if (agent && countBlocks(agent.modules[index]) <= 1) return apply()
    ask({ title: `Use ${example.name}`, body: 'This replaces the blocks in this module.', confirmLabel: 'Use example', run: apply })
  }

  /** So a team can play a block strategy without writing any code. */
  function playModule(index: number) {
    ask({
      title: `Play ${names[index]}`,
      body: `This replaces your code in strategy.py, so that ${names[index]} decides every move.`,
      confirmLabel: 'Use as my strategy',
      run: () => {
        if (!agent) return
        const hand_code = `import random\n\n\ndef strategy(${MODULE_ARGS}):\n    return ${names[index]}(${MODULE_ARGS})\n`
        saveDraft(team.team_id, gameKey, load({ ...agent, hand_code }))
      },
    })
  }

  function askToLoad(id: number, version: number) {
    ask({
      title: `Load version ${version}`,
      body: 'This replaces what is in your editor now. Anything you have not submitted will be lost.',
      confirmLabel: 'Load version',
      run: async () => {
        try {
          const next = agentFromDetail(await request('GET', `/submissions/${id}`, SubmissionDetail))
          if (!next) throw new Error('unreadable version')
          if (placesTroops) setPlayMode(parseAllocation(next.hand_code, regions) ? 'map' : 'code')
          saveDraft(team.team_id, gameKey, load(next))
        } catch (err) {
          toast('bad', errorMessage(err, `Could not load version ${version}. Try again.`))
        }
      },
    })
  }

  const activeBlocks = typeof tab === 'number' && agent?.modules[tab] ? countBlocks(agent.modules[tab]) : 0
  const examples = examplesFor(gameKey, blockLimit - totalBlocks + activeBlocks)
  const unused = (i: number) => !agent?.hand_code.includes(`${names[i]}(`)
  const fallen = team.status !== 'active'
  const windowOpen = round?.status === 'open'
  const problems = blockProblems + (noStrategy ? 1 : 0)
  // In map mode the troop placement is what gets sent; otherwise the editor's code, as before
  const outgoing = mapMode ? mapAgent : agent
  const canSubmit = mapMode
    ? windowOpen && !fallen && !busy && placementProblems.length === 0
    : windowOpen && !fallen && !busy && agent !== null && problems === 0 && !tooLong

  async function submit() {
    const sent = outgoing
    if (sent === null || !round || sending.current) return
    if (mapMode && placementProblems.length > 0) return
    sending.current = true
    setBusy(true)
    flush()
    try {
      const s = await submitAgent(sent, moves, round.id)
      markSent(sent)
      toast('info', `Version ${s.version} received. Testing against the bots…`)
      void queries.invalidateQueries({ queryKey: keys.submissions(round.id) })
    } catch (err) {
      toast('bad', submitFailure(err))
      // The window may have closed or the team fallen since the last update
      void queries.invalidateQueries({ queryKey: keys.currentRound })
      void queries.invalidateQueries({ queryKey: keys.me })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const accepted = submissions?.find((s) => s.status === 'accepted')
  const notSent = !!newest && outgoing !== null && JSON.stringify(outgoing) !== lastSent
  const activeModule = typeof tab === 'number' && agent && tab < agent.modules.length ? tab : null
  const submitLabel = busy ? 'Transmitting…' : windowOpen ? 'Submit strategy' : 'Submissions closed'

  const status = tooLong ? (
    <span className="text-alert">Code is too long</span>
  ) : problems ? (
    <span className="text-alert">
      {problems} problem{problems > 1 ? 's' : ''}
    </span>
  ) : agent?.modules.some((_, i) => unused(i)) ? (
    <span className="text-amber">No errors, but a module isn't used yet</span>
  ) : generated.some((m) => m.warnings.length > 0) ? (
    <span className="text-amber">No errors, but a module has gaps</span>
  ) : (
    <span className="text-coop" title="The server checks your code fully when you submit">
      Ready to submit
    </span>
  )

  const tabs = (
    <div className="flex items-stretch gap-px overflow-x-auto border-b border-steel bg-steel/40" role="tablist">
      <button
        role="tab"
        aria-selected={tab === 'code'}
        onClick={() => setTab('code')}
        className={`cursor-pointer px-4 py-2 text-xs font-bold tracking-widest uppercase ${tab === 'code' ? 'bg-panel text-paper' : 'text-muted hover:text-paper'}`}
      >
        strategy.py
        {noStrategy && <span className="ml-2 text-alert">●</span>}
      </button>
      {agent?.modules.map((layout, i) => {
        const blocks = countBlocks(layout)
        return (
          <button
            key={moduleKeys[i]}
            role="tab"
            aria-selected={tab === i}
            onClick={() => setTab(i)}
            className={`flex cursor-pointer items-center gap-2 px-4 py-2 text-xs font-bold tracking-wider whitespace-nowrap ${tab === i ? 'bg-panel text-paper' : 'text-muted hover:text-paper'}`}
          >
            <span className="text-alert">▦</span>
            {names[i]}
            <span className="font-normal text-muted tabular-nums">{blocks}</span>
            {(generated[i]?.problems.length ?? 0) > 0 && <span className="text-alert">●</span>}
          </button>
        )
      })}
      {/* Rounds that play numbers have no blocks yet, so they don't offer a block module at all */}
      {maxModules > 0 && (
        <button
          onClick={addModule}
          disabled={!agent || agent.modules.length >= maxModules}
          title={`This round allows ${maxModules} block module(s)`}
          className="cursor-pointer px-4 py-2 text-xs font-bold tracking-widest whitespace-nowrap text-amber uppercase hover:text-paper disabled:cursor-not-allowed disabled:text-steel-light"
        >
          + Block module
        </button>
      )}
      <span data-testid="check" className="ml-auto flex items-center px-4 text-[11px] whitespace-nowrap text-muted">
        {status}
      </span>
    </div>
  )

  return (
    <div className="grid min-h-full grid-cols-1 gap-3 p-3 lg:h-full lg:grid-cols-[1fr_380px]">
      <section className="flex min-h-[70vh] flex-col border border-steel bg-panel/90 panel-3d lg:min-h-0">
        {placesTroops && (
          <div className="flex flex-wrap items-stretch gap-px border-b border-steel bg-steel/40" role="tablist" aria-label="How to play this round">
            {(
              [
                ['map', '◈ Place troops on the map'],
                ['code', '</> Write code'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                role="tab"
                aria-selected={playMode === mode}
                onClick={() => setPlayMode(mode)}
                className={`cursor-pointer px-4 py-2.5 text-xs font-bold tracking-widest uppercase transition-colors ${playMode === mode ? 'bg-panel text-amber shadow-[inset_0_2px_0_var(--color-amber)]' : 'text-muted hover:text-paper'}`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto flex items-center px-4 text-[11px] text-muted">Whichever is open is what you submit</span>
          </div>
        )}
        {mapMode ? (
          <TroopPlacement troops={troops} regions={regions} allocation={placement} onChange={setAllocation} problems={placementProblems} disabled={fallen} />
        ) : (
        <>
        {tabs}
        {noStrategy && <p className="border-b border-alert-dim bg-alert/10 px-4 py-1.5 text-xs text-alert">strategy.py must define a strategy function.</p>}
        {tooLong && (
          <p className="border-b border-alert-dim bg-alert/10 px-4 py-1.5 text-xs text-alert">
            {modulesBytes > MAX_BLOCKS_BYTES
              ? `Your block modules use ${modulesBytes.toLocaleString()} bytes and the limit is ${MAX_BLOCKS_BYTES.toLocaleString()} bytes. Remove some blocks to submit.`
              : `Your code uses ${assembledBytes.toLocaleString()} bytes and the limit is ${MAX_CODE_LENGTH.toLocaleString()} bytes. Shorten it to submit.`}
          </p>
        )}
        <div className="relative min-h-0 flex-1">
          {agent === null ? (
            <Empty>Loading your workspace…</Empty>
          ) : (
            <>
              {/* The code editor stays mounted so its undo history survives tab switches */}
              <div className={`absolute inset-0 ${activeModule === null ? '' : 'invisible'}`}>
                <CodeEditor key={loadCount} value={agent.hand_code} onChange={setCode} onMount={setEditor} />
              </div>
              {activeModule !== null && (
                <div className="absolute inset-0 flex flex-col">
                  <div className="min-h-0 flex-1">
                    <ErrorBoundary
                      resetKey={moduleKeys[activeModule]}
                      fallback={() => (
                        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center" role="alert">
                          <p className="text-sm text-alert">This module's saved layout can't be opened.</p>
                          <p className="text-xs text-muted">Your code and other modules are not affected.</p>
                          <Button onClick={() => resetModule(activeModule)}>Start this module again</Button>
                        </div>
                      )}
                    >
                      <BlockEditor
                        key={moduleKeys[activeModule]}
                        layout={agent.modules[activeModule]}
                        onChange={(layout) => setModule(activeModule, layout)}
                        maxBlocks={blockLimit - totalBlocks + activeBlocks}
                        moves={moves}
                      />
                    </ErrorBoundary>
                  </div>
                  <div className="grid max-h-64 shrink-0 grid-cols-[1fr_minmax(0,16rem)] gap-4 overflow-y-auto border-t border-steel bg-ink/80 p-3">
                    <div className="min-w-0">
                      <span className="label !text-[10px]">Generated Python</span>
                      {overLimit && (
                        <p className="mt-1 text-xs text-alert">
                          This round allows {blockLimit} blocks in total, and you have {totalBlocks}. Remove some to submit.
                        </p>
                      )}
                      {generated[activeModule]?.problems.map((problem) => (
                        <p key={problem} className="mt-1 text-xs text-alert">
                          {problem}
                        </p>
                      ))}
                      {generated[activeModule]?.warnings.map((warning) => (
                        <p key={warning} className="mt-1 text-xs text-amber">
                          {warning}
                        </p>
                      ))}
                      {unused(activeModule) && <p className="mt-1 text-xs text-amber">This module won't play yet: strategy.py doesn't call it. Use the button here, or call {names[activeModule]}({MODULE_ARGS}) in your code.</p>}
                      <pre data-testid="generated" className="mt-1 text-xs whitespace-pre-wrap text-coop/90">
                        {generated[activeModule]?.code ?? ''}
                      </pre>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-xs text-muted tabular-nums">
                        {totalBlocks} of {blockLimit} blocks in total
                      </span>
                      {examples.length > 0 && (
                        <select className={`${inputClass} !py-1 text-xs`} aria-label="Start from an example" title="Start from a ready-made strategy" value="" onChange={(e) => applyExample(activeModule, e.target.value)}>
                          <option value="">Start from an example…</option>
                          {examples.map((e) => (
                            <option key={e.name} value={e.name}>
                              {e.name}: {e.about}
                            </option>
                          ))}
                        </select>
                      )}
                      {unused(activeModule) && (
                        <Button variant="primary" className="!px-2 !py-1" onClick={() => playModule(activeModule)}>
                          Use as my strategy
                        </Button>
                      )}
                      <Button variant="danger" className="!px-2 !py-1" onClick={() => removeModule(activeModule)}>
                        Delete module
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        </>
        )}
      </section>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Guard name="Command">
          {/* Stays in view, so Submit and the timer are always reachable while reading results below */}
          <Panel className="z-10 shrink-0 !bg-panel lg:sticky lg:top-0" title={round ? `Round ${round.number} of ${TOTAL_ROUNDS}` : 'Command'} right={round && <span className="label !text-amber">{game.name}</span>}>
            <div className="flex flex-col gap-3">
              {/* Only this team's own score, from public GET /standings (published rounds only). Teams never see other teams' scores or the leaderboard */}
              <div data-testid="own-score" className="flex items-baseline justify-between border border-steel bg-ink/60 px-3 py-2">
                <span className="label">Your score</span>
                <span className="text-xl font-bold tabular-nums text-paper">
                  {typeof ownScore === 'number' ? ownScore.toLocaleString(undefined, { maximumFractionDigits: 2 }) : <span className="text-sm font-normal text-muted">Not scored yet</span>}
                </span>
              </div>
              {roundFailed && roundError instanceof ApiError && roundError.code === 'BAD_RESPONSE' && (
                <p role="alert" className="text-xs text-alert">
                  {roundError.message}
                </p>
              )}
              {fallen ? (
                <>
                  <p className="stamp self-start text-alert">{team.status === 'disqualified' ? 'Disqualified' : 'Nation fallen'}</p>
                  <p className="text-xs text-muted">Your nation is out of the event, so nothing more can be submitted.</p>
                </>
              ) : (
                <>
                  <WindowTimer round={round} />
                  <Button variant="primary" onClick={submit} disabled={!canSubmit}>
                    {submitLabel}
                  </Button>
                  {placesTroops && (
                    <p data-testid="submitting" className="text-xs text-muted">
                      Submitting: <span className="text-paper">{mapMode ? 'your troop placement on the map' : 'your code'}</span>
                    </p>
                  )}
                  {!round ? (
                    <p className="text-xs text-muted">
                      The event has not started yet. Prepare your strategy here; your draft is saved automatically.
                    </p>
                  ) : round.status === 'waiting' ? (
                    <p className="text-xs text-muted">
                      The submission window has not opened yet. Prepare your strategy here; you can submit as soon as the window opens.
                    </p>
                  ) : (
                    <p className="text-xs text-muted">
                      {round.status === 'open'
                        ? accepted
                          ? `Version ${accepted.version} is your latest accepted strategy and will play when the window closes.`
                          : 'You have no accepted strategy yet.'
                        : accepted
                          ? `Version ${accepted.version} is your strategy for this round.`
                          : 'You have no accepted strategy for this round.'}
                    </p>
                  )}
                  {notSent && round?.status === 'open' && (
                    <p data-testid="not-sent" className="text-xs font-bold text-amber">
                      You have changes that aren't submitted. Only submitted versions play.
                    </p>
                  )}
                </>
              )}
              {draftState === 'failed' ? (
                <p role="alert" className="text-xs text-alert">
                  This browser is not saving your draft. Submit often so your work is safe on the server.
                </p>
              ) : (
                draftState === 'saved' && <p className="text-xs text-muted">Draft saved in this browser.</p>
              )}
            </div>
          </Panel>
        </Guard>
        {newest && (
          <Guard name="Latest version">
            <LatestResult version={newest.version} detail={latestDetail?.id === newest.id ? latestDetail : undefined} />
          </Guard>
        )}
        {round && (
          <Guard name="Round rules">
            <details open className="shrink-0 border border-steel bg-panel/90 panel-3d">
              <summary className="label cursor-pointer bg-steel/40 px-4 py-2 !text-paper">Round rules</summary>
              <div className="flex flex-col gap-2 p-4 text-xs">
                {game.also && <p className="label !text-amber">{game.also}</p>}
                {game.brief && <p>{game.brief}</p>}
                {game.question && <p className="text-muted italic">{game.question}</p>}
                {moves.length > 0 ? (
                  <p className="text-muted">Moves: {moves.map((m) => moveOption(m, moveLabel(m))).join(' · ')}</p>
                ) : (
                  <p className="text-muted">No named moves this round: your bot returns numbers.</p>
                )}
                {game.limits && <p className="text-muted">{game.limits}</p>}
                {placesTroops && (
                  <p className="text-muted">
                    Region order in the list: {regionNames(regions).map((name, i) => `${i + 1}. ${name}`).join(' · ')}
                  </p>
                )}
                {round.config.rounds_per_match !== undefined && (
                  <p className="text-muted">
                    {round.config.rounds_per_match} turns per match{round.config.repetitions !== undefined ? ` · ${round.config.repetitions} repetitions` : ''}
                  </p>
                )}
                <p className="text-muted">
                  Blocks: {maxModules ? `up to ${maxModules} module${maxModules > 1 ? 's' : ''}, ${blockLimit} blocks in total · ${TOOLBOX.map((group) => group.label).join(', ')}` : 'not used this round, write code'}
                </p>
              </div>
            </details>
          </Guard>
        )}
        <Guard name="Version history">
          <History roundId={round?.id} onLoad={askToLoad} />
        </Guard>
      </div>
      {dialog}
    </div>
  )
}
