// Phase 9 A1: the run context's store (each list once, own writes kept in memory, updates without a read),
// and the store's synchronous add with its two fallbacks. Real createStore over a fake Mem0; requests counted.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createStore, clearStoreCache } from '../src/store.js'
import { createRunStore } from '../src/runstore.js'
import { withMem0Count } from '../src/util/mem0count.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, fakeFetch } from './helpers.js'

beforeEach(() => clearStoreCache())

/**
 * A fake Mem0 that honours agent_id / run_id / metadata filters.
 * addMode: 'sync' answers results[].id (infer=false, Mem0 docs); 'event' answers an event to poll;
 * 'bare' answers neither (the store finds the record by its record_key). hideNew: lists skip new records (lag).
 */
function fakeMem0({ addMode = 'sync', hideNew = false } = {}) {
  const memories = new Map()
  const fresh = new Set()
  const ok = (m, f) => {
    if (f.AND) return f.AND.every((x) => ok(m, x))
    if (f.agent_id) return m.agentId === f.agent_id
    if (f.run_id) return m.runId === f.run_id
    if (f.metadata) return Object.entries(f.metadata).every(([k, v]) => m.metadata?.[k] === v)
    return true
  }
  return {
    memories,
    async add(messages, o) {
      const id = `uuid-${memories.size + 1}`
      memories.set(id, { id, memory: messages[0].content, metadata: o.metadata, agentId: o.agentId, runId: o.runId })
      if (hideNew) fresh.add(id)
      if (addMode === 'sync') return { message: 'ok', results: [{ id, data: { memory: messages[0].content }, event: 'ADD' }] }
      if (addMode === 'event') return { status: 'PENDING', event_id: `evt-${id}` }
      return { status: 'PENDING' }
    },
    async get(id) { return memories.get(id) },
    async update(id, body) {
      const m = memories.get(id)
      if (body.text !== undefined) m.memory = body.text
      if (body.metadata) m.metadata = body.metadata
      return m
    },
    async getAll({ filters }) { return { next: null, results: [...memories.values()].filter((m) => !fresh.has(m.id) && ok(m, filters)) } },
    async search() { return { results: [] } },
    async delete(id) { memories.delete(id) }
  }
}

function base(opts = {}) {
  const mem0 = fakeMem0(opts)
  const fetch = fakeFetch((url) => ({ body: { status: 'SUCCEEDED', results: [{ id: url.match(/evt-(uuid-\d+)/)[1] }] } }))
  const store = createStore({ config: fakeConfig(), clientFactory: async () => mem0, fetch, sleepFn: async () => {}, cacheTtlMs: 0, dryRun: false })
  return { mem0, store, fetch }
}
const counted = async (fn) => {
  const { counts, result } = withMem0Count(fn)
  return { counts, value: await result }
}

test('synchronous add: the id comes from results[].id, with no event poll (1 write, 0 reads)', async () => {
  const { store, fetch } = base({ addMode: 'sync' })
  const { counts, value } = await counted(() => store.createRecord({ type: 'brief', briefId: 'B1', payload: { a: 1 }, status: 'new' }))
  assert.equal(value.id, 'uuid-1')
  assert.deepEqual([counts.writes, counts.reads], [1, 0])
  assert.equal(fetch.calls.length, 0)
})

test('fallbacks: an event answer is polled; an answer with neither is found by its record_key — never a silent failure', async () => {
  const ev = base({ addMode: 'event' })
  const a = await counted(() => ev.store.createRecord({ type: 'brief', briefId: 'B1', payload: {}, status: 'new' }))
  assert.equal(a.value.id, 'uuid-1')
  assert.deepEqual([a.counts.writes, a.counts.reads], [1, 1])
  const bare = base({ addMode: 'bare' })
  const b = await counted(() => bare.store.createRecord({ type: 'brief', briefId: 'B1', payload: {}, status: 'new' }))
  assert.equal(b.value.id, 'uuid-1')
  assert.deepEqual([b.counts.writes, b.counts.reads], [1, 1], 'one list read to find the record_key')
})

test('updateRecord with a known record skips the read (1 write); without one it reads first', async () => {
  const { store, mem0 } = base()
  const rec = await store.createRecord({ type: 'draft', briefId: 'B1', payload: { t: 1 }, status: 'drafted', version: 1 })
  const plain = await counted(() => store.updateRecord(rec.id, undefined, { status: 'awaiting_human' }))
  assert.deepEqual([plain.counts.reads, plain.counts.writes], [1, 1])
  const known = await counted(() => store.updateRecord(rec.id, undefined, { status: 'approved' }, { known: plain.value }))
  assert.deepEqual([known.counts.reads, known.counts.writes], [0, 1])
  assert.equal(mem0.memories.get(rec.id).metadata.status, 'approved')
  assert.equal(mem0.memories.get(rec.id).metadata.brief_id, 'B1', 'the rest of the metadata is kept')
  assert.equal(JSON.parse(mem0.memories.get(rec.id).memory).t, 1, 'the payload is kept')
})

