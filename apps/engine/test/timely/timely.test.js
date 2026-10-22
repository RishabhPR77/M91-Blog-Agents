// The timely lane: the news check (Scout timely mode), dedupe, expiry, the picking order with the Starter rule and the
// weekly cap, the card actions, a timely post through the Scout and Strategist, the Start-here line, approval and the
// API. Fakes only: no AI, no Mem0, no network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { runScout } from '../../src/scout/index.js'
import { saveRoadmap, loadRoadmap } from '../../src/roadmap/model.js'
import { pickTarget } from '../../src/roadmap/pick.js'
import { runPipeline } from '../../src/orchestrator.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { createServer } from '../../src/server.js'
import { createRunManager } from '../../src/runs.js'
import { buildInputs } from '../../src/strategist/inputs.js'
import { buildPlanPrompt } from '../../src/strategist/prompts.js'
import { runContentChecks } from '../../src/checks/content.js'
import { isExpired, expireOld, nextTimely, applyAction, markWriting, releaseWriting, finishTimely, timelyThisWeek } from '../../src/timely/model.js'
import { withStartHere, starterPost, startHereLine, needsStartHere } from '../../src/timely/starthere.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer } from '../helpers.js'
import { fakeChecker } from '../scout/fixtures.js'
import { goodRoadmap, FACTS } from '../roadmap/fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const NOW = Date.parse('2026-10-22T06:00:00Z')
const now = () => NOW
const TODAY = '2026-10-22'
const cfg = (env = {}) => fakeConfig({ ROADMAP_ENABLED: 'true', RAPID_RESPONSE_ENABLED: 'true', DRY_RUN: 'false', ...env })

const EVENT = (over = {}) => ({
  title: 'An AI agent refunded the wrong orders', what_happened: 'A shop\'s AI agent sent refunds without a check. The company paused it.', source_url: 'https://news.example.com/refunds',
  outlet: 'Example News', published_date: '2026-10-20', why_m91: 'A person could approve each refund over a limit.', urgency: 'high', urgency_reason: 'Teams are adding agents now.', topic_group: 2, ...over
})

/** A fake aiSend: answers by the last part of the thread id (scout-<run>-<call>-xxxx). */
function fakeAi(answers) {
  const calls = []
  const send = async (p) => {
    const parts = p.threadId.split('-')
    const call = parts.slice(-3, -1).join('-').replace(/^[A-Z0-9]+-/, '').replace(/^.*-(?=(timely|questions-slot|sources-slot|facts)$)/, '')
    calls.push({ call, prompt: p.prompt, message: p.message })
    const a = answers[call]
    if (a === undefined) throw new Error(`unexpected call ${call}`)
    return { content: structuredClone(a), model: 'gpt-5-mini', ms: 2, delivery: 'sync' }
  }
  send.calls = calls
  return send
}

const approvedRoadmap = (starterDone = true) => {
  const rm = { ...goodRoadmap(), status: 'approved' }
  if (starterDone) rm.stages[0].slots[0].status = 'approved'
  return rm
}

async function seed({ starterDone = true, cards = [] } = {}) {
  const store = memoryStore()
  await store.createRecord({ type: 'm91_facts', payload: { ...FACTS, research_at: null }, status: 'current', date: '2026-10-20' })
  await saveRoadmap(store, approvedRoadmap(starterDone))
  for (const c of cards) await store.createRecord({ type: 'timely_opportunity', payload: { opportunity_id: c.id, brief_id: '', ...EVENT(), ...c.payload }, status: c.status ?? 'proposed', date: TODAY })
  return store
}
const card = (store, id) => store.byType('timely_opportunity').find((r) => r.payload.opportunity_id === id)

// ---------- the news check ----------

