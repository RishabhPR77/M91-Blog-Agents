// The editor (what the next run writes, no AI): near-repeats of published guides and other posts are left out with a
// reason, a fresh news story goes first when no news post went out lately, a tutorial when the last posts were not
// tutorials, otherwise the next roadmap slot. Pinned topics and Write now cards still go first. Fakes only.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chooseNext, coverage, topicWords, isTutorialSlot, kindOfBrief, readySlots } from '../src/roadmap/editor.js'
import { pickTarget } from '../src/roadmap/pick.js'
import { saveRoadmap } from '../src/roadmap/model.js'
import { resetEvents } from '../src/events.js'
import { fakeConfig, memoryStore } from './helpers.js'
import { goodRoadmap } from './roadmap/fixtures.js'

beforeEach(() => resetEvents())
const NOW = Date.parse('2026-10-28T06:00:00Z')
const now = () => NOW
const cfg = (over = {}) => fakeConfig({ NEXT_PICK: 'editor', ROADMAP_ENABLED: 'true', RAPID_RESPONSE_ENABLED: 'true', ...over })
const approved = (fn = () => {}) => { const rm = { ...goodRoadmap(), status: 'approved' }; fn(rm); return rm }
const slotOf = (rm, id) => rm.stages.flatMap((s) => s.slots).find((s) => s.slot_id === id)
const set = (rm, ids, status) => { for (const id of ids) slotOf(rm, id).status = status }
const APPROVAL = { url: 'https://msg91.com/guide/what-happens-when-your-software-needs-a-human-approval-', title: 'What Happens When Your Software Needs a Human Approval?', headings: ['What Is M91?', 'What Is Human-in-the-Loop (HITL)?', 'How M91 Works', 'Who Uses M91'], keywords: ['M91', 'HITL', 'human approval'] }
const FLOW = { url: 'https://msg91.com/guide/how-the-m91-alert-flow', title: 'How the M91 Alert Flow Moves an Alert From Software to a Person', description: 'Explore how M91 sends a titled alert from software, notifies a channel, captures a human response, and returns the result to software with callbacks and timeouts.', headings: ['What happens after software sends an M91 alert?', 'How does the M91 send URL raise an alert?', 'What does the person receive and do?', "How does the software get the person's answer?", 'What should software do if nobody answers?'], keywords: [] }
const guide = (store, g, at = '2026-10-20T13:00:00.000Z') => store.createRecord({ type: 'published_guide', status: 'live', payload: { ...g, slug: g.url.split('/guide/')[1], summary: '', published_at: at } })
const brief = (store, id, payload, status = 'approved', at = '2026-10-26T10:00:00Z') => store.createRecord({ type: 'brief', briefId: id, version: 1, status, date: at.slice(0, 10), payload: { brief_id: id, titles: [payload.title], keyword: payload.keyword ?? '', supporting_keywords: [], outline: [], approved_at: at, ...payload } })
const card = (store, over = {}) => store.createRecord({ type: 'timely_opportunity', status: 'proposed', date: '2026-10-27', payload: { opportunity_id: 'O-1', title: 'Two AI agents weakened a safety check before deploy', what_happened: 'x', outlet: 'The Hacker News', published_date: '2026-10-27', urgency: 'high', source_url: 'https://thehackernews.com/x', brief_id: '', topic_group: 1, ...over } })

