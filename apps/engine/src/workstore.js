// The run's work in a local file (WORK_STORE=local). Mem0 keeps what must outlive a run: finished posts and the
// context the agents need next time. A run's work in progress stays in work.json under the engine's data folder:
//
// - brief, draft, review, guide_doc, source_pack and run_log records of a brief this engine started (a "claimed"
//   brief: the full run calls claimBrief before its first step), and every run record. Their ids start with "w-".
// - Everything else (and work records of a brief that is not claimed: older posts, a counter prompt on an approved
//   post) goes to Mem0 as before.
// - promoteBrief: on approval, the final brief, the approved draft, its review and its guide are copied to Mem0 and
//   the brief's local work is deleted. A rejected or failed post never reaches Mem0: its local work is deleted after
//   WORK_KEEP_DAYS (pruneWork), like old local run records.
// - saveRunSummary: one short Mem0 record per finished run (the run's full record stays local).
//
// It has the store's interface. Lists of a work type merge the local records with Mem0's, except lists scoped to a
// claimed brief, which are local only (0 Mem0 requests). Every local write is announced like a Mem0 write, so the
// engine's index follows it, and stamps the write marker. The file is read on every call, so the CLI and the engine
// see each other's work; each write replaces the file in one rename.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { RECORD_TYPES, recordMatches } from './store.js'
import { emitStoreWrite, markWrite } from './storeevents.js'
import { dataDir } from './util/runlock.js'
import { istDate } from './util/time.js'
import { log } from './util/log.js'

export const WORK_FILE = 'work.json'
/** Types kept locally while a post is being written. */
export const WORK_TYPES = Object.freeze(['brief', 'draft', 'review', 'guide_doc', 'source_pack', 'run', 'run_log'])
const LOCAL_ID = 'w-'
export const isLocalId = (id) => String(id ?? '').startsWith(LOCAL_ID)
/** Local run records kept at most (the newest), whatever their age. */
const MAX_LOCAL_RUNS = 200
const CORE_META = ['type', 'brief_id', 'status', 'version', 'topic_group', 'date', 'record_key']

/** Run lists: a Mem0 run summary is dropped when the full local record of that run is there. */
export function preferLocalRuns(records) {
  const local = new Set(records.filter((r) => r.type === 'run' && isLocalId(r.id)).map((r) => r.payload?.run_id).filter(Boolean))
  return records.filter((r) => !(r.type === 'run' && !isLocalId(r.id) && r.metadata?.summary === true && local.has(r.payload?.run_id)))
}

/** The short run summary saved in Mem0: no timeline, steps without their record ids. */
export function runSummary(run) {
  return {
    run_id: run.run_id, mode: run.mode, trigger: run.trigger, dry_run: Boolean(run.dry_run), status: run.status,
    started_at: run.started_at, finished_at: run.finished_at, ms: run.ms, brief_id: run.brief_id ?? null,
    result_summary: run.result_summary ?? '', warnings: (run.warnings ?? []).slice(0, 5),
    steps: (run.steps ?? []).map((s) => ({ name: s.name, status: s.status, ms: s.ms ?? null, ai_calls: s.ai_calls ?? 0, summary: s.summary ?? '' })),
    ...(run.mem0 && { mem0: run.mem0 }), summary: true
  }
}

const versionOf = (r) => Number(r.payload?.version ?? r.version ?? 0)
const briefVersionOf = (r) => Number(r.payload?.brief_version ?? r.metadata?.brief_version ?? 1)
const newest = (a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? ''))

