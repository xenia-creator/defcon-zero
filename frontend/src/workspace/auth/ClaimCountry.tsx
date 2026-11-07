import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Empty, LoadFailed, Panel, inputClass, useConfirm } from '../../components/ui'
import { ApiError, errorMessage, hasCode, request } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Team, isClaimed } from '../../lib/contract'
import { keys, useTerritories } from '../../lib/queries'

const NAME_RULE = /^[A-Za-z0-9 ]{3,24}$/
const HAS_LETTER = /[A-Za-z]/

/** Trims spaces from both ends and collapses repeated spaces into one (docs/api.md section 3). */
export function cleanNationName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/** What's wrong with a nation name, or null. Follows docs/api.md v4 rules. */
export function nationNameProblem(raw: string): string | null {
  const name = cleanNationName(raw)
  if (name.length === 0) return 'Choose a nation name.'
  if (name.length < 3 || name.length > 24) return 'A nation name is 3 to 24 characters.'
  if (!NAME_RULE.test(name)) return 'A nation name can only use letters, numbers and spaces.'
  if (!HAS_LETTER.test(name)) return 'A nation name must include at least one letter.'
  return null
}

/** Deterministic emblem from nation name hash */
function nameHash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

const EMBLEM_COLORS = ['#f5a524', '#f0702a', '#e5243b', '#22c55e', '#4b7bec', '#a78bfa', '#e6e9ec', '#06b6d4']

type ShapeRenderer = (c: string) => string
const EMBLEM_SHAPES: ShapeRenderer[] = [
  (c) =>
    `<polygon points="27,4 50,27 27,50 4,27" fill="none" stroke="${c}" stroke-width="3"/><polygon points="27,16 38,27 27,38 16,27" fill="${c}"/>`,
  (c) =>
    `<circle cx="27" cy="27" r="22" fill="none" stroke="${c}" stroke-width="3"/><circle cx="27,27" r="8" fill="${c}"/>`.replace('cx="27,27"', 'cx="27" cy="27"'),
  (c) =>
    `<polygon points="27,5 50,47 4,47" fill="none" stroke="${c}" stroke-width="3"/><polygon points="27,24 36,41 18,41" fill="${c}"/>`,
  (c) =>
    `<rect x="6" y="6" width="42" height="42" fill="none" stroke="${c}" stroke-width="3"/><rect x="19" y="19" width="16" height="16" fill="${c}"/>`,
  (c) =>
    `<polygon points="27,4 47,16 47,38 27,50 7,38 7,16" fill="none" stroke="${c}" stroke-width="3"/><circle cx="27" cy="27" r="7" fill="${c}"/>`,
  (c) =>
    `<polygon points="27,4 33,21 50,21 36,31 41,48 27,38 13,48 18,31 4,21 21,21" fill="none" stroke="${c}" stroke-width="3"/>`,
]