test('news check: one call; keeps dated, live, new events as "proposed" cards; drops old, future, undated, dead, known and similar ones', async () => {
  const restore = quiet()
  const store = await seed({ cards: [{ id: 'O-KNOWN', payload: { title: 'Payments team missed an on-call page', source_url: 'https://news.example.com/known' } }] })
  await store.createRecord({ type: 'knowledge', payload: { title: 'Why a phone call beats a chat message', stage: 0 }, status: 'current' })
  const ai = fakeAi({
    timely: {
      events: [
        EVENT(),
        EVENT({ title: 'Same source again', source_url: 'https://news.example.com/known' }),
        EVENT({ title: 'Old outage report', source_url: 'https://news.example.com/old', published_date: '2026-10-01' }),
        EVENT({ title: 'A future thing', source_url: 'https://news.example.com/future', published_date: '2026-10-30' }),
        EVENT({ title: 'Undated story', source_url: 'https://news.example.com/undated', published_date: 'unknown' }),
        EVENT({ title: 'Dead link story', source_url: 'https://dead.example.com/q2' })
      ]
    }
  })
  const out = await runScout({ mode: 'timely', runId: 'R-261022-1130-ABCD' }, { config: cfg(), store, aiSend: ai, urlChecker: fakeChecker(), now })
  restore()
  assert.deepEqual(ai.calls.map((c) => c.call), ['timely'])
  assert.match(ai.calls[0].prompt, /from the last 7 days \(today is 2026-10-22\)/)
  assert.match(ai.calls[0].message, /--- KNOWN EVENTS ---\n- Payments team missed an on-call page \(https:\/\/news\.example\.com\/known\)/)
  assert.equal(out.mode, 'timely')
  assert.deepEqual(out.opportunities.map((o) => o.title), ['An AI agent refunded the wrong orders'])
  assert.deepEqual(out.dropped.map((d) => d.reason), ['already known (same source)', '21 days old (window 7)', 'dated in the future (2026-10-30)', 'no clear date'])
  assert.ok(out.warnings.includes('timely: 6 events returned, kept the first 5'))
  const saved = card(store, out.opportunities[0].opportunity_id)
  assert.equal(saved.status, 'proposed')
  assert.deepEqual([saved.payload.outlet, saved.payload.urgency, saved.payload.published_date, saved.payload.brief_id], ['Example News', 'high', '2026-10-20', ''])
  // A title close to a card or an approved post is dropped too.
  const ai2 = fakeAi({ timely: { events: [EVENT({ title: 'Why a phone call beats a chat message', source_url: 'https://news.example.com/other' }), EVENT({ title: 'Dead link story', source_url: 'https://dead.example.com/q2' })] } })
  const out2 = await runScout({ mode: 'timely', runId: 'R-261022-1131-ABCD' }, { config: cfg(), store, aiSend: ai2, urlChecker: fakeChecker(), now })
  assert.match(out2.dropped[0].reason, /^close to an approved post/)
  assert.equal(out2.dropped[1].reason, 'the source does not load')
})

test('expiry: a proposed or write_now card expires TIMELY_WINDOW_DAYS after the event; one being written never does', async () => {
  const store = await seed({ cards: [
    { id: 'O-OLD', payload: { published_date: '2026-10-10' } },
    { id: 'O-NEW', payload: { published_date: '2026-10-21' } },
    { id: 'O-WRITING', status: 'write_now', payload: { published_date: '2026-10-01', brief_id: '261022-0900-ABCD' } },
    { id: 'O-DONE', status: 'dismissed', payload: { published_date: '2026-10-01' } }
  ] })
  assert.equal(isExpired(card(store, 'O-OLD'), { today: TODAY, windowDays: 7 }), true)
  assert.equal(await expireOld(store, { config: cfg(), now }), 1)
  assert.deepEqual(['O-OLD', 'O-NEW', 'O-WRITING', 'O-DONE'].map((id) => card(store, id).status), ['expired', 'proposed', 'write_now', 'dismissed'])
})

// ---------- picking ----------

test('picking: pinned topics due → one write_now card → the roadmap\'s next slot; a timely post never uses a slot', async () => {
  const store = await seed({ cards: [{ id: 'O-1', status: 'write_now', payload: { write_now_at: '2026-10-21T10:00:00+05:30' } }] })
  let t = await pickTarget(store, { now, config: cfg() })
  assert.deepEqual([t.kind, t.opportunity.opportunity_id], ['timely', 'O-1'])
  // Without the lane (no config), the roadmap is picked as before.
  assert.equal((await pickTarget(store, { now })).kind, 'slot')
  await store.createRecord({ type: 'pinned_topic', payload: { pinned_id: 'PIN-1', topic: 'Due now', target_date: '2026-01-01' }, status: 'open' })
  t = await pickTarget(store, { now, config: cfg() })
  assert.equal(t.kind, 'pinned')
})

