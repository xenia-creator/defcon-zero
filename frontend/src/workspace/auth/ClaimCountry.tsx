import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Empty, LoadFailed, Panel, inputClass, useConfirm } from '../../components/ui'
import { ApiError, api, errorMessage, unwrap, type Schemas } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useCountries } from '../../lib/queries'

export function ClaimCountry({ user }: { user: Schemas['UserOut'] }) {
  const setUser = useAuth((s) => s.setUser)
  const queries = useQueryClient()
  const { data: countries = [], isPending, isError, refetch } = useCountries()
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const { dialog, ask } = useConfirm()

  const search = filter.trim().toLowerCase()
  const shown = useMemo(() => countries.filter((c) => c.name.toLowerCase().includes(search)), [countries, search])
  const chosen = countries.find((c) => c.code === selected)
  const freeCount = countries.filter((c) => !c.team_id).length

  // Another team can take it while this one is deciding
  useEffect(() => {
    if (chosen?.team_id) {
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
      const team = unwrap(await api.POST('/api/v1/teams/me/country', { body: { code } }))
      setUser({ ...user, team })
      queries.invalidateQueries({ queryKey: ['teams'] })
    } catch (err) {
      setError(errorMessage(err, 'Could not reach the server, so nothing was claimed. Try again.'))
      if (err instanceof ApiError) {
        setSelected(null)
        queries.invalidateQueries({ queryKey: ['countries'] })
        queries.invalidateQueries({ queryKey: ['teams'] })
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3 lg:flex-row">
      <Panel title="Available nations" right={<span className="label !text-amber">{freeCount} free</span>} className="min-h-0 min-w-0 flex-1" bodyClass="flex min-h-0 flex-col">
        <div className="border-b border-steel p-3">
          <input className={inputClass} aria-label="Search countries" placeholder="Search countries" maxLength={60} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isPending ? (
            <Empty>Loading nations…</Empty>
          ) : isError ? (
            <LoadFailed what="the list of nations" onRetry={() => refetch()} />
          ) : shown.length === 0 ? (
            <Empty>No country matches “{filter}”.</Empty>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
              {shown.map((c) => (
                <li key={c.code}>
                  <button
                    disabled={!!c.team_id}
                    onClick={() => setSelected(c.code)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected === c.code ? 'border-amber text-amber' : 'border-steel hover:border-paper'
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                    {c.team_id && <Badge status="taken" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      <Panel title="Claim your nation" className="shrink-0 lg:w-80">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{user.team?.name}, pick the country you will represent. Each country belongs to one team, and the choice is final.</p>
          <div className="border border-steel p-3">
            <span className="label">Selected</span>
            <p className="mt-1 text-xl font-bold tracking-widest break-words text-amber">{chosen ? chosen.name.toUpperCase() : '—'}</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-alert">
              {error}
            </p>
          )}
          <Button
            variant="primary"
            disabled={!chosen || busy}
            onClick={() =>
              chosen &&
              ask({
                title: 'Confirm your nation',
                body: `Claim ${chosen.name} for ${user.team?.name}? This can't be changed afterwards.`,
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
