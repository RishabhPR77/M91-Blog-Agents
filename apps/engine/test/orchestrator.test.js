import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline, decideAfterReview, assertTransition, acquireLock, LockedError, UNVERIFIED_FIX } from '../src/orchestrator.js'
import { acquireRunLock } from '../src/util/runlock.js'
import { setSink } from '../src/util/log.js'
import { replay, resetEvents, withRun } from '../src/events.js'
import { stubAgents } from '../src/agents/stubs.js'
import { heldLock, fakeConfig, memoryStore, fakeNotifier, mockReviewer } from './helpers.js'

const limits = { maxWriterRevisions: 2, maxStrategistRebriefs: 1, maxScoutRetries: 1, maxAiRoundsPerPost: 5, feedbackMaxItems: 8 }
const counters = (o = {}) => ({ writerRevisions: 0, rebriefs: 0, scoutRetries: 0, rounds: 0, ...o })
const stubs = () => ({ ...stubAgents, reviewer: mockReviewer() })

/** Stub agents whose reviewer answers from a script of reviews. */
function scripted(reviews) {
  let i = 0
  const calls = []
  const wrap = (name, fn) => async (ctx) => { calls.push(name); return fn(ctx) }
  return {
    calls,
    agents: {
      scout: wrap('scout', stubAgents.scout),
      strategist: wrap('strategist', stubAgents.strategist),
      writer: wrap('writer', stubAgents.writer),
      reviewer: wrap('reviewer', async () => ({ model: 'stub', output: reviews[Math.min(i++, reviews.length - 1)] }))
    }
  }
}
const it = (send_to, over = {}) => ({ area: 'x', quote: '', problem: `fix for ${send_to}`, fix: 'f', severity: 'must', send_to, claims: send_to === 'scout' ? ['claim A'] : [], ...over })
const fail = (...sendTos) => ({ pass: false, total: 50, feedback: sendTos.map((t) => it(t)) })

test('transitions: legal ones pass, illegal ones throw', () => {
  assert.equal(assertTransition('new', 'drafting'), 'drafting')
  assert.equal(assertTransition('drafting', 'reviewing'), 'reviewing')
  assert.equal(assertTransition('reviewing', 'revising'), 'revising')
  assert.equal(assertTransition('revising', 'drafting'), 'drafting')
  assert.equal(assertTransition('reviewing', 'awaiting_human'), 'awaiting_human')
  assert.throws(() => assertTransition('reviewing', 'approved'), 'only the human approves')
  assert.throws(() => assertTransition('new', 'awaiting_human'))
  assert.throws(() => assertTransition('awaiting_human', 'drafting'))
  assert.throws(() => assertTransition('failed', 'new'))
})

test('decideAfterReview: "must" items choose the route in order strategist → scout → writer, with limits and fallbacks', () => {
  assert.equal(decideAfterReview({ pass: true, total: 91 }, counters(), limits).action, 'approve')
  assert.equal(decideAfterReview(fail('writer'), counters({ writerRevisions: 1 }), limits).action, 'revise')
  assert.match(decideAfterReview(fail('writer'), counters({ writerRevisions: 2 }), limits).reason, /MAX_WRITER_REVISIONS/)
  assert.equal(decideAfterReview(fail('writer', 'strategist', 'scout'), counters(), limits).action, 'rebrief')
  const rescout = decideAfterReview(fail('writer', 'strategist', 'scout'), counters({ rebriefs: 1 }), limits)
  assert.equal(rescout.action, 'rescout')
  assert.deepEqual(rescout.claims, ['claim A'])
  assert.ok(rescout.feedback.every((f) => f.send_to === 'writer'), 'the revise after the Scout gets every must item')
  assert.equal(rescout.feedback.length, 3)
  // Fallbacks: no re-briefs / Scout retries left → the Writer gets those items.
  const fb = decideAfterReview(fail('strategist', 'scout'), counters({ rebriefs: 1, scoutRetries: 1 }), limits)
  assert.equal(fb.action, 'revise')
  assert.equal(fb.feedback.find((f) => f.problem === 'fix for scout').fix, 'f ' + UNVERIFIED_FIX)
  assert.ok(fb.feedback.some((f) => f.problem === 'fix for strategist' && f.severity === 'must' && f.send_to === 'writer'))
  assert.match(fb.reason, /no re-briefs left.*no Scout retries left/)
  assert.match(decideAfterReview(fail('strategist'), counters({ rebriefs: 1, writerRevisions: 2 }), limits).reason, /MAX_WRITER_REVISIONS/)
  // A scout item without claims is not a Scout route.
  assert.equal(decideAfterReview({ pass: false, feedback: [it('scout', { claims: [] })] }, counters(), limits).action, 'revise')
  // Hard cap on routes.
  assert.match(decideAfterReview(fail('writer'), counters({ rounds: 5 }), limits).reason, /MAX_AI_ROUNDS_PER_POST/)
  // All "must" items, then "should" items up to REVIEW_FEEDBACK_MAX_ITEMS.
  const many = { pass: false, feedback: [...Array(2)].map(() => it('writer')).concat([...Array(10)].map(() => it('writer', { severity: 'should' }))) }
  assert.equal(decideAfterReview(many, counters(), limits).feedback.length, 8)
  const allMust = { pass: false, feedback: [...Array(9)].map(() => it('writer')).concat([it('writer', { severity: 'should' })]) }
  assert.equal(decideAfterReview(allMust, counters(), limits).feedback.length, 9)
  assert.equal(decideAfterReview(fail('editor'), counters(), limits).action, 'revise', 'unknown send_to → the Writer')
})

