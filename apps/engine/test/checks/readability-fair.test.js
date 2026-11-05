// The reading grade and sentence lengths measure what a reader reads: sentences end after closing quotes and
// brackets, table rows and inline code are not prose, and the Writer is told which sentences and words are hard.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sentences, hardestParts, fleschKincaidGrade } from '../../src/checks/readability.js'
import { parseMarkdown, neutralCode } from '../../src/checks/content.js'

test('a sentence ends after a closing quote or bracket, not only right after the full stop', () => {
  assert.deepEqual(sentences('The phone rings until someone says “yes.” Then the agent goes on. It waits (see below.) Next it acts.'),
    ['The phone rings until someone says “yes.”', 'Then the agent goes on.', 'It waits (see below.)', 'Next it acts.'])
  assert.deepEqual(sentences('Say "stop." Stop now!'), ['Say "stop."', 'Stop now!'])
})

test('readable text leaves out table rows and counts inline code as one short word; word count still sees everything', () => {
  const md = '# T\n\nSet `idempotency_key_for_the_payment_request` before you call `requestApprovalFromTheOnCallPerson()`.\n\n| What you see | What it means | What to do |\n| --- | --- | --- |\n| Two charges appear for one approved payment in the ledger | The approval was retried without an idempotency identifier attached | Add an idempotency identifier to every approval request you send |\n'
  const p = parseMarkdown(md)
  assert.ok(!/ledger|retried/.test(p.readable), 'no table cells in the readable text')
  assert.match(p.readable, /Set it before you call it\./)
  assert.match(p.prose, /ledger/, 'the prose (word count) keeps the table')
  assert.ok(fleschKincaidGrade(p.readable) < fleschKincaidGrade(p.prose))
  assert.equal(neutralCode('Use `a_b` and `c()` here.'), 'Use it and it here.')
})

test('the hardest sentences and the most used long words are named for the Writer', () => {
  const text = 'This is a short line for people. Responsibility for the notification acknowledgement is automatically transferred to the organization administrator. Responsibility stays clear. The cat sat on the mat today.'
  const h = hardestParts(text)
  assert.match(h.sentences[0], /^Responsibility for the notification acknowledgement/)
  assert.equal(h.longWords[0], 'responsibility (2×)')
  assert.ok(h.longWords.some((w) => w.startsWith('acknowledgement')))
})
