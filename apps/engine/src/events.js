// Live events for the dashboard (Phase 3.5, Task 2).
// One in-process bus. Everything inside withRun(runId, fn) is tagged with that run_id through
// AsyncLocalStorage, every event passes the same secret masking as logs, and the last 5,000
// events of the last 20 runs are kept for late subscribers.

import { EventEmitter } from 'node:events'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mask, maskString, onLogLine } from './util/log.js'

export const EVENT_TYPES = Object.freeze([
  'run.started', 'run.finished', 'run.failed', 'run.cancelled',
  'step.started', 'step.finished', 'step.failed', 'step.cancelled', 'step.output',
  'ai.call', 'loop.route', 'log'
])
export const TERMINAL_TYPES = Object.freeze(['run.finished', 'run.failed', 'run.cancelled'])

export const MAX_EVENTS_PER_RUN = 5000
export const MAX_RUNS = 20
const MAX_DATA_CHARS = 4000

const bus = new EventEmitter()
bus.setMaxListeners(200)
const als = new AsyncLocalStorage()
const runs = new Map() // run_id → { seq, events: [] } in insertion order (oldest first)

/** Runs fn with run_id (and an optional abort signal) attached to everything it does. */
export function withRun(runId, fn, { signal } = {}) {
  return als.run({ runId, signal }, fn)
}
export const currentRunId = () => als.getStore()?.runId ?? null
export const currentSignal = () => als.getStore()?.signal ?? null

/** The run was cancelled (cancelRun). Agents never turn this into a warning. */
export class CancelledError extends Error {
  constructor(message = 'run cancelled') {
    super(message)
    this.name = 'CancelledError'
    this.kind = 'cancelled'
  }
}

/** Was this error caused by a cancel? (A CancelledError, or any error once the run's signal is aborted.) */
export function isCancel(error, signal = currentSignal()) {
  return error instanceof CancelledError || error?.name === 'CancelledError' || Boolean(signal?.aborted)
}

/** Throws CancelledError when the current run (or the given signal) has been cancelled. */
export function throwIfCancelled(signal = currentSignal()) {
  if (signal?.aborted) throw new CancelledError()
}

function bufferFor(runId) {
  let b = runs.get(runId)
  if (!b) {
    b = { seq: 0, events: [] }
    runs.set(runId, b)
    while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value)
  }
  return b
}

// Events carry summaries, never payloads: oversized data is replaced by its keys.
function smallData(data) {
  if (data === undefined) return undefined
  const masked = mask(data)
  const text = JSON.stringify(masked)
  if (text.length <= MAX_DATA_CHARS) return masked
  return { truncated: true, keys: Object.keys(masked ?? {}).slice(0, 30) }
}

/**
 * Emits an event for the current run (or fields.run_id). Returns the event, or null outside a run.
 * @param {string} type one of EVENT_TYPES
 */
export function emit(type, { run_id, agent, step, level, message, data } = {}) {
  const runId = run_id ?? currentRunId()
  if (!runId) return null
  const b = bufferFor(runId)
  const event = {
    run_id: runId,
    seq: ++b.seq,
    ts: new Date().toISOString(),
    type,
    ...(agent && { agent }),
    ...(step && { step }),
    ...(level && { level }),
    ...(message !== undefined && { message: maskString(String(message)) }),
    ...(data !== undefined && { data: smallData(data) })
  }
  b.events.push(event)
  if (b.events.length > MAX_EVENTS_PER_RUN) b.events.splice(0, b.events.length - MAX_EVENTS_PER_RUN)
  bus.emit('event', event)
  return event
}

/** Buffered events of a run with seq > afterSeq. */
export function replay(runId, afterSeq = 0) {
  return (runs.get(runId)?.events ?? []).filter((e) => e.seq > afterSeq)
}

/** Live events; runId limits them to one run. Returns an unsubscribe function. */
export function subscribe(fn, { runId } = {}) {
  const listener = (e) => {
    if (!runId || e.run_id === runId) fn(e)
  }
  bus.on('event', listener)
  return () => bus.off('event', listener)
}

/** run_ids with buffered events, newest last. */
export const bufferedRuns = () => [...runs.keys()]

/** Tests only. */
export function resetEvents() {
  runs.clear()
  bus.removeAllListeners('event')
}

// Every log line written inside a run becomes a `log` event (already masked by the logger).
onLogLine((entry) => {
  if (!currentRunId()) return
  const { time, level, msg, ...rest } = entry
  emit('log', { level, message: msg, ...(Object.keys(rest).length && { data: rest }) })
})

// ---------- helpers used by the agents ----------

/** Step name for a Scout sub-call: questions-3 → scout.questions.g3, facts → scout.facts. */
export function scoutStepName(call) {
  const m = /^questions-(\d)$/.exec(call)
  return m ? `scout.questions.g${m[1]}` : `scout.${call}`
}

/** Thread id without its random suffix (never the full id). */
export const threadPrefix = (threadId) => String(threadId ?? '').replace(/-[a-z0-9]{4,6}$/, '')
