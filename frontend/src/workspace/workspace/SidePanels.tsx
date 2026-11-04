import { useRef, useState } from 'react'
import { Badge, Button, Empty, LoadFailed, Panel, inputClass } from '../../components/ui'
import { api, errorMessage, unwrap, type Schemas } from '../../lib/api'
import { useBots, useSubmissions } from '../../lib/queries'
import { type Agent, parseAgent } from './drafts'
import type { GameInfo } from './games'

export const toBody = (agent: Agent) => ({ hand_code: agent.hand_code, modules: agent.modules.map((layout) => ({ layout })) })

export function agentFromDetail(detail: Schemas['SubmissionDetail']): Agent | null {
  return parseAgent({ hand_code: detail.hand_code, modules: detail.modules.map((m) => m.layout) })
}

/** tit_for_tat reads as "Tit for tat". */
const botName = (key: string) => {
  const words = key.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const clamp = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min)

export function MoveStrip({ moves, max = 200 }: { moves: string; max?: number }) {
  return (
    <div className="flex flex-wrap gap-px">
      {[...moves.slice(0, max)].map((m, i) => (
        <span key={i} className={`h-2 w-2 ${m === 'C' ? 'bg-coop' : 'bg-alert'}`} title={`Turn ${i + 1}: ${m}`} />
      ))}
    </div>
  )
}

/** Practice always plays the current round's game. The server sets who the bots are for it. */
export function Practice({ agent, tooLong, gameKey, game, startNoise }: { agent: Agent; tooLong: boolean; gameKey: string; game: GameInfo; startNoise: number }) {
  const { data: bots = [] } = useBots()
  const [picked, setOpponent] = useState('tit_for_tat')
  const opponent = picked === 'self' || bots.some((b) => b.key === picked) ? picked : (bots[0]?.key ?? 'self')
  const [turns, setTurns] = useState(50)
  const [noise, setNoise] = useState(startNoise)
  const [result, setResult] = useState<Schemas['PracticeOut'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)

  async function run() {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const body = { ...toBody(agent), opponent, game: gameKey, turns: clamp(turns, 1, 500), noise: game.usesNoise ? clamp(noise, 0, 0.5) : 0 }
      setResult(unwrap(await api.POST('/api/v1/practice/simulate', { body })))
    } catch (err) {
      setResult(null)
      setError(errorMessage(err, 'Could not reach the server to run the match.'))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Panel title="Practice match">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <select className={`${inputClass} col-span-2`} aria-label="Opponent" value={opponent} onChange={(e) => setOpponent(e.target.value)}>
            <option value="self">A copy of yourself</option>
            {bots.map((b) => (
              <option key={b.key} value={b.key} title={b.description}>
                {botName(b.key)}
              </option>
            ))}
          </select>
          <p className="col-span-2 text-xs text-muted">Plays {game.name}</p>
          <label className="flex items-center gap-2 text-xs text-muted">
            Turns
            <input
              className={inputClass}
              type="number"
              min={1}
              max={500}
              value={turns}
              onChange={(e) => setTurns(e.target.valueAsNumber)}
              onBlur={() => setTurns((t) => clamp(t, 1, 500))}
            />
          </label>
          {game.usesNoise && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Random error %
            <input
              className={inputClass}
              type="number"
              title="The chance of a move being changed by accident"
              min={0}
              max={50}
              step={1}
              value={Number.isFinite(noise) ? Math.round(noise * 100) : ''}
              onChange={(e) => setNoise(e.target.valueAsNumber / 100)}
              onBlur={() => setNoise((n) => clamp(n, 0, 0.5))}
            />
          </label>
          )}
        </div>
        <Button onClick={run} disabled={busy || tooLong}>
          {busy ? 'Simulating…' : 'Run practice match'}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-alert">
            {error}
          </p>
        )}
        {result && (
          <div className="flex flex-col gap-2 text-sm">
            {result.forfeit && <p className="text-alert">{result.forfeit}</p>}
            <div className="flex justify-between">
              <span>You</span>
              <span className="font-bold tabular-nums">{result.score}</span>
            </div>
            {game.moves && <MoveStrip moves={result.my_moves} />}
            <div className="flex justify-between">
              <span>{opponent === 'self' ? 'Copy of you' : botName(opponent)}</span>
              <span className="font-bold tabular-nums">{result.opponent_score}</span>
            </div>
            {game.moves && <MoveStrip moves={result.opponent_moves} />}
          </div>
        )}
      </div>
    </Panel>
  )
}

