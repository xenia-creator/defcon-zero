import { useState } from 'react'
import { Badge, Empty, LoadFailed, Panel } from '../../components/ui'
import { isChecked, type SubmissionDetail } from '../../lib/contract'
import { useSubmission, useSubmissions } from '../../lib/queries'
import { assemble, generateModules, handCodeOf } from '../blocks/generate'
import { type Agent, parseAgent } from './drafts'

/** What POST /submissions takes: the code as one file, and the block layouts. The backend needs blocks even when there are none. */
export const toSubmission = (agent: Agent, moves: string[], roundId: number) => ({
  round_id: roundId,
  code: assemble(agent.hand_code, generateModules(agent.modules, moves)),
  blocks: { modules: agent.modules },
})

/** A stored version back in the editor: the team's own code and its blocks. */
export const agentFromDetail = (detail: SubmissionDetail): Agent | null => parseAgent({ hand_code: handCodeOf(detail.code), modules: detail.blocks?.modules ?? [] })

/** tit_for_tat reads as "Tit for tat". */
const botName = (key: string) => {
  const words = key.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function TestResults({ tests }: { tests: SubmissionDetail['tests'] }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="label !text-[10px]">Test matches · you – opponent</span>
      {tests.map((t) => (
        <p key={t.opponent} className="flex justify-between text-muted">
          <span>vs {botName(t.opponent)}</span>
          <span className="tabular-nums">
            {t.my_score} – {t.opp_score}
          </span>
        </p>
      ))}
    </div>
  )
}

/** What happened to the team's newest version, without having to open the history. */
export function LatestResult({ version, detail }: { version: number; detail: SubmissionDetail | undefined }) {
  const status = detail?.status ?? 'pending'
  return (
    <Panel title={`Latest version · v${version}`} right={<Badge status={status} />}>
      <div data-testid="latest-result" className="flex flex-col gap-2 text-sm">
        {!isChecked(status) && <p className="text-amber">Testing against the built-in bots…</p>}
        {status === 'rejected' && <p className="text-alert">This version won't play. {detail?.error ? 'Fix this and submit again:' : 'Submit a new version.'}</p>}
        {detail?.error && <p className="break-words text-xs text-alert">{detail.error}</p>}
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

export function History({ roundId, onLoad }: { roundId: number | undefined; onLoad: (id: number, version: number) => void }) {
  const { data: submissions = [], isError, refetch } = useSubmissions(roundId)
  const [open, setOpen] = useState<number | null>(null)

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
                  {s.createdAt !== null && <span className="ml-2 text-xs text-muted">{new Date(s.createdAt).toLocaleTimeString()}</span>}
                </button>
                <span className="flex items-center gap-2">
                  <Badge status={s.status} />
                  <button className="label cursor-pointer !text-[10px] hover:!text-paper" onClick={() => onLoad(s.id, s.version)}>
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
