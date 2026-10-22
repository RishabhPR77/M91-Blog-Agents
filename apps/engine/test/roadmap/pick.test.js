// Phase 12 Task 3: picking the next post (code only) and the slot statuses through a run, an approval and a
// rejection. Stub agents, memory store: no AI, no Mem0.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { nextSlot, pickTarget, duePins, setSlotStatus } from '../../src/roadmap/pick.js'
import { loadRoadmap, saveRoadmap } from '../../src/roadmap/model.js'
import { createRunManager } from '../../src/runs.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { buildInputs } from '../../src/strategist/inputs.js'
import { resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer } from '../helpers.js'
import { goodRoadmap } from './fixtures.js'
import { config as strategistConfig, seededStore, NOW as SNOW } from '../strategist/fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const approved = (fn = () => {}) => { const rm = { ...goodRoadmap(), status: 'approved' }; fn(rm); return rm }
const slotOf = (rm, id) => rm.stages.flatMap((s) => s.slots).find((s) => s.slot_id === id)
const set = (rm, ids, status) => { for (const id of ids) slotOf(rm, id).status = status }

test('nextSlot: no roadmap, a draft roadmap, then stage order and needs', () => {
  assert.match(nextSlot(null).reason, /no roadmap yet/)
  assert.equal(nextSlot(goodRoadmap()).reason, 'Approve the roadmap first')
  assert.equal(nextSlot(approved()).slot.slot_id, 's0-1', 'the lowest stage, its first slot')
  assert.equal(nextSlot(approved()).stage.level, 'beginner')
  // s0-1 approved → s0-2 (it needs s0-1).
  assert.equal(nextSlot(approved((rm) => set(rm, ['s0-1'], 'approved'))).slot.slot_id, 's0-2')
  // Stage 0 done → stage 1; s1-1 in review → s1-2 and s1-3 need s1-1: nothing ready in stage 1, later stages wait.
  const busy = nextSlot(approved((rm) => { set(rm, ['s0-1', 's0-2'], 'approved'); set(rm, ['s1-1'], 'in_review') }))
  assert.equal(busy.slot, null)
  assert.match(busy.reason, /^stage 1 \(Foundations\) has nothing ready: s1-1 is in review; s1-2 needs s1-1; s1-3 needs s1-1$/)
  // A skipped need is done (it never blocks).
  assert.equal(nextSlot(approved((rm) => { set(rm, ['s0-1', 's0-2'], 'approved'); set(rm, ['s1-1'], 'skipped') })).slot.slot_id, 's1-2')
  // Every slot done.
  const all = approved((rm) => set(rm, rm.stages.flatMap((s) => s.slots.map((x) => x.slot_id)), 'approved'))
  assert.equal(nextSlot(all).reason, 'every stage of the roadmap is finished')
})

test('nextSlot: proposed slots are never picked and never hold a stage open', () => {
  const rm = approved((r) => set(r, ['s0-1', 's0-2'], 'approved'))
  rm.stages[0].slots.unshift({ slot_id: 's0-3', title_idea: 'x', question: 'x?', teaches: ['x'], needs: [], status: 'proposed', brief_id: '' })
  assert.equal(nextSlot(rm).slot.slot_id, 's1-1', 'stage 0 is finished: its proposed slot waits for the person')
})

test('pickTarget: a due pinned topic goes first; then the roadmap', async () => {
  const store = memoryStore()
  await saveRoadmap(store, approved())
  await store.createRecord({ type: 'pinned_topic', payload: { pinned_id: 'PIN-1', topic: 'Later', target_date: '2099-01-01' }, status: 'open' })
  let t = await pickTarget(store)
  assert.equal(t.kind, 'slot')
  assert.equal(t.slot.slot_id, 's0-1')
  await store.createRecord({ type: 'pinned_topic', payload: { pinned_id: 'PIN-2', topic: 'Due now', target_date: '2026-01-01' }, status: 'open' })
  t = await pickTarget(store)
  assert.deepEqual([t.kind, t.pin.pinned_id], ['pinned', 'PIN-2'])
  assert.deepEqual(duePins([{ status: 'open', payload: { target_date: '2026-10-01', priority: 'normal' } }, { status: 'cancelled', payload: { target_date: '2026-10-01' } }], { today: '2026-10-22' }).length, 1)
})

function manager(store, env = {}, agents = {}) {
  const config = fakeConfig({ DRY_RUN: 'false', ROADMAP_ENABLED: 'true', ...env })
  return createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer(), ...agents }) })
}

