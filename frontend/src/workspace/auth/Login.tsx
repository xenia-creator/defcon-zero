import { useEffect, useRef, useState, type FormEvent } from 'react'
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
    <div className="min-h-[4.25rem] space-y-0.5" aria-hidden>
      {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
        <div key={i} className={`boot-line boot-line-${i + 1}`}>
          {line}
        </div>
      ))}
    </div>
  )
}

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

      {/* Top line */}
      <header className="flex shrink-0 items-center justify-between gap-4 px-5 pt-4 sm:px-10 lg:px-16">
        <span className="flex items-center gap-3">
          <span className="h-3 w-1.5 bg-fire" aria-hidden />
          <span className="label !text-khaki tracking-[0.3em]">Field Command</span>
        </span>
        <span className="label !text-[10px] text-right tracking-[0.2em]">Secure terminal · Lab node</span>
      </header>

      <main className="flex flex-1 items-center px-5 py-3 sm:px-10 lg:px-16">
        <div className="flex w-full max-w-3xl flex-col gap-4 [@media(max-height:720px)]:gap-3">
          <BootSequence />

          <div>
            <p className="label mb-2 !text-khaki tracking-[0.28em]">
              Eyes only · Directorate of Game Theory · File 1983-RG
            </p>
            <h1 className="stencil weathered glow text-6xl leading-[0.95] tracking-[0.06em] text-paper sm:text-7xl [@media(max-height:760px)]:sm:text-6xl">
              DEFCON ZERO
            </h1>
            <p className="mt-2 font-label text-xl tracking-wide text-paper sm:text-2xl">
              Trust is a strategy. So is betrayal.
            </p>
          </div>

          {/* The clearance form: a worn sheet of paper */}
          <form onSubmit={submit} className="paper relative flex w-full max-w-md flex-col gap-3 px-6 pt-5 pb-5 sm:px-8">
            <span
              className="stamp stamp-land pointer-events-none absolute -top-4 -right-3 rotate-[-8deg] text-base text-type-red sm:-right-5 sm:text-lg"
              aria-hidden
            >
              Top secret
            </span>

            <div className="border-b-2 border-double border-type-muted pr-24 pb-2 sm:pr-28">
              <p className="font-label text-[11px] tracking-[0.24em] text-type-muted uppercase">
                Form DZ-1 · Request for clearance
              </p>
              <p className="mt-1 font-label text-xl tracking-[0.14em] uppercase">Identify yourself</p>
            </div>

            {/* Clearance denied feedback */}
            {denied && (
              <div className="self-start border-2 border-type-red px-2 py-1 -rotate-1">
                <p className="font-label text-sm tracking-widest text-type-red uppercase">
                  &gt; CLEARANCE DENIED
                </p>
              </div>
            )}

            {expired && !error && (
              <p className="font-label text-sm text-type-brass">
                Your session ended. Log in again; your draft is still here.
              </p>
            )}

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] font-bold tracking-[0.24em] text-type-muted uppercase">
                Callsign
              </span>
              <input
                className="paper-input"
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

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] font-bold tracking-[0.24em] text-type-muted uppercase">
                Access code
              </span>
              <input
                className="paper-input"
                aria-label="Password"
                placeholder="Password"
                type="password"
                autoComplete="current-password"
                maxLength={200}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {error && (
              <p role="alert" className="font-label text-sm text-type-red">
                {error}
              </p>
            )}

            <Button
              variant="primary"
              disabled={busy || !username.trim() || !password}
              className={`mt-1 py-2.5 tracking-[0.3em] ${paperPrimaryClass}`}
            >
              {busy ? 'Authenticating…' : 'Request Clearance'}
            </Button>

            <div className="flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-type-muted/50" />
              <span className="font-label text-xs tracking-widest text-type-muted uppercase">or</span>
              <span className="h-px flex-1 bg-type-muted/50" />
            </div>

            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              // View only: never signs in as anyone, so watching the board can't grant organiser access
              onClick={() => setSession(SPECTATOR_SESSION)}
              className="!border-type-ink !text-type-ink tracking-[0.2em] hover:!bg-type-ink hover:!text-paper"
            >
              View Big Board · War Map
            </Button>
          </form>
        </div>
      </main>

      <footer className="flex shrink-0 justify-between gap-4 px-5 pb-3 font-mono text-[10px] tracking-[0.18em] text-muted uppercase sm:px-10 lg:px-16" aria-hidden>
        <span>File 1983-RG · DGT</span>
        <span>Lat 48.8°N · Lon 2.3°E</span>
      </footer>
      <div className="film-grain" aria-hidden />
    </div>
  )
}
