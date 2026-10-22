// Phase 12 Task 4: the focused Scout (slot mode). A fake AI answers by call name; a fake URL checker; a memory
// store. No AI, no Mem0, no network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { runScout } from '../../src/scout/index.js'
import { saveRoadmap, loadRoadmap } from '../../src/roadmap/model.js'
import { runPipeline } from '../../src/orchestrator.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer } from '../helpers.js'
import { fakeChecker, fakeWeb } from '../scout/fixtures.js'
import { goodRoadmap, FACTS } from './fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const NOW = Date.parse('2026-10-22T06:00:00Z')
const TODAY = '2026-10-22'

const FACTS_ANSWER = { can: [{ fact: 'Rings every phone in a channel until someone answers.', source_url: 'https://m91.msg91.com/llms.txt' }], cannot: [], integrations: [], contradictions: [] }
const QUESTIONS = (off = []) => ({
  main_question: 'What is M91 and why would my software need a person?',
  related_questions: [
    { question: 'Why do AI agents need human approval?', source_url: 'https://reddit.example.com/r1', demand_evidence: '120 upvotes' },
    { question: 'How to page a human from code?', source_url: 'https://dead.example.com/q2', demand_evidence: '3 answers' }
  ],
  demand: { level: 'high', reason: 'asked in many places' },
  off_roadmap: off
})
const SOURCES = { sources: [{ url: 'https://m91.msg91.com/llms.txt', publisher: 'M91', what_it_covers: 'What M91 does.', kind: 'docs' }, { url: 'https://dead.example.com/q2', publisher: 'x', what_it_covers: 'x', kind: 'community' }] }
const TUTORIALS = { tutorials: [{ title: 'Send your first alert', target: 'curl', reader_outcome: 'A phone rings.', supporting_facts: [{ fact: 'x', source_url: 'https://m91.msg91.com/llms.txt' }], steps_outline: [{ step: 'Create a channel', source_url: 'https://m91.msg91.com/llms.txt' }], gaps: [], topic_group: 1 }] }

/** A fake aiSend: answers by the call name in the thread id (scout-<run>-<call>-xxxx). */
function fakeAi(answers) {
  const calls = []
  const send = async (p) => {
    const call = p.threadId.split('-').slice(2, -1).join('-').replace(/^.*?-(?=(facts|questions-slot|sources-slot|tutorials)$)/, '')
    calls.push(call)
    const a = answers[call]
    if (a === undefined) throw new Error(`unexpected call ${call}`)
    return { content: structuredClone(a), model: 'gemini-2.5-flash', ms: 2, delivery: 'sync' }
  }
  send.calls = calls
  return send
}

async function setup({ facts = true } = {}) {
  const store = memoryStore()
  if (facts) await store.createRecord({ type: 'm91_facts', payload: { ...FACTS, research_at: null }, status: 'current', date: TODAY })
  const roadmap = { ...goodRoadmap(), status: 'approved' }
  await saveRoadmap(store, roadmap)
  return { store, roadmap }
}
const target = (rm, id) => {
  const st = rm.stages.find((s) => s.slots.some((x) => x.slot_id === id))
  return { kind: 'slot', slot: st.slots.find((x) => x.slot_id === id), stage: { number: st.number, name: st.name, level: st.level, goal: st.goal } }
}
const run = (store, t, ai, env = {}) => runScout({ mode: 'slot', runId: 'R-261022-1130-ABCD', briefId: '261022-1130-ABCD', target: t }, { config: fakeConfig({ M91_DOCS_URL: 'https://m91.msg91.com/llms.txt', ...env }), store, aiSend: ai, fetch: fakeWeb(), urlChecker: fakeChecker(), now: () => NOW })

test('a slot with today\'s facts: 2 calls (questions, sources); no stories, clusters, style or question groups', async () => {
  const restore = quiet()
  const s = await setup()
  const ai = fakeAi({ 'questions-slot': QUESTIONS(), 'sources-slot': SOURCES })
  const out = await run(s.store, target(s.roadmap, 's0-1'), ai)
  restore()
  assert.deepEqual(ai.calls, ['questions-slot', 'sources-slot'])
  assert.equal(out.calls_used, 2)
  assert.equal(out.mode, 'slot')
  assert.equal(out.facts_reused, true)
  const cluster = s.store.byType('question_cluster')[0]
  assert.equal(cluster.status, 'open')
  assert.equal(cluster.payload.slot_id, 's0-1')
  assert.deepEqual(cluster.payload.related_questions, ['Why do AI agents need human approval?'], 'a dead source drops its question')
  const pack = s.store.byType('source_pack')[0]
  assert.equal(pack.briefId, '261022-1130-ABCD')
  assert.deepEqual(pack.payload.claims[0].results.map((r) => r.url), ['https://m91.msg91.com/llms.txt'])
  assert.equal(pack.payload.claims[0].verdict, 'supported')
  assert.equal(s.store.byType('story_lead').length + s.store.byType('tone_profile').length, 0)
})

