import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRunManager, configForRun, RUN_ID_RE, RunError } from '../src/runs.js'
import { replay, resetEvents, withRun, CancelledError, throwIfCancelled } from '../src/events.js'
import { stubAgents } from '../src/agents/stubs.js'
import { createViaSocketClient } from '../src/viasocket.js'
import { BRIEF_ID_RE } from '../src/util/ids.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, fakeFetch, mockReviewer } from './helpers.js'

beforeEach(() => resetEvents())
const recordsOf = (store, type) => [...store.records.values()].filter((r) => r.type === type)

function setup({ env = {}, agents = {}, store } = {}) {
  const config = fakeConfig(env)
  store ??= memoryStore({ dryRun: config.runtime.dryRun })
  const notifier = fakeNotifier()
  const updates = []
  const update = store.updateRecord.bind(store)
  store.updateRecord = async (id, payload, md) => { if (md?.type === 'run') updates.push(payload.status); return update(id, payload, md) }
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => notifier, agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer(), ...agents }) })
  return { config, store, notifier, manager, updates }
}
const quiet = () => setSink(() => {})

test('full run: run_id format, separate brief_id, run record lifecycle, events, lock released', async () => {
  const restore = quiet()
  let lockOwner = null
  const s = setup({ agents: { scout: async () => { lockOwner = recordsOf(s.store, 'lock')[0]?.payload?.owner; return stubAgents.scout() } } })
  const { run_id } = await s.manager.startRun({ mode: 'full', trigger: 'manual' })
  assert.match(run_id, RUN_ID_RE)
  assert.equal(s.manager.isRunning(), true)
  const result = await s.manager.wait(run_id)
  restore()
  assert.equal(result.status, 'succeeded')
  assert.equal(s.manager.isRunning(), false)

  const [run] = recordsOf(s.store, 'run')
  assert.equal(recordsOf(s.store, 'run').length, 1, 'one run record, updated in place')
  assert.equal(run.status, 'succeeded')
  const p = run.payload
  assert.equal(p.run_id, run_id)
  assert.equal(p.trigger, 'manual')
  assert.equal(p.mode, 'full')
  assert.equal(p.dry_run, false)
  assert.ok(p.finished_at && p.ms >= 0)
  assert.deepEqual(p.steps.map((x) => [x.name, x.status]), [['scout', 'succeeded'], ['strategist', 'succeeded'], ['writer', 'succeeded'], ['reviewer', 'succeeded'], ['promo', 'succeeded']])
  assert.match(p.brief_id, BRIEF_ID_RE)
  assert.notEqual(p.brief_id, run_id)
  assert.ok(s.updates.length >= 8, `updated at step boundaries (${s.updates.length})`)

  assert.equal(lockOwner, run_id, 'the lock points to the run')
  assert.equal(recordsOf(s.store, 'lock').length, 0, 'lock released')
  const types = replay(run_id).map((e) => e.type)
  assert.equal(types[0], 'run.started')
  assert.equal(types.at(-1), 'run.finished')
  assert.ok(types.includes('step.output'))
  assert.ok(recordsOf(s.store, 'run_log').every((l) => l.briefId === run_id), 'run_logs keyed by run_id')
})

test('dry run: the run record is written and updated with dry_run: true; nothing else but run_log', async () => {
  const restore = quiet()
  const s = setup({ env: { DRY_RUN: 'true' } })
  const { run_id } = await s.manager.startRun({ mode: 'full', trigger: 'cli' })
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'succeeded')
  const [run] = recordsOf(s.store, 'run')
  assert.equal(run.payload.dry_run, true)
  assert.equal(run.status, 'succeeded')
  assert.ok([...s.store.records.values()].every((x) => x.type === 'run' || x.type === 'run_log'))
})

