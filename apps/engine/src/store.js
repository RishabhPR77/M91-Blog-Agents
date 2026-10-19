// Mem0 hosted Platform store. One record = one memory under agent_id MEM0_AGENT_ID,
// run_id = brief_id when it belongs to a post, content = JSON string of the payload.
// mem0ai v3: add() is asynchronous (returns an event to poll); entity ids go in `filters` for reads.

import { randomUUID } from 'node:crypto'
import { getConfig } from './config.js'
import { log } from './util/log.js'
import { sleep, retry } from './util/retry.js'
import { istDate } from './util/time.js'

export const RECORD_TYPES = Object.freeze([
  'question_cluster', 'story_lead', 'tutorial_lead', 'tone_profile', 'brief', 'draft',
  'review', 'promo_pack', 'run_log', 'lesson', 'lock', 'm91_facts', 'source_pack', 'pinned_topic', 'run', 'setting', 'published_post', 'block_doc'
])

// Statuses used across record types. brief: new → superseded (re-brief) / approved (Reviewer pass).
export const BRIEF_STATUSES = Object.freeze(['new', 'active', 'drafted', 'awaiting_human', 'superseded', 'approved', 'rejected', 'published', 'failed'])
// draft: drafted | drafted_with_issues → awaiting_human (Reviewer pass) → approved | changes_requested | rejected; failed_review; superseded.
export const DRAFT_STATUSES = Object.freeze(['drafted', 'drafted_with_issues', 'awaiting_human', 'changes_requested', 'approved', 'rejected', 'failed_review', 'superseded'])
export const LEAD_STATUSES = Object.freeze(['open', 'used', 'discarded', 'expired', 'cancelled'])

// Payload schemas per type are filled in by later phases.
export const RECORD_SCHEMAS = Object.freeze(Object.fromEntries(RECORD_TYPES.map((t) => [t, Object.freeze({})])))

const MEM0_HOST = 'https://api.mem0.ai'

/** Retry window for repeat-safe Mem0 calls; random() in [0.5, 1) keeps every wait at least half its cap. */
export const MEM0_RETRY = Object.freeze({ retries: 5, baseMs: 2000, maxMs: 15000, random: () => 0.5 + Math.random() / 2 })

/** A failed connection (not an HTTP answer): fetch's "fetch failed", resets, timeouts, DNS. */
export function isNetworkError(error) {
  if (!error) return false
  const code = error.cause?.code ?? error.code ?? ''
  return (error.name === 'TypeError' && /fetch failed/i.test(error.message)) ||
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_[A-Z_]+)$/.test(code) ||
    error.name === 'TimeoutError' || /socket hang up|network error/i.test(error.message ?? '')
}

export class StoreError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'StoreError'
    if (details !== undefined) this.details = details
  }
}

async function defaultClientFactory(apiKey) {
  // Opt out of the SDK's usage telemetry; it is read when the module loads.
  process.env.MEM0_TELEMETRY ??= 'false'
  const { MemoryClient } = await import('mem0ai')
  return new MemoryClient({ apiKey })
}

