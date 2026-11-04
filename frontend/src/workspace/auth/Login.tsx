import { useRef, useState, type FormEvent } from 'react'
import { Button, inputClass } from '../../components/ui'
import { api, errorMessage, unwrap } from '../../lib/api'
import { useAuth } from '../../lib/auth'

export function Login() {
  const setSession = useAuth((s) => s.setSession)
  const expired = useAuth((s) => s.expired)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (sending.current || !username.trim() || !password) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const pair = unwrap(await api.POST('/api/v1/auth/login', { body: { username: username.trim(), password } }))
      setSession({ access: pair.access_token, refresh: pair.refresh_token, user: pair.user })
    } catch (err) {
      setError(errorMessage(err, 'Cannot reach the Command Server. Check your connection and try again.'))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-steel bg-ink/90 px-5">
        <span className="h-3 w-3 bg-alert shadow-[0_0_12px_var(--color-alert)]" />
        <span className="ml-3 text-lg font-bold tracking-[0.3em] text-alert">DEFCON ZERO</span>
      </header>
      <main className="flex flex-1 items-center justify-center p-5">
        <div className="relative flex w-full max-w-5xl flex-col items-center gap-10 border border-steel bg-panel/70 px-6 py-14">
          <span className="stamp absolute top-6 right-6 hidden rotate-[8deg] text-2xl text-alert sm:block">Top secret</span>
          <div className="text-center">
            <p className="label mb-5">Eyes only · Directorate of Game Theory · File 1983-RG</p>
            <h1 className="glow text-5xl font-bold tracking-[0.18em] text-alert sm:text-7xl">DEFCON ZERO</h1>
            <p className="mt-5 font-[family-name:var(--font-type)] text-xl sm:text-2xl">Trust is a strategy. So is betrayal.</p>
          </div>
          <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 border border-steel bg-ink/70 p-6">
            <span className="label">Identify yourself</span>
            {expired && !error && <p className="text-sm text-amber">Your session ended. Log in again; your draft is still here.</p>}
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
            {error && (
              <p role="alert" className="text-sm text-alert">
                {error}
              </p>
            )}
            <Button variant="primary" disabled={busy || !username.trim() || !password}>
              {busy ? 'Authenticating…' : 'Enter'}
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