/** What happened to the team's newest version, without having to open the history. */
export function LatestResult({ submission }: { submission: Schemas['SubmissionOut'] }) {
  const { version, status, errors, rule_problems: ruleProblems, test_results: tests } = submission
  return (
    <Panel title={`Latest version · v${version}`} right={<Badge status={status} />}>
      <div data-testid="latest-result" className="flex flex-col gap-2 text-sm">
        {status === 'checking' && <p className="text-amber">Testing in the sandbox…</p>}
        {status !== 'checking' && status !== 'accepted' && (
          <p className="text-alert">This version won't play. {errors.length ? 'Fix this and submit again:' : 'Submit a new version.'}</p>
        )}
        {errors.map((e, i) => (
          <p key={i} className="break-words text-xs text-alert">
            {e}
          </p>
        ))}
        {ruleProblems.map((p, i) => (
          <p key={i} className="text-xs text-amber">
            Cannot play this round: {p}
          </p>
        ))}
        {tests.length > 0 && (
          <div className="flex flex-col gap-1 text-xs">
            <span className="label !text-[10px]">Test matches · you – opponent</span>
            {tests.map((t) => (
              <p key={t.opponent} className="flex justify-between text-muted">
                <span>vs {botName(t.opponent)}</span>
                <span className="tabular-nums">
                  {t.score} – {t.opponent_score}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

export function History({ onLoad, opensAt }: { onLoad: (id: string, version: number) => void; opensAt: number | null | undefined }) {
  const { data: submissions = [], isError, refetch } = useSubmissions()
  const [open, setOpen] = useState<string | null>(null)

  return (
    <Panel title="Version history" bodyClass="p-0">
      {isError && submissions.length === 0 ? (
        <LoadFailed what="your versions" onRetry={() => refetch()} />
      ) : submissions.length === 0 ? (
        <Empty>No submissions yet.</Empty>
      ) : (
        <ul className="divide-y divide-steel">
          {submissions.map((s) => (
            <li key={s.id} className="px-4 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <button className="cursor-pointer text-left" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                  <span className="font-bold">v{s.version}</span>
                  <span className="ml-2 text-xs text-muted">{new Date(s.created_at * 1000).toLocaleTimeString()}</span>
                  {(opensAt == null || s.created_at < opensAt) && <span className="ml-2 text-xs text-muted">· earlier round</span>}
                  {s.module_count > 0 && (
                    <span className="ml-2 text-xs text-muted">
                      · {s.module_count} module{s.module_count > 1 ? 's' : ''}
                    </span>
                  )}
                </button>
                <span className="flex items-center gap-2">
                  <Badge status={s.status} />
                  <button className="label cursor-pointer !text-[10px] hover:!text-paper" onClick={() => onLoad(s.id, s.version)}>
                    Load
                  </button>
                </span>
              </div>
              {s.rule_problems.length > 0 && <p className="mt-1 text-xs text-amber">Cannot play this round: {s.rule_problems[0]}</p>}
              {open === s.id && (
                <div className="mt-2 flex flex-col gap-1 text-xs">
                  {s.errors.map((e, i) => (
                    <p key={i} className="break-words text-alert">
                      {e}
                    </p>
                  ))}
                  {s.test_results.map((t) => (
                    <p key={t.opponent} className="flex justify-between text-muted">
                      <span>vs {botName(t.opponent)}</span>
                      <span className="tabular-nums">
                        {t.score} – {t.opponent_score}
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
