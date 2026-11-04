import Editor, { type OnMount } from '@monaco-editor/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { Button, Empty, Guard, Panel, WindowTimer, inputClass, useConfirm } from '../../components/ui'
import { ApiError, api, errorMessage, unwrap, type Schemas } from '../../lib/api'
import { newId } from '../../lib/ids'
import { serverNow, windowRemaining } from '../../lib/clock'
import { useLive } from '../../lib/live'
import { useCurrentRound, useSubmissions } from '../../lib/queries'
import { BlockEditor } from '../blocks/BlockEditor'
import { blockSet } from '../blocks/categories'
import { exampleLayout, examplesFor } from '../blocks/examples'
import { generateModules } from '../blocks/generate'
import { countBlocks, moduleName, newModule, type Layout } from '../blocks/layout'
import { History, LatestResult, Practice, agentFromDetail, toBody } from './SidePanels'
import { MAX_CODE_LENGTH, loadDraft, saveDraft, type Agent } from './drafts'
import { DEFAULT_GAME, TOTAL_ROUNDS, gameInfo } from './games'
import { monaco, setGameHints, setModuleNames } from './monaco'

const AUTOSAVE_MS = 2000
const VALIDATE_DEBOUNCE_MS = 600
const VALIDATE_RETRY_MS = 5000
const LAST_GAME = 'ic.game'
const DEADLINE_WARNINGS = [300, 60]