test('no facts today: 3 calls (facts first); stage 2: + the tutorial call (steps from the M91 docs and skill repo)', async () => {
  const restore = quiet()
  const s = await setup({ facts: false })
  const ai = fakeAi({ facts: FACTS_ANSWER, 'questions-slot': QUESTIONS(), 'sources-slot': SOURCES })
  const out = await run(s.store, target(s.roadmap, 's1-1'), ai)
  assert.deepEqual(ai.calls, ['facts', 'questions-slot', 'sources-slot'])
  assert.equal(out.facts_reused, false)
  const s2 = await setup()
  const ai2 = fakeAi({ 'questions-slot': QUESTIONS(), 'sources-slot': SOURCES, tutorials: TUTORIALS })
  const out2 = await run(s2.store, target(s2.roadmap, 's2-1'), ai2)
  restore()
  assert.deepEqual(ai2.calls, ['questions-slot', 'sources-slot', 'tutorials'])
  assert.equal(out2.tutorial_ids.length, 1)
  assert.equal(s2.store.byType('tutorial_lead')[0].payload.slot_id, 's2-1')
})

test('strong demand off the roadmap: a "proposed" slot is added for the person; an invalid or known one is not', async () => {
  const restore = quiet()
  const s = await setup()
  const off = [
    { title_idea: 'Approvals for database schema changes', question: 'Can a person approve a database change?', stage: 3, teaches: ['schema change'], evidence_url: 'https://reddit.example.com/r9', demand_evidence: '300 upvotes' },
    { title_idea: 'M91 vs PagerDuty', question: 'Is M91 better than PagerDuty?', stage: 3, teaches: ['pager'], evidence_url: 'https://x.example.com', demand_evidence: 'many' }
  ]
  const out = await run(s.store, target(s.roadmap, 's0-1'), fakeAi({ 'questions-slot': QUESTIONS(off), 'sources-slot': SOURCES }))
  restore()
  assert.deepEqual(out.proposed_slot_ids, ['s3-4'])
  const st3 = (await loadRoadmap(s.store)).payload.stages[3]
  const p = st3.slots.find((x) => x.slot_id === 's3-4')
  assert.deepEqual([p.status, p.title_idea, p.evidence_url], ['proposed', 'Approvals for database schema changes', 'https://reddit.example.com/r9'])
  assert.ok(!st3.slots.some((x) => x.title_idea === 'M91 vs PagerDuty'), 'comparisons belong in stage 5')
  assert.ok(out.warnings.some((w) => /proposed slot "M91 vs PagerDuty" not added/.test(w)))
})

test('a pinned topic is researched the same way (no roadmap slot); a failed sources call is a warning', async () => {
  const restore = quiet()
  const s = await setup()
  const ai = fakeAi({ 'questions-slot': QUESTIONS() })
  const out = await run(s.store, { kind: 'pinned', pin: { pinned_id: 'PIN-1', topic: 'Approvals for refunds over ₹10,000', notes: '' } }, ai)
  restore()
  assert.deepEqual(ai.calls, ['questions-slot', 'sources-slot'])
  assert.equal(out.target.kind, 'pinned')
  assert.equal(s.store.byType('question_cluster')[0].payload.pinned_id, 'PIN-1')
  assert.ok(out.warnings.some((w) => /sources-slot failed/.test(w)))
  await assert.rejects(runScout({ mode: 'slot' }, { config: fakeConfig(), store: memoryStore(), aiSend: ai }), /needs a target/)
})

test('the pipeline with the roadmap on: the Scout runs in slot mode with the picked target', async () => {
  const restore = quiet()
  const s = await setup()
  let seen = null
  const agents = { ...stubAgents, reviewer: mockReviewer(), scout: async (ctx) => { seen = { mode: ctx.scoutMode, target: ctx.target }; return stubAgents.scout(ctx) } }
  const r = await runPipeline({ config: fakeConfig({ ROADMAP_ENABLED: 'true', DRY_RUN: 'false' }), store: s.store, notifier: fakeNotifier(), agents, now: () => NOW })
  restore()
  assert.equal(r.state, 'awaiting_human')
  assert.equal(seen.mode, 'slot')
  assert.deepEqual([seen.target.kind, seen.target.slot.slot_id, seen.target.stage.name], ['slot', 's0-1', 'Starter'])
})
