// The fact check before the review: the Reviewer's model lists the sentences that the evidence does not support, the
// Writer applies the exact fixes in its own thread, and only then does the Reviewer see the post.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWriter } from '../../src/writer/index.js'
import { factIssues, factCheckMessage, factFixLine } from '../../src/writer/factcheck.js'
import { AiError } from '../../src/viasocket.js'
import { setSink } from '../../src/util/log.js'
import { config, seededStore, fakeAi, okChecker, draftAnswer, BRIEF_ID, NOW, GOOD_MD } from './fixtures.js'
import { fakeNotifier } from '../helpers.js'

const noWeb = async () => ({ ok: false, status: 404, headers: { get: () => '' }, text: async () => '' })
const SENTENCE = GOOD_MD.split('\n').find((l) => l.startsWith('Agent approval means')).split('. ')[0] + '.'

async function run(answers = {}, env = {}) {
  const restore = setSink(() => {})
  const store = await seededStore()
  const ai = fakeAi(answers)
  try {
    const r = await runWriter({ mode: 'new', briefId: BRIEF_ID, runId: 'R-1' }, { config: config({ WRITER_FACT_CHECK: 'true', ...env }), store, notifier: fakeNotifier(), aiSend: ai, urlChecker: okChecker(), fetch: noWeb, now: () => NOW })
    return { r, ai, store }
  } finally {
    restore()
  }
}

test('issues: only quotes really in the post, each once; an answer without "issues" is unusable', () => {
  const post = `# T\n\n${SENTENCE} More text.`
  const issues = factIssues({ issues: [{ quote: SENTENCE, problem: 'p', fix: 'f' }, { quote: SENTENCE.toUpperCase(), problem: 'p', fix: 'f' }, { quote: 'Not in the post at all.', problem: 'p', fix: 'f' }] }, post)
  assert.deepEqual(issues.map((x) => x.quote), [SENTENCE])
  assert.equal(factIssues({ gates: [] }, post), null)
  assert.equal(factIssues('not json', post), null)
  assert.equal(factFixLine({ quote: 'A.', problem: 'Wrong.', fix: 'B.' }), '"A.": Wrong. Write instead: "B."')
  assert.equal(factFixLine({ quote: 'A.', problem: 'Wrong.', fix: 'remove' }), '"A.": Wrong. Write instead: (remove this sentence)')
})

test('message: the post and the evidence; source pages are cut first to fit', () => {
  const m = factCheckMessage({ post: 'P', facts: '{}', brief: '{}', docsText: 'D', sourceText: 'S'.repeat(60000) })
  assert.ok(m.length <= 50000)
  assert.match(m, /^--- POST ---\nP\n--- M91 FACTS ---\n\{\}\n--- BRIEF ---\n\{\}\n--- M91 DOCS TEXT ---\nD\n--- SOURCE TEXT ---\nS+ …\(trimmed\)$/)
})

test('the Reviewer model checks the facts; the Writer fixes the sentences in its thread; then the draft is saved', async () => {
  const fixed = draftAnswer({ post_markdown: GOOD_MD.replace(SENTENCE, 'Agent approval means your software waits for a person before it acts.') })
  const { r, ai, store } = await run({ factcheck: { issues: [{ quote: SENTENCE, problem: 'Overstates what M91 does.', fix: 'Agent approval means your software waits for a person before it acts.' }] }, factfix: fixed })
  assert.deepEqual(ai.requests.map((q) => q.call), ['new', 'factcheck', 'factfix'])
  const [first, check, fix] = ai.requests
  assert.equal(check.agent, 'reviewer', "on the Reviewer's model")
  assert.match(check.message, /^--- POST ---\n# /)
  assert.match(check.message, /--- BRIEF ---\nFORBIDDEN CLAIMS \(check every sentence of POST, the FAQ included, against each one\):\n1\. /)
  assert.equal(fix.threadId, first.threadId, "in the Writer's own thread")
  assert.match(fix.message, /--- PROBLEMS FOUND BY THE CHECKER ---\n- ".+": Overstates what M91 does\. Write instead: "Agent approval means your software waits for a person before it acts\."/)
  assert.equal(r.fact_fixes, 1)
  assert.ok(r.warnings.includes('fact check: 1 sentence(s) corrected before the review'))
  const saved = [...store.records.values()].find((x) => x.type === 'draft').payload
  assert.ok(saved.post_markdown.includes('waits for a person before it acts'))
})

test('nothing to fix: one check, no fix call; a failed check is a warning and the draft still goes on', async () => {
  const clean = await run({ factcheck: { issues: [] } })
  assert.deepEqual(clean.ai.requests.map((q) => q.call), ['new', 'factcheck'])
  assert.equal(clean.r.fact_fixes, 0)
  const failed = await run({ factcheck: new AiError('no answer', { kind: 'timeout' }) })
  assert.ok(failed.r.warnings.some((w) => /^fact check failed \(no answer\): the draft went to the review unchecked$/.test(w)), failed.r.warnings.join('\n'))
  assert.equal(failed.r.hard_passed, true)
  const off = await run({}, { WRITER_FACT_CHECK: 'false' })
  assert.deepEqual(off.ai.requests.map((q) => q.call), ['new'])
})

test('a fix that breaks a major check is dropped: the draft before it is saved', async () => {
  const worse = draftAnswer({ post_markdown: GOOD_MD.replace('A pause keeps', "We've seen that a pause keeps") })
  const { r, store } = await run({ factcheck: { issues: [{ quote: SENTENCE, problem: 'x', fix: 'y' }] }, factfix: worse })
  assert.ok(r.warnings.includes('fact check fixes: its answer was not better, so the draft before it was kept'))
  assert.ok(!r.warnings.some((w) => /sentence\(s\) corrected/.test(w)))
  const saved = [...store.records.values()].find((x) => x.type === 'draft').payload
  assert.ok(!saved.post_markdown.includes("We've seen"))
})