function tryParse(text) {
  if (typeof text !== 'string') return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// Mem0 can hand metadata numbers and booleans back as strings ("1", "false"); these keys are turned back
// into numbers / booleans so "1" + 1 is 2 (not "11") and "false" is not truthy.
const NUMERIC_META = ['version', 'brief_version', 'review_total', 'total']
const BOOLEAN_META = ['pass', 'test', 'dry_run']

function toNumber(v) {
  if (v == null || v === '') return null
  return Number.isNaN(Number(v)) ? v : Number(v)
}

/** Metadata with the numeric and boolean keys above restored to their real types. */
export function normalizeMetadata(md = {}) {
  const out = { ...md }
  for (const k of NUMERIC_META) if (k in out) out[k] = toNumber(out[k])
  for (const k of BOOLEAN_META) if (out[k] === 'true' || out[k] === 'false') out[k] = out[k] === 'true'
  return out
}

/** A Mem0 memory → our record shape. */
export function toRecord(memory) {
  const md = normalizeMetadata(memory?.metadata ?? {})
  return {
    id: memory.id,
    type: md.type,
    briefId: md.brief_id ?? null,
    status: md.status ?? null,
    version: md.version ?? null,
    topicGroup: md.topic_group ?? null,
    date: md.date ?? null,
    payload: tryParse(memory.memory ?? memory.data?.memory),
    metadata: md,
    createdAt: memory.createdAt ?? memory.created_at ?? null,
    updatedAt: memory.updatedAt ?? memory.updated_at ?? null
  }
}

function matches(record, filters = {}) {
  const want = {
    type: filters.type,
    brief_id: filters.brief_id ?? filters.briefId,
    status: filters.status,
    version: filters.version,
    topic_group: filters.topic_group ?? filters.topicGroup
  }
  return Object.entries(want).every(([k, v]) => v === undefined || record.metadata?.[k] === v)
}

/**
 * @param {{ config?: object, clientFactory?: Function, fetch?: Function, sleepFn?: Function, eventTimeoutMs?: number }} deps
 */
// testTag: smoke tests mark every record they create with metadata.test = true, so cleanup can find them.
export function createStore({ config = getConfig(), clientFactory = defaultClientFactory, fetch = globalThis.fetch, sleepFn = sleep, eventTimeoutMs = 60000, eventPollMs = 1000, dryRun = config.runtime.dryRun, testTag = false } = {}) {
  const { apiKey, agentId } = config.mem0
  // DRY_RUN rule: no Mem0 writes, except run_log records, which carry dry_run: true.
  // Reads still happen. Skipped writes return a placeholder record with a "dryrun-" id.
  const DRY_ID = 'dryrun-'
  // DRY_RUN still writes run_log and run records (they carry dry_run: true) so dry runs show in history.
  const skipWrite = (type) => dryRun && type !== 'run_log' && type !== 'run'
  let clientPromise
  const client = () => (clientPromise ??= clientFactory(apiKey))

  // Mem0 calls that are safe to repeat (reads, update/delete by id, event polls) retry network blips
  // (seen live: one "fetch failed" ended a run; another blip outlasted 3 tries in ~3 s). Up to 5
  // retries with "equal jitter" (each wait is half to all of 2, 4, 8, 15, 15 s), so a blip of
  // ~22–55 s is ridden out. New-record writes are not retried, since a retry after a lost reply
  // could save a second copy.
  const net = (fn, what) => retry(fn, {
    ...MEM0_RETRY,
    sleepFn,
    shouldRetry: isNetworkError,
    onRetry: (error, attempt, delay) => log.warn('Mem0 network error; retrying', { what, attempt, delay_ms: delay, error })
  })

  const entityFilters = (briefId) => (briefId ? { AND: [{ agent_id: agentId }, { run_id: briefId }] } : { agent_id: agentId })

  /** Polls GET /v1/event/<id>/ until the add has been processed. */
  async function waitForEvent(eventId) {
    const deadline = Date.now() + eventTimeoutMs
    while (Date.now() < deadline) {
      const res = await net(() => fetch(`${MEM0_HOST}/v1/event/${encodeURIComponent(eventId)}/`, { headers: { Authorization: `Token ${apiKey}` } }), 'event')
      if (!res.ok) throw new StoreError(`Mem0 event lookup failed with HTTP ${res.status}`)
      const event = await res.json()
      if (event.status === 'SUCCEEDED') return event
      if (event.status === 'FAILED') throw new StoreError('Mem0 add event FAILED', { eventId })
      await sleepFn(eventPollMs)
    }
    throw new StoreError(`Mem0 add event not finished after ${eventTimeoutMs} ms`, { eventId })
  }

  async function listAll(briefId) {
    const c = await client()
    const out = []
    for (let page = 1; page <= 50; page++) {
      const res = await net(() => c.getAll({ filters: entityFilters(briefId), page, pageSize: 100 }), 'list')
      const results = Array.isArray(res) ? res : res?.results ?? []
      out.push(...results)
      if (Array.isArray(res) || !res?.next || results.length === 0) break
    }
    return out
  }

  /**
   * Stores one record verbatim (infer=false) and returns it with its memory id.
   * meta: extra metadata (e.g. a draft's brief_version); it never overrides the fields above it.
   */
  async function createRecord({ type, payload, briefId, status = null, version = null, topicGroup = null, date = istDate(), meta = {} }) {
    if (!RECORD_TYPES.includes(type)) throw new StoreError(`Unknown record type "${type}"`)
    const recordKey = randomUUID()
    const metadata = { ...meta, ...(testTag && { test: true }), type, brief_id: briefId ?? null, status, version, topic_group: topicGroup, date, record_key: recordKey }
    if (type === 'run_log' || type === 'run') {
      metadata.dry_run = dryRun
      payload = { ...payload, dry_run: dryRun }
    }
    if (skipWrite(type)) {
      log.info('DRY_RUN: Mem0 write skipped', { type, briefId })
      return { id: `${DRY_ID}${recordKey}`, type, briefId: briefId ?? null, status, version, topicGroup, date, payload, metadata, dryRun: true }
    }
    const c = await client()
    const added = await c.add([{ role: 'user', content: JSON.stringify(payload ?? {}) }], {
      agentId,
      ...(briefId && { runId: briefId }),
      metadata,
      infer: false
    })
    const eventId = added?.eventId ?? added?.event_id
    let id = Array.isArray(added) ? added[0]?.id : undefined
    if (!id && eventId) {
      const event = await waitForEvent(eventId)
      id = event.results?.find?.((r) => r?.id)?.id ?? event.results?.[0]?.memory_id
    }
    if (!id) {
      // The event did not name the memory: find it by the unique record_key we attached.
      const found = (await listAll(briefId)).find((m) => m.metadata?.record_key === recordKey)
      id = found?.id
    }
    if (!id) throw new StoreError('Mem0 stored the record but its memory id could not be found', { type, eventId })
    log.debug('store create', { type, id, briefId })
    return { id, type, briefId: briefId ?? null, status, version, topicGroup, date, payload, metadata }
  }

  /** Updates one record in place by memory id (never adds a second copy). Metadata is merged. */
  async function updateRecord(id, payload, metadata = {}) {
    // run records are kept up to date in DRY_RUN too (the caller marks them with metadata.type = 'run').
    if (dryRun && metadata.type !== 'run') {
      log.info('DRY_RUN: Mem0 update skipped', { id })
      return { id, payload, metadata, dryRun: true }
    }
    const c = await client()
    const current = await net(() => c.get(id), 'get')
    const merged = { ...(current?.metadata ?? {}), ...metadata }
    await net(() => c.update(id, { ...(payload !== undefined && { text: JSON.stringify(payload) }), metadata: merged }), 'update')
    return toRecord({ ...current, id, metadata: merged, memory: payload !== undefined ? JSON.stringify(payload) : current?.memory })
  }

  /** One record by memory id, or null (also null for another agent's memory). */
  async function getRecord(id) {
    const c = await client()
    let m
    try {
      m = await net(() => c.get(id), 'get')
    } catch {
      return null
    }
    if (!m || (m.agentId ?? m.agent_id) && (m.agentId ?? m.agent_id) !== agentId) return null
    return toRecord({ ...m, id: m.id ?? id })
  }

  /** Records under our agent_id, filtered by type / brief_id / status / version / topic_group. */
  async function getRecords(filters = {}) {
    const briefId = filters.brief_id ?? filters.briefId
    return (await listAll(briefId)).map(toRecord).filter((r) => matches(r, filters))
  }

  /** One record of a type for a brief; the given version, else the highest. */
  async function getOne(type, briefId, version) {
    const records = await getRecords({ type, brief_id: briefId, ...(version !== undefined && { version }) })
    return records.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null
  }

  async function searchSimilar(text, filters = {}) {
    const c = await client()
    const briefId = filters.brief_id ?? filters.briefId
    const res = await net(() => c.search(text, { filters: entityFilters(briefId), topK: filters.topK ?? 10 }), 'search')
    const results = Array.isArray(res) ? res : res?.results ?? []
    return results.map((m) => ({ ...toRecord(m), score: m.score ?? null })).filter((r) => matches(r, filters))
  }

  /**
   * A free-text lesson; Mem0 extracts the facts and merges similar lessons (infer=true). Returns the add event.
   * meta: extra metadata, e.g. { source: 'reviewer', brief_id } (Phase 5 C3); type and date are always set.
   */
  async function addLesson(text, meta = {}) {
    if (dryRun) {
      log.info('DRY_RUN: lesson not stored', { lesson: text, ...meta })
      return { eventId: null, status: 'DRY_RUN' }
    }
    const c = await client()
    const added = await c.add([{ role: 'user', content: text }], { agentId, metadata: { ...meta, ...(testTag && { test: true }), type: 'lesson', date: istDate() }, infer: true })
    return { eventId: added?.eventId ?? added?.event_id ?? null, status: added?.status ?? null }
  }

  /** Tests and lock release only. */
  async function deleteRecord(id) {
    if (dryRun || String(id).startsWith(DRY_ID)) return
    const c = await client()
    await net(() => c.delete(id), 'delete')
  }

  return { dryRun, createRecord, updateRecord, getRecord, getRecords, getOne, searchSimilar, addLesson, deleteRecord }
}

let defaultStore
export function getStore() {
  defaultStore ??= createStore()
  return defaultStore
}
