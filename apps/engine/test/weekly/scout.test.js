// The Scout for the weekly editor: the "week" call (questions people asked recently) and the focused research of the
// pick (its questions, its sources, the hook's source, tutorial steps for a tutorial). A fake AI answers by call
// name; a fake URL checker; a memory store. No AI, no Mem0, no network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { runScout } from '../../src/scout/index.js'
import { resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { fakeConfig, memoryStore } from '../helpers.js'
import { fakeChecker, fakeWeb } from '../scout/fixtures.js'
import { weeklyTarget, HOOK, FACTS } from './fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const NOW = Date.parse('2026-10-22T06:00:00Z')
const TODAY = '2026-10-22'

const FACTS_ANSWER = { can: [{ fact: 'Rings every phone in a channel until someone answers.', source_url: 'https://m91.msg91.com/llms.txt' }], cannot: [], integrations: [], contradictions: [] }
const QUESTIONS = {
  main_question: 'How do I make my AI agent ask a person before it deletes data?',
  related_questions: [
    { question: 'Why do AI agents need human approval?', source_url: 'https://reddit.example.com/r1', demand_evidence: '120 upvotes' },
    { question: 'How to page a human from code?', source_url: 'https://dead.example.com/q2', demand_evidence: '3 answers' }
  ],
  demand: { level: 'high', reason: 'asked in many places' }
}
const SOURCES = { sources: [{ url: 'https://m91.msg91.com/llms.txt', publisher: 'M91', what_it_covers: 'What M91 does.', kind: 'docs' }, { url: 'https://dead.example.com/q2', publisher: 'x', what_it_covers: 'x', kind: 'community' }] }
const TUTORIALS = { tutorials: [{ title: 'Ask before rm -rf', target: 'Claude Code', reader_outcome: 'A phone rings.', supporting_facts: [{ fact: 'x', source_url: 'https://m91.msg91.com/llms.txt' }], steps_outline: [{ step: 'Add the hook', source_url: 'https://m91.msg91.com/llms.txt' }], gaps: [], topic_group: 1 }] }
const WEEK = {
  questions: [
    { question: 'How do I stop Claude Code from running rm -rf?', source_url: 'https://reddit.example.com/r1', where: 'Reddit r/ClaudeAI', posted_date: '2026-10-19', demand_evidence: '320 upvotes', topic_group: 1 },
    { question: 'How can I stop Claude Code running rm -rf?', source_url: 'https://reddit.example.com/r1', where: 'Reddit', posted_date: '2026-10-19', demand_evidence: 'dup', topic_group: 1 },
    { question: 'Is Opsgenie still supported next year?', source_url: 'https://news.example.com/old', where: 'HN', posted_date: '2026-08-01', demand_evidence: '40 comments', topic_group: 3 },
    { question: 'How to page on-call when a payout fails?', source_url: 'https://dead.example.com/q2', where: 'Stack Overflow', posted_date: '', demand_evidence: '2 answers', topic_group: 2 },
    { question: 'What should wake an engineer at night?', source_url: 'https://forum.example.com/t/7', where: 'a forum', posted_date: '', demand_evidence: 'none visible', topic_group: 4 }
  ]
}

/** A fake aiSend: answers by the call name in the thread id (scout-<run>-<call>-xxxx). */
function fakeAi(answers) {
  const calls = []
  const send = async (p) => {
    const call = p.threadId.split('-').slice(2, -1).join('-').replace(/^.*?-(?=(facts|questions-slot|questions-week|sources-slot|tutorials)$)/, '')
    calls.push({ call, message: p.message })
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
  return store
}
const config = (env = {}) => fakeConfig({ M91_DOCS_URL: 'https://m91.msg91.com/llms.txt', ...env })
const run = (store, t, ai) => runScout({ mode: 'slot', runId: 'R-261022-1130-ABCD', briefId: '261022-1130-ABCD', target: t }, { config: config(), store, aiSend: ai, fetch: fakeWeb(), urlChecker: fakeChecker(), now: () => NOW })

test('the week call: real recent questions only (window, a page that loads, no near-duplicates); nothing saved', async () => {
  const restore = quiet()
  const store = await setup()
  const ai = fakeAi({ 'questions-week': WEEK })
  const out = await runScout({ mode: 'week', runId: 'R-261022-1130-ABCD' }, { config: config({ EDITOR_QUESTION_DAYS: '21' }), store, aiSend: ai, fetch: fakeWeb(), urlChecker: fakeChecker(), now: () => NOW })
  restore()
  assert.deepEqual(ai.calls.map((c) => c.call), ['questions-week'])
  assert.equal(out.mode, 'week')
  assert.deepEqual(out.questions.map((q) => q.question), ['How do I stop Claude Code from running rm -rf?', 'What should wake an engineer at night?'])
  assert.deepEqual(out.dropped.map((d) => d.reason), ['a near-duplicate of another question', '82 days old (window 21)', 'the page does not load'])
  assert.equal(out.questions[0].where, 'Reddit r/ClaudeAI')
  assert.equal(store.byType('question_cluster').length, 0)
})

test('the weekly pick: 2 calls (questions, sources); its cluster and source pack carry the pick id; the demand pages are sources', async () => {
  const restore = quiet()
  const store = await setup()
  const ai = fakeAi({ 'questions-slot': QUESTIONS, 'sources-slot': SOURCES })
  const out = await run(store, weeklyTarget({ format: 'explainer' }), ai)
  restore()
  assert.deepEqual(ai.calls.map((c) => c.call), ['questions-slot', 'sources-slot'])
  assert.match(ai.calls[0].message, /Format: explainer\. Angle: a step-by-step pause before destructive tool calls/)
  assert.match(ai.calls[0].message, /Why readers need it: How to stop Claude Code running rm -rf\?/)
  assert.equal(out.target.pick_id, 'W-261022-1200-PICK')
  const cluster = store.byType('question_cluster')[0]
  assert.equal(cluster.payload.pick_id, 'W-261022-1200-PICK')
  assert.deepEqual(cluster.payload.related_questions, ['Why do AI agents need human approval?'], 'a dead source drops its question')
  const pack = store.byType('source_pack')[0]
  assert.equal(pack.payload.pick_id, 'W-261022-1200-PICK')
  assert.deepEqual(pack.payload.claims[0].results.map((r) => r.url), ['https://m91.msg91.com/llms.txt', 'https://www.reddit.com/r/ClaudeAI/comments/abc/'])
  assert.equal(store.byType('tutorial_lead').length, 0)
})

test('a tutorial pick adds the tutorial call; a hook\'s source comes first in the source pack', async () => {
  const restore = quiet()
  const store = await setup()
  const ai = fakeAi({ 'questions-slot': QUESTIONS, 'sources-slot': SOURCES, tutorials: TUTORIALS })
  const out = await run(store, weeklyTarget({ hook: HOOK }), ai)
  restore()
  assert.deepEqual(ai.calls.map((c) => c.call), ['questions-slot', 'sources-slot', 'tutorials'])
  assert.match(ai.calls[0].message, /This week's hook \(the intro opens with it\): A coding agent ran a destructive command without asking\./)
  assert.equal(out.tutorial_ids.length, 1)
  assert.equal(store.byType('tutorial_lead')[0].payload.pick_id, 'W-261022-1200-PICK')
  assert.equal(store.byType('source_pack')[0].payload.claims[0].results[0].url, HOOK.source_url)
})

test('no facts today: the facts call first; a pinned topic is researched the same way; no target is an error', async () => {
  const restore = quiet()
  const store = await setup({ facts: false })
  const ai = fakeAi({ facts: FACTS_ANSWER, 'questions-slot': QUESTIONS })
  const out = await run(store, { kind: 'pinned', pin: { pinned_id: 'PIN-1', topic: 'Approvals for refunds over ₹10,000', notes: '' } }, ai)
  restore()
  assert.deepEqual(ai.calls.map((c) => c.call), ['facts', 'questions-slot', 'sources-slot'])
  assert.equal(out.facts_reused, false)
  assert.equal(store.byType('question_cluster')[0].payload.pinned_id, 'PIN-1')
  assert.ok(out.warnings.some((w) => /sources-slot failed/.test(w)))
  await assert.rejects(runScout({ mode: 'slot' }, { config: fakeConfig(), store: memoryStore(), aiSend: ai }), /needs a target/)
})
