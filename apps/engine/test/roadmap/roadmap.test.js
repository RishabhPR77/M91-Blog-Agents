// Phase 12 Task 2: the roadmap's code checks, the Roadmap Planner (hand-written answers, fake AI, memory store)
// and the person's actions on the roadmap. No AI, no Mem0.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { roadmapProblems } from '../../src/roadmap/checks.js'
import { STAGES, allSlots, loadRoadmap, saveRoadmap } from '../../src/roadmap/model.js'
import { runPlanner, roadmapFromAnswer, PlannerError } from '../../src/planner/index.js'
import { PLANNER_PROMPT, buildPlannerMessage } from '../../src/planner/prompts.js'
import { approveRoadmap, editSlot, moveSlot, setSkipped, decideProposed, RoadmapError } from '../../src/roadmap/actions.js'
import { createRunManager } from '../../src/runs.js'
import { defaultAgents } from '../../src/orchestrator.js'
import { printRoadmap } from '../../src/cli.js'
import { resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier } from '../helpers.js'
import { goodAnswer, goodRoadmap, FACTS } from './fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const stage = (rm, n) => rm.stages.find((s) => s.number === n)

function fakeAi(answers) {
  const calls = []
  const send = async (p) => {
    calls.push(p)
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]
    if (a instanceof Error) throw a
    return { content: structuredClone(typeof a === 'function' ? a() : a), model: 'gpt-5.6-luna', ms: 3, delivery: 'sync' }
  }
  send.calls = calls
  return send
}

test('the code stages: 0 Starter … 5 Comparisons and migrations, with levels', () => {
  assert.deepEqual(STAGES.map((s) => [s.number, s.name, s.level]), [[0, 'Starter', 'beginner'], [1, 'Foundations', 'beginner'], [2, 'First steps', 'beginner'], [3, 'Use cases', 'intermediate'], [4, 'Best practices', 'intermediate'], [5, 'Comparisons and migrations', 'advanced']])
})

test('roadmapProblems: a valid roadmap passes; every rule is checked', () => {
  assert.deepEqual(roadmapProblems(goodRoadmap()), [])
  const bad = (fn) => { const rm = goodRoadmap(); fn(rm); return roadmapProblems(rm) }
  assert.match(bad((rm) => stage(rm, 0).slots.push({ ...stage(rm, 1).slots[0], slot_id: 's0-3', needs: [] }))[0], /stage 0 \(Starter\) must have exactly 2 slots \(has 3\)/)
  assert.match(bad((rm) => { stage(rm, 1).slots = stage(rm, 1).slots.slice(0, 2) })[0], /stage 1 \(Foundations\) must have 3–6 slots \(has 2\)/)
  assert.match(bad((rm) => { stage(rm, 1).slots[0].needs = ['s2-1'] }).join(' | '), /slot s1-1: needs s2-1, which comes later/)
  assert.match(bad((rm) => { stage(rm, 1).slots[0].needs = ['s1-1'] }).join(' | '), /slot s1-1: needs itself/)
  assert.match(bad((rm) => { stage(rm, 1).slots[1].needs = ['s9-9'] }).join(' | '), /needs s9-9, which does not exist/)
  // A circle (s1-2 needs s1-3, s1-3 needs s1-2) always has one link pointing forward.
  assert.match(bad((rm) => { stage(rm, 1).slots[1].needs = ['s1-3']; stage(rm, 1).slots[2].needs = ['s1-2'] }).join(' | '), /slot s1-2: needs s1-3, which comes later/)
  assert.match(bad((rm) => { stage(rm, 1).slots[2].slot_id = 's1-1' }).join(' | '), /slot s1-1: duplicate slot_id/)
  assert.match(bad((rm) => { stage(rm, 2).slots[0].slot_id = 's3-9' }).join(' | '), /its id says stage 3 but it is in stage 2/)
  assert.match(bad((rm) => { stage(rm, 2).slots[0].slot_id = 'two-1' }).join(' | '), /slot_id must look like s<stage>-<n>/)
  assert.match(bad((rm) => { stage(rm, 3).slots[0].title_idea = 'M91 vs PagerDuty for agents' }).join(' | '), /slot s3-1: comparisons and migrations belong in stage 5 only/)
  assert.match(bad((rm) => { stage(rm, 4).slots[0].question = 'How to migrate to M91?' }).join(' | '), /stage 5 only/)
  assert.match(bad((rm) => { stage(rm, 1).slots[0].teaches = [] }).join(' | '), /teaches must list 1–5 concepts/)
  assert.match(bad((rm) => { stage(rm, 1).slots[0].question = 'Tell me about approvals' }).join(' | '), /ending with "\?"/)
  assert.match(bad((rm) => { rm.stages = rm.stages.filter((s) => s.number !== 4) }).join(' | '), /stage 4 \(Best practices\) must appear exactly once/)
  // Proposed slots never count towards a stage's size (skipped ones do, so a skip is always possible).
  assert.deepEqual(bad((rm) => stage(rm, 0).slots.push({ ...stage(rm, 0).slots[1], slot_id: 's0-3', status: 'proposed', needs: [] })), [])
})

