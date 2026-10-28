// Mem0's own monthly limit (seen live on 2026-10-28: "Monthly retrieval limit reached (1000 of 1000)", reset on the
// 19th, the account's billing day, not the 1st). When Mem0 refuses a request for this reason, the engine stops treating
// it as an unknown "internal error": the error says what happened and until when, the quota guard records Mem0's own
// figures and reset date (src/util/mem0usage.js), and new runs are refused before they send anything.

const LIMIT_RE = /monthly (retrieval|add|search|memory|request)s? limit (is )?reached/i

/** Mem0's JSON error inside an error message, or null. */
function bodyOf(text) {
  try {
    return JSON.parse(text)
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

const whole = (x) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : null)

/**
 * { kind: 'retrievals' | 'adds', limit, used, reset_at, event_type, next_step_url } when the error is Mem0's monthly
 * limit, else null. A short burst limit ("too many requests") is not the monthly limit and gives null.
 */
export function mem0LimitOf(error) {
  if (!error) return null
  if (error.name === 'Mem0LimitError' && error.info) return error.info
  const text = String(error.message ?? error)
  const body = bodyOf(text)
  const message = String(body?.error ?? text)
  if (!LIMIT_RE.test(message)) return null
  const reset = Date.parse(body?.quota_reset ?? '')
  return {
    kind: /\badd\b|\bmemory\b/i.test(message.match(LIMIT_RE)?.[1] ?? '') ? 'adds' : 'retrievals',
    limit: whole(body?.quota_limit),
    used: whole(body?.quota_used),
    reset_at: Number.isFinite(reset) ? new Date(reset).toISOString() : null,
    event_type: body?.event_type ?? null,
    next_step_url: typeof body?.next_step_url === 'string' ? body.next_step_url : null
  }
}

const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'its next reset')

/** The sentence people see. */
export function limitMessage(info) {
  const what = info.kind === 'adds' ? 'add' : 'retrieval'
  const figures = info.used !== null && info.limit !== null ? ` (${info.used} of ${info.limit})` : ''
  return `Mem0's monthly ${what} limit is reached${figures}. Mem0 resets it on ${dateOf(info.reset_at)}; until then the engine cannot ${info.kind === 'adds' ? 'save' : 'read'} its data, so runs and lists wait. To go on sooner, raise the limit in Mem0${info.next_step_url ? ` (${info.next_step_url})` : ''}.`
}

export class Mem0LimitError extends Error {
  constructor(info) {
    super(limitMessage(info))
    this.name = 'Mem0LimitError'
    this.code = 'mem0_quota'
    this.status = 429
    this.info = info
  }
}
