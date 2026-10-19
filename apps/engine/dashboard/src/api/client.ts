// The only way the dashboard talks to the engine: same-origin /api/* calls. No keys, tokens or .env values
// ever live in browser code; with DASHBOARD_AUTH=true the session is an HttpOnly cookie set by the engine.

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError

type Options = { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; signal?: AbortSignal }

let onUnauthorized: (() => void) | null = null
/** Called on any 401 except from /api/login itself (the app sends the user to the login page). */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

/** Calls the engine API. Errors become ApiError with the engine's { error: { code, message } } shape. */
export async function api<T>(path: string, { method = 'GET', body, signal }: Options = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new ApiError(0, 'bad_path', `only /api/* paths are allowed (got ${path})`)
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new ApiError(0, 'network', 'Cannot reach the engine. Is it running?')
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } | string } | null)?.error
    const code = typeof err === 'object' && err?.code ? err.code : `http_${res.status}`
    const message = typeof err === 'object' && err?.message ? err.message : typeof err === 'string' ? err : res.statusText || `HTTP ${res.status}`
    if (res.status === 401 && path !== '/api/login') onUnauthorized?.()
    throw new ApiError(res.status, code, message)
  }
  return json as T
}

/** A short, human message for any error (used by toasts). */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}
