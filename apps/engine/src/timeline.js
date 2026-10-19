// The compact timeline saved in a run record (Phase 6), so a finished run can still be shown after the
// engine restarts and the in-memory event buffer is gone. It keeps the step boundaries, step summaries,
// routing decisions, approval events, AI calls (compact) and warn/error log lines; never info log lines,
// post text, prompts or secrets. Events are already masked by emit(); messages are cut short here too.

export const TIMELINE_MAX = 300
const MESSAGE_MAX = 500
const STRING_MAX = 200
const ARRAY_MAX = 20

const STEP_TYPES = new Set(['step.started', 'step.finished', 'step.failed', 'step.cancelled'])
const KEEP_MESSAGE = new Set(['step.failed', 'step.cancelled', 'step.output', 'loop.route', 'run.started'])

const cut = (s, max) => (s.length > max ? `${s.slice(0, max)}…` : s)

/** Small values only: primitives (strings cut), arrays of primitives, and one level of nested objects. */
export function compactData(data, depth = 0) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string') out[k] = cut(v, STRING_MAX)
    else if (Array.isArray(v)) {
      if (v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x))) out[k] = v.slice(0, ARRAY_MAX).map((x) => (typeof x === 'string' ? cut(x, STRING_MAX) : x))
    } else if (depth === 0) {
      const inner = compactData(v, 1)
      if (inner && Object.keys(inner).length) out[k] = inner
    }
  }
  return out
}

/** One event → a timeline entry, or null when the event is not kept. */
export function timelineEntry(e) {
  const base = { seq: e.seq, ts: e.ts, type: e.type, ...((e.step ?? e.agent) && { step: e.step ?? e.agent }) }
  const message = e.message === undefined ? undefined : cut(String(e.message), MESSAGE_MAX)
  if (e.type === 'ai.call') {
    const d = e.data ?? {}
    return { ...base, ...(d.call && { call: d.call }), model: d.model ?? null, delivery: d.delivery ?? null, ms: d.ms ?? null, retries: d.retries ?? 0, finish_reason: d.finish_reason ?? null }
  }
  if (e.type === 'log') {
    if (e.level !== 'warn' && e.level !== 'error') return null
    return { ...base, level: e.level, ...(message !== undefined && { message }) }
  }
  const keep = STEP_TYPES.has(e.type) || e.type === 'step.output' || e.type === 'loop.route' || e.type.startsWith('approval.') || e.type.startsWith('run.')
  if (!keep) return null
  const data = compactData(e.data)
  return {
    ...base,
    ...(message !== undefined && (KEEP_MESSAGE.has(e.type) || e.type.startsWith('approval.') || e.type.startsWith('run.')) && { message }),
    ...(data && Object.keys(data).length && { data })
  }
}

/** Adds an event to a run's timeline (in place), keeping the last TIMELINE_MAX entries. Returns true if kept. */
export function addToTimeline(run, e, max = TIMELINE_MAX) {
  const entry = timelineEntry(e)
  if (!entry) return false
  run.timeline ??= []
  run.timeline.push(entry)
  if (run.timeline.length > max) {
    const drop = run.timeline.length - max
    run.timeline.splice(0, drop)
    run.timeline_dropped = (run.timeline_dropped ?? 0) + drop
  }
  return true
}