function NationEmblem({ name, size = 48 }: { name: string; size?: number }) {
  if (!name.trim())
    return (
      <svg width={size} height={size} viewBox="0 0 54 54">
        <circle cx="27" cy="27" r="22" fill="none" stroke="var(--color-steel-light)" strokeWidth="2" />
      </svg>
    )
  const h = nameHash(name)
  const color = EMBLEM_COLORS[h % EMBLEM_COLORS.length]
  const shape = EMBLEM_SHAPES[Math.floor(h / EMBLEM_COLORS.length) % EMBLEM_SHAPES.length]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 54 54"
      dangerouslySetInnerHTML={{ __html: shape(color) }}
    />
  )
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
  const [justClaimed, setJustClaimed] = useState(false)
  const sending = useRef(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const { dialog, ask } = useConfirm()

  const search = filter.trim().toLowerCase()
  const shown = useMemo(
    () => territories.filter((t) => t.name.toLowerCase().includes(search)),
    [territories, search],
  )
  const chosen = territories.find((t) => t.code === selected)
  const freeCount = territories.filter((t) => !t.claimed).length
  const name = cleanNationName(nationName)
  const nameProblem = nationNameProblem(name)

  // Another team can take it while this one is deciding
  useEffect(() => {
    if (!sending.current && !justClaimed && chosen?.claimed) {
      setSelected(null)
      setError(`${chosen.name} was just claimed by another team. Pick another.`)
    }
  }, [chosen, justClaimed])

  async function claim(code: string) {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const team = await request('POST', '/teams/claim', Team, { territory_code: code, nation_name: name })
      setJustClaimed(true)
      void queries.invalidateQueries({ queryKey: keys.territories })
      setTimeout(() => setTeam(team), 400) // let the stamp animation land, then enter workspace
    } catch (err) {
      if (hasCode(err, 'ALREADY_CLAIMED')) {
        try {
          const me = await request('GET', '/me', Team)
          if (isClaimed(me)) {
            setTeam(me)
            return
          }
        } catch {
          // Fall through to show the server's error message if /me could not be read
        }
      }
      setError(errorMessage(err, 'Could not reach the server, so nothing was claimed. Try again.'))
      if (err instanceof ApiError) {
        if (hasCode(err, 'TERRITORY_TAKEN')) {
          setSelected(null)
        } else if (hasCode(err, 'NAME_TAKEN')) {
          nameInputRef.current?.focus()
        }
        void queries.invalidateQueries({ queryKey: keys.territories })
        void queries.invalidateQueries({ queryKey: keys.me })
      }
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3 lg:flex-row">
      {/* Nation established stamp — full-screen reveal on lock-in */}
      {justClaimed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 tactical-grid">
          <div className="stamp stamp-land text-4xl text-coop rotate-[-6deg] shadow-[0_0_40px_var(--color-coop)]">
            Nation Established
          </div>
        </div>
      )}

      {/* Territory list */}
      <Panel
        title="Available territories"
        right={<span className="label !text-amber tracking-widest">{freeCount} free</span>}
        className="min-h-0 min-w-0 flex-1"
        bodyClass="flex min-h-0 flex-col"
      >
        <div className="border-b border-steel p-3">
          <input
            className={inputClass}
            aria-label="Search countries"
            placeholder="Search countries…"
            maxLength={60}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isPending ? (
            <Empty>Loading territories…</Empty>
          ) : isError ? (
            <LoadFailed what="the list of territories" onRetry={() => refetch()} />
          ) : shown.length === 0 ? (
            <Empty>No country matches "{filter}".</Empty>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
              {shown.map((t) => (
                <li key={t.code}>
                  <button
                    disabled={t.claimed}
                    onClick={() => setSelected(t.code)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 border px-3 py-2 text-left text-sm transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected === t.code
                        ? 'border-amber text-amber shadow-[0_0_10px_-4px_var(--color-amber)] bg-amber/5'
                        : 'border-steel hover:border-paper'
                    }`}
                  >
                    <span className="truncate tracking-wide">{t.name}</span>
                    {t.claimed && <Badge status="taken" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {/* Claim side panel */}
      <Panel title="Claim your nation" className="shrink-0 lg:w-80">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted tracking-wide">
            {username}, name your nation and pick its territory. Both are unique, and the choice is
            final.
          </p>

          <label className="flex flex-col gap-1">
            <span className="label tracking-[0.2em]">Nation name</span>
            <input
              ref={nameInputRef}
              className={inputClass}
              placeholder="Red Fox Republic"
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              value={nationName}
              onChange={(e) => setNationName(e.target.value)}
            />
            <span className={`text-xs ${name && nameProblem ? 'text-alert' : 'text-muted'}`}>
              {name && nameProblem ? nameProblem : '3 to 24 letters, numbers or spaces.'}
            </span>
          </label>

          {/* Live emblem preview */}
          {name && !nameProblem && (
            <div className="flex items-center gap-3 border border-steel/60 bg-ink/40 p-3">
              <NationEmblem name={name} size={42} />
              <div>
                <p className="font-mono text-[10px] tracking-[0.2em] text-muted uppercase">Emblem</p>
                <p className="font-bold tracking-widest text-paper">{name.toUpperCase()}</p>
              </div>
            </div>
          )}

          <div className="border border-steel p-3">
            <span className="label tracking-[0.2em]">Selected territory</span>
            <p className="mt-1 text-xl font-bold tracking-widest break-words text-amber drop-shadow-[0_0_8px_var(--color-amber)]">
              {chosen ? chosen.name.toUpperCase() : '—'}
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-alert border border-alert/30 bg-alert/10 px-2 py-1">
              {error}
            </p>
          )}

          <Button
            variant="primary"
            disabled={!chosen || !!nameProblem || busy}
            className="tracking-[0.3em]"
            onClick={() =>
              chosen &&
              ask({
                title: 'Confirm your nation',
                body: `Claim ${chosen.name} as ${name}? This can't be changed afterwards.`,
                confirmLabel: 'Lock in',
                run: () => claim(chosen.code),
              })
            }
          >
            {busy ? 'Claiming…' : 'Lock in'}
          </Button>
        </div>
      </Panel>
      {dialog}
    </div>
  )
}
