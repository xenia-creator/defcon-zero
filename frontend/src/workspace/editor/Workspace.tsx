import Editor, { type OnMount } from '@monaco-editor/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { Button, Empty, Guard, Panel, WindowTimer, inputClass, useConfirm } from '../../components/ui'
import { ApiError, request } from '../../lib/api'
import { newId } from '../../lib/ids'
import { serverNow, windowRemaining } from '../../lib/clock'
import { Submitted, type Round, type Team } from '../../lib/contract'
import { FEATURES } from '../../lib/features'
import { useLive } from '../../lib/live'
import { useCurrentRound, useSubmission, useSubmissions } from '../../lib/queries'
import { BlockEditor } from '../blocks/BlockEditor'
import { BLOCK_RULES, blockSet } from '../blocks/categories'
import { exampleLayout, examplesFor } from '../blocks/examples'
import { generateModules } from '../blocks/generate'
import { countBlocks, moduleName, newModule, type Layout } from '../blocks/layout'
import { History, LatestResult, Practice, toSubmission } from './SidePanels'
import { MAX_CODE_LENGTH, loadDraft, loadVersion, saveDraft, saveVersion, type Agent } from './drafts'
import { DEFAULT_GAME, TOTAL_ROUNDS, gameInfo, gameKeyOf } from './games'
import { monaco, setGameHints, setModuleNames } from './monaco'

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

/** Retries network and gateway failures, so a blip at the deadline doesn't lose a submission. Trying twice can at worst store one extra version. */
async function submitAgent(agent: Agent, game: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request('POST', '/submissions', Submitted, toSubmission(agent, game))
    } catch (err) {
      if ((err instanceof ApiError && err.status < 500) || attempt >= 2) throw err
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
}

function submitFailure(err: unknown): string {
  if (!(err instanceof ApiError) || err.status >= 500) return 'Could not reach the server. Your draft is saved here, so try again.'
  return err.message
}

