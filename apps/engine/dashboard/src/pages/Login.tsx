// Shown only when the API answers 401 (DASHBOARD_AUTH=true). The engine sets an HttpOnly session cookie.
import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorMessage } from '../api/client'

/** Only same-app paths are followed after login (never another site). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/'
}

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/login', { method: 'POST', body: { password } })
      setPassword('')
      await qc.invalidateQueries()
      navigate(safeNext(params.get('next')), { replace: true })
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
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">The engine asks for the dashboard password.</p>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" className="btn-primary mt-4 w-full" disabled={busy || !password}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </div>
  )
}
