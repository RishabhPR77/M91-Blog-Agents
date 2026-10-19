// Mem0 call counter: every HTTP request the store sends to Mem0 (each retry counts), per run and per API
// request. A scope is an AsyncLocalStorage store, so calls made by concurrent requests or by a run that a
// request started are each counted once, in the innermost scope (a run's own scope replaces the request's).
//   reads:    record gets, list pages (getAll) and add-event status polls
//   searches: semantic searches
//   writes:   adds, updates and deletes
//   cache_hits: answered from the in-process read cache (no request sent)
// Note: Mem0's quota error named list (getAll) calls "SEARCH" events, so compare quotas with reads + searches.
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage()
const totals = blankCounts()

export function blankCounts() {
  return { reads: 0, searches: 0, writes: 0, cache_hits: 0 }
}

/** Count one call of a kind in the current scope (if any) and in the process totals. */
export function countMem0(kind, n = 1) {
  if (!(kind in totals)) return
  totals[kind] += n
  const scope = als.getStore()
  if (scope) scope[kind] += n
}

/** Runs fn in a new counting scope. Returns { counts, result } (result is fn's return value, maybe a promise). */
export function withMem0Count(fn) {
  const counts = blankCounts()
  return { counts, result: als.run(counts, fn) }
}

/** The current scope's counts (a live object), or null outside any scope. */
export const currentMem0Counts = () => als.getStore() ?? null

/** Process totals since start (a copy). */
export const mem0Totals = () => ({ ...totals })

/** Requests sent = reads + searches + writes (cache hits are free). */
export const mem0Requests = (c) => (c ? c.reads + c.searches + c.writes : 0)
