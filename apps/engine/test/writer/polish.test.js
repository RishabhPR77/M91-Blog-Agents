// The polish pass (2026-11-13): before the review, the Writer fixes the warnings code found that cost points on the
// Reviewer's checklist (keywords, the FAQ, answer-first openings, long sentences, a post over its range), once, in
// the same thread. A polish that makes the draft worse is dropped: the draft before it stays.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWriter } from '../../src/writer/index.js'
import { polishProblems } from '../../src/checks/content.js'
import { setSink } from '../../src/util/log.js'
import { config, seededStore, fakeAi, okChecker, draftAnswer, BRIEF_ID, NOW, GOOD_MD } from './fixtures.js'
import { fakeNotifier } from '../helpers.js'

const noWeb = async () => ({ ok: false, status: 404, headers: { get: () => '' }, text: async () => '' })
async function run(env = {}, answers = {}) {
  const restore = setSink(() => {})
  const store = await seededStore()
  const ai = fakeAi(answers)
  try {
    const r = await runWriter({ mode: 'new', briefId: BRIEF_ID, runId: 'R-1' }, { config: config(env), store, notifier: fakeNotifier(), aiSend: ai, urlChecker: okChecker(), fetch: noWeb, now: () => NOW })
    return { r, ai, store }
  } finally {
    restore()
  }
}

test('polish: one call in the same thread, listing only the warnings that cost checklist points', async () => {
  const { r, ai } = await run({ WRITER_POLISH: 'true' })
  assert.deepEqual(ai.requests.map((q) => q.call), ['new', 'polish'])
  const p = ai.requests[1]
  assert.equal(p.threadId, ai.requests[0].threadId)
  assert.match(p.message, /--- PROBLEMS FOUND BY THE CHECKER ---\n- secondary_keywords: not used: .*\n- faq_count: no "Frequently Asked Questions" section/)
  assert.ok(p.message.length < 2000)
  assert.equal(r.polished, true)
  assert.equal(r.repairs_used, 0, 'a polish is not a repair')
})

test('polish: an answer that breaks a major check is dropped; the draft before it is saved', async () => {
  const worse = draftAnswer({ post_markdown: GOOD_MD.replace('A pause keeps', "We've seen that a pause keeps") })
  const { r, ai, store } = await run({ WRITER_POLISH: 'true' }, { polish: worse })
  assert.deepEqual(ai.requests.map((q) => q.call), ['new', 'polish'])
  assert.ok(r.warnings.some((w) => /^polish pass: its answer was not better, so the draft before it was kept$/.test(w)))
  const saved = [...store.records.values()].find((x) => x.type === 'draft').payload
  assert.ok(!saved.post_markdown.includes("We've seen"))
  assert.equal(r.hard_passed, true)
})

test('polish off (WRITER_POLISH=false): one call, as before', async () => {
  const { ai } = await run({ WRITER_POLISH: 'false' })
  assert.deepEqual(ai.requests.map((q) => q.call), ['new'])
})

test('what the polish fixes: minor hard checks, checklist warnings, and only a post over its range', () => {
  const results = [
    { id: 'sentence_hard', severity: 'hard', passed: false, value: 2, detail: 'two sentences over 25 words' },
    { id: 'secondary_keywords', severity: 'soft', passed: false, value: 6, detail: 'not used: M91 API' },
    { id: 'links_count', severity: 'soft', passed: false, value: 1, detail: 'few links' },
    { id: 'words_target', severity: 'soft', passed: false, value: 2913, detail: 'target 1800–2500' }
  ]
  assert.deepEqual(polishProblems(results, { wordsMax: 2500 }), [
    'sentence_hard: two sentences over 25 words (value: 2)',
    'secondary_keywords: not used: M91 API (value: 6)',
    'words_target: target 1800–2500 (value: 2913): cut repeated points and filler to stay within the range'
  ])
  const under = results.map((x) => (x.id === 'words_target' ? { ...x, value: 1500 } : x))
  assert.ok(!polishProblems(under, { wordsMax: 2500 }).some((l) => l.startsWith('words_target')), 'never padded to length')
})
