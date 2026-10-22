// Phase 12 Task 5: the knowledge map (saved on approve) and the journey-aware Strategist (one roadmap slot, the
// reader's level, earlier posts instead of re-explaining, why_today). Fake AI, memory store: no AI, no Mem0.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { knowledgeOf, saveKnowledge, knowledgeMap } from '../../src/roadmap/knowledge.js'
import { runStrategist } from '../../src/strategist/index.js'
import { ROADMAP_RULES } from '../../src/strategist/prompts.js'
import { saveRoadmap, loadRoadmap } from '../../src/roadmap/model.js'
import { createRunManager } from '../../src/runs.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer } from '../helpers.js'
import { config as strategistConfig, seededStore, validBrief, fakeAi, NOW } from '../strategist/fixtures.js'
import { goodRoadmap } from './fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const slotTarget = (id) => {
  const rm = goodRoadmap()
  const st = rm.stages.find((s) => s.slots.some((x) => x.slot_id === id))
  return { kind: 'slot', slot: st.slots.find((x) => x.slot_id === id), stage: { number: st.number, name: st.name, level: st.level, goal: st.goal } }
}

test('knowledgeOf / saveKnowledge / knowledgeMap: one record per approved post, oldest first, replaced on a re-approval', async () => {
  const store = memoryStore()
  const k = knowledgeOf({ briefId: 'B-2', brief: { terms_to_define: ['callback URL'] }, draft: { title: 'Read the answer', tldr: ['Your code gets the answer by a callback.', 'x', 'y'] }, slot: { slot_id: 's2-2', teaches: ['callback URL'] }, stage: { number: 2, name: 'First steps' }, exportInfo: { slug: 'read-the-answer' } })
  assert.deepEqual(k, { brief_id: 'B-2', title: 'Read the answer', slot_id: 's2-2', stage: 2, stage_name: 'First steps', concepts: ['callback URL'], terms_defined: ['callback URL'], summary: 'Your code gets the answer by a callback.', link: null, export_slug: 'read-the-answer', approved_at: null })
  await saveKnowledge(store, { ...k, approved_at: '2026-10-23T10:00:00+05:30' })
  await saveKnowledge(store, { ...k, brief_id: 'B-1', title: 'What M91 is', approved_at: '2026-10-22T10:00:00+05:30' })
  await saveKnowledge(store, { ...k, summary: 'Changed.', approved_at: '2026-10-23T10:00:00+05:30' })
  assert.equal(store.byType('knowledge').length, 2)
  assert.deepEqual((await knowledgeMap(store)).map((x) => [x.title, x.summary]), [['What M91 is', 'Your code gets the answer by a callback.'], ['Read the answer', 'Changed.']])
})

async function slotStore() {
  const store = await seededStore()
  // The focused Scout's cluster for slot s1-2 (C-1, made the slot's cluster here).
  const c1 = store.byType('question_cluster').find((r) => r.payload.cluster_id === 'C-1')
  await store.updateRecord(c1.id, { ...c1.payload, slot_id: 's1-2' }, {})
  await saveKnowledge(store, { brief_id: 'B-0', title: 'What a human approval step is', slot_id: 's1-1', stage: 1, stage_name: 'Foundations', concepts: ['approval step'], terms_defined: ['approval step'], summary: 'A pause before a risky action.', link: null, export_slug: 'what-a-human-approval-step-is', approved_at: '2026-10-20T10:00:00+05:30' })
  return store
}

