// Phase 8: the post as numbered parts with exact source slices, previews and flags. No AI, no Mem0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseParts, bodyMarkdown, partForPrompt, PREVIEW_MAX } from '../../src/designer/parts.js'
import { EVERY_BLOCK_MD, idOf } from './fixtures.js'

test('every top-level node becomes a part N1, N2 … with its exact source slice', () => {
  const { markdown, parts } = parseParts(EVERY_BLOCK_MD)
  assert.equal(markdown, EVERY_BLOCK_MD)
  parts.forEach((p, i) => {
    assert.equal(p.id, `N${i + 1}`)
    assert.equal(p.source, markdown.slice(p.start, p.end))
    assert.ok(p.end > p.start)
    if (i > 0) assert.ok(p.start >= parts[i - 1].end, 'in order, no overlap')
  })
  const types = new Set(parts.map((p) => p.type))
  for (const t of ['heading', 'paragraph', 'list', 'table', 'code', 'blockquote']) assert.ok(types.has(t), t)
  // Between parts there is only whitespace (blank lines).
  let cursor = 0
  for (const p of parts) {
    assert.equal(markdown.slice(cursor, p.start).trim(), '')
    cursor = p.end
  }
  assert.equal(markdown.slice(cursor).trim(), '')
})

test('facts and previews per type: headings, lists, tables, code; previews are short', () => {
  const { parts } = parseParts(EVERY_BLOCK_MD)
  const get = (text) => parts.find((p) => p.source.startsWith(text))
  assert.equal(get('## Set it up').depth, 2)
  assert.equal(get('### Does M91').depth, 3)
  assert.deepEqual([get('1. Create a channel').ordered, get('1. Create a channel').items], [true, 3])
  assert.equal(get('1. Create a channel').preview, '1. Create a channel in M91. What you should… | 2. Add the link to your server. | 3. Send a test alert.')
  assert.equal(get('| Option').preview, 'columns: Option | Wakes a person | Records the answer · 2 rows')
  assert.deepEqual([get('```bash').lang, get('```bash').lines, get('```bash').preview], ['bash', 1, 'bash code · 1 lines'])
  assert.equal(get('```console').preview, 'console code · 4 lines')
  assert.equal(get('> Never').type, 'blockquote')
  const long = parseParts(`${'word '.repeat(80)}end`).parts[0]
  assert.ok(long.preview.length <= PREVIEW_MAX && long.preview.endsWith('…'))
})

test('pattern flags: bold start, questions, likely cause, fix, approval flow', () => {
  const { parts } = parseParts(EVERY_BLOCK_MD)
  const flags = (text) => parts.find((p) => p.source.startsWith(text)).flags
  assert.deepEqual(flags('**Short timeout**'), { starts_with_bold: true })
  assert.deepEqual(flags('That keeps'), {})
  assert.deepEqual(flags('### Does M91'), { is_question: true })
  assert.deepEqual(flags('### The phone does not ring'), {})
  assert.deepEqual(flags('Likely cause: the app'), { starts_with_likely_cause: true })
  assert.deepEqual(flags('Fix: allow'), { starts_with_fix: true })
  assert.deepEqual(flags('1. The agent reaches'), { looks_like_flow: true })
  assert.deepEqual(flags('1. Create a channel'), {}, 'a setup list is not a flow')
  assert.deepEqual(flags('1. Minute 0'), {}, 'one flow word in three items is not enough')
  assert.deepEqual(parseParts('**Likely cause:** bold label.').parts[0].flags, { starts_with_bold: true, starts_with_likely_cause: true })
})

test('the Designer sees ids, types, facts, previews and flags only — never the source', () => {
  const { parts } = parseParts(EVERY_BLOCK_MD)
  const p = partForPrompt(parts.find((x) => x.id === idOf(parts, '1. The agent reaches')))
  assert.deepEqual(Object.keys(p), ['id', 'type', 'ordered', 'items', 'preview', 'flags'])
  assert.deepEqual(p.flags, ['looks_like_flow'])
  assert.ok(!JSON.stringify(parts.map(partForPrompt)).includes('M91_SEND_LINK'), 'code text is not sent')
  assert.equal(Object.keys(parts[0]).includes('node'), false, 'the mdast node is not enumerable')
  assert.ok(parts[0].node)
})

test('bodyMarkdown is the Publisher body: no H1, no TL;DR; html and other nodes are plain-text parts', () => {
  const draft = '# Title\n\n**TL;DR**\n- One\n- Two\n- Three\n\n## First\n\nBody text.'
  assert.equal(bodyMarkdown(draft), '## First\n\nBody text.')
  const { parts } = parseParts('Text.\n\n<div>raw</div>\n\n---\n\n[x]: https://example.com')
  assert.deepEqual(parts.map((p) => p.type), ['paragraph', 'html', 'thematicBreak', 'html'])
  assert.equal(parseParts('a\r\nb').markdown, 'a\nb')
})
