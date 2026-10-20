// Phase 9 A4: the engine's index — built once, kept current by this process's writes, served with 0 Mem0
// requests; Refresh; "out of date" after another process writes; runs start from it; the CLI uses the engine.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createStore, clearStoreCache } from '../src/store.js'
import { createEngineIndex, PRELOAD_TYPES } from '../src/engineindex.js'
import { createServer } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { markWrite } from '../src/storeevents.js'
import { mem0Totals, withMem0Count } from '../src/util/mem0count.js'
import { resetEvents } from '../src/events.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { startAndWait } from '../src/cli.js'
import { runViaEngine, engineUrl } from '../src/enginecall.js'
import { fakeConfig, fakeFetch, fakeNotifier, mockReviewer } from './helpers.js'

beforeEach(() => {
  clearStoreCache()
  resetEvents()
})

/** A fake Mem0 (sync adds) shared by several real stores, like one Mem0 account used by many store instances. */
function fakeMem0() {
  const memories = new Map()
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
      return { results: [{ id }] }
    },
    async get(id) { return memories.get(id) },
    async update(id, body) {
      const m = memories.get(id)
      if (body.text !== undefined) m.memory = body.text
      if (body.metadata) m.metadata = body.metadata
      return m
    },
    async getAll({ filters }) { return { next: null, results: [...memories.values()].filter((m) => ok(m, filters)) } },
    async search() { return { results: [] } },
    async delete(id) { memories.delete(id) }
  }
}
const quiet = () => setSink(() => {})
const delta = (before) => {
  const after = mem0Totals()
  return { reads: after.reads - before.reads, searches: after.searches - before.searches, writes: after.writes - before.writes }
}

function world(env = {}) {
  const mem0 = fakeMem0()
  const config = fakeConfig(env)
  const make = () => createStore({ config, clientFactory: async () => mem0, cacheTtlMs: 0 })
  return { mem0, config, make }
}

test('built once (one read per preloaded type), then lists cost 0 Mem0 requests', async () => {
  const w = world()
  const base = w.make()
  await base.createRecord({ type: 'draft', briefId: 'B1', payload: { title: 'T' }, status: 'awaiting_human', version: 1 })
  const index = createEngineIndex(base, { config: w.config })
  const b0 = mem0Totals()
  await index.build()
  assert.equal(delta(b0).reads, PRELOAD_TYPES.length)
  const b1 = mem0Totals()
  for (let i = 0; i < 3; i++) {
    assert.equal((await index.getRecords({ type: 'draft', status: 'awaiting_human' })).length, 1)
    await index.getRecords({ type: 'run' })
    await index.getOne('draft', 'B1')
  }
  assert.deepEqual(delta(b1), { reads: 0, searches: 0, writes: 0 })
  index.close()
})

test('writes by any store of this process (same Mem0 agent) update the index with no read', async () => {
  const w = world()
  const index = createEngineIndex(w.make(), { config: w.config })
  await index.build()
  const runStore = w.make()
  const d = await runStore.createRecord({ type: 'draft', briefId: 'B2', payload: { title: 'New' }, status: 'drafted', version: 1 })
  await runStore.updateRecord(d.id, undefined, { status: 'awaiting_human' })
  const b = mem0Totals()
  const waiting = await index.getRecords({ type: 'draft', status: 'awaiting_human' })
  assert.deepEqual(waiting.map((r) => r.id), [d.id])
  assert.equal((await index.getRecord(d.id)).payload.title, 'New')
  await runStore.deleteRecord(d.id)
  assert.equal((await index.getRecords({ type: 'draft' })).length, 0)
  assert.equal(delta(b).reads, 0)
  index.close()
})

test('another process wrote (write marker with another pid) → out of date; Refresh reloads and clears it', async () => {
  const w = world()
  let t = 1_000_000
  const index = createEngineIndex(w.make(), { config: w.config, now: () => t })
  await index.build()
  assert.equal(index.status().out_of_date, false)
  // A write by this process does not count.
  t += 10
  markWrite(w.config, { now: () => t })
  assert.equal(index.status().out_of_date, false)
  // A CLI process wrote after the index was loaded.
  t += 10
  markWrite(w.config, { pid: 424242, now: () => t })
  assert.equal(index.status().out_of_date, true)
  // Mem0 has a record the index never saw (written by that other process).
  w.mem0.memories.set('uuid-cli', { id: 'uuid-cli', memory: '{"topic":"from the CLI"}', metadata: { type: 'pinned_topic', status: 'open' }, agentId: w.config.mem0.agentId })
  assert.equal((await index.getRecords({ type: 'pinned_topic' })).length, 0)
  t += 10
  const b = mem0Totals()
  const status = await index.refresh()
  assert.equal(delta(b).reads, PRELOAD_TYPES.length)
  assert.equal(status.out_of_date, false)
  assert.equal((await index.getRecords({ type: 'pinned_topic' })).length, 1)
  index.close()
})

