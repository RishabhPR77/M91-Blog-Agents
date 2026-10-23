// The Writer in the pipeline: Strategist → Writer → Reviewer (an injected mock, or the real one with a fake AI).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRunManager } from '../../src/runs.js'
import { defaultAgents } from '../../src/orchestrator.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { replay, resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { createServer } from '../../src/server.js'
import { memoryStore, fakeNotifier, mockReviewer } from '../helpers.js'
import { reviewAnswer, fakeReviewerAi } from '../reviewer/fixtures.js'
import { NOW, config, brief, draftAnswer, fakeAi, okChecker, BRIEF_ID } from './fixtures.js'

beforeEach(() => resetEvents())
const now = () => NOW
const quiet = () => setSink(() => {})
const recordsOf = (store, type) => [...store.records.values()].filter((r) => r.type === type)

/** A run manager whose Strategist saves a real-shaped brief (so the real Writer can load it). */
function setup(env = {}, reviewer = mockReviewer()) {
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
      promo: stubAgents.promo, designer: stubAgents.designer,
      reviewer,
      async strategist(ctx) {
        const b = brief({ brief_id: ctx.briefId })
        const rec = await st.createRecord({ type: 'brief', briefId: ctx.briefId, payload: b, status: 'new', version: 1, topicGroup: 1 })
        return { model: 'stub', output: { brief_id: ctx.briefId, brief_version: 1, record_id: rec.id, brief: b, title: b.titles[0], lead: b.lead, repairs_used: 0 } }
      }
    })
  })
  return { cfg, store, notifier, ai, manager }
}

test('reviewer passes: Strategist → Writer v1 → Reviewer → awaiting_human; run record has writer and checks steps', async () => {
  const restore = quiet()
  const s = setup()
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'succeeded')
  assert.deepEqual(r.run.steps.map((x) => [x.name, x.status]), [['scout', 'succeeded'], ['strategist', 'succeeded'], ['writer', 'succeeded'], ['checks', 'succeeded'], ['designer', 'succeeded'], ['reviewer', 'succeeded']])
  const writer = r.run.steps.find((x) => x.name === 'writer')
  assert.match(writer.summary, /^Draft v1: \d+ words · grade [\d.]+ · hard checks passed · repairs 0$/)
  assert.ok(writer.record_ids.length >= 1)
  assert.match(r.run.steps.find((x) => x.name === 'checks').summary, /soft warning\(s\), 0 hard failure\(s\)/)
  assert.deepEqual(recordsOf(s.store, 'draft').map((d) => [d.version, d.status]), [[1, 'awaiting_human']])
  assert.equal(recordsOf(s.store, 'brief')[0].status, 'awaiting_human')
})

