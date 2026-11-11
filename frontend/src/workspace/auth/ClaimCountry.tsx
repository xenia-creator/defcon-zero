import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileNumber, RedactionBar, Stamp } from '../../components/period'
import { Button, Empty, LoadFailed, Panel, inputClass, paperPrimaryClass, useConfirm } from '../../components/ui'
import { ApiError, errorMessage, hasCode, request } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Team, isClaimed } from '../../lib/contract'
import { keys, useTerritories } from '../../lib/queries'
import { useTour } from '../../tour/useTour'
import './ClaimCountry.css'

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

// A ruled line on the sheet, as on the login form: mono for what is typed, the placeholder in
// typewriter (muted ink, still AA), an ink underline that thickens on focus. Important, because
// .paper-input is unlayered CSS.
const paperInputClass =
  'paper-input !bg-transparent !px-0 !font-data placeholder:font-label focus:!border-type-ink focus:!shadow-[0_2px_0_0_var(--color-type-ink)]'

// The login sheet's lift off the background
const sheetShadow =
  '!shadow-[inset_0_1px_0_rgb(255_255_255/0.15),inset_0_0_0_1px_rgb(35_31_26/0.18),0_32px_64px_-16px_rgb(0_0_0/0.8),0_12px_32px_-8px_rgb(0_0_0/0.55)]'

// A small tag pinned flat to the paper casts a short shadow (the sheet's long one would darken Lock in below it on a phone)
const tagShadow =
  '!shadow-[inset_0_1px_0_rgb(255_255_255/0.15),inset_0_0_0_1px_rgb(35_31_26/0.18),0_8px_14px_-6px_rgb(0_0_0/0.55),0_2px_4px_rgb(0_0_0/0.3)]'

// A field label on the sheet: its number in mono, the words typed
const fieldLabelClass = 'flex items-baseline gap-2 font-label text-xs tracking-[0.2em] text-type-muted uppercase'

