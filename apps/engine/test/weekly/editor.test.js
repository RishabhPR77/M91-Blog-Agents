// The weekly editor: this week's signals (code), the editor's call with code checks (real evidence, a real hook, no
// near-repeats), the runner-up and code fallbacks, the decision saved and linked to the brief, the news hook held by
// the run, and the API. Fake AI and memory store: no AI, no Mem0, no network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { gatherSignals } from '../../src/weekly/signals.js'
import { runWeeklyEditor, checkCandidates, fallbackPick, editorMessage, pickOfBrief } from '../../src/weekly/editor.js'
import { runPipeline } from '../../src/orchestrator.js'
import { createRunManager } from '../../src/runs.js'
import { createServer } from '../../src/server.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer } from '../helpers.js'
import { FACTS } from './fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const NOW = Date.parse('2026-10-22T06:00:00Z')
const now = () => NOW
const cfg = (env = {}) => fakeConfig({ RAPID_RESPONSE_ENABLED: 'true', DRY_RUN: 'false', ...env })

const QUESTIONS = [
  { question: 'How do I stop Claude Code from running rm -rf?', source_url: 'https://reddit.example.com/r1', where: 'Reddit r/ClaudeAI', posted_date: '2026-10-19', demand_evidence: '320 upvotes', topic_group: 1 },
  { question: 'What should wake an on-call engineer at night?', source_url: 'https://forum.example.com/t/7', where: 'a forum', posted_date: '', demand_evidence: '40 replies', topic_group: 4 }
]
const NEWS = { opportunity_id: 'O-1', title: 'An AI agent deleted a production database', what_happened: 'A coding agent ran a destructive command without asking.', source_url: 'https://news.example.com/db', outlet: 'Example News', published_date: '2026-10-21', why_m91: 'A phone call would have stopped it.', urgency: 'high', brief_id: '' }

async function seed({ guides = [], briefs = [], cards = [NEWS], oldFacts = true } = {}) {
  const store = memoryStore()
  await store.createRecord({ type: 'm91_facts', payload: { ...FACTS, integrations: [...FACTS.integrations, { name: 'n8n', what_it_enables: 'a call from a workflow', source_url: 'https://m91-api.msg91.com/llms.txt' }] }, status: 'current', date: '2026-10-22' })
  if (oldFacts) await store.createRecord({ type: 'm91_facts', payload: FACTS, status: 'old', date: '2026-10-10' })
  for (const c of cards) await store.createRecord({ type: 'timely_opportunity', payload: c, status: 'proposed', date: '2026-10-22' })
  for (const g of guides) await store.createRecord({ type: 'published_guide', status: 'live', payload: { url: `https://msg91.com/guide/${g.slug}`, slug: g.slug, title: g.title, published_at: '2026-10-01T10:00:00Z' } })
  for (const b of briefs) await store.createRecord({ type: 'brief', briefId: b.id, payload: { brief_id: b.id, titles: [b.title], keyword: b.keyword ?? '', post_type: 'question', weekly: b.format ? { format: b.format } : undefined, approved_at: b.at }, status: 'approved', version: 1, date: '2026-10-15' })
  await store.createRecord({ type: 'pinned_topic', payload: { pinned_id: 'PIN-1', topic: 'Approvals for refunds over a limit', target_date: '2026-11-15' }, status: 'open' })
  return store
}

const candidate = (over = {}) => ({ title: 'How to make Claude Code ask before rm -rf', question: 'How do I make Claude Code ask a person before rm -rf?', format: 'tutorial', angle: 'a phone call before destructive commands', hook_id: 'n1', evidence_ids: ['q1'], why_now: 'an agent deleted a database this week', scores: { demand: 5, timeliness: 5, m91_fit: 5, gap: 4, variety: 4 }, ...over })
const editorAi = (answer) => {
  const calls = []
  const send = async (opts) => {
    calls.push(opts)
    const a = typeof answer === 'function' ? answer(calls.length) : answer
    if (a instanceof Error) throw a
    return { content: structuredClone(a), model: 'gpt-5.5', ms: 2, delivery: 'sync' }
  }
  send.calls = calls
  return send
}