test('a per-run dry_run flag overrides config without touching .env', async () => {
  const restore = quiet()
  const config = fakeConfig()
  let seen
  const manager = createRunManager({ config, storeFactory: (cfg) => { seen = cfg.runtime.dryRun; return memoryStore({ dryRun: cfg.runtime.dryRun }) }, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  await manager.wait((await manager.startRun({ mode: 'full', dryRun: true })).run_id)
  restore()
  assert.equal(seen, true)
  assert.equal(config.runtime.dryRun, false)
})

test('failure: status failed, run.failed event, lock released', async () => {
  const restore = quiet()
  const s = setup({ agents: { strategist: async () => { throw new Error('planner down') } } })
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'failed')
  const [run] = recordsOf(s.store, 'run')
  assert.equal(run.status, 'failed')
  assert.equal(run.payload.steps.find((x) => x.name === 'strategist').status, 'failed')
  assert.equal(replay(run_id).at(-1).type, 'run.failed')
  assert.equal(recordsOf(s.store, 'lock').length, 0)
})

test('one run at a time (409); unknown and not-built modes are refused', async () => {
  const restore = quiet()
  let release
  const s = setup({ agents: { scout: () => new Promise((r) => { release = () => r(stubAgents.scout()) }) } })
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  await assert.rejects(s.manager.startRun({ mode: 'full' }), (e) => e instanceof RunError && e.status === 409 && e.code === 'run_in_progress')
  await new Promise((r) => setImmediate(r))
  release()
  await s.manager.wait(run_id)
  restore()
  await assert.rejects(s.manager.startRun({ mode: 'publish' }), (e) => e.code === 'not_built' && /not built yet/.test(e.message))
  await assert.rejects(s.manager.startRun({ mode: 'writer' }), (e) => e.code === 'bad_params' && /brief_id/.test(e.message))
  await assert.rejects(s.manager.startRun({ mode: 'writer', params: { brief_id: '261018-0700-ZZZZ' } }), (e) => e.code === 'unknown_brief' && e.status === 400)
  await assert.rejects(s.manager.startRun({ mode: 'everything' }), (e) => e.code === 'bad_mode')
  await assert.rejects(s.manager.startRun({ mode: 'full', trigger: 'pigeon' }), (e) => e.code === 'bad_trigger')
})

test('cancel between steps: status cancelled, later steps never run, lock released, Slack line, no M91 alert', async () => {
  const restore = quiet()
  let release
  let strategistCalled = false
  const s = setup({
    agents: {
      scout: () => new Promise((r) => { release = () => r(stubAgents.scout()) }),
      strategist: async (ctx) => { strategistCalled = true; return stubAgents.strategist(ctx) }
    }
  })
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  await new Promise((r) => setImmediate(r))
  assert.equal(s.manager.cancelRun('R-other'), false)
  assert.equal(s.manager.cancelRun(run_id), true)
  release()
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'cancelled')
  assert.equal(strategistCalled, false)
  const [run] = recordsOf(s.store, 'run')
  assert.equal(run.status, 'cancelled')
  assert.equal(replay(run_id).at(-1).type, 'run.cancelled')
  assert.equal(recordsOf(s.store, 'lock').length, 0)
  assert.equal(recordsOf(s.store, 'brief').length, 0, 'nothing half-saved')
  assert.deepEqual(s.notifier.sent.slack, [`⏹️ Run ${run_id} cancelled`])
  assert.equal(s.notifier.sent.m91.length, 0)
})

test('cancel, then a network error inside the in-flight step: still cancelled, no failure alert', async () => {
  const restore = quiet()
  let fail
  const s = setup({ agents: { scout: () => new Promise((_, reject) => { fail = () => reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })) }) } })
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  await new Promise((r) => setImmediate(r))
  s.manager.cancelRun(run_id)
  fail()
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'cancelled')
  assert.equal(replay(run_id).at(-1).type, 'run.cancelled')
  assert.equal(s.notifier.sent.m91.length, 0)
  assert.deepEqual(s.notifier.sent.slack, [`⏹️ Run ${run_id} cancelled`])
})

test('a step interrupted by a cancel is recorded as "cancelled", not "failed" (run record, event, run_log)', async () => {
  const restore = quiet()
  // As live: the in-flight Scout call finishes, then the next cancel check throws CancelledError inside the step.
  let finishCall
  const s = setup({ agents: { scout: async () => { await new Promise((r) => { finishCall = r }); throwIfCancelled(); return stubAgents.scout() } } })
  const { run_id } = await s.manager.startRun({ mode: 'full' })
  await new Promise((r) => setImmediate(r))
  s.manager.cancelRun(run_id)
  finishCall()
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'cancelled')
  assert.deepEqual(r.run.steps.map((x) => [x.name, x.status, x.error]), [['scout', 'cancelled', null]])
  const ev = replay(run_id).find((e) => e.step === 'scout' && (e.type === 'step.failed' || e.type === 'step.cancelled'))
  assert.equal(ev.type, 'step.cancelled')
  assert.equal(ev.message, 'cancelled')
  const log = recordsOf(s.store, 'run_log').find((l) => l.payload.agent === 'scout')
  assert.deepEqual([log.payload.result, log.payload.error], ['cancelled', null])
  // A real failure is still "failed".
  const f = setup({ agents: { scout: async () => { throw new Error('scout down') } } })
  const { run_id: id2 } = await f.manager.startRun({ mode: 'full' })
  const r2 = await f.manager.wait(id2)
  assert.deepEqual(r2.run.steps.map((x) => [x.name, x.status, x.error]), [['scout', 'failed', 'scout down']])
})

