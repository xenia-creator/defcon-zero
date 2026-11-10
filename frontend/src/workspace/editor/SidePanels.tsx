import { useState } from 'react'
import { Badge, Empty, LoadFailed, Panel } from '../../components/ui'
import { isChecked, type SubmissionDetail } from '../../lib/contract'
import { useSubmission, useSubmissions } from '../../lib/queries'
import { assemble, generateModules, generateStrategy, handCodeOf, type StrategyConfig } from '../blocks/generate'
import { isStrategyLayout } from '../blocks/layout'
import { type Agent, parseAgent } from './drafts'

/**
 * What gets sent for an agent: the code as one file, and the block layouts. Whichever tab is open is what is sent:
 * - Build with blocks: strategy.py generated from the strategy block, which is stored as the one module;
 * - Write code: the team's code with its block modules after it.
 * The backend needs blocks even when there are none.
 */
export function submissionOf(agent: Agent, game: string, config: StrategyConfig) {
  if (agent.mode === 'blocks' && agent.strategy_blocks) {
    return { code: generateStrategy(agent.strategy_blocks, game, config).code, blocks: { modules: [agent.strategy_blocks] } }
  }
  return { code: assemble(agent.hand_code, generateModules(agent.modules, config.moves)), blocks: { modules: agent.modules } }
}

/** The POST /submissions body (docs/api.md section 5). */
export const toSubmission = (agent: Agent, game: string, config: StrategyConfig, roundId: number) => ({ round_id: roundId, ...submissionOf(agent, game, config) })

/**
 * A stored version back in the editor. One strategy-block layout means it was built with blocks, so it opens
 * in Build with blocks, and its Python goes into Write code to start from there. Anything else opens in Write code.
 */
export const agentFromDetail = (detail: SubmissionDetail): Agent | null => {
  const modules = detail.blocks?.modules ?? []
  if (modules.length === 1 && isStrategyLayout(modules[0])) return parseAgent({ hand_code: detail.code, modules: [], strategy_blocks: modules[0], mode: 'blocks' })
  return parseAgent({ hand_code: handCodeOf(detail.code), modules, mode: 'code' })
}