test('signals: questions, fresh news, M91 changes (against a week-old fact sheet), integrations, pins not due, live guides and recent posts, each with an id', async () => {
  const store = await seed({ guides: [{ slug: 'what-is-m91', title: 'What Is M91?' }], briefs: [{ id: '261015-1000-AAAA', title: 'Why a phone call beats a chat ping', format: 'explainer', at: '2026-10-15T10:00:00+05:30' }], cards: [NEWS, { ...NEWS, opportunity_id: 'O-OLD', title: 'Old news', published_date: '2026-09-01' }] })
  const s = await gatherSignals(store, { config: cfg(), now, questions: QUESTIONS })
  assert.deepEqual(s.questions.map((q) => q.id), ['q1', 'q2'])
  assert.deepEqual(s.news.map((n) => [n.id, n.title]), [['n1', NEWS.title]], 'an expired card is not news')
  assert.deepEqual(s.changes.map((c) => [c.id, c.name]), [['m1', 'n8n']], 'new since the week-old facts')
  assert.deepEqual(s.integrations.map((c) => c.id), ['i1', 'i2'])
  assert.deepEqual(s.pins.map((p) => [p.id, p.topic]), [['p1', 'Approvals for refunds over a limit']])
  assert.deepEqual(s.live, [{ title: 'What Is M91?', url: 'https://msg91.com/guide/what-is-m91' }])
  assert.deepEqual(s.recent.map((r) => [r.title, r.format]), [['Why a phone call beats a chat ping', 'explainer']])
  assert.equal(s.byId.get('n1').record_id, store.byType('timely_opportunity')[0].id)
  const msg = editorMessage(s)
  assert.match(msg, /--- QUESTIONS ---\n\{"id":"q1","question":"How do I stop Claude Code from running rm -rf\?","where":"Reddit r\/ClaudeAI"/)
  assert.match(msg, /--- LIVE GUIDES ---\n- What Is M91\?/)
  // News is off: no news signals.
  assert.equal((await gatherSignals(store, { config: cfg({ RAPID_RESPONSE_ENABLED: 'false' }), now })).news.length, 0)
})

test('checks: enough real signals (a hook counts), a hook must be this week\'s news, a near-repeat of a live guide is left out', async () => {
  const store = await seed({ guides: [{ slug: 'claude-code-rm', title: 'How to make Claude Code ask before rm -rf' }] })
  const s = await gatherSignals(store, { config: cfg(), now, questions: QUESTIONS })
  const [ok, fake, thin, repeat] = checkCandidates([
    candidate({ title: 'Make an AI agent page a human before a payout', question: 'How can an agent page a person before a payout?' }),
    candidate({ title: 'A clever idea', question: 'What nobody asks?', hook_id: 'n9', evidence_ids: ['q7'] }),
    candidate({ title: 'Wake engineers at night only for real problems', question: 'What should wake an engineer?', hook_id: '', evidence_ids: ['q2'] }),
    candidate()
  ], s, { minEvidence: 2 })
  assert.deepEqual(ok.problems, [])
  assert.deepEqual(ok.evidence.map((e) => [e.id, e.kind]), [['q1', 'question'], ['n1', 'news']])
  assert.equal(ok.hook.title, NEWS.title)
  assert.deepEqual(fake.problems, ['hook "n9" is not a news item of this week', 'cites 0 real signals (needs 2)'])
  assert.deepEqual(thin.problems, ['cites 1 real signal (needs 2)'])
  assert.match(repeat.problems[0], /^repeats a live guide "How to make Claude Code ask before rm -rf"$/)
})

test('the editor\'s choice is saved as a weekly_pick (reason, evidence, hook, runners-up, signals)', async () => {
  const restore = quiet()
  const store = await seed()
  const s = await gatherSignals(store, { config: cfg(), now, questions: QUESTIONS })
  const ai = editorAi({ candidates: [candidate(), candidate({ title: 'What should wake an engineer at night', question: 'What should wake an on-call engineer?', format: 'checklist', hook_id: '', evidence_ids: ['q2', 'i1'] })], choice: 0, reason: 'An agent deleted a database this week and 320 people asked how to stop it.' })
  const out = await runWeeklyEditor(s, { store, config: cfg(), aiSend: ai, runId: 'R-261022-1130-ABCD', now })
  restore()
  assert.equal(ai.calls.length, 1)
  assert.equal(ai.calls[0].agent, 'editor')
  assert.equal(ai.calls[0].jsonSchema.name, 'weekly_editor')
  assert.match(ai.calls[0].prompt, /Propose 4 candidate posts/)
  assert.equal(out.chosen_by, 'editor')
  assert.deepEqual([out.pick.title, out.pick.format, out.pick.hook.source_url], ['How to make Claude Code ask before rm -rf', 'tutorial', NEWS.source_url])
  const [rec] = store.byType('weekly_pick')
  assert.equal(rec.status, 'chosen')
  assert.equal(rec.payload.reason, 'An agent deleted a database this week and 320 people asked how to stop it.')
  assert.deepEqual(rec.payload.runners_up.map((r) => [r.title, r.format]), [['What should wake an engineer at night', 'checklist']])
  assert.deepEqual(rec.payload.signals.counts, { questions: 2, news: 1, changes: 1, integrations: 2, pins: 1, live: 0, recent: 0 })
  assert.equal(out.pick.record_id, rec.id)
})

test('a choice that fails a check: the best-scoring candidate that passes; an editor that fails or picks nothing usable: code\'s pick', async () => {
  const restore = quiet()
  const store = await seed({ guides: [{ slug: 'claude-code-rm', title: 'How to make Claude Code ask before rm -rf' }, { slug: 'stop-claude-code', title: 'How to stop Claude Code from running rm -rf' }] })
  const s = await gatherSignals(store, { config: cfg(), now, questions: QUESTIONS })
  const second =candidate({ title: 'What should wake an on-call engineer at night', question: 'What should wake an on-call engineer at night?', format: 'checklist', hook_id: '', evidence_ids: ['q2', 'i1'], scores: { demand: 4, timeliness: 2, m91_fit: 4, gap: 5, variety: 5 } })
  const r1 = await runWeeklyEditor(s, { store, config: cfg(), aiSend: editorAi({ candidates: [candidate(), second], choice: 0, reason: 'x' }), runId: 'R-261022-1130-ABCD', now })
  assert.equal(r1.chosen_by, 'editor_runner_up')
  assert.equal(r1.pick.title, 'What should wake an on-call engineer at night')
  assert.match(r1.reason, /the editor's first choice "How to make Claude Code ask before rm -rf" repeats a live guide/)
  // The call fails: code picks the strongest question that is not a repeat (q1 repeats the live guide → q2).
  const r2 = await runWeeklyEditor(s, { store, config: cfg(), aiSend: editorAi(new Error('timeout')), runId: 'R-261022-1131-ABCD', now })
  assert.equal(r2.chosen_by, 'fallback')
  assert.equal(r2.pick.question, 'What should wake an on-call engineer at night?')
  assert.ok(r2.warnings.some((w) => /the editor call failed \(timeout\)/.test(w)))
  // A wrong answer twice: code picks too.
  const bad = editorAi({ candidates: 'nope' })
  const r3 = await runWeeklyEditor(s, { store, config: cfg(), aiSend: bad, runId: 'R-261022-1132-ABCD', now })
  restore()
  assert.equal(bad.calls.length, 2)
  assert.equal(r3.chosen_by, 'fallback')
  // No questions at all: an M91 integration becomes a tutorial.
  const tut = fallbackPick({ ...s, questions: [] })
  assert.deepEqual([tut.format, tut.question], ['tutorial', 'How do I connect M91 to n8n?'])
})

test('the pipeline: questions → editor → research of the pick; the pick is linked to the brief and its hook card is held, then freed on failure', async () => {
  const restore = quiet()
  const store = await seed()
  const ai = editorAi({ candidates: [candidate()], choice: 0, reason: 'This week\'s incident.' })
  const seen = []
  const editor = async (ctx) => ({ output: await runWeeklyEditor(await gatherSignals(store, { config: cfg(), now, questions: ctx.weekQuestions }), { store, config: cfg(), aiSend: ai, runId: ctx.runId, now }) })
  const agents = { ...stubAgents, reviewer: mockReviewer(), editor, scout: async (ctx) => { seen.push([ctx.scoutMode, ctx.target?.kind ?? null]); return ctx.scoutMode === 'week' ? { output: { mode: 'week', questions: QUESTIONS } } : stubAgents.scout(ctx) } }
  const r = await runPipeline({ config: cfg(), store, notifier: fakeNotifier(), agents, now })
  assert.equal(r.state, 'awaiting_human', r.error)
  // During the week call the target is still "the editor decides".
  assert.deepEqual(seen, [['week', 'editor'], ['slot', 'weekly']])
  assert.match(ai.calls[0].message, /How do I stop Claude Code from running rm -rf\?/)
  const pick = store.byType('weekly_pick')[0]
  assert.deepEqual([pick.status, pick.payload.brief_id], ['written', r.briefId])
  assert.equal((await pickOfBrief(store, r.briefId)).pick.title, 'How to make Claude Code ask before rm -rf')
  assert.equal(store.byType('timely_opportunity')[0].payload.brief_id, r.briefId, 'the hook is used by this post')
  // A run that fails frees the hook for a later week.
  const store2 = await seed()
  const failing = { ...agents, editor: async (ctx) => ({ output: await runWeeklyEditor(await gatherSignals(store2, { config: cfg(), now, questions: QUESTIONS }), { store: store2, config: cfg(), aiSend: ai, runId: ctx.runId, now }) }), writer: async () => { throw new Error('writer broke') } }
  const r2 = await runPipeline({ config: cfg(), store: store2, notifier: fakeNotifier(), agents: failing, now })
  restore()
  assert.equal(r2.state, 'failed')
  assert.equal(store2.byType('timely_opportunity')[0].payload.brief_id, '')
})

test('nothing new to write: the run stops before the Strategist with the editor\'s reason', async () => {
  const restore = quiet()
  const store = await seed({ cards: [], oldFacts: false, guides: [{ slug: 'connect-claude-code', title: 'How to connect M91 to Claude Code' }, { slug: 'connect-n8n', title: 'How to connect M91 to n8n' }] })
  const editor = async (ctx) => ({ output: await runWeeklyEditor(await gatherSignals(store, { config: cfg(), now, questions: [] }), { store, config: cfg(), aiSend: editorAi(new Error('down')), runId: ctx.runId, now }) })
  let strategist = false
  const agents = { ...stubAgents, reviewer: mockReviewer(), editor, strategist: async (ctx) => { strategist = true; return stubAgents.strategist(ctx) } }
  const r = await runPipeline({ config: cfg(), store, notifier: fakeNotifier(), agents, now })
  restore()
  assert.equal(r.state, 'skipped')
  assert.match(r.reason, /nothing this week is new for readers/)
  assert.equal(strategist, false)
})

test('API: GET /api/weekly (what the next run does, the latest picks); the post page gets the pick of its brief', async () => {
  const restore = quiet()
  const store = await seed()
  const s = await gatherSignals(store, { config: cfg(), now, questions: QUESTIONS })
  const out = await runWeeklyEditor(s, { store, config: cfg(), aiSend: editorAi({ candidates: [candidate()], choice: 0, reason: 'This week.' }), runId: 'R-261022-1130-ABCD', now })
  const rec = store.byType('weekly_pick')[0]
  await store.updateRecord(rec.id, { ...rec.payload, brief_id: '261022-1130-ABCD' }, { status: 'written' })
  await store.createRecord({ type: 'brief', briefId: '261022-1130-ABCD', payload: { brief_id: '261022-1130-ABCD', titles: ['T'] }, status: 'awaiting_human', version: 1 })
  await store.createRecord({ type: 'draft', briefId: '261022-1130-ABCD', payload: { title: 'T', version: 1, brief_version: 1, post_markdown: '# T', checks: { hard_passed: true, results: [] } }, status: 'awaiting_human', version: 1, meta: { brief_version: 1 } })
  const config = cfg()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents, now })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config, now })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const w = await (await fetch(`${base}/api/weekly`)).json()
    assert.deepEqual(w.next, { kind: 'editor' })
    assert.deepEqual(w.model, { service: 'openai', model: 'gpt-5.5' })
    assert.deepEqual(w.picks.map((p) => [p.pick.title, p.reason, p.brief_id]), [[out.pick.title, 'This week.', '261022-1130-ABCD']])
    const detail = await (await fetch(`${base}/api/approvals/261022-1130-ABCD`)).json()
    assert.equal(detail.pick.pick.title, out.pick.title)
    const j = await (await fetch(`${base}/api/journeys/261022-1130-ABCD`)).json()
    assert.match(j.stages[0].detail, /^Chosen this week: How to make Claude Code ask before rm -rf$/)
    const settings = await (await fetch(`${base}/api/settings`)).json()
    assert.deepEqual(settings.models.editor, { service: 'openai', model: 'gpt-5.5', delivery: 'sync' })
    assert.deepEqual(settings.weekly, { question_days: 21, questions_max: 12, candidates: 4, min_evidence: 2, similarity: 0.6 })
    assert.equal(settings.roadmap, undefined)
  } finally {
    await new Promise((r) => server.close(r))
    restore()
  }
})