test('scout mode: a cancel inside the step is recorded as "cancelled"', async () => {
  const restore = quiet()
  let finishCall
  const s = setup({ agents: { scout: async () => { await new Promise((r) => { finishCall = r }); throwIfCancelled(); return stubAgents.scout() } } })
  const { run_id } = await s.manager.startRun({ mode: 'scout' })
  await new Promise((r) => setImmediate(r))
  s.manager.cancelRun(run_id)
  finishCall()
  const r = await s.manager.wait(run_id)
  restore()
  assert.equal(r.status, 'cancelled')
  assert.deepEqual(r.run.steps.map((x) => [x.name, x.status]), [['scout', 'cancelled']])
})

test('scout and strategist modes run just that agent', async () => {
  const restore = quiet()
  const scoutOut = { mode: 'research', counts: { clusters_new: 2, stories: 1, tutorials: 0, questions: 4 }, cluster_ids: ['C-1', 'C-2'], calls_used: 6, warnings: [] }
  const s = setup({ agents: { scout: async () => ({ model: 'm', output: scoutOut }), strategist: async () => ({ model: 'm', output: { brief_id: '261018-0700-ABCD', brief_version: 1, title: 'T', record_id: 'mem-9', warnings: [] } }) } })
  const a = await s.manager.wait((await s.manager.startRun({ mode: 'scout' })).run_id)
  assert.equal(a.status, 'succeeded')
  assert.deepEqual(a.run.steps.map((x) => x.name), ['scout'])
  assert.deepEqual(a.run.steps[0].record_ids, ['C-1', 'C-2'])
  const b = await s.manager.wait((await s.manager.startRun({ mode: 'strategist' })).run_id)
  restore()
  assert.equal(b.status, 'succeeded')
  assert.equal(b.run.brief_id, '261018-0700-ABCD')
})

test('run params: low-cost Scout settings for one run only; bad params refused', () => {
  const base = fakeConfig()
  const c = configForRun(base, { dryRun: true, params: { scout: { question_groups: [1], max_calls: 6, questions_per_group: 3, docs_max_chars: 15000, docs_max_pages: 5 }, ai_max_retries: 1 } })
  assert.deepEqual(c.scout.questionGroups, [1])
  assert.equal(c.scout.maxCalls, 6)
  assert.equal(c.scout.docsMaxChars, 15000)
  assert.equal(c.viasocket.maxRetries, 1)
  assert.equal(c.runtime.dryRun, true)
  assert.equal(base.scout.maxCalls, 14, 'base config untouched')
  assert.ok(Object.isFrozen(c.scout))
  assert.throws(() => configForRun(base, { params: { scout: { model: 'x' } } }), /not a run setting/)
  assert.throws(() => configForRun(base, { params: { scout: { docs_max_chars: 150000 } } }), /invalid value/)
  assert.throws(() => configForRun(base, { params: { scout: { question_groups: [9] } } }), /invalid value/)
})

test('cancel stops rtlayer history polling', async () => {
  const fetch = fakeFetch((url) => (url.endsWith('/message')
    ? { status: 202, body: { success: true, data: { thread_id: 'th', message_id: 'm' } } }
    : { body: { success: true, data: { messages: [] } } }))
  const controller = new AbortController()
  let polls = 0
  const client = createViaSocketClient({ config: fakeConfig(), fetch, sleepFn: async () => { if (++polls === 2) controller.abort() } })
  await assert.rejects(withRun('R-poll', () => client.aiSend({ agent: 'writer', message: 'M', threadId: 'th' }), { signal: controller.signal }), CancelledError)
  assert.ok(polls <= 2)
})
