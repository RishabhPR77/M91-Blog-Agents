import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore, RECORD_TYPES } from '../src/store.js'
import { fakeConfig, fakeFetch } from './helpers.js'

function fakeMem0() {
  const calls = []
  const memories = new Map()
  return {
    calls,
    memories,
    async add(messages, options) {
      calls.push(['add', messages, options])
      const id = `uuid-${memories.size + 1}`
      memories.set(id, { id, memory: messages[0].content, metadata: options.metadata, agentId: options.agentId, runId: options.runId })
      return { eventId: `evt-${id}`, status: 'PENDING' }
    },
    async get(id) { return memories.get(id) },
    async update(id, body) {
      calls.push(['update', id, body])
      const m = memories.get(id)
      if (body.text !== undefined) m.memory = body.text
      if (body.metadata) m.metadata = body.metadata
      return m
    },
    async getAll(options) {
      calls.push(['getAll', options])
      return { count: memories.size, next: null, results: [...memories.values()] }
    },
    async search(query, options) {
      calls.push(['search', query, options])
      return { results: [...memories.values()].map((m) => ({ ...m, score: 0.9 })) }
    },
    async delete(id) { memories.delete(id) }
  }
}

function setup() {
  const mem0 = fakeMem0()
  const fetch = fakeFetch((url) => {
    const id = url.match(/evt-(uuid-\d+)/)[1]
    return { body: { id: 'evt', status: 'SUCCEEDED', results: [{ id }] } }
  })
  const store = createStore({ config: fakeConfig(), clientFactory: async () => mem0, fetch, sleepFn: async () => {} })
  return { mem0, fetch, store }
}

test('all record types are supported', () => {
  for (const t of ['question_cluster', 'story_lead', 'tutorial_lead', 'tone_profile', 'brief', 'draft', 'review', 'promo_pack', 'run_log', 'lesson', 'lock']) {
    assert.ok(RECORD_TYPES.includes(t))
  }
})

