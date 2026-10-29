// Memory manager: why a record may not be useful, protection, filters, GET /api/memory (0 Mem0 requests),
// POST /api/memory/load-all (one paged list) and DELETE /api/records (checks, 1 request per delete). Fakes only.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { judgeRecords, filterRows, planDelete } from '../src/memory.js'
import { createEngineIndex } from '../src/engineindex.js'
import { createServer } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { resetEvents } from '../src/events.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer } from './helpers.js'

beforeEach(() => resetEvents())

const NOW = Date.parse('2026-10-23T12:00:00Z')
const B1 = '261001-1000-AAAA'
const B2 = '261002-1000-BBBB'
let n = 0
const rec = (type, extra = {}) => ({ id: `m${++n}`, type, briefId: null, status: null, version: null, payload: {}, metadata: { type }, createdAt: '2026-10-22T00:00:00Z', ...extra })
const reasons = (j, r) => j.get(r.id).reasons.map((x) => x.code)

test('judgeRecords: dead statuses, dry runs, rejected and superseded briefs, briefs with no draft, duplicates, stale leads', () => {
  const b1v1 = rec('brief', { briefId: B1, status: 'superseded', version: 1, payload: { brief_version: 1 } })
  const b1v2 = rec('brief', { briefId: B1, status: 'rejected', version: 2, payload: { brief_version: 2 } })
  const d1 = rec('draft', { briefId: B1, status: 'rejected', version: 1, metadata: { type: 'draft', brief_version: 2 } })
  const r1 = rec('review', { briefId: B1, status: 'fail', version: 1, metadata: { type: 'review', brief_version: 2 } })
  const lonely = rec('brief', { briefId: B2, status: 'new', version: 1, payload: { brief_version: 1 }, createdAt: '2026-08-01T00:00:00Z' })
  const orphan = rec('draft', { briefId: '260101-0000-ZZZZ', status: 'drafted', version: 1 })
  const dry = rec('run', { payload: { dry_run: true, run_id: 'R-1' } })
  const lead = rec('question_cluster', { status: 'open', payload: { cluster_id: 'C-1', main_question: 'What is a callback?' }, createdAt: '2026-07-01T00:00:00Z' })
  const leadCopy = rec('question_cluster', { status: 'open', payload: { cluster_id: 'C-2', main_question: 'What is a  callback?' }, createdAt: '2026-10-20T00:00:00Z' })
  const usedLead = rec('story_lead', { status: 'open', payload: { story_id: 'S-9', title: 'A story' }, createdAt: '2026-07-01T00:00:00Z' })
  const briefUsingStory = rec('brief', { briefId: '261003-1000-CCCC', status: 'drafted', version: 1, payload: { brief_version: 1, story: { story_id: 'S-9' } } })
  const fine = rec('m91_facts', { status: 'current' })
  const j = judgeRecords([b1v1, b1v2, d1, r1, lonely, orphan, dry, lead, leadCopy, usedLead, briefUsingStory, fine], { now: NOW, staleDays: 30 })
  assert.deepEqual(reasons(j, b1v1), ['status', 'brief_dead'])
  assert.deepEqual(reasons(j, d1), ['status', 'brief_dead'])
  assert.ok(reasons(j, r1).includes('brief_dead'))
  assert.match(j.get(r1.id).reasons.find((x) => x.code === 'brief_dead').text, /rejected/)
  assert.deepEqual(reasons(j, lonely), ['no_draft'])
  assert.deepEqual(reasons(j, orphan), ['orphan'])
  assert.deepEqual(reasons(j, dry), ['test'])
  assert.deepEqual(reasons(j, lead), ['stale', 'duplicate'])
  assert.match(j.get(lead.id).reasons[1].text, new RegExp(leadCopy.id))
  assert.deepEqual(reasons(j, leadCopy), [], 'the newest copy is kept')
  assert.deepEqual(reasons(j, usedLead), [], 'a brief refers to it')
  assert.deepEqual(reasons(j, fine), [])
})