test('the Starter rule: no timely post until stage 0 has an approved post (the card waits, with the reason)', async () => {
  const store = await seed({ starterDone: false, cards: [{ id: 'O-1', status: 'write_now' }] })
  const t = await pickTarget(store, { now, config: cfg() })
  assert.equal(t.kind, 'slot')
  assert.equal(t.slot.slot_id, 's0-1')
  assert.deepEqual(t.timelyWaiting, { title: EVENT().title, opportunity_id: 'O-1', reason: 'Timely posts start once the Starter (stage 0) has an approved post' })
})

test('the weekly cap: at most TIMELY_MAX_PER_WEEK timely posts per 7 days (written or being written)', async () => {
  const store = await seed({ cards: [
    { id: 'O-DONE', status: 'written', payload: { written_at: '2026-10-19T10:00:00+05:30' } },
    { id: 'O-1', status: 'write_now' }
  ] })
  assert.equal(timelyThisWeek(store.byType('timely_opportunity'), { now }), 1)
  const t = await nextTimely(store, { config: cfg(), now })
  assert.equal(t.record, null)
  assert.match(t.reason, /^TIMELY_MAX_PER_WEEK \(1\) timely post already written in the last 7 days$/)
  assert.equal((await nextTimely(store, { config: cfg({ TIMELY_MAX_PER_WEEK: '2' }), now })).record.payload.opportunity_id, 'O-1')
  // A post written 8 days ago no longer counts.
  card(store, 'O-DONE').payload.written_at = '2026-10-13T10:00:00+05:30'
  assert.equal((await nextTimely(store, { config: cfg(), now })).record.payload.opportunity_id, 'O-1')
})

// ---------- card actions ----------

test('actions: Write now, Dismiss, Add to roadmap (a planned slot in the chosen stage); wrong status or in progress → 409', async () => {
  const store = await seed({ cards: [{ id: 'O-1' }, { id: 'O-2' }, { id: 'O-3', payload: { title: 'Approvals for payouts over a limit', source_url: 'https://news.example.com/payouts' } }, { id: 'O-4', status: 'write_now', payload: { brief_id: '261022-0900-ABCD' } }] })
  assert.equal((await applyAction(store, 'O-1', 'write_now', { now })).status, 'write_now')
  assert.ok(card(store, 'O-1').payload.write_now_at)
  await assert.rejects(applyAction(store, 'O-1', 'write_now'), (e) => e.code === 'bad_status' && e.status === 409)
  assert.equal((await applyAction(store, 'O-2', 'dismiss', { now })).status, 'dismissed')
  const added = await applyAction(store, 'O-3', 'add_to_roadmap', { stage: 3, now })
  assert.equal(added.status, 'added_to_roadmap')
  const slot = (await loadRoadmap(store)).payload.stages[3].slots.find((s) => s.slot_id === added.payload.slot_id)
  assert.deepEqual([slot.status, slot.title_idea, slot.from_opportunity], ['planned', 'Approvals for payouts over a limit', 'O-3'])
  await assert.rejects(applyAction(store, 'O-4', 'dismiss'), (e) => e.code === 'in_progress')
  await assert.rejects(applyAction(store, 'O-9', 'dismiss'), (e) => e.status === 404)
  await assert.rejects(applyAction(store, 'O-1', 'publish'), (e) => e.code === 'bad_params')
  await assert.rejects(applyAction(store, 'O-1', 'add_to_roadmap', { stage: 0 }), (e) => e.code === 'bad_params')
})