test('roadmapFromAnswer: code stages and statuses; locked and proposed slots of the existing roadmap come back unchanged', () => {
  const rm = goodRoadmap()
  assert.equal(rm.status, 'draft')
  assert.ok(allSlots(rm).every((s) => s.status === 'planned' && s.brief_id === ''))
  assert.equal(stage(rm, 3).goal, STAGES[3].goal)
  const existing = goodRoadmap()
  Object.assign(stage(existing, 0).slots[0], { status: 'approved', brief_id: '261022-1000-ABCD', title_idea: 'The approved title' })
  stage(existing, 3).slots.push({ slot_id: 's3-4', title_idea: 'Approvals for database migrations', question: 'Can a person approve a database change?', teaches: ['schema change'], needs: ['s2-2'], status: 'proposed', brief_id: '' })
  const answer = goodAnswer()
  answer.stages[0].slots[0].title_idea = 'A different title the Planner chose'
  const next = roadmapFromAnswer(answer, existing)
  assert.deepEqual(stage(next, 0).slots[0], stage(existing, 0).slots[0], 'the approved slot is kept exactly')
  assert.equal(stage(next, 3).slots.at(-1).status, 'proposed')
  assert.deepEqual(roadmapProblems(next), [])
})

test('the prompt and message: the rules, the stages, M91 facts, locked slots marked', () => {
  assert.match(PLANNER_PROMPT, /Stage 0 \(Starter\) has exactly 2 slots/)
  assert.match(PLANNER_PROMPT, /Comparisons, "X vs Y", alternatives and migrations go in Stage 5 only/)
  assert.match(PLANNER_PROMPT, /Facts about M91 come only from M91 FACTS/)
  const existing = goodRoadmap()
  stage(existing, 1).slots[0].status = 'approved'
  const m = buildPlannerMessage({ factsText: 'can:\n  - Rings every phone', existing })
  assert.match(m, /--- STAGES ---\n- Stage 0: Starter \(beginner\)/)
  assert.match(m, /--- M91 FACTS ---\ncan:/)
  assert.match(m, /s1-1 \[LOCKED\] What a human approval step is/)
})

async function seeded({ facts = true, roadmap = null } = {}) {
  const store = memoryStore()
  if (facts) await store.createRecord({ type: 'm91_facts', payload: FACTS, status: 'current', date: '2026-10-22' })
  if (roadmap) await saveRoadmap(store, roadmap)
  return store
}

test('runPlanner: one call with today\'s facts; the roadmap is saved as a draft (one record)', async () => {
  const restore = quiet()
  const store = await seeded()
  const ai = fakeAi([goodAnswer()])
  const out = await runPlanner({ runId: 'R-1' }, { config: fakeConfig(), store, aiSend: ai, runFacts: async () => { throw new Error('must not run') } })
  restore()
  assert.equal(ai.calls.length, 1)
  assert.equal(ai.calls[0].agent, 'planner')
  assert.equal(ai.calls[0].jsonSchema.name, 'planner_roadmap')
  assert.match(ai.calls[0].threadId, /^planner-R-1-plan-[a-z0-9]{4}$/)
  assert.equal(out.slots, 17)
  assert.equal(out.facts_reused, true)
  assert.match(out.summary_line, /^Roadmap draft: 17 slots in 6 stages \(2\/3\/3\/3\/3\/3\) · approve it in the dashboard$/)
  const recs = store.byType('roadmap')
  assert.equal(recs.length, 1)
  assert.equal(recs[0].status, 'draft')
  assert.equal(recs[0].payload.status, 'draft')
})

test('runPlanner: no M91 facts → the Scout\'s facts step first; a regenerate updates the same record and returns to draft', async () => {
  const restore = quiet()
  const approved = { ...goodRoadmap(), status: 'approved' }
  const store = await seeded({ facts: false, roadmap: approved })
  let factsRuns = 0
  const out = await runPlanner({ runId: 'R-2' }, { config: fakeConfig(), store, aiSend: fakeAi([goodAnswer()]), runFacts: async () => { factsRuns++; return { facts: FACTS, reused: false } } })
  restore()
  assert.equal(factsRuns, 1)
  assert.equal(out.facts_reused, false)
  assert.match(out.summary_line, /M91 facts read first/)
  assert.equal(store.byType('roadmap').length, 1, 'the same record')
  assert.equal(store.byType('roadmap')[0].payload.status, 'draft', 'a new plan must be approved again')
})