test('reviewer fails once: Writer v1 → fail (must + should, quoted) → loop.route → Writer revise v2 → pass', async () => {
  const restore = quiet()
  const s = setup({}, mockReviewer(['fail', 'pass']))
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'succeeded')
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['new', 'revise'])
  const rev = s.ai.requests[1]
  assert.match(rev.message, /--- FEEDBACK ---\n\[\{"source":"reviewer","area":"simplicity","quote":"Agent approval means your software stops and asks a person before a risky step\."/)
  assert.match(rev.message, /--- QUOTED EXCERPTS ---\n- "Agent approval means/)
  assert.deepEqual(recordsOf(s.store, 'draft').map((d) => [d.version, d.status]).sort(), [[1, 'superseded'], [2, 'awaiting_human']])
  const route = replay(run_id).find((e) => e.type === 'loop.route')
  assert.equal(route.data.send_to, 'writer')
  assert.equal(route.data.action, 'revise')
  assert.equal(r.run.steps.filter((x) => x.name === 'writer').length, 2)
  // Both Writer calls are in the run record's steps; successful calls make no run_log records (Phase 9 A2).
  assert.equal(recordsOf(s.store, 'run_log').length, 0)
})

test('reviewer always fails: stops at MAX_WRITER_REVISIONS, run failed, LOW alert', async () => {
  const restore = quiet()
  const s = setup({ MAX_WRITER_REVISIONS: '2' }, mockReviewer(['fail']))
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'failed')
  assert.match(r.run.result_summary, /MAX_WRITER_REVISIONS/)
  assert.deepEqual(recordsOf(s.store, 'draft').map((d) => d.version).sort(), [1, 2, 3])
  assert.ok(replay(run_id).some((e) => e.type === 'loop.route' && /stop: hit MAX_WRITER_REVISIONS/.test(e.message)))
  // D3: statuses, the Slack text with the best score and top "must" items, and the LOW M91 alert.
  const drafts = recordsOf(s.store, 'draft').sort((a, b) => a.version - b.version)
  assert.equal(drafts[2].status, 'failed_review')
  assert.equal(recordsOf(s.store, 'brief')[0].status, 'failed')
  const slack = s.notifier.sent.slack.find((t) => t.startsWith('❌'))
  assert.match(slack, /^❌ Not approved: \*How agent approval works with a phone call\* after 3 rounds · best score 70\/100\nStopped: hit MAX_WRITER_REVISIONS \(2\)\nNot yet\.\n1\. This sentence is harder to follow than it needs to be\. \("Agent approval means/)
  assert.deepEqual(s.notifier.sent.m91, [{ title: 'Blog post failed review', description: 'How agent approval works with a phone call — best score 70/100. See Slack.', severity: 'LOW' }])
  assert.ok(!r.run.steps.some((x) => x.name === 'promo'), 'no promo pack without a pass')
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
  const cfg = config({ DRY_RUN: 'true', WRITER_REVISION_INPUT: 'context' })
  const store = memoryStore({ dryRun: true })
  const ai = fakeAi({ revise: draftAnswer({ revision_notes: [{ feedback_quote: 'q', what_changed: 'w' }] }) })
  const manager = createRunManager({
    config: cfg,
    storeFactory: () => store,
    notifierFactory: () => fakeNotifier(),
    agentsFactory: (rc, { store: st, notifier: nt }) => ({
      ...defaultAgents({ config: rc, store: st, notifier: nt, agentDeps: { aiSend: ai, urlChecker: okChecker(), now } }),
      scout: stubAgents.scout,
      promo: stubAgents.promo, designer: stubAgents.designer,
      reviewer: mockReviewer(['fail', 'pass']),
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

test('the real Reviewer in the loop (DRY_RUN): fail with a quoted "must" item → loop.route → revise → pass; reviews and lessons not saved', async () => {
  const restore = quiet()
  const cfg = config({ DRY_RUN: 'true' })
  const store = memoryStore({ dryRun: true })
  const writerAi = fakeAi({ revise: draftAnswer({ revision_notes: [{ feedback_quote: 'A ringing phone gets attention fast.', what_changed: 'w' }] }) })
  const must = { area: 'simplicity', quote: 'A ringing phone gets attention fast.', problem: 'p', fix: 'f', severity: 'must', send_to: 'writer', claims: [] }
  const reviewerAi = fakeReviewerAi([reviewAnswer({ scores: { simplicity: 5 }, gates: { no_invented_content: false }, feedback: [must], lessons: ['Explain jargon.'] }), reviewAnswer({ lessons: ['Short intros.'] })])
  const aiSend = (opts) => (opts.agent === 'reviewer' ? reviewerAi(opts) : writerAi(opts))
  const manager = createRunManager({
    config: cfg,
    storeFactory: () => store,
    notifierFactory: () => fakeNotifier(),
    agentsFactory: (rc, { store: st, notifier: nt }) => ({
      ...defaultAgents({ config: rc, store: st, notifier: nt, agentDeps: { aiSend, urlChecker: okChecker(), now } }),
      scout: stubAgents.scout,
      async strategist(ctx) {
        const b = brief({ brief_id: ctx.briefId })
        return { model: 'stub', output: { brief_id: ctx.briefId, brief_version: 1, record_id: 'dryrun-1', brief: b, title: b.titles[0], lead: b.lead, repairs_used: 0 } }
      }
    })
  })
  const { run_id } = await manager.startRun({ mode: 'full' })
  const r = await manager.wait(run_id)
  restore()
  assert.equal(r.status, 'succeeded', r.run.result_summary)
  assert.deepEqual(reviewerAi.requests.map((q) => q.call), ['review', 'review'])
  assert.match(reviewerAi.requests[1].message, /--- PREVIOUS REVIEW ---\n\{"feedback":\[\{"area":"simplicity","quote":"A ringing phone gets attention fast\."/)
  assert.match(writerAi.requests.filter((q) => q.agent === 'writer')[1].message, /--- FEEDBACK ---\n\[\{"source":"reviewer","area":"simplicity","quote":"A ringing phone gets attention fast\."/)
  const reviewSteps = r.run.steps.filter((x) => x.name === 'reviewer')
  assert.match(reviewSteps[0].summary, /^Score \d+(\.\d)?\/100 · fail · no_invented_content, simplicity 5 → writer$/)
  assert.match(reviewSteps[1].summary, /^Score 90\/100 · pass · gates 11\/11 · 0 should-fix items$/)
  const events = replay(run_id)
  const routes = events.filter((e) => e.type === 'loop.route').map((e) => e.data.action)
  assert.deepEqual(routes, ['revise', 'approve'])
  // E1: reviewer steps and AI calls are events; never the post text, prompts or secrets.
  const reviewerEvents = events.filter((e) => e.agent === 'reviewer').map((e) => e.type)
  // (ai.call events come from the real viaSocket client, which the fakes replace; call names are checked above.)
  for (const t of ['step.started', 'step.finished', 'step.output']) assert.ok(reviewerEvents.includes(t), t)
  assert.match(events.find((e) => e.agent === 'reviewer' && e.type === 'step.output').message, /^Score .+ · fail · no_invented_content, simplicity 5 → writer$/)
  const all = JSON.stringify(events)
  assert.ok(!all.includes("You are the Reviewer for M91's blog"), 'no prompt in events')
  assert.ok(!all.includes('A pause keeps a person in charge. You can read how'), 'no post paragraph in events')
  assert.ok(!all.includes('fake-embed-secret-for-tests') && !all.includes('m0-fakekeyfortests123'), 'no secrets in events')
  assert.ok([...store.records.values()].every((x) => x.type === 'run' || x.type === 'run_log'))
  assert.equal(store.lessons.length, 0)
})

test('lessons: saved per review (at most LESSONS_PER_REVIEW_MAX) with source and brief_id', async () => {
  const restore = quiet()
  const { runReviewer } = await import('../../src/reviewer/index.js')
  const store = memoryStore()
  const cfg = config({ LESSONS_PER_REVIEW_MAX: '2' })
  await store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief(), status: 'drafted', version: 1 })
  const d = { ...draftAnswer(), checks: { hard_passed: true, results: [] }, brief_id: BRIEF_ID, version: 1, brief_version: 1 }
  await store.createRecord({ type: 'draft', briefId: BRIEF_ID, payload: d, status: 'drafted', version: 1, meta: { brief_version: 1 } })
  await runReviewer({ briefId: BRIEF_ID }, { config: cfg, store, aiSend: fakeReviewerAi([reviewAnswer({ lessons: ['One.', 'Two.', 'Three.'] })]) })
  restore()
  assert.deepEqual(store.lessons, [{ text: 'One.', meta: { source: 'reviewer', brief_id: BRIEF_ID } }, { text: 'Two.', meta: { source: 'reviewer', brief_id: BRIEF_ID } }])
})