test('a run writes the card: brief id held while writing, released when the run fails; approval → written, rejection → dismissed', async () => {
  const store = await seed({ cards: [{ id: 'O-1', status: 'write_now' }] })
  const rec = card(store, 'O-1')
  await markWriting(store, rec.id, '261022-1200-ABCD', { now })
  assert.equal(card(store, 'O-1').payload.brief_id, '261022-1200-ABCD')
  assert.equal((await nextTimely(store, { config: cfg(), now })).record, null, 'a card being written is not picked again')
  await releaseWriting(store, rec.id)
  assert.equal(card(store, 'O-1').payload.brief_id, '')
  await markWriting(store, rec.id, '261022-1300-ABCD', { now })
  assert.deepEqual(await finishTimely(store, '261022-1300-ABCD', 'approved', { now }), { ok: true, opportunity_id: 'O-1', status: 'written' })
  assert.equal(card(store, 'O-1').status, 'written')
  // Rejecting a timely post's topic dismisses its card.
  const store2 = await seed({ cards: [{ id: 'O-2', status: 'write_now', payload: { brief_id: '261022-1400-ABCD' } }] })
  assert.equal((await finishTimely(store2, '261022-1400-ABCD', 'dismissed', { now })).status, 'dismissed')
  assert.equal(card(store2, 'O-2').status, 'dismissed')
  assert.deepEqual(await finishTimely(store2, 'no-such-brief', 'approved', { now }), { ok: false })
})

test('the pipeline: the news check runs first (TIMELY_CHECK_ON_RUN), then a write_now card is written; a slot stays planned', async () => {
  const restore = quiet()
  const store = await seed({ cards: [{ id: 'O-1', status: 'write_now' }] })
  const seen = []
  const agents = { ...stubAgents, reviewer: mockReviewer(), scout: async (ctx) => { seen.push({ mode: ctx.scoutMode, target: ctx.target?.kind ?? null }); return stubAgents.scout(ctx) } }
  const r = await runPipeline({ config: cfg(), store, notifier: fakeNotifier(), agents, now })
  assert.equal(r.state, 'awaiting_human')
  assert.deepEqual(seen, [{ mode: 'timely', target: null }, { mode: 'slot', target: 'timely' }])
  assert.equal(card(store, 'O-1').payload.brief_id, r.briefId)
  const rm = (await loadRoadmap(store)).payload
  assert.equal(rm.stages.flatMap((s) => s.slots).filter((s) => s.status !== 'planned' && s.status !== 'approved').length, 0, 'no slot is drafting or in review')
  // TIMELY_CHECK_ON_RUN=false: no news check; a failed check is only a warning.
  const store2 = await seed()
  const seen2 = []
  const failing = { ...stubAgents, reviewer: mockReviewer(), scout: async (ctx) => { seen2.push(ctx.scoutMode); if (ctx.scoutMode === 'timely') throw new Error('web search timed out'); return stubAgents.scout(ctx) } }
  const r2 = await runPipeline({ config: cfg(), store: store2, notifier: fakeNotifier(), agents: failing, now })
  assert.equal(r2.state, 'awaiting_human')
  assert.ok(r2.warnings.some((w) => /news check failed \(the run goes on\): web search timed out/.test(w)))
  const seen3 = []
  await runPipeline({ config: cfg({ TIMELY_CHECK_ON_RUN: 'false' }), store: await seed(), notifier: fakeNotifier(), agents: { ...stubAgents, reviewer: mockReviewer(), scout: async (ctx) => { seen3.push(ctx.scoutMode); return stubAgents.scout(ctx) } }, now })
  restore()
  assert.deepEqual(seen3, ['slot'])
})

test('a failed timely run releases the card (still write_now, no brief id)', async () => {
  const restore = quiet()
  const store = await seed({ cards: [{ id: 'O-1', status: 'write_now' }] })
  const agents = { ...stubAgents, reviewer: mockReviewer(), writer: async () => { throw new Error('writer broke') } }
  const r = await runPipeline({ config: cfg({ TIMELY_CHECK_ON_RUN: 'false' }), store, notifier: fakeNotifier(), agents, now })
  restore()
  assert.equal(r.state, 'failed')
  assert.deepEqual([card(store, 'O-1').status, card(store, 'O-1').payload.brief_id], ['write_now', ''])
})

// ---------- a timely post: Scout, Strategist, the Start-here line ----------

