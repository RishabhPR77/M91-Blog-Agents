import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline, decideAfterReview, assertTransition, acquireLock, LockedError, LOCK_TTL_MS } from '../src/orchestrator.js'
import { stubAgents } from '../src/agents/stubs.js'
import { fakeConfig, memoryStore, fakeNotifier } from './helpers.js'

const limits = { maxWriterRevisions: 2, maxStrategistRebriefs: 1, maxScoutRetries: 1, maxAiRoundsPerPost: 5 }
const counters = (o = {}) => ({ writerRevisions: 0, rebriefs: 0, scoutRetries: 0, rounds: 1, ...o })

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
const fail = (send_to) => ({ pass: false, score: 50, feedback: ['x'], send_to })

test('transitions: legal ones pass, illegal ones throw', () => {
  assert.equal(assertTransition('new', 'drafting'), 'drafting')
  assert.equal(assertTransition('drafting', 'reviewing'), 'reviewing')
  assert.equal(assertTransition('reviewing', 'revising'), 'revising')
  assert.equal(assertTransition('revising', 'drafting'), 'drafting')
  assert.equal(assertTransition('reviewing', 'approved'), 'approved')
  assert.throws(() => assertTransition('new', 'approved'))
  assert.throws(() => assertTransition('approved', 'drafting'))
  assert.throws(() => assertTransition('failed', 'new'))
})

test('decideAfterReview: routing and every limit', () => {
  assert.equal(decideAfterReview({ pass: true }, counters(), limits).action, 'approve')
  assert.equal(decideAfterReview(fail('writer'), counters({ writerRevisions: 1 }), limits).action, 'revise')
  assert.match(decideAfterReview(fail('writer'), counters({ writerRevisions: 2 }), limits).reason, /MAX_WRITER_REVISIONS/)
  assert.equal(decideAfterReview(fail(undefined), counters(), limits).action, 'revise')
  assert.equal(decideAfterReview(fail('strategist'), counters(), limits).action, 'rebrief')
  assert.match(decideAfterReview(fail('strategist'), counters({ rebriefs: 1 }), limits).reason, /MAX_STRATEGIST_REBRIEFS/)
  assert.equal(decideAfterReview(fail('scout'), counters(), limits).action, 'rescout')
  assert.match(decideAfterReview(fail('scout'), counters({ scoutRetries: 1 }), limits).reason, /MAX_SCOUT_RETRIES/)
  assert.match(decideAfterReview(fail('writer'), counters({ rounds: 5 }), limits).reason, /MAX_AI_ROUNDS_PER_POST/)
  assert.equal(decideAfterReview(fail('editor'), counters(), limits).action, 'fail')
})

test('happy path with stubs: approved, run_log per step, records written, lock released, nothing sent', async () => {
  const store = memoryStore()
  const notifier = fakeNotifier()
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store, notifier, agents: stubAgents })
  assert.equal(r.state, 'approved')
  assert.equal(r.version, 1)
  assert.equal(store.byType('brief')[0].status, 'approved')
  const logs = store.byType('run_log')
  assert.deepEqual(logs.map((l) => l.payload.agent), ['scout', 'strategist', 'writer', 'reviewer', 'orchestrator'])
  for (const l of logs) {
    for (const k of ['time', 'agent', 'model', 'ms', 'result', 'error']) assert.ok(k in l.payload, `run_log has ${k}`)
    assert.equal(l.briefId, r.briefId)
  }
  assert.equal(store.byType('brief').length, 1)
  assert.equal(store.byType('draft').length, 1)
  assert.equal(store.byType('review').length, 1)
  assert.equal(store.byType('lock').length, 0)
  assert.equal(notifier.sent.slack.length, 0)
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
  assert.equal(store.byType('lock').length, 0)
})

test('revise then pass is approved at version 2', async () => {
  const s = scripted([fail('writer'), { pass: true, score: 91, feedback: [] }])
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store: memoryStore(), notifier: fakeNotifier(), agents: s.agents })
  assert.equal(r.state, 'approved')
  assert.equal(r.version, 2)
})

test('strategist rebrief limit', async () => {
  const s = scripted([fail('strategist')])
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store: memoryStore(), notifier: fakeNotifier(), agents: s.agents })
  assert.match(r.error, /MAX_STRATEGIST_REBRIEFS/)
  assert.equal(s.calls.filter((c) => c === 'strategist').length, 2)
})

test('send_to scout: Scout runs in sources mode, then back to the Writer (strategist not re-run); limit applies', async () => {
  const s = scripted([fail('scout')])
  const modes = []
  const scout = s.agents.scout
  s.agents.scout = async (ctx) => { modes.push(ctx.scoutMode); return scout(ctx) }
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store: memoryStore(), notifier: fakeNotifier(), agents: s.agents })
  assert.match(r.error, /MAX_SCOUT_RETRIES/)
  assert.deepEqual(modes, ['research', 'sources'])
  assert.equal(s.calls.filter((c) => c === 'strategist').length, 1)
  assert.equal(s.calls.filter((c) => c === 'writer').length, 2)
})

test('hard cap MAX_AI_ROUNDS_PER_POST wins over route limits', async () => {
  const s = scripted([fail('writer')])
  const config = fakeConfig({ DRY_RUN: 'true', MAX_WRITER_REVISIONS: '10', MAX_AI_ROUNDS_PER_POST: '3' })
  const r = await runPipeline({ config, store: memoryStore(), notifier: fakeNotifier(), agents: s.agents })
  assert.match(r.error, /MAX_AI_ROUNDS_PER_POST/)
  assert.equal(s.calls.filter((c) => c === 'writer').length, 3)
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

test('run lock: a second run is skipped while the first holds the lock', async () => {
  const store = memoryStore()
  const lock = await acquireLock(store, { owner: 'first' })
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store, notifier: fakeNotifier(), agents: stubAgents })
  assert.equal(r.state, 'skipped')
  await assert.rejects(acquireLock(store, { owner: 'third' }), LockedError)
  await lock.release()
  assert.equal(store.byType('lock').length, 0)
})

test('run lock: locks older than 30 min are cleared', async () => {
  const store = memoryStore()
  const t0 = Date.parse('2026-10-17T00:00:00Z')
  await acquireLock(store, { owner: 'old', now: () => t0 })
  const lock = await acquireLock(store, { owner: 'new', now: () => t0 + LOCK_TTL_MS + 1000 })
  const locks = store.byType('lock')
  assert.equal(locks.length, 1)
  assert.equal(locks[0].payload.owner, 'new')
  await lock.release()
})
