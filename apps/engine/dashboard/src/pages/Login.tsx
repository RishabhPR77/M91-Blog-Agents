// Shown only when the API answers 401 (the login is on). The engine sets an HttpOnly session cookie. With the admin
// login (always on when hosted) it asks for the admin ID and password; otherwise for the dashboard password only.
// A link opened from Slack arrives without the (SameSite=Strict) cookie and lands here: when the session is in fact
// valid, the page goes on at once. A download (/api/...) is opened as a full page, not inside the dashboard.
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorMessage } from '../api/client'
import type { Health } from '../api/types'

/** Only same-app paths are followed after login (never another site). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/'
}

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  // Without a session /api/health says only how to log in.
  const health = useQuery({ queryKey: ['login-mode'], queryFn: () => api<Health>('/api/health'), retry: false, meta: { silent: true } })
  const admin = health.data?.login === 'admin'
  const next = safeNext(params.get('next'))
  const go = (to: string) => (to.startsWith('/api/') ? window.location.assign(to) : navigate(to, { replace: true }))
  // A full health answer (it has the version) means the session is valid: no need to log in again.
  const signedIn = Boolean((health.data as { version?: string } | undefined)?.version)
  useEffect(() => {
    if (signedIn) go(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/login', { method: 'POST', body: admin ? { username, password } : { password } })
      setPassword('')
      await qc.invalidateQueries()
      go(next)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="mb-1 text-lg font-semibold">Log in</h1>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{admin ? 'Log in with the admin ID and password.' : 'The engine asks for the dashboard password.'}</p>
        {admin && (
          <>
            <label className="label" htmlFor="username">Admin ID</label>
            <input id="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} className="input mb-3" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </>
        )}
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" className="btn-primary mt-4 w-full" disabled={busy || health.isPending || !password || (admin && !username)}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </div>
  )
}
