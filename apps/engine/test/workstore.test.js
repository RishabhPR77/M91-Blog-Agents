// The work store (WORK_STORE=local): a run's work in progress in work.json, Mem0 for finished posts and context.
// A fake Mem0 client counts every request. No network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStore, clearStoreCache } from '../src/store.js'
import { createRunStore } from '../src/runstore.js'
import { createEngineIndex } from '../src/engineindex.js'
import { WORK_FILE, isLocalId, preferLocalRuns, runSummary } from '../src/workstore.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig } from './helpers.js'

beforeEach(() => clearStoreCache())

function fakeMem0() {
  const memories = new Map()
  const calls = []
  const ok = (m, f) => {
    if (f.AND) return f.AND.every((x) => ok(m, x))
    if (f.agent_id) return m.agentId === f.agent_id
    if (f.run_id) return m.runId === f.run_id
    if (f.metadata) return Object.entries(f.metadata).every(([k, v]) => String(m.metadata?.[k]) === String(v))
    return true
  }
  return {
    memories,
    calls,
    async add(messages, o) {
      calls.push('add')
      const id = `uuid-${memories.size + 1}`
      memories.set(id, { id, memory: messages[0].content, metadata: o.metadata, agentId: o.agentId, runId: o.runId })
      return { results: [{ id }] }
    },
    async get(id) { calls.push('get'); return memories.get(id) },
    async update(id, body) { calls.push('update'); const m = memories.get(id); if (body.text !== undefined) m.memory = body.text; if (body.metadata) m.metadata = body.metadata; return m },
    async getAll({ filters }) { calls.push('list'); return { next: null, results: [...memories.values()].filter((m) => ok(m, filters)) } },
    async search() { calls.push('search'); return { results: [] } },
    async delete(id) { calls.push('delete'); memories.delete(id) }
  }
}

function setup({ dryRun = false, now = Date.now, overrides = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'm91-work-'))
  const config = fakeConfig({ ENGINE_DATA_DIR: dir, WORK_STORE: 'local', STORE_CACHE_TTL_MS: '0', ...overrides })
  const mem0 = fakeMem0()
  const make = () => createStore({ config, clientFactory: async () => mem0, dryRun, now })
  return { dir, config, mem0, make, store: make() }
}

test('a claimed brief keeps its work local ("w-" ids, 0 Mem0 requests); context and unclaimed briefs go to Mem0', async () => {
  const { store, mem0, dir } = setup()
  store.claimBrief('B1')
  const brief = await store.createRecord({ type: 'brief', briefId: 'B1', payload: { title: 't' }, status: 'new', version: 1 })
  const draft = await store.createRecord({ type: 'draft', briefId: 'B1', payload: { title: 't' }, status: 'drafted', version: 1, meta: { brief_version: 1 } })
  await store.updateRecord(draft.id, undefined, { status: 'awaiting_human' })
  assert.ok(isLocalId(brief.id) && isLocalId(draft.id))
  assert.deepEqual((await store.getRecords({ type: 'draft', brief_id: 'B1' })).map((r) => r.status), ['awaiting_human'])
  assert.equal((await store.getRecord(draft.id)).status, 'awaiting_human')
  assert.deepEqual(mem0.calls, [], 'nothing sent to Mem0')
  assert.ok(existsSync(join(dir, WORK_FILE)))

  const lead = await store.createRecord({ type: 'story_lead', briefId: null, payload: {}, status: 'open' })
  const old = await store.createRecord({ type: 'draft', briefId: 'OLD', payload: {}, status: 'drafted', version: 1 })
  assert.ok(!isLocalId(lead.id) && !isLocalId(old.id))
  // An unscoped list merges the local work with Mem0's.
  assert.deepEqual((await store.getRecords({ type: 'draft' })).map((r) => r.briefId).sort(), ['B1', 'OLD'])
})

test('a waiting draft survives a restart: a new store and a new engine index see it; the Memory list (held) leaves it out', async () => {
  const restore = setSink(() => {})
  const { store, make, mem0 } = setup()
  store.claimBrief('B1')
  const d = await store.createRecord({ type: 'draft', briefId: 'B1', payload: { title: 't' }, status: 'awaiting_human', version: 2 })
  await store.createRecord({ type: 'lesson', payload: {}, status: null })

  const index = createEngineIndex(make())
  await index.build(['draft'])
  assert.deepEqual((await index.getRecords({ type: 'draft', status: 'awaiting_human' })).map((r) => r.id), [d.id])
  await index.loadAll()
  assert.deepEqual((await index.getRecords({ type: 'draft', status: 'awaiting_human' })).map((r) => r.id), [d.id], 'a full Mem0 load keeps the local records')
  assert.ok(!index.held().has(d.id), 'the Memory page lists Mem0 records only')
  assert.ok([...index.held().values()].some((r) => r.type === 'lesson'))
  // A local write is announced to the index like a Mem0 write.
  await make().updateRecord(d.id, undefined, { status: 'changes_requested' })
  assert.equal((await index.getRecord(d.id)).status, 'changes_requested')
  assert.ok(mem0.calls.every((c) => c !== 'update'))
  index.close()
  restore()
})