test('judgeRecords: protection — published posts, current facts/tone, approved posts and their exports, the editor’s picks', () => {
  const post = rec('published_post', { briefId: B1, status: 'published', payload: { brief_id: B1 } })
  const draft = rec('draft', { briefId: B1, status: 'approved', version: 1 })
  const brief = rec('brief', { briefId: B1, status: 'approved', version: 1, payload: { brief_version: 1 } })
  const exp = rec('markdown_export', { briefId: B1, status: 'final', version: 1 })
  const facts = rec('m91_facts', { status: 'current' })
  const oldFacts = rec('m91_facts', { status: 'old' })
  const pick = rec('weekly_pick', { status: 'written' })
  const oldRoadmap = rec('roadmap', { status: 'approved' })
  const lesson = rec('lesson', { payload: 'Explain jargon.' })
  const pin = rec('pinned_topic', { status: 'open' })
  const know = rec('knowledge', { status: 'current' })
  const j = judgeRecords([post, draft, brief, exp, facts, oldFacts, pick, oldRoadmap, lesson, pin, know], { now: NOW })
  const p = (r) => j.get(r.id).protection
  assert.deepEqual([post, exp, facts, know].map(p), ['never', 'never', 'never', 'never'])
  assert.deepEqual([draft, brief, pick, lesson, pin].map(p), ['confirm', 'confirm', 'confirm', 'confirm', 'confirm'])
  // A roadmap from before the weekly editor is no longer protected: it can be cleaned up.
  assert.equal(p(oldRoadmap), null)
  assert.equal(p(oldFacts), null)
  assert.deepEqual(reasons(j, oldFacts), ['status'])
})

test('filterRows and planDelete', () => {
  const rows = [
    { id: 'a', type: 'brief', status: 'new', brief_id: B1, title: 'Callbacks explained', key_id: B1, created_ms: Date.parse('2026-10-01'), reasons: [] },
    { id: 'b', type: 'draft', status: 'rejected', brief_id: B1, title: 'Draft', key_id: null, created_ms: Date.parse('2026-10-20'), reasons: [{ code: 'status' }] }
  ]
  assert.deepEqual(filterRows(rows, { q: 'callback' }).map((r) => r.id), ['a'])
  assert.deepEqual(filterRows(rows, { notUseful: true }).map((r) => r.id), ['b'])
  assert.deepEqual(filterRows(rows, { after: '2026-10-10' }).map((r) => r.id), ['b'])
  assert.deepEqual(filterRows(rows, { before: '2026-10-01' }).map((r) => r.id), ['a'])
  assert.deepEqual(filterRows(rows, { type: 'draft', status: 'rejected', briefId: B1 }).map((r) => r.id), ['b'])
  const held = new Map([['x', { id: 'x' }], ['y', { id: 'y' }], ['z', { id: 'z' }]])
  const judged = new Map([['x', { protection: null }], ['y', { protection: 'confirm' }], ['z', { protection: 'never', protection_reason: 'a published post' }]])
  const p = planDelete(['x', 'y', 'z', 'gone', 'x'], held, judged)
  assert.deepEqual(p.ok.map((r) => r.id), ['x'])
  assert.deepEqual(p.needsConfirm, ['y'])
  assert.deepEqual(p.refused.map((r) => r.id), ['z', 'gone'])
  assert.deepEqual(planDelete(['y'], held, judged, { confirmProtected: true }).ok.map((r) => r.id), ['y'])
})

test('index.loadAll: one paged list of the agent fills every type (run logs and unknown types too); refresh repeats it', async () => {
  let lists = 0
  const raw = [
    { id: 'u1', memory: '{"titles":["A"]}', metadata: { type: 'brief', brief_id: B1, status: 'new' } },
    { id: 'u2', memory: '{}', metadata: { type: 'run_log' } },
    { id: 'u3', memory: 'free text', metadata: {} }
  ]
  const base = { writeKey: 'fake:1', dryRun: false, getRecords: async () => assert.fail('no per-type list'), listAgentMemories: async () => { lists++; return raw } }
  const index = createEngineIndex(base, { now: () => NOW })
  const st = await index.loadAll()
  assert.equal(lists, 1)
  assert.equal(st.all_loaded, true)
  assert.deepEqual([...index.held().keys()].sort(), ['u1', 'u2', 'u3'])
  assert.equal(index.held().get('u3').type, 'unknown')
  assert.equal((await index.getRecords({ type: 'brief' })).length, 1)
  await index.refresh()
  assert.equal(lists, 2)
  index.close()
})

function gate() {
  let open
  const p = new Promise((r) => { open = r })
  return { wait: () => p, open: () => open() }
}

async function withApi({ agents = {} } = {}, fn) {
  const restoreLog = setSink(() => {})
  const config = fakeConfig({})
  const store = memoryStore()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer(), ...agents }) })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config, now: () => NOW })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json() }
  }
  try {
    await fn({ call, store, manager })
  } finally {
    await new Promise((r) => server.close(r))
    restoreLog()
  }
}

