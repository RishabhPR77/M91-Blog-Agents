// The engine's index (Phase 9 A4): what the dashboard lists, held in memory so its pages cost no Mem0
// requests. Each record type is loaded once (the dashboard's types at start, others on first use), with
// the type as a server-side filter, then kept up to date by every write this process makes (store write
// events). Writes by another process (a CLI command) stamp the write marker; the index then reports itself
// as out of date until a refresh. It has the store's interface, so the API and the run checks use it as is.
import { recordMatches, RECORD_TYPES, toRecord } from './store.js'
import { onStoreWrite, readWriteMarker } from './storeevents.js'
import { log } from './util/log.js'

/** Loaded at engine start: everything the dashboard's list pages show. */
export const PRELOAD_TYPES = Object.freeze(['run', 'draft', 'brief', 'review', 'published_post', 'pinned_topic', 'lesson', 'markdown_export', 'timely_opportunity'])
/** Never indexed: per-call logs and the old lock records. */
const SKIP = new Set(['run_log', 'lock'])

export function createEngineIndex(base, { config = null, now = Date.now, pid = process.pid } = {}) {
  /** type → Map(id → record) */
  const types = new Map()
  const loading = new Map()
  /** Records seen by id whose type list is not loaded. */
  const loose = new Map()
  const dirty = new Set()
  let loadedAt = null
  // Memory page: every type was loaded with one paged list of the whole agent (loadAll).
  let allLoaded = false

  const copy = (r) => (r ? { ...r, metadata: { ...(r.metadata ?? {}) } } : r)

  async function load(type) {
    if (types.has(type) && !dirty.has(type)) return types.get(type)
    if (loading.has(type)) return loading.get(type)
    const p = (async () => {
      const records = await base.getRecords({ type })
      const map = new Map(records.map((r) => [r.id, copy(r)]))
      types.set(type, map)
      dirty.delete(type)
      loadedAt ??= now()
      return map
    })()
    loading.set(type, p)
    try {
      return await p
    } finally {
      loading.delete(type)
    }
  }

  function apply(event) {
    if (event.key !== base.writeKey) return
    if (event.op === 'delete') {
      for (const m of types.values()) m.delete(event.id)
      loose.delete(event.id)
      return
    }
    if (event.op === 'lesson') {
      // Mem0 extracts lessons later: reload that list on its next use.
      if (types.has('lesson')) dirty.add('lesson')
      return
    }
    const r = event.record
    if (!r?.id || r.dryRun) return
    const type = r.type ?? r.metadata?.type
    const held = types.get(type)
    if (held) held.set(r.id, copy({ ...(held.get(r.id) ?? {}), ...r }))
    else loose.set(r.id, copy(r))
  }
  const unsubscribe = onStoreWrite(apply)

  async function getRecords(filters = {}) {
    const wanted = filters.type ? [filters.type] : RECORD_TYPES.filter((t) => !SKIP.has(t))
    const out = []
    for (const type of wanted) {
      if (SKIP.has(type)) {
        out.push(...(await base.getRecords(filters)))
        continue
      }
      for (const r of (await load(type)).values()) if (recordMatches(r, filters)) out.push(copy(r))
    }
    return out
  }

  /** Whether another process wrote to Mem0 after this index was loaded. */
  function outOfDate() {
    const marker = config ? readWriteMarker(config) : null
    return Boolean(marker && marker.pid !== pid && loadedAt !== null && marker.at > loadedAt)
  }

  return {
    isIndex: true,
    base,
    get dryRun() { return base.dryRun },
    get writeKey() { return base.writeKey },
    /** Loads the dashboard's types (engine start). */
    async build(list = PRELOAD_TYPES) {
      for (const t of list) await load(t)
      log.info('index loaded', { types: [...types.keys()], records: [...types.values()].reduce((n, m) => n + m.size, 0) })
    },
    /**
     * Memory page: every record of this agent, any type (run logs, locks and records of unknown type too), with one
     * paged list (about 1 Mem0 request per 100 records) instead of one list per type. Stores without that list load
     * each type instead.
     */
    async loadAll() {
      if (base.listAgentMemories) {
        const byType = new Map()
        for (const m of await base.listAgentMemories()) {
          const r = toRecord(m)
          const type = r.type || 'unknown'
          if (!byType.has(type)) byType.set(type, new Map())
          byType.get(type).set(r.id, copy({ ...r, type }))
        }
        types.clear()
        loose.clear()
        dirty.clear()
        for (const t of RECORD_TYPES) types.set(t, byType.get(t) ?? new Map())
        for (const [t, m] of byType) if (!types.has(t)) types.set(t, m)
      } else {
        for (const t of RECORD_TYPES) {
          if (SKIP.has(t)) types.set(t, new Map((await base.getRecords({ type: t })).map((r) => [r.id, copy(r)])))
          else await load(t)
        }
      }
      allLoaded = true
      loadedAt = now()
      return this.status()
    },
    /** Every record the index holds now (no Mem0 request). */
    held() {
      const out = new Map()
      for (const m of types.values()) for (const [id, r] of m) out.set(id, copy(r))
      for (const [id, r] of loose) if (!out.has(id)) out.set(id, copy(r))
      return out
    },
    /** Reloads every loaded type from Mem0 (the dashboard's Refresh). */
    async refresh() {
      if (allLoaded) return this.loadAll()
      const loaded = [...types.keys()]
      types.clear()
      loose.clear()
      dirty.clear()
      loadedAt = null
      for (const t of loaded.length ? loaded : PRELOAD_TYPES) await load(t)
      loadedAt = now()
      return this.status()
    },
    status() {
      return { loaded_at: loadedAt === null ? null : new Date(loadedAt).toISOString(), types: [...types.keys()], all_loaded: allLoaded, records: [...types.values()].reduce((n, m) => n + m.size, 0), out_of_date: outOfDate() }
    },
    outOfDate,
    getRecords,
    async getOne(type, briefId, version) {
      const records = await getRecords({ type, brief_id: briefId, ...(version !== undefined && { version }) })
      return records.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null
    },
    async getRecord(id) {
      for (const m of types.values()) if (m.has(id)) return copy(m.get(id))
      if (loose.has(id)) return copy(loose.get(id))
      const r = await base.getRecord(id)
      if (r) {
        const held = types.get(r.type)
        if (held) held.set(r.id, copy(r))
        else loose.set(r.id, copy(r))
      }
      return r
    },
    // Writes go to the store; its write events update the index.
    createRecord: (...a) => base.createRecord(...a),
    updateRecord: (id, payload, metadata = {}) => {
      let known = null
      for (const m of types.values()) if (m.has(id)) known = m.get(id)
      return base.updateRecord(id, payload, metadata, ...(known ? [{ known }] : []))
    },
    deleteRecord: (...a) => base.deleteRecord(...a),
    addLesson: (...a) => base.addLesson(...a),
    searchSimilar: (...a) => base.searchSimilar(...a),
    close: unsubscribe
  }
}
