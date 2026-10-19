// Phase 7 Part A: server-side Mem0 filters, the in-process read cache and its invalidation. No network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createStore, clearStoreCache } from '../src/store.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, fakeFetch } from './helpers.js'

beforeEach(() => clearStoreCache())

/** A fake Mem0 that honours agent_id / run_id / metadata filters, like the Platform's v2 filters. */
function fakeMem0({ refuseMetadata = false } = {}) {
  const calls = []
  const memories = new Map()
  const ok = (m, f) => {
    if (f.AND) return f.AND.every((x) => ok(m, x))
    if (f.agent_id) return m.agentId === f.agent_id
    if (f.run_id) return m.runId === f.run_id
    if (f.metadata) return Object.entries(f.metadata).every(([k, v]) => m.metadata?.[k] === v)
    return true
  }
  return {
    calls,
    memories,
    async add(messages, options) {
      calls.push(['add'])
      const id = `uuid-${memories.size + 1}`
      memories.set(id, { id, memory: messages[0].content, metadata: options.metadata, agentId: options.agentId, runId: options.runId })
      return { eventId: `evt-${id}`, status: 'PENDING' }
    },
    async get(id) { calls.push(['get', id]); return memories.get(id) },
    async update(id, body) {
      calls.push(['update', id])
      const m = memories.get(id)
      if (body.text !== undefined) m.memory = body.text
      if (body.metadata) m.metadata = body.metadata
      return m
    },
    async getAll({ filters }) {
      calls.push(['getAll', filters])
      if (refuseMetadata && JSON.stringify(filters).includes('"metadata"')) throw Object.assign(new Error('FilterValidationError: metadata filters are not allowed'), { status: 400 })
      return { next: null, results: [...memories.values()].filter((m) => ok(m, filters)) }
    },
    async delete(id) { calls.push(['delete', id]); memories.delete(id) }
  }
}

function setup({ ttl = 30000, refuseMetadata = false } = {}) {
  const mem0 = fakeMem0({ refuseMetadata })
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms) => { t += ms } }
  const fetch = fakeFetch((url) => ({ body: { status: 'SUCCEEDED', results: [{ id: url.match(/evt-(uuid-\d+)/)[1] }] } }))
  const make = () => createStore({ config: fakeConfig(), clientFactory: async () => mem0, fetch, sleepFn: async () => {}, cacheTtlMs: ttl, now: clock.now, dryRun: false })
  return { mem0, clock, store: make(), make }
}
const lists = (mem0) => mem0.calls.filter((c) => c[0] === 'getAll').length
const lastFilters = (mem0) => mem0.calls.filter((c) => c[0] === 'getAll').at(-1)[1]

test('server-side filters: type and status go to Mem0 as metadata filters with agent_id (and run_id for a brief)', async () => {
  const s = setup({ ttl: 0 })
  await s.store.createRecord({ type: 'draft', briefId: 'b', payload: {}, status: 'approved', version: 1 })
  await s.store.createRecord({ type: 'review', briefId: 'b', payload: {}, version: 1 })
  await s.store.createRecord({ type: 'draft', payload: {}, status: 'drafted', version: 1 })
  const approved = await s.store.getRecords({ type: 'draft', status: 'approved' })
  assert.equal(approved.length, 1)
  assert.deepEqual(lastFilters(s.mem0), { AND: [{ agent_id: 'm91-blog' }, { metadata: { type: 'draft' } }, { metadata: { status: 'approved' } }] })
  await s.store.getRecords({ brief_id: 'b' })
  assert.deepEqual(lastFilters(s.mem0), { AND: [{ agent_id: 'm91-blog' }, { run_id: 'b' }] })
  assert.equal((await s.store.getRecords({})).length, 3)
  assert.deepEqual(lastFilters(s.mem0), { agent_id: 'm91-blog' })
})

test('a run is found by its run_id with one small filtered read (no full scan)', async () => {
  const s = setup({ ttl: 0 })
  for (const id of ['R-1', 'R-2', 'R-3']) await s.store.createRecord({ type: 'run', briefId: id, payload: { run_id: id } })
  await s.store.createRecord({ type: 'run_log', briefId: 'R-2', payload: {} })
  const found = await s.store.getRecords({ type: 'run', brief_id: 'R-2' })
  assert.deepEqual(found.map((r) => r.payload.run_id), ['R-2'])
  assert.deepEqual(lastFilters(s.mem0), { AND: [{ agent_id: 'm91-blog' }, { run_id: 'R-2' }, { metadata: { type: 'run' } }] })
})