test('GET /api/memory: counts, reasons, filters, not_loaded; POST /api/memory/load-all loads every type', async () => {
  await withApi({}, async ({ call, store }) => {
    await store.createRecord({ type: 'brief', briefId: B1, status: 'rejected', version: 1, payload: { brief_id: B1, titles: ['Callbacks'], brief_version: 1 } })
    await store.createRecord({ type: 'brief', briefId: B2, status: 'new', version: 1, payload: { brief_id: B2, titles: ['Webhooks'], brief_version: 1 } })
    await store.createRecord({ type: 'question_cluster', status: 'open', payload: { cluster_id: 'C-1', main_question: 'Why ring?' } })
    let r = await call('GET', '/api/memory')
    assert.equal(r.status, 200)
    assert.equal(r.json.mem0_requests, 0)
    assert.ok(r.json.not_loaded.includes('question_cluster'), 'clusters are not in the index yet')
    assert.equal(r.json.counts.brief.total, 2)
    assert.equal(r.json.counts.brief.not_useful, 1)
    const l = await call('POST', '/api/memory/load-all')
    assert.equal(l.status, 200)
    assert.equal(l.json.index.all_loaded, true)
    r = await call('GET', '/api/memory')
    assert.deepEqual(r.json.not_loaded, [])
    assert.equal(r.json.counts.question_cluster.total, 1)
    r = await call('GET', '/api/memory?not_useful=true')
    assert.deepEqual(r.json.records.map((x) => x.title), ['Callbacks'])
    assert.equal(r.json.records[0].reasons[0].code, 'status')
    assert.equal(r.json.records[0].created_ms, undefined)
    r = await call('GET', '/api/memory?q=webh&type=brief')
    assert.deepEqual(r.json.records.map((x) => x.brief_id), [B2])
  })
})

test('DELETE /api/records: bad ids, protected refused, extra confirm, deletes and drops from the index; 409 while a run is in progress', async () => {
  const g = gate()
  await withApi({ agents: { scout: async () => { await g.wait(); return stubAgents.scout() } } }, async ({ call, store, manager }) => {
    const post = await store.createRecord({ type: 'published_post', briefId: B1, status: 'published', payload: { brief_id: B1, title: 'Live' } })
    const lesson = await store.createRecord({ type: 'lesson', payload: 'Keep it short.' })
    const old = await store.createRecord({ type: 'brief', briefId: B2, status: 'rejected', version: 1, payload: { brief_id: B2, brief_version: 1 } })
    await call('GET', '/api/memory')
    assert.equal((await call('DELETE', '/api/records', { ids: [] })).status, 400)
    assert.equal((await call('DELETE', '/api/records', { ids: [5] })).status, 400)
    let r = await call('DELETE', '/api/records', { ids: [old.id, post.id] })
    assert.equal(r.status, 400)
    assert.equal(r.json.error.code, 'refused')
    assert.deepEqual(r.json.refused.map((x) => x.id), [post.id])
    assert.ok(store.records.has(old.id), 'nothing deleted')
    r = await call('DELETE', '/api/records', { ids: [old.id, lesson.id] })
    assert.equal(r.status, 409)
    assert.deepEqual(r.json.needs_confirm, [lesson.id])
    r = await call('DELETE', '/api/records', { ids: [old.id, lesson.id], confirm_protected: true })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json.deleted.sort(), [old.id, lesson.id].sort())
    assert.ok(!store.records.has(old.id) && !store.records.has(lesson.id))
    assert.equal((await call('GET', '/api/memory')).json.total, 1, 'the index dropped them')

    const run = await call('POST', '/api/runs', { mode: 'full', dry_run: true })
    const busy = await call('DELETE', '/api/records', { ids: [post.id] })
    assert.deepEqual([busy.status, busy.json.error.code], [409, 'run_in_progress'])
    assert.equal((await call('POST', '/api/memory/load-all')).status, 409)
    g.open()
    await manager.wait(run.json.run_id)
  })
})

test('DELETE /api/records: refused while DRY_RUN is on (deletes would be skipped)', async () => {
  await withApi({}, async ({ call, store }) => {
    const r1 = await store.createRecord({ type: 'story_lead', status: 'expired', payload: { story_id: 'S-1' } })
    store.setDryRun(true)
    const r = await call('DELETE', '/api/records', { ids: [r1.id] })
    assert.deepEqual([r.status, r.json.error.code], [409, 'dry_run'])
  })
})