/** Teams heads-down in their code may not be watching the timer. */
function useDeadlineWarnings(round: Schemas['RoundOut'] | null | undefined) {
  const toast = useLive((s) => s.toast)
  const before = useRef<number | null>(null)
  useEffect(() => {
    const tick = () => {
      const left = windowRemaining(round, serverNow())
      if (!left || left.paused) {
        before.current = null
        return
      }
      // Only the closest one, if organisers cut the time past both at once
      const passed = DEADLINE_WARNINGS.filter((mark) => before.current !== null && before.current > mark && left.seconds <= mark)
      if (passed.length) {
        const mark = Math.min(...passed)
        toast('bad', `${mark / 60} minute${mark > 60 ? 's' : ''} left. Only submitted versions play, so submit now.`)
      }
      before.current = left.seconds
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
type Check = 'checking' | 'done' | 'unavailable'

/** The server builds the agent as the team edits: errors, generated module code and the round's rules. */
function useValidation(agent: Agent | null, editor: Editor | null, tooLong: boolean) {
  const [result, setResult] = useState<Schemas['ValidateOut'] | null>(null)
  const [check, setCheck] = useState<Check>('checking')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!agent || tooLong) return
    let stale = false
    // A retry after a failure keeps its message up, so it doesn't flicker
    if (attempt === 0) setCheck('checking')
    let retry: ReturnType<typeof setTimeout> | undefined
    const id = setTimeout(async () => {
      try {
        const answer = unwrap(await api.POST('/api/v1/practice/validate', { body: toBody(agent) }))
        // A slow answer about older code must not replace a newer one
        if (stale) return
        setResult(answer)
        setCheck('done')
      } catch {
        // The submission is checked on the server anyway, so this never blocks submitting
        if (stale) return
        setCheck('unavailable')
        retry = setTimeout(() => setAttempt((n) => n + 1), VALIDATE_RETRY_MS)
      }
    }, VALIDATE_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(id)
      clearTimeout(retry)
    }
  }, [agent, tooLong, attempt])

  // New code starts a fresh check rather than continuing the retries for the old code
  useEffect(() => setAttempt(0), [agent])

  const errors = useMemo(() => (check === 'unavailable' ? [] : (result?.errors ?? [])), [check, result])
  useEffect(() => {
    const model = editor?.getModel()
    if (!model) return
    monaco.editor.setModelMarkers(
      model,
      'sandbox',
      errors
        .filter((e) => e.module === null)
        .map((e) => {
          const line = Math.min(Math.max(e.line ?? 1, 1), model.getLineCount())
          return {
            severity: monaco.MarkerSeverity.Error,
            message: e.message,
            startLineNumber: line,
            endLineNumber: line,
            startColumn: 1,
            endColumn: model.getLineMaxColumn(line),
          }
        }),
    )
  }, [errors, editor])
  return { result, errors, check }
}

/** Submit with an idempotency key, retrying network and gateway failures with the same key so nothing is stored twice. */
async function submitAgent(agent: Agent) {
  const key = newId()
  for (let attempt = 0; ; attempt++) {
    try {
      return unwrap(await api.POST('/api/v1/submissions', { body: toBody(agent), headers: { 'Idempotency-Key': key } }))
    } catch (err) {
      if ((err instanceof ApiError && err.status < 500) || attempt >= 2) throw err
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
}

function submitFailure(err: unknown): string {
  if (!(err instanceof ApiError) || err.status >= 500) return 'Could not reach the server. Your draft is saved here, so try again.'
  const first = Array.isArray(err.details.errors) ? (err.details.errors[0] as { message?: unknown } | undefined) : undefined
  return typeof first?.message === 'string' ? `${err.message}: ${first.message}` : err.message
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
export function Workspace({ team }: { team: Schemas['TeamOut'] }) {
  const { data: round } = useCurrentRound()
  const toast = useLive((s) => s.toast)
  const key = round?.game.key
  const shown = useRef(key)
  useEffect(() => {
    if (!key) return
    try {
      localStorage.setItem(LAST_GAME, key)
    } catch {
      // only a convenience for reloading while offline
    }
    if (shown.current && shown.current !== key) toast('info', `The round has moved on to ${round?.game.name}. Your earlier code is saved with its own round.`)
    shown.current = key
  }, [key, round?.game.name, toast])

  // Never wait for the round: with the server down the team still needs their draft
  const gameKey = key ?? lastGame()
  return <RoundWorkspace key={gameKey} team={team} gameKey={gameKey} />
}

function RoundWorkspace({ team, gameKey }: { team: Schemas['TeamOut']; gameKey: string }) {
  const { data: round } = useCurrentRound()
  const { data: submissions, isError: submissionsFailed } = useSubmissions()
  const game = gameInfo(gameKey, round?.game.name)
  const blocks = blockSet(gameKey)
  useEffect(() => setGameHints(game, blocks.args), [game, blocks.args])
  // The list holds every round's versions. Only this round's can play this round's game
  const opensAt = round?.opens_at
  const thisRound = useMemo(() => (opensAt == null ? [] : (submissions ?? []).filter((s) => s.created_at >= opensAt)), [submissions, opensAt])
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
  const { errors, check } = useValidation(agent, editor, tooLong)
  const generated = useMemo(() => generateModules(agent?.modules ?? [], gameKey), [agent, gameKey])
  const blockProblems = generated.reduce((n, m) => n + m.problems.length, 0)

  const rules = game.blocks && round ? round.block_rules : { max_modules: 0, max_blocks: 1, categories: [] }
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

  // Restore: the autosaved draft, else the latest submitted version, else the template.
  // If the server can't be reached the team still gets an editor and can load a version later.
  useEffect(() => {
    if (restoring.current || (submissions === undefined && !submissionsFailed)) return
    restoring.current = true
    ;(async () => {
      const draft = await loadDraft(team.id, gameKey)
      if (draft) return void load(draft)
      const newest = thisRound[0]
      if (newest) {
        try {
          const detail = unwrap(await api.GET('/api/v1/submissions/{submission_id}', { params: { path: { submission_id: newest.id } } }))
          const restored = agentFromDetail(detail)
          if (restored) return void markSent(load(restored))
        } catch {
          toast('bad', `Could not fetch version ${newest.version}. Use Load in the version history to try again.`)
        }
      }
      load({ hand_code: game.template, modules: [] })
    })()
  }, [submissions, submissionsFailed, thisRound, team.id, gameKey, game.template, load, markSent, toast])

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

  function askToLoad(id: string, version: number) {
    ask({
      title: `Load version ${version}`,
      body: 'This replaces what is in your editor now. Anything you have not submitted will be lost.',
      confirmLabel: 'Load version',
      run: async () => {
        try {
          const detail = unwrap(await api.GET('/api/v1/submissions/{submission_id}', { params: { path: { submission_id: id } } }))
          const next = agentFromDetail(detail)
          if (!next) throw new Error('unreadable version')
          saveDraft(team.id, gameKey, load(next))
        } catch (err) {
          toast('bad', errorMessage(err, `Could not load version ${version}. Try again.`))
        }
      },
    })
  }

  const examples = examplesFor(gameKey, rules.categories, rules.max_blocks)
  const unused = (i: number) => !agent?.hand_code.includes(`${names[i]}(`)
  const fallen = team.eliminated_in != null
  const paused = round?.status === 'open' && round.paused_remaining !== null
  const canSubmit = !!round?.window_open && !fallen && !busy && agent !== null && errors.length === 0 && blockProblems === 0 && !tooLong

  async function submit() {
    if (agent === null || sending.current) return
    sending.current = true
    setBusy(true)
    flush()
    try {
      const s = await submitAgent(agent)
      markSent(agent)
      toast('info', `Version ${s.version} received. Testing in the sandbox…`)
      queries.invalidateQueries({ queryKey: ['submissions'] })
    } catch (err) {
      toast('bad', submitFailure(err))
      // The window may have closed or the team fallen since the last update
      queries.invalidateQueries({ queryKey: ['round'] })
      queries.invalidateQueries({ queryKey: ['teams'] })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const accepted = thisRound.find((s) => s.status === 'accepted')
  const notSent = thisRound.length > 0 && agent !== null && JSON.stringify(agent) !== lastSent
  const activeModule = typeof tab === 'number' && agent && tab < agent.modules.length ? tab : null
  const moduleErrors = (i: number) => errors.filter((e) => e.module === i)
  const generalErrors = errors.filter((e) => e.module === null && e.line === null && e.kind === 'blocks')
  const submitLabel = busy ? 'Transmitting…' : round?.window_open ? 'Submit strategy' : paused ? 'Window paused' : 'Submissions closed'

  const status = tooLong ? (
    <span className="text-alert">Code is too long</span>
  ) : check === 'unavailable' && !blockProblems ? (
    <span className="text-amber">Can't check right now. The server checks on submit.</span>
  ) : errors.length + blockProblems ? (
    <span className="text-alert">
      {errors.length + blockProblems} problem{errors.length + blockProblems > 1 ? 's' : ''}
    </span>
  ) : check === 'checking' ? (
    <span>Checking…</span>
  ) : agent?.modules.some((_, i) => unused(i)) ? (
    <span className="text-amber">No errors, but a module isn't used yet</span>
  ) : generated.some((m) => m.warnings.length > 0) ? (
    <span className="text-amber">No errors, but a module has gaps</span>
  ) : (
    <span className="text-coop">Passes all checks</span>
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
        {errors.some((e) => e.module === null && e.kind === 'code') && <span className="ml-2 text-alert">●</span>}
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
            {moduleErrors(i).length + (generated[i]?.problems.length ?? 0) > 0 && <span className="text-alert">●</span>}
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
        {generalErrors.map((e, i) => (
          <p key={i} className="border-b border-alert-dim bg-alert/10 px-4 py-1.5 text-xs text-alert">
            {e.message}
          </p>
        ))}
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
                      {moduleErrors(activeModule).map((e, i) => (
                        <p key={i} className="mt-1 text-xs text-alert">
                          {e.message}
                        </p>
                      ))}
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
          <Panel className="z-10 shrink-0 !bg-panel lg:sticky lg:top-0" title={round ? `Round ${round.index} of ${TOTAL_ROUNDS}` : 'Command'} right={round && <span className="label !text-amber">{game.name}</span>}>
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
                  {round?.status !== 'draft' && (
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
        {thisRound[0] && (
          <Guard name="Latest version">
            <LatestResult submission={thisRound[0]} />
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
                  {round.turns ?? 'Hidden number of'} turns{round.noise > 0 ? ` · ${Math.round(round.noise * 100)}% random errors` : ''} · {round.repetitions} repetitions
                </p>
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
        {agent && (
          <Guard name="Practice match">
            <Practice agent={agent} tooLong={tooLong} gameKey={gameKey} game={game} startNoise={game.usesNoise ? (round?.noise ?? 0) : 0} />
          </Guard>
        )}
        <Guard name="Version history">
          <History onLoad={askToLoad} opensAt={opensAt} />
        </Guard>
      </div>
      {dialog}
    </div>
  )
}
