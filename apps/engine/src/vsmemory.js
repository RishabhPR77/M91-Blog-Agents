// viaSocket AI memory as the engine's record store (MEMORY_BACKEND=viasocket), in place of Mem0. Same interface as
// createMem0Store (store.js): createRecord, updateRecord, getRecord, getRecords, getOne, searchSimilar, addLesson,
// deleteRecord, listAgentMemories, deleteAllForAgent.
//
// Contract: https://memory-api.viasocket.com/guide.md. Every call goes through viasocket-apps
// (viasocket.user(<VIASOCKET_SYSTEM_USER_ID>).memory.call), which signs the embed token from the keys the engine already
// has and keeps the memory token fresh. The engine writes in its own space (the token's `me`).
//
// - One record = one note at  <MEMORY_ROOT>/<type>/<id>, written with PUT /notes: saved exactly as sent, never merged;
//   saving it again updates that path (each version is kept by viaSocket). The note's body is the record as JSON; its
//   title ("type|brief|status|version") lets a list skip notes without opening them.
// - Lists: GET /index on the type's folder (500 a page), then GET /open for each note that may match (8 at a time).
// - No monthly cap: viaSocket charges per successful call (reads $0.002, writes $0.10 per 1,000). Calls are still
//   counted (util/mem0count.js), so the dashboard shows the month's calls and their cost.
import { randomUUID } from 'node:crypto'
import { ViaSocket } from 'viasocket-apps'
import { getConfig } from './config.js'
import { log } from './util/log.js'
import { retry, sleep } from './util/retry.js'
import { istDate } from './util/time.js'
import { countMem0 } from './util/mem0count.js'
import { configureUsage } from './util/mem0usage.js'
import { markWrite, emitStoreWrite } from './storeevents.js'
import { limiter } from './scout/checks.js'
import { RECORD_TYPES, StoreError, normalizeMetadata, recordMatches } from './store.js'

export const ID_PREFIX = 'vm_'
const PAGE = 500
const MAX_PAGES = 40

/** "vm_question_cluster_1a2b…" → "question_cluster" (null when the id is not one of ours). */
export function typeOfId(id) {
  const s = String(id ?? '')
  if (!s.startsWith(ID_PREFIX)) return null
  const rest = s.slice(ID_PREFIX.length)
  const i = rest.lastIndexOf('_')
  return i > 0 ? rest.slice(0, i) : null
}

/** The note title: enough to filter a list without opening each note. */
export const titleOf = (r) => [r.type, r.briefId ?? '', r.status ?? '', r.version ?? ''].join('|')
/** { type, briefId, status, version } from a note title (null when it is not ours). */
export function parseTitle(title) {
  const parts = String(title ?? '').split('|')
  if (parts.length !== 4 || !RECORD_TYPES.includes(parts[0])) return null
  const [type, briefId, status, version] = parts
  return { type, briefId: briefId || null, status: status || null, version: version === '' ? null : Number(version) }
}

/** A failure worth one more try: no answer at all, or a 5xx from the service. */
const transient = (error) => error?.status === null || error?.status === undefined || (error?.status >= 500 && error?.status <= 599)
const notFound = (error) => error?.status === 404

/** The record from a note body (its top-level fields always follow its metadata, as with Mem0). */
export function fromBody(body) {
  let r
  try {
    r = typeof body === 'string' ? JSON.parse(body) : body
  } catch {
    return null
  }
  if (!r || typeof r !== 'object' || !r.id) return null
  const md = normalizeMetadata(r.metadata ?? {})
  return { id: r.id, type: md.type ?? r.type, briefId: md.brief_id ?? null, status: md.status ?? null, version: md.version ?? null, topicGroup: md.topic_group ?? null, date: md.date ?? null, payload: r.payload, metadata: md, createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null }
}

/**
 * @param {{ config?, viasocketFactory?, memoryFetch?, sleepFn?, dryRun?, testTag?, now?, concurrency? }} deps
 *   viasocketFactory(options) → a ViaSocket client (tests pass a fake); memoryFetch: the package's transport.
 */
