import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { emit, withRun, replay, subscribe, resetEvents, bufferedRuns, currentRunId, MAX_EVENTS_PER_RUN, MAX_RUNS, scoutStepName, threadPrefix } from '../src/events.js'
import { log, registerSecrets, setSink, setLevel } from '../src/util/log.js'
import { runScout } from '../src/scout/index.js'
import { fakeConfig, memoryStore, fakeNotifier } from './helpers.js'
import { fakeAi, fakeWeb, fakeChecker } from './scout/fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})

test('seq increases per run; events outside a run are ignored', () => {
  assert.equal(emit('log', { message: 'x' }), null)
  emit('step.started', { run_id: 'R-1', step: 'scout' })
  emit('step.finished', { run_id: 'R-1', step: 'scout' })
  emit('step.started', { run_id: 'R-2', step: 'scout' })
  assert.deepEqual(replay('R-1').map((e) => e.seq), [1, 2])
  assert.deepEqual(replay('R-2').map((e) => e.seq), [1])
  assert.deepEqual(replay('R-1', 1).map((e) => e.type), ['step.finished'])
  for (const e of replay('R-1')) assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T/)
})

test('run_id is attached through AsyncLocalStorage, across awaits', async () => {
  await withRun('R-als', async () => {
    assert.equal(currentRunId(), 'R-als')
    await new Promise((r) => setTimeout(r, 1))
    emit('step.started', { step: 'scout' })
  })
  assert.equal(currentRunId(), null)
  assert.equal(replay('R-als')[0].run_id, 'R-als')
})

test('log lines inside a run become masked log events', async () => {
  const restore = quiet()
  setLevel('info')
  registerSecrets(['fake-secret-for-events-123'])
  await withRun('R-log', async () => {
    log.info('calling with fake-secret-for-events-123', { apiKey: 'zzzz-not-shown', model: 'gpt-5-mini' })
  })
  restore()
  const [e] = replay('R-log')
  assert.equal(e.type, 'log')
  assert.equal(e.level, 'info')
  assert.ok(!JSON.stringify(e).includes('fake-secret-for-events-123'))
  assert.ok(!JSON.stringify(e).includes('zzzz-not-shown'))
  assert.equal(e.data.model, 'gpt-5-mini')
})

test('every event is masked, and big data is reduced to its keys', () => {
  registerSecrets(['another-fake-secret-456'])
  const e = emit('step.output', { run_id: 'R-m', message: 'token another-fake-secret-456', data: { token: 'tttt-secret', text: 'x'.repeat(5000) } })
  assert.ok(!JSON.stringify(e).includes('another-fake-secret-456'))
  assert.deepEqual(e.data, { truncated: true, keys: ['token', 'text'] })
})

test('replay buffer limits: 5,000 events per run, 20 runs', () => {
  for (let i = 0; i < MAX_EVENTS_PER_RUN + 10; i++) emit('log', { run_id: 'R-big', message: String(i) })
  const evs = replay('R-big')
  assert.equal(evs.length, MAX_EVENTS_PER_RUN)
  assert.equal(evs[0].seq, 11)
  for (let i = 0; i < MAX_RUNS + 3; i++) emit('log', { run_id: `R-n${i}`, message: 'x' })
  assert.equal(bufferedRuns().length, MAX_RUNS)
  assert.ok(!bufferedRuns().includes('R-big'))
})

test('subscribe gets live events, optionally for one run only', () => {
  const all = []
  const one = []
  const offAll = subscribe((e) => all.push(e))
  const offOne = subscribe((e) => one.push(e), { runId: 'R-a' })
  emit('log', { run_id: 'R-a', message: 'a' })
  emit('log', { run_id: 'R-b', message: 'b' })
  offAll()
  offOne()
  emit('log', { run_id: 'R-a', message: 'after' })
  assert.equal(all.length, 2)
  assert.deepEqual(one.map((e) => e.message), ['a'])
})

test('helper names stay stable', () => {
  assert.equal(scoutStepName('questions-3'), 'scout.questions.g3')
  assert.equal(scoutStepName('facts'), 'scout.facts')
  assert.equal(threadPrefix('scout-R-261018-0700-ABCD-facts-x7k2'), 'scout-R-261018-0700-ABCD-facts')
})

test('a Scout run emits step.started/finished/output per sub-call (names stable)', async () => {
  const restore = quiet()
  const config = fakeConfig({ SCOUT_QUESTION_GROUPS: '1' })
  const deps = { config, store: memoryStore(), notifier: fakeNotifier(), aiSend: fakeAi(), fetch: fakeWeb(), urlChecker: fakeChecker(), now: () => Date.parse('2026-10-17T08:35:00Z') }
  await withRun('R-scout', () => runScout({ mode: 'research', runId: 'R-scout' }, deps))
  restore()
  const evs = replay('R-scout')
  const started = evs.filter((e) => e.type === 'step.started').map((e) => e.step)
  assert.deepEqual(started, ['scout.facts', 'scout.questions.g1', 'scout.stories', 'scout.tutorials', 'scout.clusters', 'scout.style'])
  assert.equal(evs.filter((e) => e.type === 'step.finished').length, 6)
  const out = evs.find((e) => e.type === 'step.output' && e.step === 'scout.stories')
  assert.match(out.message, /kept of \d+ returned/)
  assert.ok(evs.some((e) => e.type === 'log'))
})