test('promoteBrief: the final brief, approved draft, its review and guide go to Mem0 (4 writes); the local work is deleted', async () => {
  const restore = setSink(() => {})
  const { make, mem0 } = setup()
  const store = createRunStore(make())
  store.newBrief('B1')
  await store.createRecord({ type: 'brief', briefId: 'B1', payload: { brief_version: 1 }, status: 'superseded', version: 1 })
  const brief2 = await store.createRecord({ type: 'brief', briefId: 'B1', payload: { brief_version: 2 }, status: 'approved', version: 2 })
  await store.createRecord({ type: 'source_pack', briefId: 'B1', payload: {}, status: 'current' })
  await store.createRecord({ type: 'draft', briefId: 'B1', payload: { version: 1, brief_version: 2 }, status: 'superseded', version: 1, meta: { brief_version: 2 } })
  const v2 = await store.createRecord({ type: 'draft', briefId: 'B1', payload: { version: 2, brief_version: 2 }, status: 'approved', version: 2, meta: { brief_version: 2, interactive: true } })
  await store.createRecord({ type: 'review', briefId: 'B1', payload: { version: 1, brief_version: 2, pass: false }, status: 'fail', version: 1, meta: { brief_version: 2 } })
  await store.createRecord({ type: 'review', briefId: 'B1', payload: { version: 2, brief_version: 2, pass: true }, status: 'pass', version: 2, meta: { brief_version: 2 } })
  await store.createRecord({ type: 'guide_doc', briefId: 'B1', payload: { n: 1 }, status: 'ok', version: 1, meta: { brief_version: 2 } })
  await store.createRecord({ type: 'guide_doc', briefId: 'B1', payload: { n: 2 }, status: 'ok', version: 2, meta: { brief_version: 2 } })
  assert.deepEqual(mem0.calls, [])

  const r = await store.promoteBrief('B1')
  assert.deepEqual(r.created.map((x) => `${x.type}:${x.status}`), ['brief:approved', 'draft:approved', 'review:pass', 'guide_doc:ok'])
  assert.equal(r.deleted.length, 9)
  assert.deepEqual(mem0.calls, ['add', 'add', 'add', 'add'])
  const m = [...mem0.memories.values()]
  assert.equal(m.find((x) => x.metadata.type === 'draft').metadata.promoted_from, v2.id)
  assert.equal(m.find((x) => x.metadata.type === 'draft').metadata.interactive, true, 'extra metadata kept')
  assert.equal(m.find((x) => x.metadata.type === 'brief').metadata.promoted_from, brief2.id)
  assert.equal(JSON.parse(m.find((x) => x.metadata.type === 'guide_doc').memory).n, 2)
  // The run's view now holds the Mem0 copies; the brief is no longer local.
  assert.deepEqual((await store.getRecords({ type: 'draft', brief_id: 'B1' })).map((x) => isLocalId(x.id)), [false])
  assert.equal(make().isClaimed('B1'), false)
  assert.deepEqual(make().localRecords(), [])
  // Later work on the approved post (a new guide) goes to Mem0.
  assert.ok(!isLocalId((await make().createRecord({ type: 'guide_doc', briefId: 'B1', payload: {}, status: 'ok', version: 2 })).id))
  restore()
})

test('promoteBrief without an approved draft copies nothing', async () => {
  const { store, mem0 } = setup()
  store.claimBrief('B1')
  await store.createRecord({ type: 'draft', briefId: 'B1', payload: {}, status: 'rejected', version: 1 })
  assert.equal(await store.promoteBrief('B1'), null)
  assert.equal(await store.promoteBrief('NOT-LOCAL'), null)
  assert.deepEqual(mem0.calls, [])
})

test('pruneWork: local work of a rejected post and old run records go after WORK_KEEP_DAYS; a waiting draft stays', async () => {
  const restore = setSink(() => {})
  let t = Date.parse('2026-10-01T00:00:00Z')
  const { store, make } = setup({ now: () => t, overrides: { WORK_KEEP_DAYS: '7' } })
  store.claimBrief('REJ')
  store.claimBrief('WAIT')
  await store.createRecord({ type: 'draft', briefId: 'REJ', payload: {}, status: 'rejected', version: 1 })
  await store.createRecord({ type: 'draft', briefId: 'WAIT', payload: {}, status: 'awaiting_human', version: 1 })
  await store.createRecord({ type: 'run', briefId: 'R-1', payload: { run_id: 'R-1' }, status: 'succeeded' })
  t += 3 * 86400000
  assert.equal(make().pruneWork(), 0, 'nothing older than 7 days yet')
  t += 5 * 86400000
  assert.equal(make().pruneWork(), 2)
  const left = make().localRecords()
  assert.deepEqual(left.map((r) => r.briefId), ['WAIT'])
  assert.equal(make().isClaimed('REJ'), false)
  restore()
})