test('API: list pages and the run page are served with 0 Mem0 requests; health shows the index; POST /api/index/refresh', async () => {
  const restore = quiet()
  const w = world()
  const base = w.make()
  const manager = createRunManager({ config: w.config, storeFactory: () => w.make(), notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store: base, config: w.config })
  await server.index.build()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    const { run_id } = await (await fetch(`${url}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"mode":"full"}' })).json()
    await manager.wait(run_id)
    const b = mem0Totals()
    for (const path of ['/api/runs', '/api/approvals', '/api/posts', '/api/pinned', '/api/records?type=draft', `/api/runs/${run_id}`, '/api/health']) {
      const res = await fetch(url + path)
      assert.equal(res.status, 200, path)
    }
    const detail = await (await fetch(`${url}/api/runs/${run_id}`)).json()
    assert.equal(detail.run.status, 'succeeded')
    const drafts = await (await fetch(`${url}/api/records?type=draft`)).json()
    assert.equal(drafts.records.length, 1, 'the run\'s draft is in the index')
    // /api/runs/:id lists produced records of types not preloaded: those load once. The rest: 0.
    const first = delta(b)
    const b2 = mem0Totals()
    for (const path of ['/api/runs', '/api/approvals', '/api/posts', '/api/records?type=draft', `/api/runs/${run_id}`]) await fetch(url + path)
    assert.deepEqual(delta(b2), { reads: 0, searches: 0, writes: 0 }, `first pass loaded ${first.reads} type(s)`)
    const health = await (await fetch(`${url}/api/health`)).json()
    assert.ok(health.index.loaded_at)
    assert.equal(health.index.out_of_date, false)
    const refreshed = await (await fetch(`${url}/api/index/refresh`, { method: 'POST' })).json()
    assert.equal(refreshed.index.out_of_date, false)
  } finally {
    await new Promise((r) => server.close(r))
    restore()
  }
})

test('runs start from the index: an approve run reads nothing from Mem0 for its draft and brief', async () => {
  const restore = quiet()
  const w = world()
  const base = w.make()
  const brief = await base.createRecord({ type: 'brief', briefId: 'B3', payload: { brief_id: 'B3', brief_version: 1, titles: ['T'] }, status: 'awaiting_human', version: 1 })
  await base.createRecord({ type: 'draft', briefId: 'B3', payload: { title: 'T', version: 1, brief_version: 1, post_markdown: '# T\n\nText.', checks: { hard_passed: true, results: [] } }, status: 'awaiting_human', version: 1, meta: { brief_version: 1 } })
  await base.createRecord({ type: 'review', briefId: 'B3', payload: { brief_id: 'B3', version: 1, brief_version: 1, pass: true, total: 90, feedback: [] }, status: 'pass', version: 1, meta: { brief_version: 1 } })
  const manager = createRunManager({ config: w.config, storeFactory: () => w.make(), notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents }) })
  const index = createEngineIndex(base, { config: w.config })
  manager.useIndex(index)
  await index.build([...PRELOAD_TYPES, 'question_cluster', 'story_lead', 'tutorial_lead', 'promo_pack', 'block_doc'])
  const { run_id } = await manager.startRun({ mode: 'approve', params: { brief_id: 'B3' } })
  const r = await manager.wait(run_id)
  restore()
  assert.equal(r.status, 'succeeded', r.error)
  assert.equal(r.run.mem0.reads, 0, JSON.stringify(r.run.mem0))
  assert.equal((await index.getRecord(brief.id)).status, 'approved', 'the run\'s writes reached the index')
  index.close()
})

test('CLI: startAndWait goes through the running engine when it answers, else runs in this process', async () => {
  const lines = []
  const via = []
  const r = await startAndWait(fakeConfig(), { mode: 'publish', params: { brief_id: 'B' }, engineUrlFn: async () => 'http://127.0.0.1:9', viaEngine: async (base, o) => { via.push([base, o.mode, o.params]); return { status: 'succeeded', run: { run_id: 'R-1' } } }, print: (l) => lines.push(l) })
  assert.equal(r.status, 'succeeded')
  assert.deepEqual(via, [['http://127.0.0.1:9', 'publish', { brief_id: 'B' }]])
  assert.match(lines[0], /Running through the engine at http:\/\/127\.0\.0\.1:9/)
  let started = null
  const local = await startAndWait(fakeConfig(), { mode: 'scout', engineUrlFn: async () => null, managerFactory: () => ({ startRun: async (o) => { started = o; return { run_id: 'R-2' } }, wait: async () => ({ status: 'succeeded' }) }) })
  assert.equal(local.status, 'succeeded')
  assert.equal(started.trigger, 'cli')
})

test('runViaEngine: posts the run, then waits on the run detail; engineUrl is null when the dashboard needs a login', async () => {
  let polls = 0
  const fetch = fakeFetch((url, init) => {
    if (url.endsWith('/api/runs') && init.method === 'POST') return { status: 202, body: { run_id: 'R-261020-1200-ABCD' } }
    polls++
    return { body: { run: { run_id: 'R-261020-1200-ABCD', status: polls < 3 ? 'running' : 'succeeded', result_summary: 'ok' } } }
  })
  const r = await runViaEngine('http://127.0.0.1:9', { mode: 'publish', params: { brief_id: 'B' }, fetch, sleepFn: async () => {} })
  assert.equal(r.status, 'succeeded')
  assert.equal(polls, 3)
  assert.deepEqual(fetch.calls[0].body, { mode: 'publish', params: { brief_id: 'B' } })
  assert.equal(await engineUrl(fakeConfig({ DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'x'.repeat(12) })), null)
})
