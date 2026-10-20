// The run context's view of the store (Phase 9 A1). One run asks Mem0 for each list it needs once, with the
// type (and brief / status when given) as server-side filters, and keeps the answer for the rest of the run.
// Every write the run makes goes to Mem0 and is applied to the lists held here, so a record created or
// changed earlier in the run is never read back. Updates pass the record held here, so Mem0 is not read first.
//
// - A list asked for with a filter is served from a held list with a wider filter when there is one
//   (e.g. "story_lead, open" from "story_lead").
// - newBrief(briefId): every record of that brief is made in this run, so lists scoped to it need no read.
// - seed (Phase 9 A4): the engine's index. Lists are taken from it instead of Mem0 while it is up to date.
// - Searches and lessons pass straight through.
import { recordMatches } from './store.js'

const keyOf = (f) => JSON.stringify([f.type ?? null, f.brief_id ?? null, f.status ?? null])
const norm = (filters = {}) => ({ type: filters.type, brief_id: filters.brief_id ?? filters.briefId, status: filters.status })

/** A held list covers a request when each of its filters is unset or equal. */
const covers = (held, want) => held.type === want.type &&
  (held.brief_id === undefined || held.brief_id === want.brief_id) &&
  (held.status === undefined || held.status === want.status)

export function createRunStore(base, { seed = null } = {}) {
  /** key → { filter, records: Map(id → record) } */
  const lists = new Map()
  /** Every record this run has seen or written, by id (the newest copy). */
  const known = new Map()
  /** Records created in this run whose type list is not held yet (Mem0 may not list them at once). */
  const created = []
  const newBriefs = new Set()

  function remember(record) {
    if (!record?.id) return record
    known.set(record.id, record)
    for (const l of lists.values()) {
      if (recordMatches(record, l.filter)) l.records.set(record.id, record)
      else l.records.delete(record.id)
    }
    return record
  }

  function forget(id) {
    known.delete(id)
    for (const l of lists.values()) l.records.delete(id)
    const i = created.findIndex((r) => r.id === id)
    if (i >= 0) created.splice(i, 1)
  }

  async function listFor(want) {
    const key = keyOf(want)
    if (lists.has(key)) return lists.get(key)
    for (const l of lists.values()) {
      if (covers(l.filter, want)) {
        const derived = { filter: want, records: new Map([...l.records].filter(([, r]) => recordMatches(r, want))) }
        lists.set(key, derived)
        return derived
      }
    }
    const source = seed ?? base
    const fetched = want.brief_id && newBriefs.has(want.brief_id) ? [] : await source.getRecords({ type: want.type, ...(want.brief_id && { brief_id: want.brief_id }), ...(want.status && { status: want.status }) })
    const l = { filter: want, records: new Map() }
    for (const r of fetched) l.records.set(r.id, known.get(r.id) ?? r)
    // Newer copies held here win over what Mem0 answered; records made in this run are added.
    for (const r of [...known.values(), ...created]) {
      if (recordMatches(r, want)) l.records.set(r.id, known.get(r.id) ?? r)
      else l.records.delete(r.id)
    }
    lists.set(key, l)
    for (const r of l.records.values()) if (!known.has(r.id)) known.set(r.id, r)
    return l
  }

  async function getRecords(filters = {}) {
    const want = norm(filters)
    // Without a type the request is not cacheable by type: ask Mem0 (no run code does this today).
    if (!want.type) return base.getRecords(filters)
    const l = await listFor(want)
    return [...l.records.values()].filter((r) => recordMatches(r, filters))
  }

  return {
    get dryRun() { return base.dryRun },
    base,
    /** Every record of this brief is made in this run (a new pipeline): its lists need no Mem0 read. */
    newBrief(briefId) { if (briefId) newBriefs.add(briefId) },
    getRecords,
    async getOne(type, briefId, version) {
      const records = await getRecords({ type, brief_id: briefId, ...(version !== undefined && { version }) })
      return records.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null
    },
    async getRecord(id) {
      if (known.has(id)) return known.get(id)
      const r = await base.getRecord(id)
      return r ? remember(r) : r
    },
    async createRecord(args) {
      const r = await base.createRecord(args)
      if (r?.id && !r.dryRun) {
        created.push(r)
        remember(r)
      }
      return r
    },
    async updateRecord(id, payload, metadata = {}) {
      const held = known.get(id) ?? null
      // Phase 9 A2: a status (or other metadata) change that changes nothing is not written again.
      const same = (a, b) => a === b || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b))
      if (held && payload === undefined && Object.entries(metadata).every(([k, v]) => same(held.metadata?.[k], v))) return held
      const r = await base.updateRecord(id, payload, metadata, { known: held })
      if (r && !r.dryRun) remember({ ...(held ?? {}), ...r, payload: payload !== undefined ? payload : held?.payload ?? r.payload })
      return r
    },
    async deleteRecord(id) {
      await base.deleteRecord(id)
      forget(id)
    },
    searchSimilar: (...a) => base.searchSimilar(...a),
    addLesson: (...a) => base.addLesson(...a)
  }
}
