// The Writer works from the same evidence the Reviewer checks against: the M91 fact sheet (with its "cannot" list) and
// what the docs say right after each code block (what it returns, when it fails). Without them the Writer guessed how
// M91's code behaves and the Reviewer, reading the whole docs page, failed the post for it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWriter } from '../../src/writer/index.js'
import { extractSnippets, snippetSection, SNIPPET_AFTER_MAX } from '../../src/writer/snippets.js'
import { setSink } from '../../src/util/log.js'
import { config, seededStore, fakeAi, okChecker, BRIEF_ID, NOW } from './fixtures.js'
import { fakeNotifier } from '../helpers.js'

const README = 'https://github.com/MSG91/m91-sdk'
const source = [
  `=== SOURCE: ${README} ===`,
  '# M91 SDK',
  'Ask a person and wait for the answer:',
  '```js',
  "const ok = await m91.requestApproval({ channel: 'ops', text: 'Deploy?' })",
  '```',
  'requestApproval resolves true when the person approves.',
  'It resolves false when they reject, and throws a TimeoutError when nobody answers in time.',
  '',
  '## Next section',
  'Something else entirely.'
].join('\n')

test('a code block keeps what the docs say right after it, up to the next heading', () => {
  const { snippets } = extractSnippets(source)
  assert.equal(snippets.length, 1)
  assert.equal(snippets[0].after, 'requestApproval resolves true when the person approves. It resolves false when they reject, and throws a TimeoutError when nobody answers in time.')
  const listed = snippetSection(snippets)
  assert.match(listed, /```\nafter it, the docs say: requestApproval resolves true when the person approves\. It resolves false when they reject, and throws a TimeoutError/)
  assert.ok(!listed.includes('Something else entirely'), 'stops at the next heading')
})

test('the text kept after a code block is capped', () => {
  const long = source.replace('requestApproval resolves true when the person approves.', 'x'.repeat(2000))
  const { snippets } = extractSnippets(long)
  assert.ok(snippets[0].after.length <= SNIPPET_AFTER_MAX)
})

test('the Writer gets M91 FACTS: the fact sheet the Reviewer checks against, with its "cannot" list', async () => {
  const restore = setSink(() => {})
  const store = await seededStore()
  await store.createRecord({ type: 'm91_facts', briefId: 'facts', payload: { can: ['Rings a phone until someone answers.'], cannot: ['M91 does not run the approved action.'], integrations: ['Slack'] }, status: 'current' })
  const ai = fakeAi()
  try {
    await runWriter({ mode: 'new', briefId: BRIEF_ID, runId: 'R-1' }, { config: config(), store, notifier: fakeNotifier(), aiSend: ai, urlChecker: okChecker(), fetch: async () => ({ ok: false, status: 404, text: async () => '' }), now: () => NOW })
  } finally {
    restore()
  }
  const { message, prompt } = ai.requests[0]
  assert.match(message, /--- M91 FACTS ---\n\{"can":\["Rings a phone until someone answers\."\],"cannot":\["M91 does not run the approved action\."\],"integrations":\["Slack"\]\}/)
  assert.match(prompt, /Facts about M91 only from the inputs: BRIEF m91_facts_to_use, M91 FACTS/)
  assert.match(prompt, /=== WHAT THE REVIEWER CHECKS ===\n[^\n]+\nA gate fails only for a problem that would mislead or misinform a reader\.[^\n]*\n- m91_claims_correct: /, 'the Writer checks its post against the Reviewer gates')
  assert.ok(!/claims_to_avoid_respected|tutorial_traceable|story_attribution_correct/.test(prompt), 'only the five gates')
  assert.match(prompt, /after it, the docs say/)
})