test('happy path with stubs: a pass ends at awaiting_human, run_log per step, records written, lock released, ready line to the notifier', async () => {
  const store = memoryStore()
  const notifier = fakeNotifier()
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store, notifier, agents: stubs() })
  assert.equal(r.state, 'awaiting_human')
  assert.equal(r.version, 1)
  assert.equal(store.byType('brief')[0].status, 'awaiting_human')
  const logs = store.byType('run_log')
  assert.deepEqual(logs.map((l) => l.payload.agent), ['scout', 'strategist', 'writer', 'reviewer', 'orchestrator'])
  for (const l of logs) {
    for (const k of ['time', 'agent', 'model', 'ms', 'result', 'error']) assert.ok(k in l.payload, `run_log has ${k}`)
    assert.equal(l.briefId, r.briefId)
  }
  assert.equal(store.byType('brief').length, 1)
  assert.equal(store.byType('draft').length, 1)
  assert.equal(store.byType('review').length, 1)
  assert.equal(heldLock(), null)
  // The notifier gets the ready line (the real one only logs it in DRY_RUN); no promo pack before the human approves.
  assert.match(notifier.sent.slack[0], /^📝 Ready for your approval: \*.+\* · score 90\/100 · v1 · brief /)
  assert.ok(!notifier.sent.slack.some((t) => /Promo pack/.test(t)))
  assert.equal(notifier.sent.m91.length, 0, 'M91_NOTIFY_ON_AWAITING is off by default')
  assert.equal(r.summary, 'awaiting human approval (v1, score 90)')
})

test('writer revisions up to MAX_WRITER_REVISIONS, then fail + notify', async () => {
  const s = scripted([fail('writer')])
  const store = memoryStore()
  const notifier = fakeNotifier()
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store, notifier, agents: s.agents })
  assert.equal(r.state, 'failed')
  assert.match(r.error, /MAX_WRITER_REVISIONS/)
  assert.equal(s.calls.filter((c) => c === 'writer').length, 3) // first draft + 2 revisions
  assert.equal(notifier.sent.slack.length, 1)
  assert.equal(notifier.sent.m91[0].severity, 'LOW')
  assert.equal(heldLock(), null)
})

test('revise then pass is approved at version 2', async () => {
  const s = scripted([fail('writer'), { pass: true, score: 91, feedback: [] }])
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store: memoryStore(), notifier: fakeNotifier(), agents: s.agents })
  assert.equal(r.state, 'awaiting_human')
  assert.equal(r.version, 2)
})

test('strategist route: one re-brief, then its items go to the Writer until MAX_WRITER_REVISIONS', async () => {
  const s = scripted([fail('strategist')])
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store: memoryStore(), notifier: fakeNotifier(), agents: s.agents })
  assert.match(r.error, /MAX_WRITER_REVISIONS/)
  assert.equal(s.calls.filter((c) => c === 'strategist').length, 2)
  assert.equal(s.calls.filter((c) => c === 'writer').length, 4) // first draft, new draft after the re-brief, 2 revisions
})

test('send_to scout: Scout runs in sources mode, then back to the Writer (strategist not re-run); limit applies', async () => {
  const s = scripted([fail('scout')])
  const modes = []
  const scout = s.agents.scout
  s.agents.scout = async (ctx) => { modes.push(ctx.scoutMode); return scout(ctx) }
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store: memoryStore(), notifier: fakeNotifier(), agents: s.agents })
  assert.match(r.error, /MAX_WRITER_REVISIONS/)
  assert.deepEqual(modes, ['research', 'sources'])
  assert.equal(s.calls.filter((c) => c === 'strategist').length, 1)
  assert.equal(s.calls.filter((c) => c === 'writer').length, 4) // first, after the Scout, then 2 revisions with UNVERIFIED_FIX
})