test('the Strategist plans only the slot: one lead, the stage level, the knowledge map, the slot schema and rules', async () => {
  const restore = quiet()
  const store = await slotStore()
  const ai = fakeAi({ plan: validBrief({ slot_id: 's1-2', terms_to_define: ['callback'], why_today: 'Builds on "What a human approval step is": now the phone rings.' }) })
  const r = await runStrategist({ mode: 'plan', runId: '261022-1200-ABCD', briefId: '261022-1200-ABCD', target: slotTarget('s1-2') }, { config: strategistConfig(), store, aiSend: ai, now: () => NOW })
  restore()
  const q = ai.requests[0]
  assert.equal(q.jsonSchema.name, 'strategist_brief_slot')
  assert.ok(q.prompt.endsWith(ROADMAP_RULES), 'the roadmap rules close the prompt')
  assert.match(q.prompt, /Never re-explain those concepts/)
  assert.match(q.message, /--- POST TO PLAN \(from the roadmap\) ---\n\{"slot_id":"s1-2","title_idea":"Why a phone call beats a chat message"/)
  assert.match(q.message, /"stage":\{"number":1,"name":"Foundations","level":"beginner"/)
  assert.match(q.message, /--- KNOWLEDGE MAP \(what the reader already learned, oldest first\) ---\n\[\{"title":"What a human approval step is","slot_id":"s1-1"/)
  assert.match(q.message, /--- QUESTION CLUSTERS ---\n\[\{"cluster_id":"C-1"/)
  assert.ok(!/"cluster_id":"C-2"/.test(q.message), 'no other cluster')
  assert.match(q.message, /--- RAPID-RESPONSE STORIES ---\nnone\n--- OTHER STORIES ---\nnone/)
  assert.equal(r.brief.slot_id, 's1-2')
  assert.deepEqual(r.brief.terms_to_define, ['callback'])
  assert.equal(store.byType('brief')[0].payload.slot_id, 's1-2')
})

test('a wrong or missing slot_id is fixed by code (no repair call); the plain Strategist schema stays without the roadmap', async () => {
  const restore = quiet()
  const store = await slotStore()
  const ai = fakeAi({ plan: validBrief({ slot_id: 's9-9', terms_to_define: [] }) })
  const r = await runStrategist({ mode: 'plan', runId: '261022-1201-ABCD', briefId: '261022-1201-ABCD', target: slotTarget('s1-2') }, { config: strategistConfig(), store, aiSend: ai, now: () => NOW })
  assert.equal(ai.requests.length, 1)
  assert.equal(r.brief.slot_id, 's1-2')
  assert.ok(r.auto_fixes.some((f) => /set slot_id to s1-2/.test(f)), JSON.stringify(r.auto_fixes))
  const plain = fakeAi()
  await runStrategist({ mode: 'plan', runId: '261022-1202-ABCD' }, { config: strategistConfig(), store: await seededStore(), aiSend: plain, now: () => NOW })
  restore()
  assert.equal(plain.requests[0].jsonSchema.name, 'strategist_brief')
  assert.ok(!/POST TO PLAN/.test(plain.requests[0].message))
})

test('approve saves the knowledge record: the slot\'s concepts, the stage, the export slug', async () => {
  const restore = quiet()
  const store = memoryStore()
  await saveRoadmap(store, { ...goodRoadmap(), status: 'approved' })
  const config = fakeConfig({ DRY_RUN: 'false', ROADMAP_ENABLED: 'true' })
  const m = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
  const r = await m.wait((await m.startRun({ mode: 'full' })).run_id)
  const briefId = r.run.brief_id
  for (const d of store.byType('draft').filter((x) => x.briefId === briefId)) await store.updateRecord(d.id, { ...d.payload, checks: { hard_passed: true, results: [] } }, { status: 'awaiting_human' })
  await store.createRecord({ type: 'review', briefId, payload: { brief_id: briefId, version: 1, brief_version: 1, pass: true, total: 90, feedback: [] }, status: 'pass', version: 1, meta: { brief_version: 1 } })
  const a = await m.wait((await m.startRun({ mode: 'approve', params: { brief_id: briefId } })).run_id)
  restore()
  assert.equal(a.status, 'succeeded', a.run?.result_summary)
  const [k] = store.byType('knowledge')
  assert.equal(k.payload.brief_id, briefId)
  assert.equal(k.payload.slot_id, 's0-1')
  assert.deepEqual(k.payload.concepts, ['human decision', 'M91'])
  assert.deepEqual([k.payload.stage, k.payload.stage_name], [0, 'Starter'])
  assert.ok(k.payload.approved_at)
  assert.equal((await loadRoadmap(store)).payload.stages[0].slots[0].status, 'approved')
})