export function createWorkStore(mem0, { config, now = Date.now } = {}) {
  const dryRun = mem0.dryRun
  const file = () => join(dataDir(config), WORK_FILE)
  const keepDays = config?.runtime?.workKeepDays ?? 7
  // DRY_RUN: claims are kept in memory only (dry-run records are never saved).
  const dryClaims = new Set()

  function read() {
    try {
      const s = JSON.parse(readFileSync(file(), 'utf8'))
      return { briefs: s.briefs ?? {}, records: s.records ?? {} }
    } catch {
      return { briefs: {}, records: {} }
    }
  }
  function write(state) {
    const dir = dataDir(config)
    mkdirSync(dir, { recursive: true })
    const tmp = join(dir, `${WORK_FILE}.${process.pid}.tmp`)
    writeFileSync(tmp, JSON.stringify(state))
    renameSync(tmp, file())
  }
  const wrote = (event) => {
    markWrite(config)
    emitStoreWrite({ key: mem0.writeKey, ...event })
  }
  const claimed = (briefId, state = read()) => Boolean(briefId) && (dryClaims.has(briefId) || Boolean(state.briefs[briefId]))
  const copy = (r) => (r ? structuredClone(r) : r)

  /** Where a new record goes: locally (true) or Mem0. */
  const isLocal = (type, briefId, state) => type === 'run' || (WORK_TYPES.includes(type) && claimed(briefId, state))

  async function createRecord(args) {
    const { type, payload, briefId, status = null, version = null, topicGroup = null, date = istDate(), meta = {} } = args
    const state = read()
    // DRY_RUN: only run records are saved (as in Mem0); the Mem0 store answers the others with a placeholder.
    if (!RECORD_TYPES.includes(type) || !isLocal(type, briefId, state) || (dryRun && type !== 'run')) return mem0.createRecord(args)
    const at = new Date(now()).toISOString()
    const metadata = { ...meta, type, brief_id: briefId ?? null, status, version, topic_group: topicGroup, date, record_key: randomUUID(), ...(type === 'run' && { dry_run: dryRun }) }
    const record = { id: `${LOCAL_ID}${randomUUID()}`, type, briefId: briefId ?? null, status, version, topicGroup, date, payload: type === 'run' ? { ...payload, dry_run: dryRun } : payload, metadata, createdAt: at, updatedAt: at }
    state.records[record.id] = record
    write(state)
    wrote({ op: 'create', record: copy(record) })
    return copy(record)
  }

  async function updateRecord(id, payload, metadata = {}, opts) {
    if (!isLocalId(id)) return mem0.updateRecord(id, payload, metadata, opts)
    if (dryRun && metadata.type !== 'run') return { id, payload, metadata, dryRun: true }
    const state = read()
    const held = state.records[id]
    if (!held) throw new Error(`no local work record ${id}`)
    const md = { ...held.metadata, ...metadata }
    const record = {
      ...held, metadata: md, payload: payload !== undefined ? payload : held.payload,
      status: md.status ?? null, version: md.version ?? null, topicGroup: md.topic_group ?? null, date: md.date ?? held.date,
      updatedAt: new Date(now()).toISOString()
    }
    state.records[id] = record
    write(state)
    wrote({ op: 'update', record: copy(record) })
    return copy(record)
  }

  async function getRecord(id) {
    if (!isLocalId(id)) return mem0.getRecord(id)
    return copy(read().records[id] ?? null)
  }

  async function getRecords(filters = {}) {
    const state = read()
    const local = Object.values(state.records).filter((r) => recordMatches(r, filters)).map(copy)
    const type = filters.type
    if (type && !WORK_TYPES.includes(type)) return mem0.getRecords(filters)
    const briefId = filters.brief_id ?? filters.briefId
    // A claimed brief's work is all here: no Mem0 read.
    if (type && type !== 'run' && briefId && claimed(briefId, state)) return local
    const out = [...local, ...(await mem0.getRecords(filters))]
    return type === 'run' || !type ? preferLocalRuns(out) : out
  }

  async function getOne(type, briefId, version) {
    const records = await getRecords({ type, brief_id: briefId, ...(version !== undefined && { version }) })
    return records.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null
  }

  async function deleteRecord(id) {
    if (!isLocalId(id)) return mem0.deleteRecord(id)
    if (dryRun) return
    const state = read()
    if (!state.records[id]) return
    delete state.records[id]
    write(state)
    wrote({ op: 'delete', id })
  }

  /** Deletes local records (and the claims of briefs that no longer have any) in one write. */
  function drop(state, ids, { unclaim = [] } = {}) {
    for (const id of ids) delete state.records[id]
    for (const b of unclaim) delete state.briefs[b]
    write(state)
    for (const id of ids) wrote({ op: 'delete', id })
  }

  /**
   * Local work older than WORK_KEEP_DAYS: a claimed brief with nothing waiting for the human (rejected, failed,
   * cancelled), and run records (the newest MAX_LOCAL_RUNS are kept). Returns the number of records deleted.
   */
  function pruneWork() {
    if (dryRun) return 0
    const state = read()
    const cutoff = now() - keepDays * 86400000
    const ms = (r) => Date.parse(r.updatedAt ?? r.createdAt ?? '') || 0
    const ids = []
    const unclaim = []
    for (const [briefId, claim] of Object.entries(state.briefs)) {
      const recs = Object.values(state.records).filter((r) => r.type !== 'run' && r.briefId === briefId)
      const last = Math.max(Date.parse(claim?.at ?? '') || 0, ...recs.map(ms))
      const waiting = recs.some((r) => r.type === 'draft' && ['awaiting_human', 'changes_requested'].includes(r.status))
      if (last < cutoff && !waiting) {
        ids.push(...recs.map((r) => r.id))
        unclaim.push(briefId)
      }
    }
    const runs = Object.values(state.records).filter((r) => r.type === 'run').sort((a, b) => ms(b) - ms(a))
    runs.forEach((r, i) => { if (i >= MAX_LOCAL_RUNS || ms(r) < cutoff) ids.push(r.id) })
    if (ids.length || unclaim.length) {
      drop(state, ids, { unclaim })
      log.info('local work pruned', { records: ids.length, briefs: unclaim.length, keep_days: keepDays })
    }
    return ids.length
  }

  return {
    isWorkStore: true,
    mem0,
    dryRun,
    writeKey: mem0.writeKey,
    agentId: mem0.agentId,
    createRecord,
    updateRecord,
    getRecord,
    getRecords,
    getOne,
    deleteRecord,
    searchSimilar: (...a) => mem0.searchSimilar(...a),
    addLesson: (...a) => mem0.addLesson(...a),
    // Mem0-wide operations (reset:all, the Memory page) see Mem0 only.
    listAgentMemories: (...a) => mem0.listAgentMemories(...a),
    deleteAllForAgent: (...a) => mem0.deleteAllForAgent(...a),
    /** Every local record (the engine's index adds them after a full Mem0 load). */
    localRecords: () => Object.values(read().records).map(copy),
    /** A new post: its work records stay local until it is approved. Also prunes old local work. */
    claimBrief(briefId) {
      if (!briefId) return
      if (dryRun) {
        dryClaims.add(briefId)
        return
      }
      const state = read()
      state.briefs[briefId] ??= { at: new Date(now()).toISOString() }
      write(state)
      try {
        pruneWork()
      } catch (error) {
        log.warn('local work not pruned', { error })
      }
    },
    isClaimed: (briefId) => claimed(briefId),
    pruneWork,
    /**
     * Approval: copies the final brief, the approved draft, its review and its guide to Mem0 (1 write each), then
     * deletes the brief's local work. Returns { created, deleted } (Mem0 records, local ids), or null when the brief
     * is not local or has no approved draft.
     */
    async promoteBrief(briefId) {
      const state = read()
      if (dryRun || !claimed(briefId, state)) return null
      const recs = Object.values(state.records).filter((r) => r.type !== 'run' && r.briefId === briefId)
      const draft = recs.filter((r) => r.type === 'draft' && r.status === 'approved').sort((a, b) => versionOf(b) - versionOf(a))[0]
      if (!draft) return null
      const sameVersion = (r) => versionOf(r) === versionOf(draft) && briefVersionOf(r) === briefVersionOf(draft)
      const brief = recs.filter((r) => r.type === 'brief').sort((a, b) => briefVersionOf(b) - briefVersionOf(a) || Number(b.version ?? 0) - Number(a.version ?? 0))[0]
      const review = recs.filter((r) => r.type === 'review' && sameVersion(r)).sort(newest)[0]
      const guide = recs.filter((r) => r.type === 'guide_doc' && sameVersion(r)).sort(newest)[0]
      const created = []
      for (const r of [brief, draft, review, guide].filter(Boolean)) {
        const meta = Object.fromEntries(Object.entries(r.metadata ?? {}).filter(([k]) => !CORE_META.includes(k)))
        created.push(await mem0.createRecord({ type: r.type, payload: r.payload, briefId, status: r.status, version: r.version, topicGroup: r.topicGroup, date: r.date, meta: { ...meta, promoted_from: r.id } }))
      }
      const fresh = read()
      const ids = Object.values(fresh.records).filter((r) => r.type !== 'run' && r.briefId === briefId).map((r) => r.id)
      drop(fresh, ids, { unclaim: [briefId] })
      log.info('approved post copied to Mem0', { briefId, records: created.map((r) => r.type), local_deleted: ids.length })
      return { created, deleted: ids }
    },
    /** One short Mem0 record per finished run (not in DRY_RUN). */
    async saveRunSummary(run) {
      if (dryRun) return null
      return mem0.createRecord({ type: 'run', briefId: run.run_id, payload: runSummary(run), status: run.status, meta: { summary: true } })
    }
  }
}