test('cache: a second identical read is a hit; a different filter is a miss; getRecord is cached too', async () => {
  const s = setup()
  const d = await s.store.createRecord({ type: 'draft', briefId: 'b', payload: { v: 1 }, version: 1 })
  await s.store.getRecords({ type: 'draft' })
  await s.store.getRecords({ type: 'draft' })
  assert.equal(lists(s.mem0), 1, 'hit')
  await s.store.getRecords({ type: 'review' })
  assert.equal(lists(s.mem0), 2, 'other filter: miss')
  await s.store.getRecords({ type: 'draft', version: 1 })
  assert.equal(lists(s.mem0), 2, 'version is filtered in code, on the cached list')
  await s.store.getRecord(d.id)
  await s.store.getRecord(d.id)
  assert.equal(s.mem0.calls.filter((c) => c[0] === 'get').length, 1)
})

test('cache: every write clears the lists (create, update, delete, addLesson), from any store of the same agent', async () => {
  const s = setup()
  const other = s.make() // e.g. the run manager's store; s.store plays the API's store
  const d = await s.store.createRecord({ type: 'draft', briefId: 'b', payload: {}, version: 1 })
  const read = async () => s.store.getRecords({ type: 'draft' })
  for (const write of [
    () => other.createRecord({ type: 'draft', briefId: 'b', payload: {}, version: 2 }),
    () => other.updateRecord(d.id, undefined, { status: 'approved' }),
    () => other.addLesson('A lesson.'),
    () => other.deleteRecord(d.id)
  ]) {
    await read()
    const before = lists(s.mem0)
    await read()
    assert.equal(lists(s.mem0), before, 'cached')
    await write()
    await read()
    assert.equal(lists(s.mem0), before + 1, 'refetched after the write')
  }
  assert.ok(!(await read()).some((r) => r.id === d.id), 'the deleted record is gone')
})

test('cache: an update refreshes the cached record; TTL expiry refetches; STORE_CACHE_TTL_MS=0 turns it off', async () => {
  const s = setup()
  const d = await s.store.createRecord({ type: 'draft', briefId: 'b', payload: {}, version: 1 })
  await s.store.getRecord(d.id)
  await s.store.updateRecord(d.id, undefined, { status: 'approved' })
  const gets = s.mem0.calls.filter((c) => c[0] === 'get').length
  assert.equal((await s.store.getRecord(d.id)).status, 'approved')
  assert.equal(s.mem0.calls.filter((c) => c[0] === 'get').length, gets, 'served from the refreshed cache')
  await s.store.getRecords({ type: 'draft' })
  s.clock.advance(29_999)
  await s.store.getRecords({ type: 'draft' })
  assert.equal(lists(s.mem0), 1)
  s.clock.advance(2)
  await s.store.getRecords({ type: 'draft' })
  assert.equal(lists(s.mem0), 2, 'expired after 30 s')

  clearStoreCache()
  const off = setup({ ttl: 0 })
  await off.store.getRecords({ type: 'draft' })
  await off.store.getRecords({ type: 'draft' })
  assert.equal(lists(off.mem0), 2)
  assert.equal(fakeConfig({ STORE_CACHE_TTL_MS: '30000' }).mem0.cacheTtlMs, 30000)
})

test('if Mem0 refuses metadata filters, lists fall back to agent/run filters (filtered in code) for the process', async () => {
  const restore = setSink(() => {})
  const s = setup({ ttl: 0, refuseMetadata: true })
  await s.store.createRecord({ type: 'draft', briefId: 'b', payload: {}, version: 1 })
  await s.store.createRecord({ type: 'review', briefId: 'b', payload: {}, version: 1 })
  assert.equal((await s.store.getRecords({ type: 'draft' })).length, 1)
  assert.deepEqual(lastFilters(s.mem0), { agent_id: 'm91-blog' })
  await s.store.getRecords({ type: 'review' })
  assert.ok(!JSON.stringify(lastFilters(s.mem0)).includes('metadata'), 'not tried again')
  restore()
})

test('a quota or rate limit (429) is thrown as is: filters stay on and no unfiltered retry is sent', async () => {
  const restore = setSink(() => {})
  const s = setup({ ttl: 0 })
  await s.store.createRecord({ type: 'draft', briefId: 'b', payload: {}, version: 1 })
  const getAll = s.mem0.getAll
  s.mem0.getAll = async (opts) => {
    s.mem0.calls.push(['getAll', opts.filters])
    throw Object.assign(new Error('Usage quota exceeded for this billing period'), { name: 'RateLimitError', errorCode: 'HTTP_429' })
  }
  await assert.rejects(s.store.getRecords({ type: 'draft' }), /quota exceeded/)
  assert.ok(s.mem0.calls.filter((c) => c[0] === 'getAll').every((c) => JSON.stringify(c[1]).includes('metadata')), 'never retried without the metadata filters')
  s.mem0.getAll = getAll
  await s.store.getRecords({ type: 'draft' })
  assert.ok(JSON.stringify(lastFilters(s.mem0)).includes('"metadata"'), 'filters still on afterwards')
  restore()
})