test('hard cap MAX_AI_ROUNDS_PER_POST wins over route limits', async () => {
  const s = scripted([fail('writer')])
  const config = fakeConfig({ DRY_RUN: 'true', MAX_WRITER_REVISIONS: '10', MAX_AI_ROUNDS_PER_POST: '3' })
  const r = await runPipeline({ config, store: memoryStore(), notifier: fakeNotifier(), agents: s.agents })
  assert.match(r.error, /MAX_AI_ROUNDS_PER_POST/)
  assert.equal(s.calls.filter((c) => c === 'writer').length, 4) // 3 routes, then the stop
})

test('a loop.route event for every decision, with the reason and counters; cancel is checked before routing', async () => {
  resetEvents()
  const s = scripted([fail('writer'), { pass: true, total: 92, feedback: [] }])
  const r = await withRun('R-route', () => runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store: memoryStore(), notifier: fakeNotifier(), agents: s.agents }))
  assert.equal(r.state, 'awaiting_human')
  const routes = replay('R-route').filter((e) => e.type === 'loop.route')
  assert.deepEqual(routes.map((e) => [e.data.action, e.data.send_to]), [['revise', 'writer'], ['approve', null]])
  assert.match(routes[0].message, /^send_to writer: fix for writer$/)
  assert.deepEqual(routes[0].data.counters, { writerRevisions: 0, rebriefs: 0, scoutRetries: 0, rounds: 0 })
  assert.deepEqual(routes[1].data.counters, { writerRevisions: 1, rebriefs: 0, scoutRetries: 0, rounds: 1 })
  const ac = new AbortController()
  const c = scripted([fail('writer')])
  const reviewer = c.agents.reviewer
  c.agents.reviewer = async (ctx) => { const out = await reviewer(ctx); ac.abort(); return out }
  const cancelled = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store: memoryStore(), notifier: fakeNotifier(), agents: c.agents, signal: ac.signal })
  assert.equal(cancelled.state, 'cancelled')
  assert.equal(c.calls.filter((x) => x === 'writer').length, 1)
})

test('an agent error fails the run with a run_log error entry', async () => {
  const s = scripted([{ pass: true }])
  s.agents.writer = async () => { throw new Error('boom') }
  const store = memoryStore()
  const notifier = fakeNotifier()
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store, notifier, agents: s.agents })
  assert.equal(r.state, 'failed')
  assert.equal(notifier.sent.m91[0].severity, 'MEDIUM')
  const entry = store.byType('run_log').find((l) => l.payload.agent === 'writer')
  assert.equal(entry.payload.result, 'error')
  assert.equal(entry.payload.error, 'boom')
})

test('run lock: a second run is skipped while the first holds the lock file; no Mem0 lock records', async () => {
  const store = memoryStore()
  const config = fakeConfig({ DRY_RUN: 'true' })
  const lock = await acquireLock(store, { owner: 'first', config })
  assert.equal(heldLock().run_id, 'first')
  assert.equal(heldLock().pid, process.pid)
  const r = await runPipeline({ config, store, notifier: fakeNotifier(), agents: stubs() })
  assert.equal(r.state, 'skipped')
  assert.equal(r.reason, 'A pipeline run is already in progress (owner first)')
  await assert.rejects(acquireLock(store, { owner: 'third', config }), LockedError)
  await lock.release()
  await lock.release()
  assert.equal(heldLock(), null)
  assert.equal(store.byType('lock').length, 0)
})

test('run lock: taken over (with a warning) when its process is gone or its heartbeat is older than RUN_LOCK_STALE_MIN', async () => {
  const config = fakeConfig({ RUN_LOCK_STALE_MIN: '10' })
  const t0 = Date.parse('2026-10-20T00:00:00Z')
  const old = acquireRunLock({ owner: 'old', config, now: () => t0 })
  // Same live pid, heartbeat 9 min old: still held.
  assert.throws(() => acquireRunLock({ owner: 'new', config, now: () => t0 + 9 * 60000 }), LockedError)
  // Heartbeat 11 min old: stale, taken over.
  const lines = []
  const restore = setSink((_l, line) => lines.push(line))
  const fresh = acquireRunLock({ owner: 'new', config, now: () => t0 + 11 * 60000 })
  restore()
  assert.equal(heldLock().run_id, 'new')
  assert.ok(lines.some((l) => /taking over a stale run lock/.test(l) && /"run_id":"old"/.test(l)))
  await old.release()
  assert.equal(heldLock().run_id, 'new', 'the old owner never removes a lock that is no longer its own')
  await fresh.release()
  // A dead process: taken over at once, whatever the heartbeat.
  acquireRunLock({ owner: 'dead', config, pid: 999999 })
  const next = acquireRunLock({ owner: 'alive', config, isAlive: (pid) => pid !== 999999 })
  assert.equal(heldLock().run_id, 'alive')
  await next.release()
})

