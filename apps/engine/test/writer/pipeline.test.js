// The Writer in the pipeline: Strategist → Writer → Reviewer stub, with REVIEWER_STUB_MODE.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRunManager } from '../../src/runs.js'
import { defaultAgents } from '../../src/orchestrator.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { replay, resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { createServer } from '../../src/server.js'
import { memoryStore, fakeNotifier } from '../helpers.js'
import { NOW, config, brief, draftAnswer, fakeAi, okChecker, BRIEF_ID } from './fixtures.js'

beforeEach(() => resetEvents())
const now = () => NOW
const quiet = () => setSink(() => {})
const recordsOf = (store, type) => [...store.records.values()].filter((r) => r.type === type)

/** A run manager whose Strategist saves a real-shaped brief (so the real Writer can load it). */
function setup(env = {}) {
  const cfg = config(env)
  const store = memoryStore()
  const notifier = fakeNotifier()
  const ai = fakeAi({ revise: draftAnswer({ revision_notes: [{ feedback_quote: 'q', what_changed: 'w' }] }) })
  const manager = createRunManager({
    config: cfg,
    storeFactory: () => store,
    notifierFactory: () => notifier,
    agentsFactory: (rc, { store: st, notifier: nt }) => ({
      ...defaultAgents({ config: rc, store: st, notifier: nt, agentDeps: { aiSend: ai, urlChecker: okChecker(), now } }),
      scout: stubAgents.scout,
      async strategist(ctx) {
        const b = brief({ brief_id: ctx.briefId })
        const rec = await st.createRecord({ type: 'brief', briefId: ctx.briefId, payload: b, status: 'new', version: 1, topicGroup: 1 })
        return { model: 'stub', output: { brief_id: ctx.briefId, brief_version: 1, record_id: rec.id, brief: b, title: b.titles[0], lead: b.lead, repairs_used: 0 } }
      }
    })
  })
  return { cfg, store, notifier, ai, manager }
}

test('REVIEWER_STUB_MODE=pass: Strategist → Writer v1 → Reviewer → approved; run record has writer and checks steps', async () => {
  const restore = quiet()
  const s = setup()
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'succeeded')
  assert.deepEqual(r.run.steps.map((x) => [x.name, x.status]), [['scout', 'succeeded'], ['strategist', 'succeeded'], ['writer', 'succeeded'], ['checks', 'succeeded'], ['reviewer', 'succeeded']])
  const writer = r.run.steps.find((x) => x.name === 'writer')
  assert.match(writer.summary, /^Draft v1: \d+ words · grade [\d.]+ · hard checks passed · repairs 0$/)
  assert.ok(writer.record_ids.length >= 1)
  assert.match(r.run.steps.find((x) => x.name === 'checks').summary, /soft warning\(s\), 0 hard failure\(s\)/)
  assert.deepEqual(recordsOf(s.store, 'draft').map((d) => [d.version, d.status]), [[1, 'drafted']])
  assert.equal(recordsOf(s.store, 'brief')[0].status, 'approved')
})

test('REVIEWER_STUB_MODE=fail_once: Writer v1 → stub fail (2 quoted items) → loop.route → Writer revise v2 → pass', async () => {
  const restore = quiet()
  const s = setup({ REVIEWER_STUB_MODE: 'fail_once' })
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'succeeded')
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['new', 'revise'])
  const rev = s.ai.requests[1]
  assert.match(rev.message, /--- REVIEWER FEEDBACK ---\n\[\{"area":"clarity","quote":"Agent approval means your software stops and asks a person before a risky step\."/)
  assert.match(rev.message, /--- QUOTED EXCERPTS ---\n- "Agent approval means/)
  assert.deepEqual(recordsOf(s.store, 'draft').map((d) => [d.version, d.status]).sort(), [[1, 'superseded'], [2, 'drafted']])
  const route = replay(run_id).find((e) => e.type === 'loop.route')
  assert.equal(route.data.send_to, 'writer')
  assert.equal(route.data.action, 'revise')
  assert.equal(r.run.steps.filter((x) => x.name === 'writer').length, 2)
  const logs = recordsOf(s.store, 'run_log').map((l) => l.payload)
  assert.deepEqual(logs.filter((l) => l.agent === 'writer' && l.call).map((l) => l.call), ['new', 'revise'])
})

test('REVIEWER_STUB_MODE=fail_always: stops at MAX_WRITER_REVISIONS, run failed, LOW alert', async () => {
  const restore = quiet()
  const s = setup({ REVIEWER_STUB_MODE: 'fail_always', MAX_WRITER_REVISIONS: '2' })
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'failed')
  assert.match(r.run.result_summary, /MAX_WRITER_REVISIONS/)
  assert.deepEqual(recordsOf(s.store, 'draft').map((d) => d.version).sort(), [1, 2, 3])
  assert.equal(s.notifier.sent.m91[0].severity, 'LOW')
  assert.ok(replay(run_id).some((e) => e.type === 'loop.route' && /stop: hit MAX_WRITER_REVISIONS/.test(e.message)))
})