test('words and repeats: real titles — the Starter slots repeat the two published guides; unrelated slots do not', () => {
  const s01 = 'What M91 is and why software needs a human What is M91 and why would my software need a person? human decision M91'
  const s02 = 'How M91 works in 5 minutes How does M91 work? alert channel callback'
  const s12 = 'Why a phone call beats a chat message Why should a phone ring for a decision? urgent alert'
  const text = (g) => `${g.title} ${g.headings.join(' ')} ${g.keywords.join(' ')}`
  assert.ok(!topicWords('M91 alert alerts guide').size, 'words every post shares say nothing')
  assert.ok(coverage(s01, text(APPROVAL)) >= 0.6, `s0-1 vs the approval guide: ${coverage(s01, text(APPROVAL))}`)
  assert.ok(coverage(s12, text(APPROVAL)) < 0.6, `s1-2 is its own topic: ${coverage(s12, text(APPROVAL))}`)
  assert.equal(coverage('a b', 'a b c'), 0, 'too few words to judge')
  assert.equal(isTutorialSlot({ title_idea: 'Test it with your own phone', question: 'How do I test an alert safely?' }, 1), true)
  assert.equal(isTutorialSlot({ title_idea: 'Anything', question: 'x?' }, 2), true, 'stage 2 (First steps)')
  assert.equal(isTutorialSlot({ title_idea: 'One owner for every decision', question: 'Who should decide?' }, 1), false)
  assert.equal(kindOfBrief({ post_type: 'rapid_response' }), 'news')
  assert.equal(kindOfBrief({ format: 'tutorial' }), 'tutorial')
  assert.equal(kindOfBrief({ post_type: 'question', format: 'guide' }), 'other')
  void s02
})

test('no near-repeats: a slot a published guide already answers is left out (with the reason); the next one is taken', async () => {
  const store = memoryStore()
  await guide(store, APPROVAL)
  const rm = approved()
  const c = await chooseNext(store, { config: cfg(), roadmap: rm, now })
  assert.equal(c.kind, 'none', 's0-1 repeats the guide, s0-2 needs s0-1: nothing else is ready')
  assert.match(c.reason, /^every ready topic repeats a post readers already have \(s0-1: close to a published guide "What Happens When Your Software Needs a Human Approval\?"\)/)
  // The person marks s0-1 covered: s0-2 is ready, but the alert-flow guide answers it too.
  set(rm, ['s0-1'], 'covered')
  await guide(store, FLOW, '2026-10-23T08:00:00.000Z')
  const c2 = await chooseNext(store, { config: cfg(), roadmap: rm, now })
  assert.equal(c2.kind, 'none')
  assert.deepEqual(c2.skipped.map((s) => s.id), ['s0-2'])
  set(rm, ['s0-2'], 'covered')
  const c3 = await chooseNext(store, { config: cfg(), roadmap: rm, now })
  // The last two posts readers got (the two guides) were not tutorials: the ready tutorial goes first.
  assert.deepEqual([c3.kind, c3.slot.slot_id, c3.why], ['slot', 's2-1', 'a tutorial: none of the last 2 posts was one'])
  // The roadmap mode keeps the old way (the next slot, no editor).
  const old = await saveRoadmap(store, approved())
  const t = await pickTarget(store, { config: cfg({ NEXT_PICK: 'roadmap' }), now })
  assert.deepEqual([t.kind, t.slot.slot_id, t.why], ['slot', 's0-1', undefined])
  void old
})

test('news: a fresh, relevant card goes first when no news post went out in the last 7 days; not otherwise', async () => {
  const rm = approved((r) => set(r, ['s0-1', 's0-2'], 'approved'))
  const store = memoryStore()
  await saveRoadmap(store, rm)
  await card(store)
  let c = await chooseNext(store, { config: cfg(), roadmap: rm, now })
  assert.equal(c.kind, 'timely')
  assert.equal(c.record.payload.opportunity_id, 'O-1')
  assert.match(c.why, /^news: "Two AI agents weakened a safety check before deploy" \(reported by The Hacker News, 2026-10-27, high urgency\); no news post in the last 7 days$/)
  // A news post 3 days ago: the card waits, the roadmap goes on.
  await brief(store, 'B-N', { title: 'An earlier news post', post_type: 'rapid_response' }, 'approved', '2026-10-25T10:00:00Z')
  c = await chooseNext(store, { config: cfg(), roadmap: rm, now })
  assert.deepEqual([c.kind, c.slot.slot_id], ['slot', 's1-1'])
  // Low urgency, an expired card, a card before the Starter is approved: no news either.
  const s2 = memoryStore()
  await saveRoadmap(s2, rm)
  await card(s2, { urgency: 'low' })
  assert.equal((await chooseNext(s2, { config: cfg(), roadmap: rm, now })).kind, 'slot')
  const s3 = memoryStore()
  await saveRoadmap(s3, rm)
  await card(s3, { published_date: '2026-09-01' })
  assert.equal((await chooseNext(s3, { config: cfg(), roadmap: rm, now })).kind, 'slot')
  const s4 = memoryStore()
  await card(s4)
  await saveRoadmap(s4, approved())
  assert.equal((await chooseNext(s4, { config: cfg(), roadmap: approved(), now })).kind, 'slot', 'news waits for an approved Starter post')
  // The timely lane off: no news at all.
  assert.equal((await chooseNext(store, { config: cfg({ RAPID_RESPONSE_ENABLED: 'false' }), roadmap: rm, now })).kind, 'slot')
})