test('runs: the full record is local, Mem0 gets one short summary; lists prefer the local record', async () => {
  const { store, mem0 } = setup()
  const run = { run_id: 'R-1', mode: 'full', trigger: 'manual', status: 'succeeded', started_at: 'a', finished_at: 'b', ms: 5, brief_id: 'B1', result_summary: 'ok', warnings: [], steps: [{ name: 'scout', status: 'succeeded', ms: 1, ai_calls: 2, record_ids: ['x'], summary: 's' }], timeline: [{ big: true }] }
  const local = await store.createRecord({ type: 'run', briefId: 'R-1', payload: run, status: 'running' })
  assert.ok(isLocalId(local.id))
  await store.saveRunSummary(run)
  assert.deepEqual(mem0.calls, ['add'])
  const saved = JSON.parse([...mem0.memories.values()][0].memory)
  assert.equal(saved.timeline, undefined)
  assert.deepEqual(saved.steps[0], { name: 'scout', status: 'succeeded', ms: 1, ai_calls: 2, summary: 's' })
  assert.deepEqual((await store.getRecords({ type: 'run' })).map((r) => r.id), [local.id])
  assert.deepEqual(runSummary(run).summary, true)
  // Without the local record (pruned, or another machine) the summary is listed.
  assert.equal(preferLocalRuns([{ id: 'uuid-1', type: 'run', payload: { run_id: 'R-1' }, metadata: { summary: true } }]).length, 1)
})

test('DRY_RUN: no work file is written and no run summary is sent', async () => {
  const { store, mem0, dir } = setup({ dryRun: true })
  store.claimBrief('B1')
  const d = await store.createRecord({ type: 'draft', briefId: 'B1', payload: {}, status: 'drafted', version: 1 })
  assert.ok(d.dryRun)
  assert.equal(await store.saveRunSummary({ run_id: 'R', status: 'succeeded' }), null)
  assert.equal(existsSync(join(dir, WORK_FILE)), false)
  assert.deepEqual(mem0.calls, [])
})

test('WORK_STORE=mem0: createStore is the plain Mem0 store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm91-work-'))
  const store = createStore({ config: fakeConfig({ ENGINE_DATA_DIR: dir, WORK_STORE: 'mem0' }), clientFactory: async () => fakeMem0() })
  assert.equal(store.isWorkStore, undefined)
  assert.equal(store.claimBrief, undefined)
})

test('dashboard API after a full run and an engine restart: Approvals and Runs come from the local work file, no draft in Mem0', async () => {
  const restore = setSink(() => {})
  const { config, mem0, make } = setup()
  const { createRunManager } = await import('../src/runs.js')
  const { createServer } = await import('../src/server.js')
  const { stubAgents } = await import('../src/agents/stubs.js')
  const { fakeNotifier, mockReviewer } = await import('./helpers.js')
  const manager = createRunManager({ config, storeFactory: () => make(), notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
  const { run_id } = await manager.startRun({ mode: 'full', trigger: 'manual' })
  const result = await manager.wait(run_id)
  assert.equal(result.status, 'succeeded', result.run?.result_summary)
  const types = [...mem0.memories.values()].map((m) => m.metadata.type)
  assert.ok(!types.some((t) => ['brief', 'draft', 'review'].includes(t)), types.join())
  assert.deepEqual(types.filter((t) => t === 'run'), ['run'], 'one run summary')
  assert.equal(result.run.mem0.writes, result.run.mem0.requests - result.run.mem0.reads - result.run.mem0.searches)

  // The stub Writer returns no record id, so the run leaves its draft "drafted": mark it waiting, as the real Writer's would be.
  const local = make().localRecords().filter((r) => r.type === 'draft')
  assert.equal(local.length, 1)
  await make().updateRecord(local[0].id, undefined, { status: 'awaiting_human', awaiting_since: 'now' })

  // "Restart": a new manager, store and server (its own index) over the same data folder.
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager: createRunManager({ config, storeFactory: () => make(), notifierFactory: () => fakeNotifier() }), store: make(), config })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const approvals = (await (await fetch(`${base}/api/approvals`)).json()).approvals
    assert.equal(approvals.length, 1)
    assert.equal(approvals[0].brief_id, result.brief_id)
    assert.ok(isLocalId(approvals[0].record_id))
    const runs = (await (await fetch(`${base}/api/runs`)).json()).runs
    assert.equal(runs.length, 1, 'the local run record, not also its Mem0 summary')
    assert.equal(runs[0].run_id, run_id)
  } finally {
    await new Promise((r) => server.close(r))
    server.index?.close?.()
    restore()
  }
})
