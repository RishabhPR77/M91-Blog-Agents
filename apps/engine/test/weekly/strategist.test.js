// The knowledge map (saved on approve) and the Strategist planning the weekly editor's pick (one lead, its format and
// angle, the news hook, earlier posts instead of re-explaining, why_today). Fake AI, memory store: no AI, no Mem0.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { knowledgeOf, saveKnowledge, knowledgeMap, knowledgeForPrompt, KNOWLEDGE_MAX } from '../../src/knowledge.js'
import { runStrategist } from '../../src/strategist/index.js'
import { TARGET_RULES } from '../../src/strategist/prompts.js'
import { resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { memoryStore } from '../helpers.js'
import { config as strategistConfig, seededStore, validBrief, fakeAi, NOW } from '../strategist/fixtures.js'
import { weeklyTarget, HOOK } from './fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})

test('knowledgeOf / saveKnowledge / knowledgeMap: one record per approved post, oldest first, replaced on a re-approval', async () => {
  const store = memoryStore()
  const k = knowledgeOf({ briefId: 'B-2', brief: { keyword: 'callback url', supporting_keywords: ['webhook'], terms_to_define: ['callback URL'] }, draft: { title: 'Read the answer', tldr: ['Your code gets the answer by a callback.', 'x', 'y'] }, exportInfo: { slug: 'read-the-answer' } })
  assert.deepEqual(k, { brief_id: 'B-2', title: 'Read the answer', concepts: ['callback url', 'webhook'], terms_defined: ['callback URL'], summary: 'Your code gets the answer by a callback.', link: null, export_slug: 'read-the-answer', approved_at: null })
  await saveKnowledge(store, { ...k, approved_at: '2026-10-23T10:00:00+05:30' })
  await saveKnowledge(store, { ...k, brief_id: 'B-1', title: 'What M91 is', approved_at: '2026-10-22T10:00:00+05:30' })
  await saveKnowledge(store, { ...k, summary: 'Changed.', approved_at: '2026-10-23T10:00:00+05:30' })
  assert.equal(store.byType('knowledge').length, 2)
  assert.deepEqual((await knowledgeMap(store)).map((x) => [x.title, x.summary]), [['What M91 is', 'Your code gets the answer by a callback.'], ['Read the answer', 'Changed.']])
})

const entry = (i, summary = `Post ${i} in one line.`) => ({ brief_id: `B-${i}`, title: `Post ${i}`, concepts: ['c'], terms_defined: [], summary, link: null, export_slug: `post-${i}`, approved_at: `2026-10-20T10:${String(i).padStart(2, '0')}:00+05:30` })

test('knowledgeForPrompt: at most the last 40 entries, newest first, each summary at most 200 characters', () => {
  const map = Array.from({ length: 45 }, (_, i) => entry(i + 1, i === 44 ? 'x'.repeat(300) : undefined))
  const out = knowledgeForPrompt(map)
  assert.equal(KNOWLEDGE_MAX, 40)
  assert.equal(out.length, 40)
  assert.deepEqual([out[0].title, out[39].title], ['Post 45', 'Post 6'])
  assert.equal(out[0].summary.length, 200)
  assert.deepEqual(knowledgeForPrompt([]), [])
})

async function pickStore() {
  const store = await seededStore()
  // The focused Scout's cluster for the pick (C-1, made the pick's cluster here).
  const c1 = store.byType('question_cluster').find((r) => r.payload.cluster_id === 'C-1')
  await store.updateRecord(c1.id, { ...c1.payload, pick_id: 'W-261022-1200-PICK' }, {})
  await saveKnowledge(store, { brief_id: 'B-0', title: 'What a human approval step is', concepts: ['approval step'], terms_defined: ['approval step'], summary: 'A pause before a risky action.', link: null, export_slug: 'what-a-human-approval-step-is', approved_at: '2026-10-20T10:00:00+05:30' })
  return store
}

test('the Strategist plans only the weekly pick: one lead, its format and angle, the knowledge map, the target schema and rules', async () => {
  const restore = quiet()
  const store = await pickStore()
  const ai = fakeAi({ plan: validBrief({ terms_to_define: ['tool call'], why_today: 'An agent deleted a production database this week.' }) })
  const r = await runStrategist({ mode: 'plan', runId: '261022-1200-ABCD', briefId: '261022-1200-ABCD', target: weeklyTarget() }, { config: strategistConfig(), store, aiSend: ai, now: () => NOW })
  restore()
  const q = ai.requests[0]
  assert.equal(q.jsonSchema.name, 'strategist_brief_target')
  assert.ok(q.prompt.endsWith(TARGET_RULES), 'the rules for a chosen post close the prompt')
  assert.match(q.prompt, /Never re-explain those concepts/)
  assert.match(q.message, /--- POST TO PLAN \(this week's post, chosen by the editor\) ---\n\{"weekly":true,"pick_id":"W-261022-1200-PICK","title":"How to make an AI agent ask before it deletes data"/)
  assert.match(q.message, /"format":"tutorial"/)
  assert.match(q.message, /"demand":\[\{"question":"How to stop Claude Code running rm -rf\?","where":"Reddit r\/ClaudeAI","demand":"320 upvotes"\}\]/)
  assert.match(q.message, /--- KNOWLEDGE MAP \(what the reader already learned, newest first\) ---\n\[\{"title":"What a human approval step is"/)
  assert.match(q.message, /--- QUESTION CLUSTERS ---\n\[\{"cluster_id":"C-1"/)
  assert.ok(!/"cluster_id":"C-2"/.test(q.message), 'no other cluster')
  assert.deepEqual(r.brief.terms_to_define, ['tool call'])
  // The pick stays on the brief (the post page and the next editor use it).
  assert.deepEqual(store.byType('brief')[0].payload.weekly, { pick_id: 'W-261022-1200-PICK', format: 'tutorial', why_now: 'an agent deleted a production database this week', hook: null })
})

test('a pick with a news hook: the brief must open with it (news from exactly its source), else a repair', async () => {
  const restore = quiet()
  const store = await pickStore()
  const target = weeklyTarget({ format: 'explainer', hook: HOOK })
  const withoutNews = validBrief({ terms_to_define: [], why_today: 'This week.' })
  const withNews = validBrief({ terms_to_define: [], why_today: 'This week.', news: { is_news_based: true, outlet: 'The Register', published_date: '2026-10-21', claim_in_own_words: 'An agent ran a destructive command.', source_url: HOOK.source_url } })
  const ai = fakeAi({ plan: withoutNews, repair: withNews })
  const r = await runStrategist({ mode: 'plan', runId: '261022-1204-ABCD', briefId: '261022-1204-ABCD', target }, { config: strategistConfig(), store, aiSend: ai, now: () => NOW })
  restore()
  assert.match(ai.requests[0].message, /"hook":\{"title":"An AI agent deleted a production database"/)
  assert.equal(ai.requests.length, 2)
  assert.match(ai.requests[1].message, /news must be filled from the hook/)
  assert.equal(r.brief.news.source_url, HOOK.source_url)
  assert.equal(store.byType('brief')[0].payload.weekly.hook, HOOK.title)
})

test('the Strategist gets the last 40 knowledge entries, newest first; the plain schema stays without a target', async () => {
  const restore = quiet()
  const store = await pickStore()
  for (let i = 1; i <= 45; i++) await saveKnowledge(store, entry(i))
  const ai = fakeAi({ plan: validBrief({ terms_to_define: [], why_today: 'Builds on Post 45.' }) })
  await runStrategist({ mode: 'plan', runId: '261022-1203-ABCD', briefId: '261022-1203-ABCD', target: weeklyTarget() }, { config: strategistConfig(), store, aiSend: ai, now: () => NOW })
  const sent = JSON.parse(ai.requests[0].message.split('--- KNOWLEDGE MAP (what the reader already learned, newest first) ---\n')[1].split('\n')[0])
  assert.equal(sent.length, 40)
  assert.deepEqual([sent[0].title, sent[39].title], ['Post 45', 'Post 6'])
  const plain = fakeAi()
  await runStrategist({ mode: 'plan', runId: '261022-1202-ABCD' }, { config: strategistConfig(), store: await seededStore(), aiSend: plain, now: () => NOW })
  restore()
  assert.equal(plain.requests[0].jsonSchema.name, 'strategist_brief')
  assert.ok(!/POST TO PLAN/.test(plain.requests[0].message))
})