test('the focused Scout for a timely card: the event\'s source first, a story lead from the card', async () => {
  const restore = quiet()
  const store = await seed()
  await store.createRecord({ type: 'm91_facts', payload: { ...FACTS, research_at: null }, status: 'current', date: TODAY })
  const opp = { record_id: 'r1', opportunity_id: 'O-1', ...EVENT() }
  const ai = fakeAi({ 'questions-slot': { main_question: 'q?', related_questions: [], demand: { level: 'low', reason: 'r' }, off_roadmap: [] }, 'sources-slot': { sources: [] } })
  const out = await runScout({ mode: 'slot', runId: 'R-261022-1200-ABCD', briefId: '261022-1200-ABCD', target: { kind: 'timely', opportunity: opp } }, { config: cfg(), store, aiSend: ai, urlChecker: fakeChecker(), now })
  restore()
  assert.equal(out.target.opportunity_id, 'O-1')
  assert.match(ai.calls[0].message, /A timely post about a real event \(outside the roadmap\)\nEvent: .* Reported by Example News on 2026-10-20: https:\/\/news\.example\.com\/refunds/)
  const pack = store.byType('source_pack')[0]
  assert.equal(pack.payload.claims[0].results[0].url, 'https://news.example.com/refunds')
  const story = store.byType('story_lead')[0]
  assert.deepEqual([story.payload.opportunity_id, story.payload.attribution_line, story.status], ['O-1', 'reported by Example News', 'open'])
  assert.equal(store.byType('question_cluster')[0].payload.opportunity_id, 'O-1')
})

test('the Strategist for a timely card: the story is the only lead; the timely rules and the knowledge map are given', async () => {
  const store = await seed()
  await store.createRecord({ type: 'm91_facts', payload: { ...FACTS, research_at: null }, status: 'current', date: TODAY })
  await store.createRecord({ type: 'story_lead', payload: { story_id: 'S-1', title: 'x', source_url: 'https://news.example.com/refunds', published_date: '2026-10-20', opportunity_id: 'O-1', attribution_line: 'reported by Example News' }, status: 'open' })
  await store.createRecord({ type: 'story_lead', payload: { story_id: 'S-OTHER', title: 'y', source_url: 'https://other.example.com', published_date: '2026-10-21' }, status: 'open' })
  await store.createRecord({ type: 'knowledge', payload: { title: 'What M91 is', stage: 0, summary: 's', approved_at: '2026-10-20T10:00:00+05:30' }, status: 'current' })
  const target = { kind: 'timely', opportunity: { record_id: 'r1', opportunity_id: 'O-1', ...EVENT() } }
  const inputs = await buildInputs({ config: cfg(), store, scoutResult: null, now, target })
  assert.deepEqual(inputs.rapidStories.map((s) => s.story_id), ['S-1'])
  assert.deepEqual([...inputs.leadIndex.keys()].filter((k) => k.startsWith('S-')), ['S-1'])
  assert.equal(inputs.target.timely, true)
  assert.equal(inputs.knowledge.length, 1)
  const prompt = buildPlanPrompt(cfg(), inputs)
  assert.match(prompt, /THIS RUN: ONE TIMELY POST ABOUT A REAL EVENT/)
  assert.match(prompt, /post_type: "rapid_response"/)
})