test('run lock: the heartbeat is refreshed while the run is active', async () => {
  const config = fakeConfig()
  let t = Date.parse('2026-10-20T00:00:00Z')
  const lock = acquireRunLock({ owner: 'beat', config, now: () => t, heartbeatMs: 10 })
  const first = heldLock().heartbeat_at
  t += 60000
  await new Promise((r) => setTimeout(r, 40))
  assert.notEqual(heldLock().heartbeat_at, first)
  assert.equal(heldLock().acquired_at, first)
  await lock.release()
})

test('resume (reviewer mode with route): the loop starts at the review of the saved draft; no Scout or Strategist', async () => {
  const B = '261018-1400-ABCD'
  const store = memoryStore()
  await store.createRecord({ type: 'brief', briefId: B, payload: { brief_id: B, brief_version: 1, titles: ['T'] }, status: 'drafted', version: 1 })
  await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'T', version: 3, brief_version: 1, post_markdown: '# T\n\nAgent approval pauses a risky step until a person answers.' }, status: 'drafted', version: 3, meta: { brief_version: 1 } })
  const s = scripted([fail('writer'), { pass: true, total: 88, feedback: [] }])
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store, notifier: fakeNotifier(), agents: s.agents, briefId: B, resume: {} })
  assert.equal(r.state, 'awaiting_human')
  assert.deepEqual(s.calls, ['reviewer', 'writer', 'reviewer'])
  const missing = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store: memoryStore(), notifier: fakeNotifier(), agents: s.agents, briefId: B, resume: {} })
  assert.match(missing.error, /no brief 261018-1400-ABCD/)
})

test('B1: a pass → draft and brief awaiting_human (one waiting draft per brief), approval.waiting event, optional M91 nudge', async () => {
  resetEvents()
  const B = '261018-1400-ABCD'
  const store = memoryStore()
  await store.createRecord({ type: 'brief', briefId: B, payload: { brief_id: B, brief_version: 1, titles: ['T'] }, status: 'awaiting_human', version: 1 })
  const old = await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'T', version: 1, brief_version: 1, post_markdown: '# T' }, status: 'awaiting_human', version: 1, meta: { brief_version: 1 } })
  await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'T', version: 2, brief_version: 1, post_markdown: '# T\n\nNew.' }, status: 'drafted', version: 2, meta: { brief_version: 1 } })
  const notifier = fakeNotifier()
  const s = scripted([{ pass: true, total: 87, feedback: [] }])
  const r = await withRun('R-wait', () => runPipeline({ config: fakeConfig({ M91_NOTIFY_ON_AWAITING: 'true', SLACK_POST_APPROVED: 'false' }), store, notifier, agents: s.agents, briefId: B, resume: { version: 2 } }))
  assert.equal(r.state, 'awaiting_human')
  assert.equal(r.summary, 'awaiting human approval (v2, score 87)')
  const drafts = store.byType('draft').sort((a, b) => a.version - b.version)
  assert.deepEqual(drafts.map((d) => d.status), ['superseded', 'awaiting_human'])
  assert.equal(store.records.get(old.id).status, 'superseded')
  assert.ok(drafts[1].metadata.awaiting_since)
  assert.equal(drafts[1].metadata.review_total, 87)
  assert.equal(store.byType('brief')[0].status, 'awaiting_human')
  assert.deepEqual(notifier.sent.slack, ['📝 Ready for your approval: *T* · score 87/100 · v2 · brief 261018-1400-ABCD'])
  assert.deepEqual(notifier.sent.m91, [{ title: 'Blog draft ready for approval', description: 'T — score 87/100. Open the dashboard.', severity: 'LOW' }])
  const ev = replay('R-wait')
  assert.deepEqual(ev.find((e) => e.type === 'approval.waiting').data, { brief_id: B, version: 2, total: 87 })
  assert.equal(ev.find((e) => e.type === 'step.output' && e.step === 'approval').message, 'Awaiting human approval')
})
