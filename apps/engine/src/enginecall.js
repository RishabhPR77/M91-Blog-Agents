// CLI → the running engine (Phase 9 A4). A command that changes data goes through the engine's API when
// the engine is up on this machine, so the engine's index stays current and the dashboard needs no refresh.
// Otherwise (engine down, or dashboard login on: the CLI has no session) the command works directly, and the
// write marker tells the engine that Mem0 changed.
import { sleep as defaultSleep } from './util/retry.js'

/** The engine's base URL when it answers /api/health and needs no login; else null. */
export async function engineUrl(config, { fetch = globalThis.fetch, timeoutMs = 1500 } = {}) {
  if (config?.dashboard?.auth) return null
  const base = `http://127.0.0.1:${config?.server?.port ?? 8080}`
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const body = await res.json()
    return body?.ok ? base : null
  } catch {
    return null
  }
}

export class EngineCallError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message)
    this.name = 'EngineCallError'
    this.status = status
    this.code = code
  }
}

async function call(base, path, { method = 'GET', body, fetch }) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  if (!res.ok) throw new EngineCallError(json?.error?.message ?? `the engine answered HTTP ${res.status}`, { status: res.status, code: json?.error?.code ?? null })
  return json
}

/**
 * Starts a run on the engine and waits for it (run detail polls are served from the engine's index: 0 Mem0).
 * Returns the same shape as the run manager's wait(): { status, run, run_id, error? }.
 */
export async function runViaEngine(base, { mode, params = {}, dryRun, fetch = globalThis.fetch, sleepFn = defaultSleep, pollMs = 2000, onStart = () => {} }) {
  const { run_id: runId } = await call(base, '/api/runs', { method: 'POST', body: { mode, params, ...(dryRun !== undefined && { dry_run: dryRun }) }, fetch })
  onStart(runId)
  for (;;) {
    await sleepFn(pollMs)
    let detail
    try {
      detail = await call(base, `/api/runs/${runId}`, { fetch })
    } catch (error) {
      if (error.status === 404) continue
      throw error
    }
    const run = detail.run ?? {}
    if (run.status && run.status !== 'running') return { status: run.status, run, run_id: runId, ...(run.status !== 'succeeded' && { error: run.result_summary }) }
  }
}

/** The other engine routes the CLI uses. */
export const engineApi = {
  addPin: (base, pin, { fetch = globalThis.fetch } = {}) => call(base, '/api/pinned', { method: 'POST', body: pin, fetch }),
  cancelPin: (base, pinnedId, { fetch = globalThis.fetch } = {}) => call(base, `/api/pinned/${encodeURIComponent(pinnedId)}`, { method: 'DELETE', fetch }),
  deleteLesson: (base, id, { fetch = globalThis.fetch } = {}) => call(base, `/api/lessons/${encodeURIComponent(id)}`, { method: 'DELETE', fetch }),
  // The timely lane: the cards, and one action on a card (no AI).
  timely: (base, { fetch = globalThis.fetch } = {}) => call(base, '/api/timely', { fetch }),
  timelyAction: (base, id, body, { fetch = globalThis.fetch } = {}) => call(base, `/api/timely/${encodeURIComponent(id)}`, { method: 'POST', body, fetch }),
  // Phase 11: the Markdown export of a reviewed draft, built by the engine (read from its index; nothing saved).
  markdown: (base, briefId, version, { fetch = globalThis.fetch } = {}) => call(base, `/api/approvals/${encodeURIComponent(briefId)}/markdown${version ? `?version=${version}` : ''}`, { fetch })
}