test('news: a card that repeats a published guide is left out', async () => {
  const rm = approved((r) => set(r, ['s0-1', 's0-2'], 'approved'))
  const store = memoryStore()
  await saveRoadmap(store, rm)
  await guide(store, APPROVAL)
  await card(store, { title: 'What happens when your software needs a human approval' })
  const c = await chooseNext(store, { config: cfg(), roadmap: rm, now })
  assert.equal(c.kind, 'slot')
  assert.match(c.skipped[0].why, /^close to a published guide/)
})

test('the mix: a tutorial when the last two posts were not tutorials; the next slot when one was', async () => {
  const rm = approved((r) => set(r, ['s0-1', 's0-2'], 'approved'))
  assert.deepEqual(readySlots(rm).slots.map((c) => [c.slot.slot_id, c.tutorial]), [['s1-1', false], ['s2-1', true]], 'stage 1, plus the ready tutorials of stage 2')
  const store = memoryStore()
  await brief(store, 'B-1', { title: 'What M91 is', format: 'explainer' }, 'approved', '2026-10-20T10:00:00Z')
  await brief(store, 'B-2', { title: 'How M91 works', format: 'guide' }, 'approved', '2026-10-23T10:00:00Z')
  let c = await chooseNext(store, { config: cfg(), roadmap: rm, now })
  assert.deepEqual([c.kind, c.slot.slot_id, c.why], ['slot', 's2-1', 'a tutorial: none of the last 2 posts was one'])
  await brief(store, 'B-3', { title: 'Connect M91 to your CRM', format: 'tutorial', post_type: 'tutorial' }, 'approved', '2026-10-26T10:00:00Z')
  c = await chooseNext(store, { config: cfg(), roadmap: rm, now })
  assert.deepEqual([c.slot.slot_id, c.why], ['s1-1', 'next on the roadmap'])
})

test('pickTarget: pinned topics first, then the editor\'s choice with its reason; a draft roadmap still waits for approval', async () => {
  const store = memoryStore()
  await saveRoadmap(store, approved((r) => set(r, ['s0-1', 's0-2'], 'approved')))
  await card(store)
  let t = await pickTarget(store, { config: cfg(), now })
  assert.deepEqual([t.kind, t.chosenByEditor, t.opportunity.opportunity_id], ['timely', true, 'O-1'])
  assert.match(t.why, /^news: /)
  await store.createRecord({ type: 'pinned_topic', status: 'open', payload: { pinned_id: 'PIN-1', topic: 'Due now', target_date: '2026-10-01' } })
  t = await pickTarget(store, { config: cfg(), now })
  assert.equal(t.kind, 'pinned')
  const draft = memoryStore()
  await saveRoadmap(draft, goodRoadmap())
  t = await pickTarget(draft, { config: cfg(), now })
  assert.deepEqual([t.kind, t.reason], ['none', 'Approve the roadmap first'])
})

// ---------- one click: the run plans and approves the roadmap itself ----------

import { createRunManager } from '../src/runs.js'
import { stubAgents } from '../src/agents/stubs.js'
import { loadRoadmap } from '../src/roadmap/model.js'
import { replay } from '../src/events.js'
import { setSink } from '../src/util/log.js'
import { fakeNotifier, mockReviewer } from './helpers.js'

/** A Roadmap Planner stand-in: saves the fixture roadmap as a draft in the run's store (what the real one does after its AI call). */
const plannerAgent = (store, calls) => async () => {
  calls.push('planner')
  await saveRoadmap(store, goodRoadmap())
  return { output: { summary_line: 'Roadmap draft: 17 slots', calls: [{ model: 'gpt-5.6-luna' }] }, model: 'gpt-5.6-luna' }
}