test('createRecord: one memory, agent_id + run_id, metadata, infer=false, JSON content; id from the event', async () => {
  const { mem0, fetch, store } = setup()
  const r = await store.createRecord({ type: 'brief', briefId: '261017-1405-ABCD', payload: { a: 1 }, status: 'active', version: 1, topicGroup: 'g' })
  assert.equal(r.id, 'uuid-1')
  const [, messages, options] = mem0.calls[0]
  assert.equal(messages[0].content, '{"a":1}')
  assert.equal(options.agentId, 'm91-blog')
  assert.equal(options.runId, '261017-1405-ABCD')
  assert.equal(options.infer, false)
  assert.equal(options.metadata.type, 'brief')
  assert.equal(options.metadata.brief_id, '261017-1405-ABCD')
  assert.equal(options.metadata.version, 1)
  assert.equal(options.metadata.topic_group, 'g')
  assert.match(options.metadata.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(fetch.calls[0].url, /\/v1\/event\/evt-uuid-1\/$/)
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Token m0-fakekeyfortests123')
})

test('updateRecord updates by id in place, merging metadata', async () => {
  const { mem0, store } = setup()
  const r = await store.createRecord({ type: 'draft', briefId: 'b', payload: { v: 1 }, version: 1 })
  await store.updateRecord(r.id, { v: 2 }, { status: 'reviewed' })
  assert.equal(mem0.calls.filter((c) => c[0] === 'add').length, 1)
  const [, id, body] = mem0.calls.find((c) => c[0] === 'update')
  assert.equal(id, r.id)
  assert.equal(body.text, '{"v":2}')
  assert.equal(body.metadata.status, 'reviewed')
  assert.equal(body.metadata.type, 'draft')
})

test('getRecords / getOne filter by metadata; entity ids go in filters', async () => {
  const { mem0, store } = setup()
  await store.createRecord({ type: 'draft', briefId: 'b', payload: { v: 1 }, version: 1 })
  await store.createRecord({ type: 'draft', briefId: 'b', payload: { v: 2 }, version: 2 })
  await store.createRecord({ type: 'review', briefId: 'b', payload: {}, version: 1 })
  const drafts = await store.getRecords({ type: 'draft', brief_id: 'b' })
  assert.equal(drafts.length, 2)
  const getAll = mem0.calls.find((c) => c[0] === 'getAll')[1]
  assert.deepEqual(getAll.filters, { AND: [{ agent_id: 'm91-blog' }, { run_id: 'b' }] })
  assert.equal(getAll.agentId, undefined)
  assert.deepEqual((await store.getOne('draft', 'b')).payload, { v: 2 })
  assert.deepEqual((await store.getOne('draft', 'b', 1)).payload, { v: 1 })
})

test('addLesson uses infer=true', async () => {
  const { mem0, store } = setup()
  await store.addLesson('Short intros work better.')
  const [, , options] = mem0.calls.find((c) => c[0] === 'add')
  assert.equal(options.infer, true)
  assert.equal(options.metadata.type, 'lesson')
})

test('DRY_RUN: no Mem0 writes except run_log, which carries dry_run: true', async () => {
  const mem0 = fakeMem0()
  const fetch = fakeFetch((url) => ({ body: { status: 'SUCCEEDED', results: [{ id: url.match(/evt-(uuid-\d+)/)[1] }] } }))
  const store = createStore({ config: fakeConfig({ DRY_RUN: 'true' }), clientFactory: async () => mem0, fetch, sleepFn: async () => {} })
  const brief = await store.createRecord({ type: 'brief', briefId: 'b', payload: {} })
  const lock = await store.createRecord({ type: 'lock', payload: {} })
  assert.match(brief.id, /^dryrun-/)
  await store.updateRecord(brief.id, { x: 1 })
  await store.deleteRecord(lock.id)
  await store.addLesson('x')
  assert.equal(mem0.calls.filter((c) => c[0] === 'add' || c[0] === 'update').length, 0)

  const log = await store.createRecord({ type: 'run_log', briefId: 'b', payload: { agent: 'scout' } })
  assert.equal(log.id, 'uuid-1')
  const [, messages, options] = mem0.calls.find((c) => c[0] === 'add')
  assert.equal(options.metadata.dry_run, true)
  assert.equal(JSON.parse(messages[0].content).dry_run, true)
})

test('run_log outside DRY_RUN carries dry_run: false', async () => {
  const { mem0, store } = setup()
  await store.createRecord({ type: 'run_log', briefId: 'b', payload: {} })
  assert.equal(mem0.calls[0][2].metadata.dry_run, false)
})

test('unknown record type is rejected', async () => {
  const { store } = setup()
  await assert.rejects(store.createRecord({ type: 'nope', payload: {} }), /Unknown record type/)
})

test('Mem0 network blips are retried for safe calls (search), but a new-record add is not retried', async () => {
  const { isNetworkError } = await import('../src/store.js')
  const blip = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
  assert.equal(isNetworkError(blip()), true)
  assert.equal(isNetworkError(new Error('HTTP 400 bad request')), false)

  let searches = 0
  let adds = 0
  const client = {
    async search() { if (++searches < 3) throw blip(); return { results: [] } },
    async add() { adds++; throw blip() }
  }
  const store = createStore({ config: fakeConfig(), clientFactory: async () => client, fetch: fakeFetch(() => ({})), sleepFn: async () => {} })
  assert.deepEqual(await store.searchSimilar('x'), [])
  assert.equal(searches, 3)
  await assert.rejects(store.createRecord({ type: 'brief', payload: {} }), /fetch failed/)
  assert.equal(adds, 1)
})

test('versions come back as numbers even when Mem0 returns metadata as strings ("1" + 1 = 2, not "11")', async () => {
  const { toRecord } = await import('../src/store.js')
  assert.equal(toRecord({ id: 'a', memory: '{}', metadata: { type: 'draft', version: '1' } }).version, 1)
  assert.equal(toRecord({ id: 'a', memory: '{}', metadata: { type: 'draft', version: 3 } }).version, 3)
  assert.equal(toRecord({ id: 'a', memory: '{}', metadata: { type: 'draft', version: null } }).version, null)
  assert.equal(toRecord({ id: 'a', memory: '{}', metadata: { type: 'draft', version: '1' } }).version + 1, 2)
})