/** A khaki pencil tick in the field index margin. */
function PencilTick() {
  return (
    <svg aria-hidden width="20" height="16" viewBox="0 0 20 16" className="text-khaki">
      <path d="M2 9.5 C4 10.5 5.5 12 7 14.5 C10 8.5 13.5 4.5 18.5 1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The issued credential: a manila tag pinned to the sheet's corner, filled in as the form is.
 * Decorative (the form already says all of it), so screen readers skip it.
 */
function IdTag({ nation, code, rejected, issued }: { nation: string | null; code: string | null; rejected: boolean; issued: boolean }) {
  const manila = 'color-mix(in oklab, var(--color-khaki) 45%, transparent)'
  return (
    <div
      aria-hidden
      className={`paper-sheet relative flex w-full shrink-0 items-center gap-4 px-4 py-2 sm:w-40 sm:flex-col sm:gap-2 sm:py-4 ${tagShadow} ${issued ? 'claim-tag--swing' : ''}`}
      style={{ backgroundImage: `linear-gradient(${manila}, ${manila}), url('/paper.jpg')` }}
    >
      {/* Brass eyelet, with the pin that holds the tag to the sheet pushed through it */}
      <span className="relative grid size-5 shrink-0 place-items-center rounded-full border-[3px] border-type-brass bg-ink/85 shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_1px_0_rgb(255_255_255/0.3)]">
        <span className="size-3 rounded-full bg-[radial-gradient(circle_at_35%_30%,var(--color-paper),var(--color-khaki)_45%,var(--color-type-brass))] shadow-[1px_2px_2px_rgb(0_0_0/0.5)]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:w-full sm:items-center sm:gap-2">
        <span className="font-label text-xs tracking-[0.2em] text-type-muted uppercase">Identity tag</span>
        <span className="flex min-h-10 w-full items-center border-type-muted/60 font-label text-sm leading-tight tracking-[0.08em] break-words uppercase sm:justify-center sm:border-y sm:py-1 sm:text-center">
          {nation ? (
            <span className={rejected ? 'line-through decoration-type-red decoration-2' : ''}>{nation}</span>
          ) : (
            <RedactionBar width={10} />
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <NationEmblem name={nation ?? ''} size={32} />
        <span className="font-data text-3xl font-bold tracking-[0.12em]">{code ?? '––'}</span>
      </span>
      {/* Issued: a round seal pressed over the tag's corner on lock-in */}
      {issued && (
        <span className="claim-seal absolute right-24 -bottom-12 grid sm:-right-6 size-16 place-items-center rounded-full border-[3px] border-double border-type-ink bg-[var(--paper-base)]/60 font-label text-[11px] leading-tight tracking-[0.16em] text-type-ink uppercase [mask-image:repeating-linear-gradient(115deg,#000_0_6px,rgb(0_0_0/0.75)_6px_8px)]">
          <span className="text-center">
            Issued
            <span className="block font-data text-xs tracking-[0.08em]">{code}</span>
          </span>
        </span>
      )}
    </div>
  )
}

export function ClaimCountry({ username }: { username: string }) {
  const setTeam = useAuth((s) => s.setTeam)
  const queries = useQueryClient()
  const { data: territories = [], isPending, isError, refetch } = useTerritories()
  // The tour waits until the list has loaded (or failed and can be retried)
  useTour('claim', !isPending, { role: 'team' })
  const [selected, setSelected] = useState<string | null>(null)
  const [nationName, setNationName] = useState('')
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [justClaimed, setJustClaimed] = useState(false)
  const [nameTaken, setNameTaken] = useState(false) // styling only: marks the name line after NAME_TAKEN
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
      // Let the stamp land on the sheet, then enter the workspace (no motion: just a beat to read it)
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      setTimeout(() => setTeam(team), reduced ? 400 : 1100)
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
          setNameTaken(true)
          nameInputRef.current?.focus()
        }
        void queries.invalidateQueries({ queryKey: keys.territories })
        void queries.invalidateQueries({ queryKey: keys.me })
      }
      sending.current = false
      setBusy(false)
    }
  }

  const docket = `DZ-${(nameHash(username) % 9000) + 1000}`
  const validName = name && !nameProblem ? name : null
  const errorNote = error && (
    <p role="alert" className="border-l-2 border-type-red pl-4 font-label text-sm text-type-red">
      {error}
    </p>
  )

  return (
    <div className="relative isolate flex min-h-full flex-col gap-6 p-4 sm:p-6 lg:h-full lg:flex-row lg:items-start lg:gap-8 lg:p-8">
      {/* claim.jpg behind everything, darkened on the left where the index and sheet sit; the soldier on the right stays open */}
      <div
        className="absolute inset-0 -z-20 bg-cover bg-[position:right_center]"
        style={{ backgroundImage: "url('/claim.jpg')" }}
        aria-hidden
      />
      <div
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgb(10_12_13/0.93)_0%,rgb(10_12_13/0.86)_50%,rgb(10_12_13/0.35)_80%,rgb(10_12_13/0.15)_100%),linear-gradient(0deg,rgb(10_12_13/0.7)_0%,transparent_35%)] max-lg:bg-[linear-gradient(180deg,rgb(10_12_13/0.85),rgb(10_12_13/0.93))]"
        aria-hidden
      />

      {/* Field index: a dark field-kit ledger of regions, one rule per row, codes in mono */}
      <Panel
        title="Available territories"
        right={<span className="label !text-khaki tracking-widest">{territories.length ? `${freeCount} of ${territories.length} free` : `${freeCount} free`}</span>}
        className="min-h-0 min-w-0 shrink-0 max-lg:h-[36vh] lg:h-full lg:w-[25rem]"
        bodyClass="flex min-h-0 flex-col"
      >
        <div className="relative border-b border-steel p-4">
          <input
            className={`${inputClass} placeholder:text-muted focus:!border-khaki focus:!shadow-[inset_0_0_0_1px_var(--color-khaki)]`}
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
              className="label absolute top-1/2 right-8 -translate-y-1/2 cursor-pointer !text-xs hover:!text-paper"
            >
              Clear
            </button>
          )}
        </div>
        <div data-tour="claim-list" className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPending ? (
            <Empty>Loading territories…</Empty>
          ) : isError ? (
            <LoadFailed what="the list of territories" onRetry={() => refetch()} />
          ) : shown.length === 0 ? (
            <Empty>No country matches "{filter}".</Empty>
          ) : (
            <>
            {/* Column heads for the ledger, held at the top while it scrolls */}
            <div aria-hidden className="sticky top-0 z-10 grid grid-cols-[2rem_1fr_auto] gap-4 border-b border-steel bg-panel px-4 py-2 font-label text-xs tracking-[0.2em] text-muted uppercase">
              <span>Code</span>
              <span>Region</span>
            </div>
            <ul>
              {shown.map((t) => {
                const isSelected = selected === t.code
                // Our own claim landing (the stamp moment): still shown as ours, not as taken by someone else
                const ours = justClaimed && isSelected
                const takenByOther = t.claimed && !ours
                return (
                  <li key={t.code} className="border-b border-steel last:border-b-0">
                    <button
                      disabled={t.claimed}
                      aria-pressed={isSelected}
                      onClick={() => setSelected(t.code)}
                      className={`grid w-full cursor-pointer grid-cols-[2rem_1fr_auto] items-center gap-4 px-4 py-2 text-left leading-6 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-khaki disabled:cursor-not-allowed ${
                        isSelected ? 'bg-steel' : 'hover:bg-steel/50'
                      }`}
                    >
                      <span aria-hidden className="font-data text-xs tracking-[0.08em] text-khaki">
                        {t.code}
                      </span>
                      <span className={`truncate font-label tracking-wide ${takenByOther ? 'text-muted line-through decoration-muted' : 'text-paper'}`}>
                        {t.name}
                      </span>
                      {takenByOther ? (
                        <span className="font-label text-xs tracking-[0.2em] text-muted uppercase">taken</span>
                      ) : ours ? (
                        <span className="flex items-center gap-2 font-label text-xs tracking-[0.2em] text-khaki uppercase">
                          yours
                          <PencilTick />
                        </span>
                      ) : isSelected ? (
                        <PencilTick />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
            </>
          )}
        </div>
        {/* More rows below: the ledger fades into the panel rather than stopping on a cut row */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-panel to-transparent" />
        </div>
      </Panel>

      {/* The clearance document: the nation is registered on paper, and the tag is issued with it */}
      <section className={`paper-sheet relative flex w-full shrink-0 flex-col gap-6 p-6 sm:p-8 lg:w-[38rem] ${sheetShadow} ${justClaimed ? 'claim-sheet--filed' : ''}`}>
        {/* Once filed, the form fades back so the stamp reads clearly; the tag (being issued) stays crisp */}
        <div
          className={`flex flex-col gap-6 [&>*:not(.claim-tag-pin)]:transition-opacity [&>*:not(.claim-tag-pin)]:duration-300 motion-reduce:[&>*]:transition-none ${
            justClaimed ? '[&>*:not(.claim-tag-pin)]:opacity-40' : ''
          }`}
        >
          {/* Header and intro text leave room on the right for the tag pinned to the corner; the rule runs full width */}
          <div className="flex flex-col gap-4">
            <header data-tour="claim-form" className="flex flex-col gap-2 border-b border-type-muted pb-4 sm:pr-44">
              <p className="font-label text-xs tracking-[0.2em] text-type-muted uppercase">Form DZ-2 · Registration of nation</p>
              <h2 className="font-title text-2xl tracking-[0.06em] sm:text-3xl">Claim your nation</h2>
              <FileNumber number={docket} className="self-start text-type-muted" />
            </header>
            <p className="font-label text-sm leading-relaxed sm:pr-44">
              {username}, name your nation and pick its territory. Both are unique, and the choice is final.
            </p>
          </div>

          <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-2">
            <span className={fieldLabelClass}>
              <span aria-hidden className="font-data">01</span>
              Nation name
            </span>
            <input
              ref={nameInputRef}
              className={`${paperInputClass} ${nameTaken ? '!border-type-red focus:!border-type-red focus:!shadow-[0_2px_0_0_var(--color-type-red)]' : ''}`}
              aria-invalid={nameTaken || !!(name && nameProblem)}
              placeholder="e.g. Red Fox Republic"
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              value={nationName}
              onChange={(e) => {
                setNationName(e.target.value)
                setNameTaken(false)
              }}
            />
            <span className={`font-label text-xs ${name && nameProblem ? 'text-type-red' : 'text-type-muted'}`}>
              {name && nameProblem ? nameProblem : '3 to 24 letters, numbers or spaces.'}
            </span>
          </label>
          {/* A taken name is reported on its own line; any other error sits above Lock in */}
          {nameTaken && errorNote}
          </div>

          <div className="flex flex-col gap-2">
            <span className={fieldLabelClass}>
              <span aria-hidden className="font-data">02</span>
              Selected territory
            </span>
            <p className="flex min-h-11 items-baseline justify-between gap-4 border-b-[1.5px] border-type-muted pb-2">
              {chosen ? (
                <>
                  <span className="font-label text-2xl tracking-[0.06em] break-words">{chosen.name.toUpperCase()}</span>
                  <span className="font-data text-sm tracking-[0.08em] text-type-muted">{chosen.code}</span>
                </>
              ) : (
                <span className="font-label text-base text-type-muted">Pick one from the territory index.</span>
              )}
            </p>
          </div>

          {/* On a phone the tag sits in the flow; from sm up it is pinned over the corner */}
          <div className="claim-tag-pin max-sm:rotate-[-1deg] sm:absolute sm:-top-4 sm:right-8 sm:rotate-[3deg]">
            <IdTag nation={validName ? validName.toUpperCase() : null} code={chosen?.code ?? null} rejected={nameTaken} issued={justClaimed} />
          </div>

          {!nameTaken && errorNote}

          {/* Special Elite has a single weight: a hairline stroke in the text colour makes it bolder (paint, not a filter).
              Wrapped, so the filed fade reaches it (the paper button pins its own opacity when disabled). */}
          <div className="flex flex-col">
          <Button
            data-tour="claim-submit"
            variant="primary"
            disabled={!chosen || !!nameProblem || busy}
            className={`py-3 !font-label !text-sm tracking-[0.24em] [-webkit-text-stroke:0.6px_currentColor] ${paperPrimaryClass}`}
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
        </div>

        {/* Nation established: stamped onto the sheet itself on lock-in */}
        {justClaimed && (
          <div role="status" aria-live="polite" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Stamp tilt={-8} className="claim-stamp text-3xl text-type-ink sm:text-4xl">
              Nation Established
            </Stamp>
          </div>
        )}
      </section>
      {dialog}
    </div>
  )
}
