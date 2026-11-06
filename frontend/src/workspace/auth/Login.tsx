import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, inputClass } from '../../components/ui'
import { errorMessage, request } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { LoginOut, Team } from '../../lib/contract'

const BOOT_LINES = [
  '> ESTABLISHING SECURE LINK… OK',
  '> VERIFYING TERMINAL… OK',
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
    <div className="mb-4 space-y-1 font-mono text-[11px] text-coop">
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
      setSession({ access: answer.access_token, username: name, role: answer.role, team })
    } catch (err) {
      setDenied(true)
      setError(
        errorMessage(err, 'Cannot reach the Command Server. Check your connection and try again.'),
      )
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col tactical-grid">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center border-b border-steel bg-ink/95 px-5 panel-3d">
        <span className="h-3 w-3 bg-alert shadow-[0_0_14px_2px_var(--color-alert)] blink" aria-hidden />
        <span className="ml-3 text-lg font-bold tracking-[0.3em] text-alert glow logo-flicker">
          DEFCON ZERO
        </span>
        <span className="ml-auto font-mono text-[10px] tracking-[0.2em] text-muted uppercase">
          Secure terminal · Lab node
        </span>
      </header>

      <main className="flex flex-1 items-center justify-center p-5">
        <div className="relative w-full max-w-5xl border border-steel bg-panel/70 panel-3d">
          {/* Corner decorations */}
          <span className="absolute top-0 left-0 h-6 w-6 border-r border-b border-amber/40" aria-hidden />
          <span className="absolute top-0 right-0 h-6 w-6 border-l border-b border-amber/40" aria-hidden />
          <span className="absolute bottom-0 left-0 h-6 w-6 border-r border-t border-amber/40" aria-hidden />
          <span className="absolute bottom-0 right-0 h-6 w-6 border-l border-t border-amber/40" aria-hidden />

          {/* Top secret stamp */}
          <span
            className="stamp stamp-land absolute top-6 right-8 hidden rotate-[-8deg] text-2xl text-alert sm:block"
            aria-hidden
          >
            Top secret
          </span>

          {/* Telemetry coords */}
          <span
            className="absolute bottom-3 left-4 font-mono text-[9px] tracking-[0.18em] text-steel-light uppercase"
            aria-hidden
          >
            File 1983-RG · DGT
          </span>
          <span
            className="absolute bottom-3 right-4 font-mono text-[9px] tracking-[0.18em] text-steel-light uppercase"
            aria-hidden
          >
            Lat 48.8°N · Lon 2.3°E
          </span>

          <div className="flex flex-col items-center gap-10 px-6 py-14">
            {/* Boot log — left-aligned on larger screens */}
            <div className="w-full max-w-sm self-start">
              <BootSequence />
            </div>

            <div className="text-center">
              <p className="label mb-5 tracking-[0.3em]">
                Eyes only · Directorate of Game Theory · File 1983-RG
              </p>
              <h1 className="glow text-5xl font-bold tracking-[0.18em] text-alert sm:text-7xl logo-flicker">
                DEFCON ZERO
              </h1>
              <p className="mt-5 font-[family-name:var(--font-type)] text-xl sm:text-2xl tracking-wide">
                Trust is a strategy. So is betrayal.
              </p>
            </div>

            <form
              onSubmit={submit}
              className="flex w-full max-w-sm flex-col gap-4 border border-steel bg-ink/70 p-6 panel-3d"
            >
              <div className="flex items-center justify-between">
                <span className="label tracking-[0.3em]">Identify yourself</span>
                <span className="font-mono text-[9px] tracking-[0.14em] text-steel-light uppercase">
                  ENCRYPTED
                </span>
              </div>

              {/* Clearance denied feedback */}
              {denied && (
                <div className="border border-alert/40 bg-alert/10 p-2">
                  <p className="font-mono text-xs tracking-widest text-alert uppercase">
                    &gt; CLEARANCE DENIED
                  </p>
                </div>
              )}

              {expired && !error && (
                <p className="text-sm text-amber">
                  Your session ended. Log in again; your draft is still here.
                </p>
              )}

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] tracking-[0.24em] text-muted uppercase">
                  Callsign
                </span>
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

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] tracking-[0.24em] text-muted uppercase">
                  Access code
                </span>
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

              {error && !denied && (
                <p role="alert" className="text-sm text-alert">
                  {error}
                </p>
              )}

              <Button
                variant="primary"
                disabled={busy || !username.trim() || !password}
                className="mt-1 tracking-[0.3em]"
              >
                {busy ? 'Authenticating…' : 'Request Clearance'}
              </Button>

              <div className="relative my-2 flex items-center justify-center">
                <span className="h-px w-full bg-steel" />
                <span className="absolute bg-ink px-2 font-mono text-[9px] uppercase tracking-widest text-muted">or</span>
              </div>

              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                // View only: never signs in as anyone, so watching the board can't grant organiser access
                onClick={() => setSession({ access: 'spectator_token', username: 'spectator', role: 'spectator', team: null })}
                className="tracking-[0.2em] border-steel text-muted hover:!text-amber hover:border-amber"
              >
                👁️ View Big Board · War Map
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