test('the Start-here line: right after the TL;DR, once (a line the Writer wrote is replaced); the hard check needs it', async () => {
  const md = '# Refunds by an agent\n\n**TL;DR**\n- One.\n- Two.\n- Three.\n\nNew to M91? Start here: something else.\n\nThe first paragraph.\n\n## Why'
  const starter = { title: 'What M91 is', link: null }
  const out = withStartHere(md, starter)
  assert.equal(out, '# Refunds by an agent\n\n**TL;DR**\n- One.\n- Two.\n- Three.\n\nNew to M91? Start here: **What M91 is**.\n\nThe first paragraph.\n\n## Why')
  assert.equal(withStartHere(out, starter), out, 'idempotent')
  assert.equal(startHereLine({ title: 'What M91 is', link: 'https://docs.example.com/m91' }), 'New to M91? Start here: [What M91 is](https://docs.example.com/m91).')
  assert.match(withStartHere('# T\n\nText.', starter), /^# T\n\nNew to M91\? Start here: \*\*What M91 is\*\*\.\n\nText\.$/)
  // starterPost: the first approved stage-0 post of the knowledge map, else the approved Starter slot.
  const store = await seed()
  assert.equal((await starterPost(store)).title, approvedRoadmap().stages[0].slots[0].title_idea)
  await store.createRecord({ type: 'knowledge', payload: { title: 'What M91 is', stage: 0, approved_at: '2026-10-20T10:00:00+05:30', link: null }, status: 'current' })
  assert.equal((await starterPost(store)).title, 'What M91 is')
  assert.equal(await starterPost(await seed({ starterDone: false })), null)
  // The hard check, only for rapid-response posts while the lane is on.
  const brief = { post_type: 'rapid_response', news: { is_news_based: false } }
  assert.equal(needsStartHere(brief, cfg()), true)
  assert.equal(needsStartHere(brief, cfg({ RAPID_RESPONSE_ENABLED: 'false' })), false)
  const check = (post_markdown) => runContentChecks({ draft: { title: 'T', post_markdown, tldr: ['a', 'b', 'c'] }, brief, config: cfg(), allowedUrls: new Set() }).results.find((r) => r.id === 'start_here_line')
  assert.equal(check(out).passed, true)
  assert.equal(check(md.replace(/New to M91.*\n/, '')).passed, false)
  assert.equal(check(md).severity, 'hard')
})

// ---------- API ----------

test('API: GET /api/timely (cards, open count, the waiting reason); POST an action; 409 while the lane is off', async () => {
  const restore = quiet()
  const store = await seed({ starterDone: false, cards: [{ id: 'O-1', status: 'write_now' }, { id: 'O-2' }, { id: 'O-OLD', payload: { published_date: '2026-10-01' } }] })
  const config = cfg()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }), now })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config, now })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const t = await (await fetch(`${base}/api/timely`)).json()
    assert.equal(t.enabled, true)
    assert.equal(t.open, 2)
    assert.deepEqual(t.waiting, { opportunity_id: 'O-1', title: EVENT().title, reason: 'Timely posts start once the Starter (stage 0) has an approved post' })
    assert.equal(t.opportunities.find((o) => o.opportunity_id === 'O-OLD').status, 'expired', 'shown as expired before a run marks it')
    const res = await fetch(`${base}/api/timely/O-2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'dismiss' }) })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).opportunity.status, 'dismissed')
    const bad = await fetch(`${base}/api/timely/O-2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'write_now' }) })
    assert.equal(bad.status, 409)
    const roadmap = await (await fetch(`${base}/api/roadmap`)).json()
    assert.equal(roadmap.next.timely_waiting.opportunity_id, 'O-1')
    const s = await (await fetch(`${base}/api/settings`)).json()
    assert.deepEqual(s.timely, { enabled: true, check_on_run: true, window_days: 7, max_per_week: 1 })
    assert.ok(s.built_modes.includes('timely_check'))
  } finally {
    await new Promise((r) => server.close(r))
  }
  const off = createRunManager({ config: cfg({ RAPID_RESPONSE_ENABLED: 'false' }), storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  await assert.rejects(off.startRun({ mode: 'timely_check', params: {} }), (e) => e.code === 'timely_off' && e.status === 409)
  restore()
})

test('timely_check run mode: the news check alone (1 call), the cards wait for you', async () => {
  const restore = quiet()
  const store = await seed()
  const ai = fakeAi({ timely: { events: [EVENT()] } })
  const manager = createRunManager({ config: cfg(), storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: (rc, { store: st }) => ({ ...stubAgents, scout: async (ctx) => ({ output: await runScout({ mode: ctx.scoutMode, runId: ctx.runId }, { config: rc, store: st, aiSend: ai, urlChecker: fakeChecker(), now }) }) }), now })
  const { run_id } = await manager.startRun({ mode: 'timely_check', params: {} })
  const r = await manager.wait(run_id)
  restore()
  assert.equal(r.status, 'succeeded', r.error)
  assert.match(r.run.result_summary, /^news check: 1 new timely opportunity \(1 found, 0 dropped\)$/)
  assert.equal(ai.calls.length, 1)
  assert.equal(store.byType('timely_opportunity')[0].status, 'proposed')
  assert.equal(store.byType('draft').length, 0, 'nothing is written')
})