/** The server reports errors as "Line 3: ...". Where it names a line, mark it in the editor. */
function useErrorMarkers(editor: Editor | null, errors: string[]) {
  useEffect(() => {
    const model = editor?.getModel()
    if (!model) return
    const markers = errors.flatMap((message) => {
      const found = message.match(/^Line (\d+):/)
      const line = found ? Number(found[1]) : 0
      if (line < 1 || line > model.getLineCount()) return []
      return [{ severity: monaco.MarkerSeverity.Error, message, startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: model.getLineMaxColumn(line) }]
    })
    monaco.editor.setModelMarkers(model, 'server', markers)
  }, [editor, errors])
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
export function Workspace({ team }: { team: Team }) {
  const { data: round } = useCurrentRound()
  const toast = useLive((s) => s.toast)
  const key = round ? gameKeyOf(round) : undefined
  const shown = useRef(key)
  useEffect(() => {
    if (!key) return
    try {
      localStorage.setItem(LAST_GAME, key)
    } catch {
      // only a convenience for reloading while offline
    }
    if (shown.current && shown.current !== key) toast('info', `The round has moved on to ${round?.name}. Your earlier code is saved with its own round.`)
    shown.current = key
  }, [key, round?.name, toast])

  // Never wait for the round: with the server down the team still needs their draft
  const gameKey = key ?? lastGame()
  return <RoundWorkspace key={gameKey} team={team} gameKey={gameKey} />
}

function RoundWorkspace({ team, gameKey }: { team: Team; gameKey: string }) {
  const { data: round } = useCurrentRound()
  const { data: submissions } = useSubmissions()
  const game = gameInfo(gameKey, round?.name)
  const blocks = blockSet(gameKey)
  useEffect(() => setGameHints(game, blocks.args), [game, blocks.args])
  // The list holds every round's versions. Only this round's can play this round's game
  const opensAt = round?.opensAt
  const thisRound = useMemo(() => (opensAt == null ? [] : (submissions ?? []).filter((s) => s.createdAt !== null && s.createdAt >= opensAt)), [submissions, opensAt])
  const newest = thisRound[0]
  const { data: latestDetail } = useSubmission(newest?.id)
  const latestFinished = !!latestDetail && latestDetail.id === newest?.id && latestDetail.status !== 'pending'
  const toast = useLive((s) => s.toast)
  const queries = useQueryClient()
  useDeadlineWarnings(round)
  // What was last sent, to tell a team when their editor no longer matches it. Lost if storage is blocked, which only over-warns
  const sentKey = `sent:${team.id}:${gameKey}`
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

  const tooLong = (agent?.hand_code.length ?? 0) > MAX_CODE_LENGTH
  const generated = useMemo(() => generateModules(agent?.modules ?? [], gameKey), [agent, gameKey])
  const blockProblems = generated.reduce((n, m) => n + m.problems.length, 0)

  const rules = game.blocks ? BLOCK_RULES : { max_modules: 0, max_blocks: 1, categories: [] }
  const noStrategy = agent !== null && !/^\s*def\s+strategy\s*\(/m.test(agent.hand_code)
  useErrorMarkers(editor, useMemo(() => (latestDetail?.status === 'rejected' ? latestDetail.errors : []), [latestDetail]))

  // The server's result arrives by polling, so say when it does
  const waitingOn = useRef<number | null>(null)
  useEffect(() => {
    if (newest?.status === 'pending') waitingOn.current = newest.id
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
    saved.current = next // no need to save what just came from storage or the server
    setAgent(next)
    setLoadCount((n) => n + 1) // a fresh editor shows what was loaded
    setModuleKeys(next.modules.map(() => newId()))
    setTab('code')
    return next
  }, [hasBlocks])

  // Restore: the autosaved draft, else the template. The server doesn't send code back, so a new machine starts fresh
  useEffect(() => {
    if (restoring.current) return
    restoring.current = true
    ;(async () => {
      const draft = await loadDraft(team.id, gameKey)
      load(draft ?? { hand_code: game.template, modules: [] })
    })()
  }, [team.id, gameKey, game.template, load])

  const flush = useCallback(() => {
    const current = latest.current
    if (current === null || current === saved.current) return
    saved.current = current
    saveDraft(team.id, gameKey, current).then((ok) => setDraftState(ok ? 'saved' : 'failed'))
  }, [team.id, gameKey])

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
    if (!agent || agent.modules.length >= rules.max_modules) return
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
        const hand_code = `import random\n\n\ndef strategy(${blocks.args}):\n    return ${names[index]}(${blocks.args})\n`
        saveDraft(team.id, gameKey, load({ ...agent, hand_code }))
      },
    })
  }

  function askToLoad(id: number, version: number) {
    ask({
      title: `Load version ${version}`,
      body: 'This replaces what is in your editor now. Anything you have not submitted will be lost.',
      confirmLabel: 'Load version',
      run: () => {
        const next = loadVersion(team.id, id)
        if (next) saveDraft(team.id, gameKey, load(next))
        else toast('bad', `This browser has no copy of version ${version}.`)
      },
    })
  }

  const examples = examplesFor(gameKey, rules.categories, rules.max_blocks)
  const unused = (i: number) => !agent?.hand_code.includes(`${names[i]}(`)
  const fallen = team.status !== 'alive'
  const windowOpen = round?.status === 'open'
  const problems = blockProblems + (noStrategy ? 1 : 0)
  const canSubmit = windowOpen && !fallen && !busy && agent !== null && problems === 0 && !tooLong

  async function submit() {
    if (agent === null || sending.current) return
    sending.current = true
    setBusy(true)
    flush()
    try {
      const s = await submitAgent(agent, gameKey)
      markSent(agent)
      saveVersion(team.id, s.id, agent)
      toast('info', `Version ${s.version} received. Testing against the bots…`)
      queries.invalidateQueries({ queryKey: ['submissions'] })
    } catch (err) {
      toast('bad', submitFailure(err))
      // The window may have closed or the team fallen since the last update
      queries.invalidateQueries({ queryKey: ['round'] })
      queries.invalidateQueries({ queryKey: ['team'] })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const accepted = thisRound.find((s) => s.status === 'accepted')
  const notSent = thisRound.length > 0 && agent !== null && JSON.stringify(agent) !== lastSent
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
            <span className={`font-normal tabular-nums ${blocks > rules.max_blocks ? 'text-alert' : 'text-muted'}`}>
              {blocks}/{rules.max_blocks}
            </span>
            {(generated[i]?.problems.length ?? 0) > 0 && <span className="text-alert">●</span>}
          </button>
        )
      })}
      <button
        onClick={addModule}
        disabled={!agent || agent.modules.length >= rules.max_modules}
        title={rules.max_modules ? `This round allows ${rules.max_modules} block module(s)` : 'This round is code only'}
        className="cursor-pointer px-4 py-2 text-xs font-bold tracking-widest whitespace-nowrap text-amber uppercase hover:text-paper disabled:cursor-not-allowed disabled:text-steel-light"
      >
        + Block module
      </button>
      <span data-testid="check" className="ml-auto flex items-center px-4 text-[11px] whitespace-nowrap text-muted">
        {status}
      </span>
    </div>
  )

  return (
    <div className="grid min-h-full grid-cols-1 gap-3 p-3 lg:h-full lg:grid-cols-[1fr_380px]">
      <section className="flex min-h-[70vh] flex-col border border-steel bg-panel/90 lg:min-h-0">
        {tabs}
        {noStrategy && <p className="border-b border-alert-dim bg-alert/10 px-4 py-1.5 text-xs text-alert">strategy.py must define a strategy function.</p>}
        {tooLong && (
          <p className="border-b border-alert-dim bg-alert/10 px-4 py-1.5 text-xs text-alert">
            Your code is {agent?.hand_code.length.toLocaleString()} characters and the limit is {MAX_CODE_LENGTH.toLocaleString()}. Shorten it to submit.
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
                        maxBlocks={rules.max_blocks}
                        categories={rules.categories}
                        game={gameKey}
                      />
                    </ErrorBoundary>
                  </div>
                  <div className="grid max-h-64 shrink-0 grid-cols-[1fr_minmax(0,16rem)] gap-4 overflow-y-auto border-t border-steel bg-ink/80 p-3">
                    <div className="min-w-0">
                      <span className="label !text-[10px]">Generated Python</span>
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
                      {unused(activeModule) && <p className="mt-1 text-xs text-amber">This module won't play yet: strategy.py doesn't call it. Use the button here, or call {names[activeModule]}({blocks.args}) in your code.</p>}
                      <pre data-testid="generated" className="mt-1 text-xs whitespace-pre-wrap text-coop/90">
                        {generated[activeModule]?.code ?? ''}
                      </pre>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-xs text-muted tabular-nums">
                        {countBlocks(agent.modules[activeModule])} of {rules.max_blocks} blocks
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
      </section>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Guard name="Command">
          {/* Stays in view, so Submit and the timer are always reachable while reading results below */}
          <Panel className="z-10 shrink-0 !bg-panel lg:sticky lg:top-0" title={round ? `Round ${round.number} of ${TOTAL_ROUNDS}` : 'Command'} right={round && <span className="label !text-amber">{game.name}</span>}>
            <div className="flex flex-col gap-3">
              {fallen ? (
                <>
                  <p className="stamp self-start text-alert">Nation fallen</p>
                  <p className="text-xs text-muted">Your nation is out of the event, so nothing more can be submitted. You can still practise.</p>
                </>
              ) : (
                <>
                  <WindowTimer round={round} />
                  <Button variant="primary" onClick={submit} disabled={!canSubmit}>
                    {submitLabel}
                  </Button>
                  {round?.status !== 'waiting' && (
                    <p className="text-xs text-muted">
                      {round?.status === 'open'
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
            <details open className="shrink-0 border border-steel bg-panel/90">
              <summary className="label cursor-pointer bg-steel/40 px-4 py-2 !text-paper">Round rules</summary>
              <div className="flex flex-col gap-2 p-4 text-xs">
                {game.brief && <p>{game.brief}</p>}
                {game.question && <p className="text-muted italic">{game.question}</p>}
                <p className="text-muted">
                  Blocks:{' '}
                  {rules.max_modules
                    ? `up to ${rules.max_modules} module${rules.max_modules > 1 ? 's' : ''} of ${rules.max_blocks} blocks · ${rules.categories.map((c) => blocks.categories[c]?.label ?? c).join(', ') || 'moves only'}`
                    : 'not used this round, write code'}
                </p>
              </div>
            </details>
          </Guard>
        )}
        {FEATURES.practice && agent && (
          <Guard name="Practice match">
            <Practice agent={agent} tooLong={tooLong} gameKey={gameKey} game={game} startNoise={0} />
          </Guard>
        )}
        <Guard name="Version history">
          <History teamId={team.id} onLoad={askToLoad} opensAt={opensAt} />
        </Guard>
      </div>
      {dialog}
    </div>
  )
}
