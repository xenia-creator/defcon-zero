import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Empty, LoadFailed, Panel, inputClass, paperPrimaryClass, useConfirm } from '../../components/ui'
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

// Printing inks, drawn on the paper claim sheet (all dark enough to read on paper.jpg)
const EMBLEM_COLORS = ['#7a2418', '#54411a', '#2f4a5c', '#3d4a22', '#7a3510', '#231f1a', '#4b3a55', '#2d5552']

type ShapeRenderer = (c: string) => string
const EMBLEM_SHAPES: ShapeRenderer[] = [
  (c) =>
    `<polygon points="27,4 50,27 27,50 4,27" fill="none" stroke="${c}" stroke-width="3"/><polygon points="27,16 38,27 27,38 16,27" fill="${c}"/>`,
  (c) =>
    `<circle cx="27" cy="27" r="22" fill="none" stroke="${c}" stroke-width="3"/><circle cx="27" cy="27" r="8" fill="${c}"/>`,
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
        <circle cx="27" cy="27" r="22" fill="none" stroke="var(--color-type-muted)" strokeWidth="2" strokeDasharray="3 3" />
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
    <div className="relative isolate flex min-h-full flex-col gap-4 p-3 sm:p-5 lg:h-full lg:flex-row lg:items-stretch">
      {/* claim.jpg behind everything, darkened on the left where the list sits; the column on the right stays open */}
      <div
        className="absolute inset-0 -z-20 bg-cover bg-[position:right_center]"
        style={{ backgroundImage: "url('/claim.jpg')" }}
        aria-hidden
      />
      <div
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgb(10_12_13/0.93)_0%,rgb(10_12_13/0.86)_50%,rgb(10_12_13/0.35)_80%,rgb(10_12_13/0.15)_100%),linear-gradient(0deg,rgb(10_12_13/0.7)_0%,transparent_35%)] max-lg:bg-[linear-gradient(180deg,rgb(10_12_13/0.85),rgb(10_12_13/0.93))]"
        aria-hidden
      />

      {/* Nation established stamp — full-screen reveal on lock-in */}
      {justClaimed && (
        <div role="status" aria-live="polite" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85">
          <div className="paper px-10 py-8">
            <div className="stamp stamp-land rotate-[-6deg] text-4xl text-type-olive">Nation Established</div>
          </div>
        </div>
      )}

      {/* Territory list: a dark field-kit panel the image shows faintly through */}
      <Panel
        title="Available territories"
        right={<span className="label !text-khaki tracking-widest">{territories.length ? `${freeCount} of ${territories.length} free` : `${freeCount} free`}</span>}
        className="min-h-0 min-w-0 flex-1 !bg-ink/75 max-lg:min-h-[60vh] lg:max-w-4xl"
        bodyClass="flex min-h-0 flex-col"
      >
        <div className="relative border-b border-steel p-3">
          <input
            className={inputClass}
            aria-label="Search countries"
            placeholder="Search countries…"
            maxLength={60}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              className="label absolute top-1/2 right-6 -translate-y-1/2 cursor-pointer !text-[10px] hover:!text-paper"
            >
              Clear
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isPending ? (
            <Empty>Loading territories…</Empty>
          ) : isError ? (
            <LoadFailed what="the list of territories" onRetry={() => refetch()} />
          ) : shown.length === 0 ? (
            <Empty>No country matches "{filter}".</Empty>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
              {shown.map((t) => (
                <li key={t.code}>
                  <button
                    disabled={t.claimed}
                    onClick={() => setSelected(t.code)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      selected === t.code
                        ? 'border-fire bg-fire/10 text-fire'
                        : 'border-steel bg-panel/60 hover:border-khaki hover:bg-panel'
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

      {/* Claim sheet: the nation is registered on paper */}
      <section className="paper relative flex shrink-0 flex-col gap-4 self-start p-5 max-lg:w-full lg:w-96">
        <header className="border-b-2 border-double border-type-muted pb-3">
          <p className="font-label text-[11px] tracking-[0.24em] text-type-muted uppercase">
            Form DZ-2 · Registration of nation
          </p>
          <h2 className="stencil mt-1 text-2xl tracking-[0.08em]">Claim your nation</h2>
        </header>

        <p className="font-label text-sm leading-relaxed text-type-muted">
          {username}, name your nation and pick its territory. Both are unique, and the choice is final.
        </p>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] font-bold tracking-[0.24em] text-type-muted uppercase">Nation name</span>
          <input
            ref={nameInputRef}
            className="paper-input"
            placeholder="Red Fox Republic"
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            value={nationName}
            onChange={(e) => setNationName(e.target.value)}
          />
          <span className={`font-label text-xs ${name && nameProblem ? 'text-type-red' : 'text-type-muted'}`}>
            {name && nameProblem ? nameProblem : '3 to 24 letters, numbers or spaces.'}
          </span>
        </label>

        {/* Live emblem preview */}
        {name && !nameProblem && (
          <div className="flex items-center gap-3 border border-dashed border-type-muted/70 p-3">
            <NationEmblem name={name} size={42} />
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-bold tracking-[0.2em] text-type-muted uppercase">Emblem</p>
              <p className="truncate font-label text-lg tracking-widest">{name.toUpperCase()}</p>
            </div>
          </div>
        )}

        <div className="border-y border-type-muted/60 py-3">
          <span className="font-mono text-[10px] font-bold tracking-[0.24em] text-type-muted uppercase">Selected territory</span>
          <p className="stencil mt-1 text-2xl break-words">{chosen ? chosen.name.toUpperCase() : '—'}</p>
        </div>

        {error && (
          <p role="alert" className="border-l-2 border-type-red bg-type-red/5 px-2 py-1 font-label text-sm text-type-red">
            {error}
          </p>
        )}

        <Button
          variant="primary"
          disabled={!chosen || !!nameProblem || busy}
          className={`py-2.5 tracking-[0.3em] ${paperPrimaryClass}`}
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
      </section>
      {dialog}
    </div>
  )
}
