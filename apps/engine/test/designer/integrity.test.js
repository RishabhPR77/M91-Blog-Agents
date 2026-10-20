// Phase 8: the integrity check passes on good plans and fails on any changed, missing, moved, added or
// dropped text. No AI, no Mem0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseParts } from '../../src/designer/parts.js'
import { buildBlocks } from '../../src/designer/build.js'
import { checkIntegrity, textStrings, onlyMarkup } from '../../src/designer/integrity.js'
import { EVERY_BLOCK_MD, everyBlockPlan } from './fixtures.js'

const built = () => {
  const p = parseParts(EVERY_BLOCK_MD)
  const r = buildBlocks(everyBlockPlan(p.parts), p, { maxBlocks: 10 })
  return { ...p, ...r }
}
const clone = (x) => structuredClone(x)
const check = (b) => checkIntegrity({ markdown: b.markdown, parts: b.parts, blocks: b.blocks, layout: b.layout })

test('passes on the every-block plan, on zero segments, and on a partly dropped plan', () => {
  assert.deepEqual(check(built()), { passed: true, details: [] })
  const p = parseParts(EVERY_BLOCK_MD)
  assert.deepEqual(check({ ...p, ...buildBlocks({ segments: [] }, p) }), { passed: true, details: [] })
  assert.equal(check({ ...p, ...buildBlocks(everyBlockPlan(p.parts), p, { maxBlocks: 3 }) }).passed, true)
})

test('fails on a changed slice (one word in a step)', () => {
  const b = built()
  const blocks = clone(b.blocks)
  blocks.find((x) => x.type === 'steps_checklist').data.steps[1].markdown = 'Add the link to your laptop.'
  const r = check({ ...b, blocks })
  assert.equal(r.passed, false)
  assert.match(r.details.join('\n'), /no new text: steps_checklist b\d+ has text that is not in its parts/)
})

test('fails on a missing part and on a reordered part', () => {
  const b = built()
  const layout = clone(b.layout)
  layout[0] = { ...layout[0], part_ids: layout[0].part_ids.slice(1) } // drop the first heading
  const missing = check({ ...b, layout })
  assert.equal(missing.passed, false)
  assert.match(missing.details.join('\n'), /coverage: .*missing N1/)
  const swapped = clone(b)
  ;[swapped.blocks[0], swapped.blocks[1]] = [swapped.blocks[1], swapped.blocks[0]]
  ;[swapped.layout[0], swapped.layout[1]] = [swapped.layout[1], swapped.layout[0]]
  const r = check(swapped)
  assert.equal(r.passed, false)
  assert.match(r.details.join('\n'), /coverage: .*order differs|ids: block 1 has id "b2"/)
})

test('fails on an injected string and on dropped text', () => {
  const b = built()
  const injected = clone(b.blocks)
  injected.find((x) => x.type === 'faq_accordion').data.items[0].answer_markdown = 'Yes. It rings through silent mode. Buy now!'
  assert.match(check({ ...b, blocks: injected }).details.join('\n'), /no new text: faq_accordion/)
  const dropped = clone(b.blocks)
  dropped.find((x) => x.type === 'escalation_timeline').data.steps.splice(1, 1) // a step disappears
  const r = check({ ...b, blocks: dropped })
  assert.equal(r.passed, false)
  assert.match(r.details.join('\n'), /no new text: escalation_timeline b\d+ leaves out text from its parts: ".*Minute 5/)
  const rich = clone(b.blocks)
  rich[0].data.markdown = rich[0].data.markdown.replace('one owner', 'an owner')
  assert.match(check({ ...b, blocks: rich }).details.join('\n'), /exactness: rich_text b1 differs/)
})

test('fails when text outside every block remains, or the schema breaks', () => {
  const b = built()
  const layout = clone(b.layout)
  const blocks = clone(b.blocks)
  layout.pop()
  blocks.pop()
  assert.match(check({ ...b, layout, blocks }).details.join('\n'), /text after the last block is in no block/)
  const bad = clone(b.blocks)
  bad.find((x) => x.type === 'callout').data.tone = 'loud'
  assert.match(check({ ...b, blocks: bad }).details.join('\n'), /schema: .*\(callout\)/)
})

test('helpers: fixed fields are not text; markup-only residue', () => {
  assert.deepEqual(textStrings({ tabs: [{ label: 'Terminal', language: 'bash', code: 'x' }] }), ['x'])
  assert.deepEqual(textStrings({ moments: [{ actor: 'agent', markdown: 'm' }], tone: 'tip' }), ['m'])
  assert.equal(onlyMarkup('1. \n2. \n```bash\n```\n### \n> '), true)
  assert.equal(onlyMarkup('1. \nhello'), false)
})
