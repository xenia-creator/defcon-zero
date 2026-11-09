import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Stamp } from '../../components/period'
import { Button, paperPrimaryClass } from '../../components/ui'
import { errorMessage, hasCode, request } from '../../lib/api'
import { SPECTATOR_SESSION, useAuth } from '../../lib/auth'
import { LoginOut, Team } from '../../lib/contract'

// Field telegraph, typed out one line at a time
const BOOT_LINES = [
  '> LINE TO HQ… ESTABLISHED',
  '> CIPHER KEY… VERIFIED',
  '> DEFCON STATUS: 3',
  '> AWAITING CLEARANCE_',
]

function BootSequence() {
  const [visibleLines, setVisibleLines] = useState(0)
  useEffect(() => {
    const timeouts = [200, 900, 1600, 2300].map((delay, i) =>
      setTimeout(() => setVisibleLines(i + 1), delay),
    )
    return () => timeouts.forEach(clearTimeout)
  }, [])
  return (
    // Fixed height for all four lines up front, so typing them in never moves anything below
    <div className="h-18 shrink-0" aria-hidden>
      {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
        <div key={i} className={`boot-line boot-line-${i + 1} !leading-[18px]`}>
          {line}
        </div>
      ))}
    </div>
  )
}

// A ruled line on the sheet: mono for what is typed, the placeholder in typewriter (muted ink, still AA) so an
// empty field never reads as filled, and an ink underline that thickens on focus. Important, because
// .paper-input is unlayered CSS.
const inputClass =
  'paper-input !bg-transparent !px-0 !font-data placeholder:font-label focus:!border-type-ink focus:!shadow-[0_2px_0_0_var(--color-type-ink)]'

export function Login() {
  const setSession = useAuth((s) => s.setSession)
  const expired = useAuth((s) => s.expired)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)
  const sending = useRef(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (sending.current || !username.trim() || !password) return
    sending.current = true
    setBusy(true)
    setError(null)
    setDenied(false)
    try {
      const name = username.trim()
      const answer = await request('POST', '/auth/login', LoginOut, { username: name, password })
      const team =
        answer.role === 'team'
          ? await request('GET', '/me', Team, undefined, {
              Authorization: `Bearer ${answer.access_token}`,
            })
          : null
      setSession({
        access: answer.access_token,
        username: team?.username ?? name.toLowerCase(),
        role: answer.role,
        team,
      })
    } catch (err) {
      setDenied(hasCode(err, 'INVALID_CREDENTIALS'))
      setError(
        errorMessage(err, 'Cannot reach the Command Server. Check your connection and try again.'),
      )
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-ink">
      {/* Hero: the soldier stands on the right, so the text column sits on the left over a dark gradient */}
      <div
        className="absolute inset-0 -z-20 bg-cover bg-[position:72%_center]"
        style={{ backgroundImage: "url('/hero.jpg')" }}
        aria-hidden
      />
      <div
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgb(10_12_13/0.94)_0%,rgb(10_12_13/0.9)_40%,rgb(10_12_13/0.5)_62%,rgb(10_12_13/0.1)_80%),linear-gradient(0deg,rgb(10_12_13/0.85)_0%,transparent_30%),linear-gradient(180deg,rgb(10_12_13/0.8)_0%,transparent_16%),radial-gradient(ellipse_at_center,transparent_55%,rgb(5_6_7/0.75)_100%)] max-lg:bg-[linear-gradient(180deg,rgb(10_12_13/0.7)_0%,rgb(10_12_13/0.9)_45%,rgb(10_12_13/0.94)_100%)]"
        aria-hidden
      />
      <div className="snow -z-10" aria-hidden />

      {/* Top-aligned, not centred: the error growing the form pushes only what is below it */}
      <main className="flex flex-1 items-start px-4 py-8 sm:px-10 lg:px-16">
        {/* From sm up the column is as wide as the title, so the sheet ends where "ZERO" ends */}
        <div className="flex w-full flex-col gap-6 sm:w-fit">
          <BootSequence />

          <div>
            <h1 className="font-title weathered glow -mr-[0.06em] text-4xl leading-[0.95] tracking-[0.06em] text-paper sm:text-6xl lg:text-7xl [@media(max-height:820px)]:lg:text-6xl">
              DEFCON ZERO
            </h1>
            <p className="mt-2 font-label text-lg tracking-wide text-paper sm:text-2xl">
              Trust is a strategy. So is betrayal.
            </p>
          </div>

          {/* The clearance form: a worn sheet of paper */}
          <form onSubmit={submit} className="paper-sheet flex w-full flex-col gap-4 p-6 !shadow-[inset_0_1px_0_rgb(255_255_255/0.15),inset_0_0_0_1px_rgb(35_31_26/0.18),0_32px_64px_-16px_rgb(0_0_0/0.8),0_12px_32px_-8px_rgb(0_0_0/0.55)] sm:p-8">
            <div className="flex items-center justify-between gap-2 border-b border-type-muted pb-4 sm:gap-4">
              <p className="font-title text-base tracking-[0.04em] whitespace-nowrap sm:text-xl sm:tracking-[0.08em]">Identify yourself</p>
              <span aria-hidden className="pointer-events-none shrink-0">
                <Stamp land className="text-xs text-type-ink sm:text-sm">
                  Top secret
                </Stamp>
              </span>
            </div>

            {expired && !error && (
              <p className="border-l-2 border-type-muted pl-4 font-label text-sm text-type-ink">
                Your session ended. Log in again; your draft is still here.
              </p>
            )}

            <label className="flex flex-col gap-2">
              <span className="font-label text-xs tracking-[0.2em] text-type-muted uppercase">Callsign</span>
              <input
                className={inputClass}
                aria-label="Username"
                placeholder="Username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                maxLength={100}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="font-label text-xs tracking-[0.2em] text-type-muted uppercase">Access code</span>
              <input
                className={inputClass}
                aria-label="Password"
                placeholder="Password"
                type="password"
                autoComplete="current-password"
                maxLength={200}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {/* One error block: the denial heading (wrong credentials only) over the message. A rule, not a box. */}
            {(denied || error) && (
              <div className="flex flex-col gap-1 border-l-2 border-type-red pl-4">
                {denied && (
                  <p className="font-label text-sm tracking-widest text-type-red uppercase">&gt; CLEARANCE DENIED</p>
                )}
                {error && (
                  <p role="alert" className="font-label text-sm text-type-red">
                    {error}
                  </p>
                )}
              </div>
            )}

            {/* Special Elite has a single weight: a hairline stroke in the text colour makes it bolder (paint, not a filter) */}
            <Button
              variant="primary"
              disabled={busy || !username.trim() || !password}
              className={`py-3 !font-label !text-sm tracking-[0.24em] [-webkit-text-stroke:0.6px_currentColor] ${paperPrimaryClass}`}
            >
              {busy ? 'Authenticating…' : 'Request Clearance'}
            </Button>

            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              // View only: never signs in as anyone, so watching the board can't grant organiser access
              onClick={() => setSession(SPECTATOR_SESSION)}
              className="self-center !border-transparent !px-0 py-2 !font-label !text-sm !font-normal !text-type-ink tracking-[0.2em] underline decoration-type-muted underline-offset-[6px] hover:decoration-type-ink hover:decoration-2"
            >
              View Big Board · War Map
            </Button>
          </form>
        </div>
      </main>
      <div className="film-grain" aria-hidden />
    </div>
  )
}