export function createVsMemoryStore({ config = getConfig(), viasocketFactory = (o) => new ViaSocket(o), memoryFetch, sleepFn = sleep, dryRun = config.runtime.dryRun, testTag = false, now = Date.now, concurrency = 8 } = {}) {
  const vs = config.viasocket
  const userId = vs.systemUserId
  const root = String(config.memory?.root ?? 'm91-blog').replace(/^\/+|\/+$/g, '')
  if (!root || /[*]/.test(root) || /[*]/.test(userId ?? '')) throw new StoreError(`refusing to use memory root "${root}" for user "${userId}"`)
  configureUsage(config, { now })
  const client = viasocketFactory({ orgId: vs.orgId, projectId: vs.projectId, secret: vs.embedSecret, apiBaseUrl: vs.apiBase, ...(memoryFetch && { fetch: memoryFetch }) })
  const user = client.user(userId)
  const agentId = `${userId}:${root}`
  const writeKey = `vsmemory:${agentId}`
  const DRY_ID = 'dryrun-'
  const skipWrite = (type) => dryRun && type !== 'run_log' && type !== 'run'
  const wrote = (event) => {
    markWrite(config)
    emitStoreWrite({ key: writeKey, ...event })
  }
  const limit = limiter(concurrency)

  /** One memory call, counted; repeat-safe calls get two more tries on a network error or a 5xx. */
  const call = (kind, method, path, body, { repeatSafe = true } = {}) => retry(() => {
    countMem0(kind)
    return user.memory.call(method, path, body)
  }, { retries: repeatSafe ? 2 : 0, baseMs: 1000, maxMs: 8000, sleepFn, shouldRetry: transient, onRetry: (error, attempt, delay) => log.warn('viaSocket memory error; retrying', { method, path: path.split('?')[0], attempt, delay_ms: delay, status: error?.status ?? null }) })

  // The engine's own space: it never changes for a user, so it is read once.
  let mePromise
  const me = () => (mePromise ??= user.memory.token({ expiresIn: 60 }).then((t) => {
    if (!t?.me) throw new StoreError('viaSocket memory gave no space for the engine')
    return t.me
  }).catch((error) => {
    mePromise = undefined
    throw error
  }))
  const pathOf = (type, id) => `${root}/${type}/${id}`
  const qs = (o) => `?${new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString()}`

  /** Every note (without body) under a folder: { path, title, updated_at, … }. */
  async function index(folder) {
    const space = await me()
    const out = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await call('reads', 'GET', `/index${qs({ space, path: folder, limit: PAGE, offset: page * PAGE })}`)
      const notes = r?.notes ?? []
      out.push(...notes.filter((n) => String(n.path ?? '').startsWith(`${folder}/`)))
      if (notes.length < PAGE) break
    }
    return out
  }

  /** One note's record, or null when there is none. */
  async function open(path) {
    const space = await me()
    try {
      const r = await call('reads', 'GET', `/open${qs({ space, path })}`)
      return fromBody(r?.note?.body)
    } catch (error) {
      if (notFound(error)) return null
      throw error
    }
  }

  async function put(record) {
    const space = await me()
    const body = JSON.stringify({ ...record, updatedAt: new Date(now()).toISOString() })
    await call('writes', 'PUT', '/notes', { space, path: pathOf(record.type, record.id), body, title: titleOf(record), kind: 'note' })
  }

  async function createRecord({ type, payload, briefId, status = null, version = null, topicGroup = null, date = istDate(), meta = {} }) {
    if (!RECORD_TYPES.includes(type)) throw new StoreError(`Unknown record type "${type}"`)
    const recordKey = randomUUID()
    const metadata = { ...meta, ...(testTag && { test: true }), type, brief_id: briefId ?? null, status, version, topic_group: topicGroup, date, record_key: recordKey }
    if (type === 'run_log' || type === 'run') {
      metadata.dry_run = dryRun
      payload = { ...payload, dry_run: dryRun }
    }
    if (skipWrite(type)) {
      log.info('DRY_RUN: memory write skipped', { type, briefId })
      return { id: `${DRY_ID}${recordKey}`, type, briefId: briefId ?? null, status, version, topicGroup, date, payload, metadata, dryRun: true }
    }
    const id = `${ID_PREFIX}${type}_${recordKey.replace(/-/g, '').slice(0, 20)}`
    const at = new Date(now()).toISOString()
    const created = { id, type, briefId: briefId ?? null, status, version, topicGroup, date, payload, metadata, createdAt: at, updatedAt: at }
    // A new note at a fresh path: a retry after a lost reply rewrites the same path, so it is safe to repeat.
    await put(created)
    log.debug('store create', { type, id, briefId })
    wrote({ op: 'create', record: created })
    return created
  }

  async function updateRecord(id, payload, metadata = {}, { known = null } = {}) {
    if (dryRun && metadata.type !== 'run') {
      log.info('DRY_RUN: memory update skipped', { id })
      return { id, payload, metadata, dryRun: true }
    }
    const current = known?.metadata ? known : await getRecord(id)
    if (!current) throw new StoreError(`no record ${id} to update`)
    const merged = normalizeMetadata({ ...(current.metadata ?? {}), ...metadata })
    const record = fromBody({ ...current, metadata: merged, payload: payload !== undefined ? payload : current.payload, createdAt: current.createdAt ?? null })
    await put(record)
    wrote({ op: 'update', record })
    return record
  }

  async function getRecord(id) {
    const type = typeOfId(id)
    if (!type) return null
    return open(pathOf(type, id))
  }

  /** Records of a type (or every type), filtered by type / brief_id / status / version / topic_group. */
  async function getRecords(filters = {}) {
    const briefId = filters.brief_id ?? filters.briefId
    const types = filters.type ? [filters.type] : RECORD_TYPES
    const out = []
    for (const type of types) {
      const notes = await index(`${root}/${type}`)
      const maybe = notes.filter((n) => {
        const t = parseTitle(n.title)
        if (!t) return true
        return (briefId === undefined || t.briefId === briefId) && (filters.status === undefined || t.status === filters.status) && (filters.version === undefined || t.version === filters.version)
      })
      const records = await Promise.all(maybe.map((n) => limit(() => open(n.path))))
      out.push(...records.filter((r) => r && recordMatches(r, filters)))
    }
    return out
  }

  async function getOne(type, briefId, version) {
    const records = await getRecords({ type, brief_id: briefId, ...(version !== undefined && { version }) })
    return records.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null
  }

  /** Records found by meaning (DEDUPE_MODE=mem0 uses it). score: 1 − distance when the service gives no score. */
  async function searchSimilar(text, filters = {}) {
    const space = await me()
    const r = await call('searches', 'POST', '/search', { query: String(text ?? ''), spaces: [space], path: filters.type ? `${root}/${filters.type}` : root, top_k: Math.min(filters.topK ?? 10, 50), prompt: false })
    const hits = (r?.results ?? []).filter((n) => String(n.path ?? '').startsWith(`${root}/`))
    const records = await Promise.all(hits.map((n) => limit(async () => {
      const rec = await open(n.path)
      return rec ? { ...rec, score: typeof n.score === 'number' ? n.score : typeof n.distance === 'number' ? 1 - n.distance : null } : null
    })))
    return records.filter((x) => x && recordMatches(x, filters))
  }

  /** A lesson: one record of type lesson (its payload is the text), as the lesson readers expect. */
  async function addLesson(text, meta = {}) {
    if (dryRun) {
      log.info('DRY_RUN: lesson not stored', { lesson: text, ...meta })
      return { eventId: null, status: 'DRY_RUN' }
    }
    const rec = await createRecord({ type: 'lesson', payload: String(text), briefId: meta.brief_id ?? null, status: 'current', meta })
    return { eventId: null, status: 'SUCCEEDED', id: rec.id }
  }

  async function deleteRecord(id) {
    if (dryRun || String(id).startsWith(DRY_ID)) return
    const type = typeOfId(id)
    if (!type) return
    const space = await me()
    try {
      await call('writes', 'DELETE', '/notes', { space, path: pathOf(type, id) })
    } catch (error) {
      if (!notFound(error)) throw error
    }
    wrote({ op: 'delete', id })
  }

  /** Every record under MEMORY_ROOT, any type, shaped like a Mem0 memory (for the reset and the Memory page). */
  async function listAgentMemories() {
    const notes = await index(root)
    const records = await Promise.all(notes.map((n) => limit(() => open(n.path))))
    return records.filter(Boolean).map((r) => ({ id: r.id, metadata: r.metadata, memory: JSON.stringify(r.payload ?? null), created_at: r.createdAt, updated_at: r.updatedAt }))
  }

  /** Deletes every note under MEMORY_ROOT in the engine's space (one call each; deletes are free). Never another space. */
  async function deleteAllForAgent() {
    const space = await me()
    const notes = await index(root)
    let deleted = 0
    for (const n of notes) {
      try {
        await call('writes', 'DELETE', '/notes', { space, path: n.path })
        deleted++
      } catch (error) {
        if (!notFound(error)) throw error
      }
    }
    wrote({ op: 'delete_all' })
    return { message: `deleted ${deleted} note${deleted === 1 ? '' : 's'} under ${root}`, event_id: null }
  }

  return { backend: 'viasocket', dryRun, writeKey, agentId, createRecord, updateRecord, getRecord, getRecords, getOne, searchSimilar, addLesson, deleteRecord, listAgentMemories, deleteAllForAgent }
}
