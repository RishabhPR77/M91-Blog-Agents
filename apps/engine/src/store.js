// Mem0 hosted Platform store. One record = one memory under agent_id MEM0_AGENT_ID,
// run_id = brief_id when it belongs to a post, content = JSON string of the payload.
// mem0ai v3: add() is asynchronous (returns an event to poll); entity ids go in `filters` for reads.

import { randomUUID } from 'node:crypto'
import { getConfig } from './config.js'
import { log } from './util/log.js'
import { sleep } from './util/retry.js'
import { istDate } from './util/time.js'

export const RECORD_TYPES = Object.freeze([
  'question_cluster', 'story_lead', 'tutorial_lead', 'tone_profile', 'brief', 'draft',
  'review', 'promo_pack', 'run_log', 'lesson', 'lock', 'm91_facts', 'source_pack', 'pinned_topic'
])

// Statuses used across record types. brief: new → superseded (re-brief) / approved (Reviewer pass).
export const BRIEF_STATUSES = Object.freeze(['new', 'active', 'superseded', 'approved', 'published', 'failed'])
export const LEAD_STATUSES = Object.freeze(['open', 'used', 'discarded', 'expired', 'cancelled'])

// Payload schemas per type are filled in by later phases.
export const RECORD_SCHEMAS = Object.freeze(Object.fromEntries(RECORD_TYPES.map((t) => [t, Object.freeze({})])))

const MEM0_HOST = 'https://api.mem0.ai'

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

/** A Mem0 memory → our record shape. */
export function toRecord(memory) {
  const md = memory?.metadata ?? {}
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
export function createStore({ config = getConfig(), clientFactory = defaultClientFactory, fetch = globalThis.fetch, sleepFn = sleep, eventTimeoutMs = 60000, eventPollMs = 1000, dryRun = config.runtime.dryRun } = {}) {
  const { apiKey, agentId } = config.mem0
  // DRY_RUN rule: no Mem0 writes, except run_log records, which carry dry_run: true.
  // Reads still happen. Skipped writes return a placeholder record with a "dryrun-" id.
  const DRY_ID = 'dryrun-'
  const skipWrite = (type) => dryRun && type !== 'run_log'
  let clientPromise
  const client = () => (clientPromise ??= clientFactory(apiKey))

  const entityFilters = (briefId) => (briefId ? { AND: [{ agent_id: agentId }, { run_id: briefId }] } : { agent_id: agentId })

  /** Polls GET /v1/event/<id>/ until the add has been processed. */
  async function waitForEvent(eventId) {
    const deadline = Date.now() + eventTimeoutMs
    while (Date.now() < deadline) {
      const res = await fetch(`${MEM0_HOST}/v1/event/${encodeURIComponent(eventId)}/`, { headers: { Authorization: `Token ${apiKey}` } })
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
      const res = await c.getAll({ filters: entityFilters(briefId), page, pageSize: 100 })
      const results = Array.isArray(res) ? res : res?.results ?? []
      out.push(...results)
      if (Array.isArray(res) || !res?.next || results.length === 0) break
    }
    return out
  }

  /** Stores one record verbatim (infer=false) and returns it with its memory id. */
  async function createRecord({ type, payload, briefId, status = null, version = null, topicGroup = null, date = istDate() }) {
    if (!RECORD_TYPES.includes(type)) throw new StoreError(`Unknown record type "${type}"`)
    const recordKey = randomUUID()
    const metadata = { type, brief_id: briefId ?? null, status, version, topic_group: topicGroup, date, record_key: recordKey }
    if (type === 'run_log') {
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
    if (dryRun) {
      log.info('DRY_RUN: Mem0 update skipped', { id })
      return { id, payload, metadata, dryRun: true }
    }
    const c = await client()
    const current = await c.get(id)
    const merged = { ...(current?.metadata ?? {}), ...metadata }
    await c.update(id, { ...(payload !== undefined && { text: JSON.stringify(payload) }), metadata: merged })
    return toRecord({ ...current, id, metadata: merged, memory: payload !== undefined ? JSON.stringify(payload) : current?.memory })
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
    const res = await c.search(text, { filters: entityFilters(briefId), topK: filters.topK ?? 10 })
    const results = Array.isArray(res) ? res : res?.results ?? []
    return results.map((m) => ({ ...toRecord(m), score: m.score ?? null })).filter((r) => matches(r, filters))
  }

  /** A free-text lesson; Mem0 extracts the facts (infer=true). Returns the add event. */
  async function addLesson(text) {
    if (dryRun) {
      log.info('DRY_RUN: lesson not stored')
      return { eventId: null, status: 'DRY_RUN' }
    }
    const c = await client()
    const added = await c.add([{ role: 'user', content: text }], { agentId, metadata: { type: 'lesson', date: istDate() }, infer: true })
    return { eventId: added?.eventId ?? added?.event_id ?? null, status: added?.status ?? null }
  }

  /** Tests and lock release only. */
  async function deleteRecord(id) {
    if (dryRun || String(id).startsWith(DRY_ID)) return
    const c = await client()
    await c.delete(id)
  }

  return { dryRun, createRecord, updateRecord, getRecords, getOne, searchSimilar, addLesson, deleteRecord }
}

let defaultStore
export function getStore() {
  defaultStore ??= createStore()
  return defaultStore
}
