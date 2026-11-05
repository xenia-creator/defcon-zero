import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Empty, LoadFailed, Panel, inputClass, useConfirm } from '../../components/ui'
import { ApiError, errorMessage, request } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Team } from '../../lib/contract'
import { useTerritories } from '../../lib/queries'

const NAME_RULE = /^[A-Za-z0-9 ]{3,24}$/

/** What's wrong with a nation name, or null. The server checks again, and alone knows if it is taken. */
export function nationNameProblem(name: string): string | null {
  if (name.length === 0) return 'Choose a nation name.'
  if (name.length < 3 || name.length > 24) return 'A nation name is 3 to 24 characters.'
  return NAME_RULE.test(name) ? null : 'A nation name can only use letters, numbers and spaces.'
}

export function ClaimCountry({ username }: { username: string }) {
  const setTeam = useAuth((s) => s.setTeam)
  const queries = useQueryClient()
  const { data: territories = [], isPending, isError, refetch } = useTerritories()
  const [selected, setSelected] = useState<string | null>(null)
  const [nationName, setNationName] = useState('')
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const { dialog, ask } = useConfirm()

  const search = filter.trim().toLowerCase()
  const shown = useMemo(() => territories.filter((t) => t.name.toLowerCase().includes(search)), [territories, search])
  const chosen = territories.find((t) => t.code === selected)
  const freeCount = territories.filter((t) => !t.claimed).length
  const name = nationName.trim()
  const nameProblem = nationNameProblem(name)

  // Another team can take it while this one is deciding
  useEffect(() => {
    if (chosen?.claimed) {
      setSelected(null)
      setError(`${chosen.name} was just claimed by another team. Pick another.`)
    }
  }, [chosen])

  async function claim(code: string) {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const team = await request('POST', '/teams/claim', Team, { territory_code: code, nation_name: name })
      setTeam(team)
    } catch (err) {
      setError(errorMessage(err, 'Could not reach the server, so nothing was claimed. Try again.'))
      if (err instanceof ApiError) {
        if (err.code === 'TERRITORY_TAKEN') setSelected(null)
        queries.invalidateQueries({ queryKey: ['territories'] })
        queries.invalidateQueries({ queryKey: ['team'] })
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3 lg:flex-row">
      <Panel title="Available territories" right={<span className="label !text-amber">{freeCount} free</span>} className="min-h-0 min-w-0 flex-1" bodyClass="flex min-h-0 flex-col">
        <div className="border-b border-steel p-3">
          <input className={inputClass} aria-label="Search countries" placeholder="Search countries" maxLength={60} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isPending ? (
            <Empty>Loading territories…</Empty>
          ) : isError ? (
            <LoadFailed what="the list of territories" onRetry={() => refetch()} />
          ) : shown.length === 0 ? (
            <Empty>No country matches “{filter}”.</Empty>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
              {shown.map((t) => (
                <li key={t.code}>
                  <button
                    disabled={t.claimed}
                    onClick={() => setSelected(t.code)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected === t.code ? 'border-amber text-amber' : 'border-steel hover:border-paper'
                    }`}
                  >
                    <span className="truncate">{t.name}</span>
                    {t.claimed && <Badge status="taken" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      <Panel title="Claim your nation" className="shrink-0 lg:w-80">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{username}, name your nation and pick its territory. Both are unique, and the choice is final.</p>
          <label className="flex flex-col gap-1">
            <span className="label">Nation name</span>
            <input className={inputClass} placeholder="Red Fox Republic" maxLength={24} autoComplete="off" spellCheck={false} value={nationName} onChange={(e) => setNationName(e.target.value)} />
            <span className={`text-xs ${name && nameProblem ? 'text-alert' : 'text-muted'}`}>{name && nameProblem ? nameProblem : '3 to 24 letters, numbers or spaces.'}</span>
          </label>
          <div className="border border-steel p-3">
            <span className="label">Selected territory</span>
            <p className="mt-1 text-xl font-bold tracking-widest break-words text-amber">{chosen ? chosen.name.toUpperCase() : '—'}</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-alert">
              {error}
            </p>
          )}
          <Button
            variant="primary"
            disabled={!chosen || !!nameProblem || busy}
            onClick={() =>
              chosen &&
              ask({
                title: 'Confirm your nation',
                body: `Claim ${chosen.name} as ${name}? This can't be changed afterwards.`,
                confirmLabel: 'Claim nation',
                run: () => claim(chosen.code),
              })
            }
          >
            {busy ? 'Claiming…' : 'Claim this nation'}
          </Button>
        </div>
      </Panel>
      {dialog}
    </div>
  )
}