test('runPlanner: code problems get one repair (with the problems); still failing → nothing saved', async () => {
  const restore = quiet()
  const bad = goodAnswer()
  bad.stages[3].slots[0].title_idea = 'M91 vs PagerDuty'
  const store = await seeded()
  const ai = fakeAi([bad, goodAnswer()])
  const out = await runPlanner({ runId: 'R-3' }, { config: fakeConfig(), store, aiSend: ai })
  assert.equal(ai.calls.length, 2)
  assert.match(ai.calls[1].message, /--- PROBLEMS TO FIX ---\n- slot s3-1: comparisons and migrations belong in stage 5 only/)
  assert.equal(out.repairs_used, 1)
  const store2 = await seeded()
  await assert.rejects(runPlanner({ runId: 'R-4' }, { config: fakeConfig(), store: store2, aiSend: fakeAi([bad]) }), (e) => e instanceof PlannerError && /still had problems after 1 repair/.test(e.message))
  restore()
  assert.equal(store2.byType('roadmap').length, 0)
})

test('the roadmap run mode (1 AI call through defaultAgents) and the CLI print', async () => {
  const restore = quiet()
  const store = await seeded()
  const ai = fakeAi([goodAnswer()])
  const config = fakeConfig()
  const m = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: (rc, d) => defaultAgents({ config: rc, ...d, agentDeps: { aiSend: ai } }) })
  const { run_id } = await m.startRun({ mode: 'roadmap' })
  const r = await m.wait(run_id)
  restore()
  assert.equal(r.status, 'succeeded', r.error)
  assert.match(r.run.result_summary, /^Roadmap draft: 17 slots/)
  assert.deepEqual(r.run.steps.map((s) => s.name), ['planner'])
  const lines = []
  printRoadmap((await loadRoadmap(store)).payload, (l) => lines.push(l))
  assert.match(lines[0], /^--- Roadmap · draft/)
  assert.ok(lines.some((l) => /^Stage 5: Comparisons and migrations \(advanced\)$/.test(l)))
})

test('actions: approve; edit, move, skip and restore planned slots; accept or reject proposed ones; invalid results are refused', async () => {
  const store = await seeded({ roadmap: goodRoadmap() })
  const ok = await approveRoadmap(store)
  assert.equal(ok.payload.status, 'approved')
  assert.ok(ok.payload.approved_at)
  let rm = (await editSlot(store, 's1-2', { title_idea: '  Why a ringing phone works  ', teaches: ['urgent alert', 'attention'] })).payload
  assert.equal(stage(rm, 1).slots[1].title_idea, 'Why a ringing phone works')
  assert.equal(rm.status, 'approved', 'an edit keeps the approval')
  await assert.rejects(editSlot(store, 's1-2', { title_idea: 'M91 vs Slack' }), (e) => e instanceof RoadmapError && e.code === 'roadmap_invalid')
  rm = (await moveSlot(store, 's1-3', 'up')).payload
  assert.deepEqual(stage(rm, 1).slots.map((s) => s.slot_id), ['s1-1', 's1-3', 's1-2'])
  await assert.rejects(moveSlot(store, 's1-1', 'down'), (e) => e.code === 'roadmap_invalid', 's1-3 needs s1-1: it cannot come first')
  await assert.rejects(moveSlot(store, 's1-1', 'up'), (e) => e.code === 'cannot_move')
  rm = (await setSkipped(store, 's2-3', true)).payload
  assert.equal(stage(rm, 2).slots[2].status, 'skipped')
  await assert.rejects(setSkipped(store, 's1-1', false), (e) => e.code === 'bad_params')
  rm = (await setSkipped(store, 's2-3', false)).payload
  assert.equal(stage(rm, 2).slots[2].status, 'planned')
  // A proposed slot (the Scout's): accept → planned; reject → removed.
  const rec = await loadRoadmap(store)
  const withProposed = structuredClone(rec.payload)
  stage(withProposed, 3).slots.push({ slot_id: 's3-4', title_idea: 'Approvals for database changes', question: 'Can a person approve a database change?', teaches: ['schema change'], needs: ['s2-2'], status: 'proposed', brief_id: '' }, { slot_id: 's3-5', title_idea: 'Approvals for big emails', question: 'Can a person approve a big email send?', teaches: ['bulk email'], needs: [], status: 'proposed', brief_id: '' })
  await saveRoadmap(store, withProposed, rec)
  rm = (await decideProposed(store, 's3-4', true)).payload
  assert.equal(stage(rm, 3).slots.find((s) => s.slot_id === 's3-4').status, 'planned')
  rm = (await decideProposed(store, 's3-5', false)).payload
  assert.equal(stage(rm, 3).slots.some((s) => s.slot_id === 's3-5'), false)
  await assert.rejects(decideProposed(store, 's3-4', true), (e) => e.code === 'not_proposed')
  // Work has started on a slot: no edits.
  const r2 = await loadRoadmap(store)
  const started = structuredClone(r2.payload)
  stage(started, 0).slots[0].status = 'drafting'
  await saveRoadmap(store, started, r2)
  await assert.rejects(editSlot(store, 's0-1', { title_idea: 'x' }), (e) => e.code === 'slot_locked')
  await assert.rejects(approveRoadmap(memoryStore()), (e) => e.code === 'no_roadmap' && e.status === 404)
})
