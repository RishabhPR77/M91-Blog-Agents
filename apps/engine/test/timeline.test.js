// The compact run timeline saved in run records (Phase 6). Mocked agents and Mem0.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRunManager } from '../src/runs.js'
import { replay, resetEvents } from '../src/events.js'
import { stubAgents } from '../src/agents/stubs.js'
import { timelineEntry, addToTimeline, compactData, TIMELINE_MAX } from '../src/timeline.js'
import { log, registerSecrets, setSink } from '../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer } from './helpers.js'

beforeEach(() => resetEvents())
const ev = (type, extra = {}) => ({ run_id: 'R-1', seq: 1, ts: '2026-10-19T06:00:00.000Z', type, ...extra })

test('timelineEntry keeps steps, outputs, routes, approvals, compact AI calls and warn/error logs; drops info logs', () => {
  assert.deepEqual(timelineEntry(ev('step.started', { agent: 'scout', step: 'scout.facts' })), { seq: 1, ts: '2026-10-19T06:00:00.000Z', type: 'step.started', step: 'scout.facts' })
  assert.deepEqual(timelineEntry(ev('ai.call', { agent: 'promo', data: { agent: 'promo', service: 'openai', model: 'gpt-5-mini', delivery: 'sync', call: 'promo', ms: 13450, retries: 2, finish_reason: 'completed', threadId: 't-1' } })),
    { seq: 1, ts: '2026-10-19T06:00:00.000Z', type: 'ai.call', step: 'promo', call: 'promo', model: 'gpt-5-mini', delivery: 'sync', ms: 13450, retries: 2, finish_reason: 'completed' })
  assert.equal(timelineEntry(ev('log', { level: 'info', message: 'ai answer' })), null)
  assert.equal(timelineEntry(ev('log', { level: 'debug', message: 'x' })), null)
  assert.deepEqual(timelineEntry(ev('log', { level: 'warn', message: 'pending flows', data: { big: 'x' } })), { seq: 1, ts: '2026-10-19T06:00:00.000Z', type: 'log', level: 'warn', message: 'pending flows' })
  const route = timelineEntry(ev('loop.route', { agent: 'orchestrator', message: 'send_to writer: simplicity 6', data: { send_to: 'writer', action: 'revise', total: 77, version: 1, counters: { writerRevisions: 0, rounds: 0 } } }))
  assert.equal(route.message, 'send_to writer: simplicity 6')
  assert.deepEqual(route.data.counters, { writerRevisions: 0, rounds: 0 })
  assert.equal(timelineEntry(ev('approval.waiting', { message: 'awaiting', data: { brief_id: 'B', version: 2, total: 78 } })).data.total, 78)
  assert.equal(timelineEntry(ev('step.output', { step: 'writer', message: 'Draft v1', data: { record_id: 'r1' } })).data.record_id, 'r1')
})

test('compactData drops nested payloads and cuts long strings and arrays (no post text)', () => {
  const post = 'A ringing phone gets attention fast. '.repeat(50)
  const d = compactData({ record_id: 'r1', post_markdown: post, draft: { payload: { post_markdown: post } }, ids: Array.from({ length: 30 }, (_, i) => `id-${i}`), list: [{ a: 1 }] })
  assert.equal(d.record_id, 'r1')
  assert.ok(d.post_markdown.length <= 201)
  assert.deepEqual(d.draft, undefined, 'two levels deep is dropped')
  assert.equal(d.ids.length, 20)
  assert.equal(d.list, undefined, 'arrays of objects are dropped')
  const long = timelineEntry(ev('step.output', { step: 'writer', message: 'm'.repeat(900) }))
  assert.ok(long.message.length <= 501)
})

test(`the timeline keeps the last ${TIMELINE_MAX} entries and counts the dropped ones`, () => {
  const run = {}
  for (let i = 1; i <= TIMELINE_MAX + 50; i++) addToTimeline(run, { ...ev('step.started', { step: 'scout' }), seq: i })
  addToTimeline(run, ev('log', { level: 'info', message: 'ignored' }))
  assert.equal(run.timeline.length, TIMELINE_MAX)
  assert.equal(run.timeline[0].seq, 51)
  assert.equal(run.timeline.at(-1).seq, TIMELINE_MAX + 50)
  assert.equal(run.timeline_dropped, 50)
})

test('a run record carries the timeline: masked, no info log lines, written at step boundaries and at the end', async () => {
  const restore = setSink(() => {})
  registerSecrets(['fake-timeline-secret-789'])
  const config = fakeConfig()
  const store = memoryStore()
  let runUpdates = 0
  const update = store.updateRecord.bind(store)
  store.updateRecord = async (id, payload, md) => { if (md?.type === 'run') runUpdates++; return update(id, payload, md) }
  const scout = async () => {
    log.info('POST TEXT should never be saved')
    log.warn('slow source with fake-timeline-secret-789 in it')
    return stubAgents.scout()
  }
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, scout, reviewer: mockReviewer(['fail', 'pass']) }) })
  const { run_id } = await manager.startRun({ mode: 'full' })
  await manager.wait(run_id)
  restore()
  const run = [...store.records.values()].find((r) => r.type === 'run').payload
  const text = JSON.stringify(run.timeline)
  assert.ok(!text.includes('fake-timeline-secret-789'), 'secret masked')
  assert.ok(!text.includes('POST TEXT'), 'info log lines are not kept')
  assert.ok(run.timeline.some((t) => t.type === 'log' && t.level === 'warn' && /slow source with/.test(t.message)))
  for (const type of ['step.started', 'step.finished', 'step.output', 'loop.route', 'approval.waiting']) assert.ok(run.timeline.some((t) => t.type === type), type)
  assert.deepEqual(run.timeline.filter((t) => t.type === 'loop.route').map((t) => t.data.action), ['revise', 'approve'])
  // Writes follow step boundaries, not every event.
  const events = replay(run_id).length
  assert.ok(runUpdates < events, `${runUpdates} record writes for ${events} events`)
})