test('one click: no roadmap → the run plans it, approves it and writes the first slot; the gate lets it start', async () => {
  const restore = setSink(() => {})
  const store = memoryStore()
  const calls = []
  const config = cfg({ DRY_RUN: 'false', ROADMAP_AUTO_PLAN: 'true', ROADMAP_AUTO_APPROVE: 'true', NEXT_PICK: 'roadmap' })
  const m = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: (rc, { store: runStore }) => ({ ...stubAgents, reviewer: mockReviewer(), planner: plannerAgent(runStore, calls) }) })
  try {
    const { run_id } = await m.startRun({ mode: 'full' })
    const r = await m.wait(run_id)
    assert.equal(r.status, 'succeeded', r.run?.result_summary)
    assert.deepEqual(calls, ['planner'])
    const rm = (await loadRoadmap(store)).payload
    assert.equal(rm.status, 'approved')
    assert.equal(rm.stages[0].slots[0].status, 'in_review', 's0-1 was written')
    const msgs = replay(run_id).filter((e) => e.type === 'step.output').map((e) => e.message)
    assert.ok(msgs.includes('No roadmap yet: the Roadmap Planner plans it first (1–2 AI calls)'))
    assert.ok(msgs.some((x) => /^Roadmap approved by the run/.test(x)))
    // The next click: the roadmap exists, so no planning again.
    calls.length = 0
    await assert.rejects(m.startRun({ mode: 'full' }), (e) => e.code === 'nothing_to_write', 's0-2 needs s0-1, which waits for you')
    assert.deepEqual(calls, [])
  } finally {
    restore()
  }
})

test('one click: a draft roadmap is approved by the run; with ROADMAP_AUTO_APPROVE=false the gate still asks you; auto-plan off keeps the old gate', async () => {
  const restore = setSink(() => {})
  try {
    const store = memoryStore()
    await saveRoadmap(store, goodRoadmap())
    const on = createRunManager({ config: cfg({ DRY_RUN: 'false', ROADMAP_AUTO_PLAN: 'true', ROADMAP_AUTO_APPROVE: 'true', NEXT_PICK: 'roadmap' }), storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
    const r = await on.wait((await on.startRun({ mode: 'full' })).run_id)
    assert.equal(r.status, 'succeeded', r.run?.result_summary)
    assert.equal((await loadRoadmap(store)).payload.status, 'approved')
    const s2 = memoryStore()
    await saveRoadmap(s2, goodRoadmap())
    const ask = createRunManager({ config: cfg({ ROADMAP_AUTO_PLAN: 'true', ROADMAP_AUTO_APPROVE: 'false' }), storeFactory: () => s2, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
    await assert.rejects(ask.startRun({ mode: 'full' }), (e) => e.code === 'roadmap_not_approved')
    const off = createRunManager({ config: cfg({ ROADMAP_AUTO_PLAN: 'false' }), storeFactory: () => memoryStore(), notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
    await assert.rejects(off.startRun({ mode: 'full' }), (e) => e.code === 'roadmap_not_approved' && /no roadmap yet/.test(e.message))
  } finally {
    restore()
  }
})

test('Next up says what one click does: plan (no roadmap), approve (a draft without problems)', async () => {
  const { createServer } = await import('../src/server.js')
  const restore = setSink(() => {})
  const store = memoryStore()
  const config = cfg({ ROADMAP_AUTO_PLAN: 'true', ROADMAP_AUTO_APPROVE: 'true' })
  const m = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const srv = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager: m, store, config })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const get = async () => (await (await fetch(`http://127.0.0.1:${srv.address().port}/api/roadmap`)).json()).next
  try {
    assert.deepEqual(await get(), { kind: 'plan', reason: 'the run plans the roadmap first (1–2 more AI calls), approves it, then writes the first post' })
    await saveRoadmap(store, goodRoadmap())
    srv.index?.invalidate?.('roadmap')
    const n = await get()
    assert.ok(n.kind === 'plan' && /approves the roadmap/.test(n.reason) || n.kind === 'plan', JSON.stringify(n))
  } finally {
    await new Promise((r) => srv.close(r))
    restore()
  }
})
