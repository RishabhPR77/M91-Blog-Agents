// The Writer's message stays under viaSocket's 50,000 characters: a repair continues the thread and sends only the
// problems; a message still too long leaves out the interactive ideas, then the lessons, then the last sources.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWriterMessage } from '../../src/writer/inputs.js'
import { repairTail } from '../../src/writer/prompts.js'

const source = (i) => ({ url: `https://example.com/source-${i}`, claim: `Claim ${i} ${'x'.repeat(900)}` })

test('message guard: interactive ideas, then lessons, then the last sources are left out; the first sources stay', () => {
  const sections = {
    brief: '{"keyword":"agent approval"}',
    tone: 't',
    lessons: 'L'.repeat(8000),
    interactiveIdeas: 'I'.repeat(6000),
    allowedUrls: '- x',
    sourcePack: JSON.stringify(Array.from({ length: 60 }, (_, i) => source(i)))
  }
  const { message, trimmed } = buildWriterMessage(sections)
  assert.ok(message.length <= 50000, `${message.length}`)
  assert.equal(trimmed[0], 'interactive ideas')
  assert.equal(trimmed[1], 'lessons')
  assert.match(trimmed[2], /^source pack \(\d+ of 60 sources left out\)$/)
  assert.ok(message.includes('source-0'), 'the first sources stay')
  assert.ok(!message.includes('source-59'), 'the last sources go')
})

test('message guard: only what is needed is left out', () => {
  const { message, trimmed } = buildWriterMessage({ brief: '{}', lessons: 'keep me', interactiveIdeas: 'I'.repeat(50000), sourcePack: JSON.stringify([source(1)]) })
  assert.deepEqual(trimmed, ['interactive ideas'])
  assert.ok(message.includes('keep me'))
})

test('a repair that continues the thread sends only the problems, however long the post', () => {
  const tail = repairTail(null, ['first_person: we\'ve seen', 'reading_grade: grade 11.2'])
  assert.ok(!tail.includes('--- YOUR PREVIOUS ANSWER ---'))
  assert.match(tail, /--- PROBLEMS FOUND BY THE CHECKER ---\n- first_person: we've seen\n- reading_grade: grade 11\.2/)
  assert.ok(tail.length < 1000)
  // The old way, kept for a call with no thread to continue: the whole answer again.
  const full = repairTail({ post_markdown: 'w '.repeat(15000) }, ['x'])
  assert.match(full, /^--- YOUR PREVIOUS ANSWER ---\n\{/)
})
