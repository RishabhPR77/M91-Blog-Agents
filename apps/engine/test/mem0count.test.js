// The Mem0 call counter: scopes, the store's counting, totals in the run record and run.finished, and the
// per-request log line. No network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { countMem0, withMem0Count, currentMem0Counts, mem0Requests } from '../src/util/mem0count.js'
import { createStore, clearStoreCache } from '../src/store.js'
import { createRunManager } from '../src/runs.js'
import { createServer } from '../src/server.js'
import { replay, resetEvents } from '../src/events.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, fakeFetch, memoryStore, fakeNotifier, mockReviewer } from './helpers.js'

beforeEach(() => {
  resetEvents()
  clearStoreCache()
})

test('scopes: each scope counts its own calls; concurrent scopes stay apart; nothing counted outside a scope', async () => {
  countMem0('reads')
  assert.equal(currentMem0Counts(), null)
  const a = withMem0Count(async () => {
    countMem0('reads')
    await new Promise((r) => setTimeout(r, 5))
    countMem0('writes')
    const inner = withMem0Count(() => countMem0('searches'))
    return inner.counts
  })
  const b = withMem0Count(async () => {
    countMem0('searches', 2)
    countMem0('nonsense')
  })
  const inner = await a.result
  await b.result
  assert.deepEqual(a.counts, { reads: 1, searches: 0, writes: 1, cache_hits: 0 }, 'the inner scope took its own search')
  assert.deepEqual(inner, { reads: 0, searches: 1, writes: 0, cache_hits: 0 })
  assert.deepEqual(b.counts, { reads: 0, searches: 2, writes: 0, cache_hits: 0 })
  assert.equal(mem0Requests(a.counts), 2)
})

/** A fake Mem0 client and event endpoint, enough for createRecord / getRecords / searchSimilar / delete. */
function fakeMem0() {
  const memories = new Map()
  return {
    async add(messages, o) { const id = `uuid-${memories.size + 1}`; memories.set(id, { id, memory: messages[0].content, metadata: o.metadata, agentId: o.agentId }); return { eventId: `evt-${id}` } },
    async get(id) { return memories.get(id) },
    async update(id, body) { const m = memories.get(id); if (body.metadata) m.metadata = body.metadata; return m },
    async getAll() { return { next: null, results: [...memories.values()] } },
    async search() { return { results: [] } },
    async delete(id) { memories.delete(id) }
  }
}

test('the store counts each request by kind, and cache hits separately', async () => {
  const mem0 = fakeMem0()
  const fetch = fakeFetch((url) => ({ body: { status: 'SUCCEEDED', results: [{ id: url.match(/evt-(uuid-\d+)/)[1] }] } }))
  const store = createStore({ config: fakeConfig(), clientFactory: async () => mem0, fetch, sleepFn: async () => {}, cacheTtlMs: 30000, dryRun: false })
  const { counts, result } = withMem0Count(async () => {
    const r = await store.createRecord({ type: 'draft', briefId: 'b', payload: {}, version: 1 })
    await store.getRecords({ type: 'draft' })
    await store.getRecords({ type: 'draft' })
    await store.getRecord(r.id)
    await store.getRecord(r.id)
    await store.searchSimilar('x', { type: 'draft' })
    await store.updateRecord(r.id, undefined, { status: 'approved' })
    await store.deleteRecord(r.id)
  })
  await result
  // writes: add, update, delete; reads: 1 event poll, 1 list page, 1 get (+1 get inside updateRecord); searches: 1.
  assert.equal(counts.writes, 3)
  assert.equal(counts.searches, 1)
  assert.ok(counts.reads >= 3, `reads ${counts.reads}`)
  assert.ok(counts.cache_hits >= 2, `cache hits ${counts.cache_hits}`)
})

/** memoryStore whose methods count like the real store. */
function countingStore() {
  const store = memoryStore()
  for (const [m, kind] of [['createRecord', 'writes'], ['updateRecord', 'writes'], ['deleteRecord', 'writes'], ['getRecords', 'reads'], ['getRecord', 'reads'], ['searchSimilar', 'searches']]) {
    const fn = store[m].bind(store)
    store[m] = async (...a) => { countMem0(kind); return fn(...a) }
  }
  return store
}

test('a run saves its Mem0 totals in the run record, and run.finished carries the full count', async () => {
  const restore = setSink(() => {})
  const store = countingStore()
  const manager = createRunManager({ config: fakeConfig(), storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
  // A request scope around startRun: the run's calls must not count there.
  const outer = withMem0Count(() => manager.startRun({ mode: 'full', trigger: 'manual' }))
  const { run_id } = await outer.result
  const result = await manager.wait(run_id)
  restore()
  const saved = result.run.mem0
  // Phase 9: the run context serves this stub run's lists from its own writes, so it reads nothing.
  assert.ok(saved.writes > 0, JSON.stringify(saved))
  assert.equal(saved.reads, 0, JSON.stringify(saved))
  assert.equal(saved.requests, saved.reads + saved.searches + saved.writes)
  const finished = replay(run_id).at(-1)
  assert.equal(finished.type, 'run.finished')
  assert.equal(finished.data.mem0.writes, saved.writes + 1, 'run.finished also counts the final save of the run record')
  assert.equal(mem0Requests(outer.counts), 0, 'the request scope does not count the run')
})

test('API: one "api Mem0 calls" log line per request that used Mem0 (method, path, status, counts; no headers)', async () => {
  const lines = []
  const restore = setSink((_level, line) => lines.push(line))
  const store = countingStore()
  const config = fakeConfig()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    await fetch(`${base}/api/records?type=draft`)
    await fetch(`${base}/api/health`)
    await new Promise((r) => setTimeout(r, 20))
  } finally {
    await new Promise((r) => server.close(r))
    restore()
  }
  const api = lines.map((l) => JSON.parse(l)).filter((l) => l.msg === 'api Mem0 calls')
  const records = api.find((l) => l.path === '/api/records')
  assert.ok(records, JSON.stringify(api))
  assert.deepEqual([records.method, records.status, records.mem0.reads >= 1, records.level], ['GET', 200, true, 'info'])
  assert.ok(!JSON.stringify(api).includes('headers'))
  assert.ok(!api.some((l) => l.path === '/api/health' && l.level === 'info'), 'no Mem0 calls → debug only')
})