test('the gate: no roadmap or a draft one → 409 "Approve the roadmap first" before any AI call; nothing ready → 409 nothing_to_write', async () => {
  let calls = 0
  const counting = { scout: async (...a) => { calls++; return stubAgents.scout(...a) } }
  const empty = memoryStore()
  await assert.rejects(manager(empty, {}, counting).startRun({ mode: 'full' }), (e) => e.status === 409 && e.code === 'roadmap_not_approved' && /no roadmap yet/.test(e.message))
  const draft = memoryStore()
  await saveRoadmap(draft, goodRoadmap())
  await assert.rejects(manager(draft, {}, counting).startRun({ mode: 'full' }), (e) => e.code === 'roadmap_not_approved' && e.message === 'Approve the roadmap first')
  const stuck = memoryStore()
  await saveRoadmap(stuck, approved((rm) => set(rm, ['s0-1'], 'in_review')))
  await assert.rejects(manager(stuck, {}, counting).startRun({ mode: 'full' }), (e) => e.code === 'nothing_to_write' && /s0-1 is in review/.test(e.message))
  assert.equal(calls, 0)
  // ROADMAP_ENABLED=false: the old behaviour (no gate).
  const off = manager(memoryStore(), { ROADMAP_ENABLED: 'false' })
  const { run_id } = await off.startRun({ mode: 'full', dryRun: true })
  assert.ok(run_id)
  await off.wait(run_id)
})

test('a run takes the next slot: drafting with its brief id, then in_review; a failed run frees it', async () => {
  const restore = quiet()
  const store = memoryStore()
  await saveRoadmap(store, approved())
  const m = manager(store)
  const { run_id } = await m.startRun({ mode: 'full' })
  const r = await m.wait(run_id)
  assert.equal(r.status, 'succeeded', r.run?.result_summary)
  let s = slotOf((await loadRoadmap(store)).payload, 's0-1')
  assert.equal(s.status, 'in_review')
  assert.equal(s.brief_id, r.run.brief_id)
  // The next run takes s0-2? No: s0-2 needs s0-1, which is only in review.
  await assert.rejects(m.startRun({ mode: 'full' }), (e) => e.code === 'nothing_to_write')
  // A failing run gives its slot back.
  const store2 = memoryStore()
  await saveRoadmap(store2, approved())
  const failing = manager(store2, {}, { writer: async () => { throw new Error('writer exploded') } })
  const f = await failing.wait((await failing.startRun({ mode: 'full' })).run_id)
  restore()
  assert.equal(f.status, 'failed')
  s = slotOf((await loadRoadmap(store2)).payload, 's0-1')
  assert.deepEqual([s.status, s.brief_id], ['planned', ''])
})

test('approve → the slot is approved and the next one is picked; reject topic → skipped', async () => {
  const restore = quiet()
  const store = memoryStore()
  await saveRoadmap(store, approved())
  const m = manager(store)
  // The stub Writer's draft is saved as drafted: put it where the real pipeline leaves it (waiting, reviewed).
  const wait = async (briefId) => {
    for (const d of store.byType('draft').filter((x) => x.briefId === briefId)) await store.updateRecord(d.id, { ...d.payload, checks: { hard_passed: true, results: [] } }, { status: 'awaiting_human', review_total: 90 })
    await store.createRecord({ type: 'review', briefId, payload: { brief_id: briefId, version: 1, brief_version: 1, pass: true, total: 90, feedback: [] }, status: 'pass', version: 1, meta: { brief_version: 1 } })
  }
  const r = await m.wait((await m.startRun({ mode: 'full' })).run_id)
  const briefId = r.run.brief_id
  await wait(briefId)
  const a = await m.wait((await m.startRun({ mode: 'approve', params: { brief_id: briefId } })).run_id)
  assert.equal(a.status, 'succeeded', a.run?.result_summary)
  assert.equal(slotOf((await loadRoadmap(store)).payload, 's0-1').status, 'approved')
  assert.equal((await pickTarget(store)).slot.slot_id, 's0-2')
  const r2 = await m.wait((await m.startRun({ mode: 'full' })).run_id)
  await wait(r2.run.brief_id)
  const rej = await m.wait((await m.startRun({ mode: 'reject_topic', params: { brief_id: r2.run.brief_id, reason: 'not now' } })).run_id)
  restore()
  assert.equal(rej.status, 'succeeded', rej.run?.result_summary)
  assert.equal(slotOf((await loadRoadmap(store)).payload, 's0-2').status, 'skipped')
})

test('setSlotStatus never throws; rapid response is off with RAPID_RESPONSE_ENABLED=false', async () => {
  assert.deepEqual(await setSlotStatus(memoryStore(), { slotId: 's0-1' }, 'drafting'), { ok: false, reason: 'no roadmap' })
  const broken = { getRecords: async () => { throw new Error('Mem0 down') } }
  const restore = quiet()
  assert.equal((await setSlotStatus(broken, { slotId: 's0-1' }, 'drafting')).ok, false)
  restore()
  const on = await buildInputs({ config: strategistConfig(), store: await seededStore(), now: () => SNOW })
  assert.deepEqual(on.rapidStories.map((s) => s.story_id), ['S-1'])
  const off = await buildInputs({ config: strategistConfig({ RAPID_RESPONSE_ENABLED: 'false' }), store: await seededStore(), now: () => SNOW })
  assert.deepEqual(off.rapidStories, [])
  assert.deepEqual(off.otherStories.map((s) => s.story_id).sort(), ['S-1', 'S-2'])
})