/** tit_for_tat reads as "Tit for tat". */
const botName = (key: string) => {
  const words = key.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const formatScore = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** Chip showing win / tie / loss for a single bot match */
function MatchChip({ myScore, oppScore }: { myScore: number; oppScore: number }) {
  const won = myScore > oppScore
  const tied = myScore === oppScore
  const color = won
    ? 'bg-coop'
    : tied
      ? 'bg-amber'
      : 'bg-alert'
  const symbol = won ? '✓' : tied ? '=' : '✕'
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center text-[10px] font-bold text-ink ${color}`}
      title={`You ${won ? 'won' : tied ? 'tied' : 'lost'}: ${formatScore(myScore)} – ${formatScore(oppScore)}`}
    >
      {symbol}
    </span>
  )
}

/** Intel advice from scores — mirrors the design doc's after-action panel */
function intelAdvice(tests: SubmissionDetail['tests']): string | null {
  if (!tests.length) return null
  const losses = tests.filter((t) => t.my_score < t.opp_score)
  if (!losses.length) return 'No losses against test bots. Well played.'
  const worst = losses.reduce((a, b) =>
    b.opp_score - b.my_score > a.opp_score - a.my_score ? b : a,
  )
  return `Intel: you lose to ${botName(worst.opponent)}. Adapt your strategy before the window closes.`
}

function TestResults({ tests }: { tests: SubmissionDetail['tests'] }) {
  const advice = intelAdvice(tests)
  return (
    <div className="flex flex-col gap-1">
      <span className="label !text-[10px] tracking-[0.2em]">After-action · test matches</span>
      {tests.map((t) => (
        <div key={t.opponent} className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted truncate">vs {botName(t.opponent)}</span>
          <span className="flex items-center gap-1.5 tabular-nums shrink-0">
            <MatchChip myScore={t.my_score} oppScore={t.opp_score} />
            <span className="text-muted">
              {formatScore(t.my_score)} – {formatScore(t.opp_score)}
            </span>
          </span>
        </div>
      ))}
      {advice && (
        <p className="mt-1 text-[11px] text-amber border-l-2 border-amber/50 pl-2 leading-relaxed">
          {advice}
        </p>
      )}
    </div>
  )
}

/** What happened to the team's newest version, without having to open the history. */
export function LatestResult({
  version,
  detail,
}: {
  version: number
  detail: SubmissionDetail | undefined
}) {
  const status = detail?.status ?? 'pending'
  const isAccepted = status === 'accepted'
  const isRejected = status === 'rejected'

  return (
    <Panel title={`Latest version · v${version}`} right={<Badge status={status} />}>
      <div data-testid="latest-result" className="flex flex-col gap-3 text-sm">
        {!isChecked(status) && (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 bg-amber blink" aria-hidden />
            <p className="text-xs text-amber tracking-wide">Testing against the built-in bots…</p>
          </div>
        )}

        {isAccepted && (
          <div className="flex items-center gap-2 border border-coop/30 bg-coop/5 px-2 py-1">
            <span className="font-mono text-[10px] tracking-[0.2em] text-coop uppercase">
              Orders received
            </span>
          </div>
        )}

        {isRejected && (
          <div className="border border-alert/30 bg-alert/5 px-2 py-1">
            <p className="font-mono text-[10px] tracking-[0.2em] text-alert uppercase">
              Orders rejected
            </p>
            {detail?.error && (
              <p className="mt-1 break-words text-xs text-alert">{detail.error}</p>
            )}
            <p className="mt-1 text-xs text-muted">
              This version won&apos;t play. Fix the problem and submit again.
            </p>
          </div>
        )}

        {detail && detail.tests.length > 0 && <TestResults tests={detail.tests} />}
      </div>
    </Panel>
  )
}

function VersionDetails({ id }: { id: number }) {
  const { data, isError, refetch } = useSubmission(id)
  if (isError) return <LoadFailed what="this version's results" onRetry={() => refetch()} />
  if (!data) return <p className="mt-2 text-xs text-muted">Loading…</p>
  return (
    <div className="mt-2 flex flex-col gap-1 text-xs">
      {data.error && <p className="break-words text-alert">{data.error}</p>}
      {data.tests.length > 0 && <TestResults tests={data.tests} />}
    </div>
  )
}

export function History({
  roundId,
  onLoad,
}: {
  roundId: number | undefined
  onLoad: (id: number, version: number) => void
}) {
  const { data: submissions = [], isPending, isError, refetch } = useSubmissions(roundId)
  const [open, setOpen] = useState<number | null>(null)

  return (
    <Panel title="Version history" bodyClass="p-0">
      {roundId !== undefined && isPending ? (
        <Empty>Loading versions…</Empty>
      ) : isError && submissions.length === 0 ? (
        <LoadFailed what="your versions" onRetry={() => refetch()} />
      ) : submissions.length === 0 ? (
        <Empty>No submissions yet.</Empty>
      ) : (
        <ul className="divide-y divide-steel">
          {submissions.map((s) => (
            <li key={s.id} className="px-4 py-2 text-sm transition-colors hover:bg-steel/20">
              <div className="flex items-center justify-between gap-2">
                <button
                  className="cursor-pointer text-left"
                  aria-expanded={open === s.id}
                  onClick={() => setOpen(open === s.id ? null : s.id)}
                >
                  <span className="font-bold tracking-wide">v{s.version}</span>
                  {s.createdAt !== null && (
                    <span className="ml-2 text-xs text-muted tabular-nums">
                      {new Date(s.createdAt).toLocaleTimeString()}
                    </span>
                  )}
                </button>
                <span className="flex items-center gap-2">
                  <Badge status={s.status} />
                  <button
                    className="label cursor-pointer !text-[10px] hover:!text-paper transition-colors"
                    onClick={() => onLoad(s.id, s.version)}
                  >
                    Load
                  </button>
                </span>
              </div>
              {open === s.id && <VersionDetails id={s.id} />}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