test('writer run mode through the API: 202, a draft for the latest brief version; feedback → revise', async () => {
  const restore = quiet()
  const cfg = config()
  const store = memoryStore()
  await store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief(), status: 'new', version: 1, topicGroup: 1 })
  const ai = fakeAi()
  const manager = createRunManager({ config: cfg, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: (rc, d) => defaultAgents({ config: rc, ...d, agentDeps: { aiSend: ai, urlChecker: okChecker(), now } }) })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config: cfg })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const post = (body) => fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }))
    const a = await post({ mode: 'writer', params: { brief_id: BRIEF_ID } })
    assert.equal(a.status, 202)
    const ra = await manager.wait(a.json.run_id)
    assert.equal(ra.status, 'succeeded')
    assert.match(ra.run.result_summary, /^draft v1 of 261018-1400-ABCD/)
    const b = await post({ mode: 'writer', params: { brief_id: BRIEF_ID, feedback: [{ area: 'clarity', quote: 'A ringing phone gets attention fast.', problem: 'p', fix: 'f', severity: 'must' }] } })
    const rb = await manager.wait(b.json.run_id)
    assert.equal(rb.status, 'succeeded')
    assert.deepEqual(ai.requests.map((q) => q.call), ['new', 'revise'])
    const list = await fetch(`${base}/api/records?type=draft&brief_id=${BRIEF_ID}`).then((r) => r.json())
    assert.equal(list.records.length, 2)
    assert.ok(list.records.every((x) => x.title === 'How agent approval works with a phone call'))
  } finally {
    await new Promise((r) => server.close(r))
    restore()
  }
})

test('DRY_RUN pipeline with fail_once: the Writer works from the in-memory brief and previous draft; nothing but run/run_log saved', async () => {
  const restore = quiet()
  const cfg = config({ DRY_RUN: 'true', REVIEWER_STUB_MODE: 'fail_once' })
  const store = memoryStore({ dryRun: true })
  const ai = fakeAi({ revise: draftAnswer({ revision_notes: [{ feedback_quote: 'q', what_changed: 'w' }] }) })
  const manager = createRunManager({
    config: cfg,
    storeFactory: () => store,
    notifierFactory: () => fakeNotifier(),
    agentsFactory: (rc, { store: st, notifier: nt }) => ({
      ...defaultAgents({ config: rc, store: st, notifier: nt, agentDeps: { aiSend: ai, urlChecker: okChecker(), now } }),
      scout: stubAgents.scout,
      async strategist(ctx) {
        const b = brief({ brief_id: ctx.briefId })
        const rec = await st.createRecord({ type: 'brief', briefId: ctx.briefId, payload: b, status: 'new', version: 1, topicGroup: 1 })
        return { model: 'stub', output: { brief_id: ctx.briefId, brief_version: 1, record_id: rec.id, brief: b, title: b.titles[0], lead: b.lead, repairs_used: 0 } }
      }
    })
  })
  const { run_id } = await manager.startRun({ mode: 'full' })
  const r = await manager.wait(run_id)
  restore()
  assert.equal(r.status, 'succeeded', r.run.result_summary)
  assert.deepEqual(ai.requests.map((q) => q.call), ['new', 'revise'])
  assert.match(ai.requests[1].message, /--- PREVIOUS DRAFT ---\n\{"summary":"Explains agent approval/)
  assert.match(ai.requests[1].threadId, /-v2-revise-/)
  assert.ok([...store.records.values()].every((x) => x.type === 'run' || x.type === 'run_log'))
})