test('run store: each list is read once; narrower lists come from a wider one; repeats cost nothing', async () => {
  const { store } = base()
  for (const status of ['open', 'open', 'used']) await store.createRecord({ type: 'question_cluster', payload: { q: status }, status })
  const run = createRunStore(store)
  const { counts } = await counted(async () => {
    assert.equal((await run.getRecords({ type: 'question_cluster' })).length, 3)
    assert.equal((await run.getRecords({ type: 'question_cluster', status: 'open' })).length, 2)
    assert.equal((await run.getRecords({ type: 'question_cluster' })).length, 3)
    assert.equal((await run.getOne('question_cluster')).payload.q !== undefined, true)
  })
  assert.equal(counts.reads, 1)
})

test('run store: a record created in the run is in later lists without a read-back (even while Mem0 does not list it yet)', async () => {
  const { store } = base({ hideNew: true })
  const run = createRunStore(store)
  const { counts } = await counted(async () => {
    await run.getRecords({ type: 'draft', brief_id: 'B1' })
    const d = await run.createRecord({ type: 'draft', briefId: 'B1', payload: { v: 1 }, status: 'drafted', version: 1 })
    const listed = await run.getRecords({ type: 'draft', brief_id: 'B1' })
    assert.deepEqual(listed.map((r) => r.id), [d.id])
    // A list fetched after the write (status filter, wider than before) still includes it.
    const all = await run.getRecords({ type: 'draft' })
    assert.ok(all.some((r) => r.id === d.id))
  })
  assert.equal(counts.writes, 1)
  assert.equal(counts.reads, 2, 'the brief list and the type list, once each')
})

test('run store: status changes move records between held lists; updates of held records cost 1 write each', async () => {
  const { store } = base()
  const run = createRunStore(store)
  const d = await run.createRecord({ type: 'draft', briefId: 'B1', payload: { v: 1 }, status: 'drafted', version: 1 })
  await run.getRecords({ type: 'draft', status: 'drafted' })
  await run.getRecords({ type: 'draft', status: 'awaiting_human' })
  const { counts } = await counted(() => run.updateRecord(d.id, undefined, { status: 'awaiting_human' }))
  assert.deepEqual([counts.reads, counts.writes], [0, 1])
  assert.equal((await run.getRecords({ type: 'draft', status: 'drafted' })).length, 0)
  assert.equal((await run.getRecords({ type: 'draft', status: 'awaiting_human' }))[0].payload.v, 1)
  assert.equal((await run.getRecord(d.id)).status, 'awaiting_human')
  await run.deleteRecord(d.id)
  assert.equal((await run.getRecords({ type: 'draft', status: 'awaiting_human' })).length, 0)
})

test('run store: lists scoped to a brief made in this run need no Mem0 read', async () => {
  const { store } = base()
  const run = createRunStore(store)
  run.newBrief('B-NEW')
  const { counts } = await counted(async () => {
    assert.deepEqual(await run.getRecords({ type: 'brief', brief_id: 'B-NEW' }), [])
    const b = await run.createRecord({ type: 'brief', briefId: 'B-NEW', payload: { brief_version: 1 }, status: 'new', version: 1 })
    assert.equal((await run.getRecords({ type: 'brief', brief_id: 'B-NEW' }))[0].id, b.id)
    assert.equal((await run.getRecords({ type: 'review', brief_id: 'B-NEW' })).length, 0)
  })
  assert.deepEqual([counts.reads, counts.writes], [0, 1])
})

test('run store: DRY_RUN placeholders are not kept (the DRY_RUN paths hand objects over as before)', async () => {
  const restore = setSink(() => {})
  const { store } = base()
  const dry = createStore({ config: fakeConfig({ DRY_RUN: 'true' }), clientFactory: async () => fakeMem0(), cacheTtlMs: 0 })
  const run = createRunStore(dry)
  const r = await run.createRecord({ type: 'brief', briefId: 'B1', payload: {}, status: 'new' })
  restore()
  assert.equal(r.dryRun, true)
  assert.equal((await run.getRecords({ type: 'brief', brief_id: 'B1' })).length, 0)
  assert.equal(run.dryRun, true)
  assert.ok(store)
})

test('A2: an update that changes nothing is not written again (0 requests)', async () => {
  const { store } = base()
  const run = createRunStore(store)
  const d = await run.createRecord({ type: 'draft', briefId: 'B1', payload: { v: 1 }, status: 'drafted', version: 1 })
  const { counts } = await counted(async () => {
    await run.updateRecord(d.id, undefined, { status: 'drafted' })
    await run.updateRecord(d.id, undefined, { status: 'awaiting_human' })
    await run.updateRecord(d.id, undefined, { status: 'awaiting_human' })
  })
  assert.deepEqual([counts.reads, counts.writes], [0, 1])
})
