// Phase 8: plan → blocks. Every block type built from exact slices; bad segments dropped with reasons;
// rich_text fills the rest. No AI, no Mem0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePost } from '@m91/content'
import { parseParts } from '../../src/designer/parts.js'
import { buildBlocks, languageLabel } from '../../src/designer/build.js'
import { EVERY_BLOCK_MD, everyBlockPlan, range, seg } from './fixtures.js'

const parsed = () => parseParts(EVERY_BLOCK_MD)
const blockOf = (r, type) => r.blocks.find((b) => b.type === type)

test('a plan with every block type: all kept, in post order, with rich_text between them and ids b1…', () => {
  const p = parsed()
  const r = buildBlocks(everyBlockPlan(p.parts), p, { maxBlocks: 10 })
  assert.deepEqual(r.dropped, [])
  assert.equal(r.kept.length, 10)
  const interactive = r.blocks.filter((b) => b.type !== 'rich_text').map((b) => b.type)
  assert.deepEqual(interactive, ['callout', 'steps_checklist', 'phone_ring_sim', 'code_tabs', 'comparison_table', 'escalation_timeline', 'agent_terminal_replay', 'choice_explorer', 'faq_accordion', 'troubleshooting_picker'])
  r.blocks.forEach((b, i) => assert.equal(b.id, `b${i + 1}`))
  assert.equal(r.blocks[0].type, 'rich_text')
  assert.equal(r.blocks[0].data.markdown, '## Why approvals need one owner\n\nAn agent that deletes data needs a person to say yes first. This post shows how.')
  assert.equal(r.blocks.at(-1).data.markdown, '## What to do next\n\n[Try M91](https://m91.msg91.com/)')
  assert.deepEqual(r.layout.flatMap((l) => l.part_ids), p.parts.map((x) => x.id), 'every part once, in order')
  const post = { blocks: r.blocks }
  assert.deepEqual(validatePost({ ...post }).errors.filter((e) => e.startsWith('/blocks')), [])
})

test('each builder takes the text from the post, character for character', () => {
  const p = parsed()
  const r = buildBlocks(everyBlockPlan(p.parts), p, { maxBlocks: 10 })
  assert.deepEqual(blockOf(r, 'callout').data, { tone: 'warning', markdown: '> Never auto-approve when the answer is missing.' })
  assert.deepEqual(blockOf(r, 'steps_checklist').data.steps, [
    { markdown: 'Create a channel in M91.\n   What you should see: a send link.' }, { markdown: 'Add the link to your server.' }, { markdown: 'Send a test alert.' }
  ])
  assert.deepEqual(blockOf(r, 'phone_ring_sim').data.moments.map((m) => [m.actor, m.markdown]), [
    ['agent', 'The agent reaches a risky step and asks for approval.'], ['m91', 'M91 rings the on-call phone.'], ['human', 'The person taps Approve.'], ['software', 'The software continues with the step.']
  ])
  assert.deepEqual(blockOf(r, 'code_tabs').data.tabs.map((t) => [t.label, t.language, t.code.slice(0, 12)]), [['Terminal', 'bash', 'curl -sS -X '], ['JavaScript', 'js', 'await fetch(']])
  assert.match(blockOf(r, 'comparison_table').data.markdown, /^\| Option \| Wakes a person \| Records the answer \|\n\|---\|---\|---\|\n/)
  assert.deepEqual(blockOf(r, 'escalation_timeline').data.steps.map((s) => s.markdown), ['Minute 0: the phone rings.', 'Minute 5: the next person is called.', 'Minute 15: the team lead is called.'])
  assert.deepEqual(blockOf(r, 'agent_terminal_replay').data, { language: 'console', lines: ['$ agent run deploy', 'waiting for approval…', 'approved by Aryan', 'deploy 4821 done'] })
  assert.deepEqual(blockOf(r, 'choice_explorer').data.options, [
    { choice_markdown: '**Short timeout**', outcome_markdown: 'and the agent gives up quickly: nothing changes.' },
    { choice_markdown: '**Long timeout**', outcome_markdown: 'and the agent waits for a person.\n\nThat keeps risky steps safe.' }
  ])
  assert.deepEqual(blockOf(r, 'faq_accordion').data.items, [
    { question_markdown: 'Does M91 work in silent mode?', answer_markdown: 'Yes. It rings through silent mode.' },
    { question_markdown: 'Can two people approve?', answer_markdown: 'Only the first answer counts.' }
  ])
  assert.deepEqual(blockOf(r, 'troubleshooting_picker').data.items, [
    { problem_markdown: 'The phone does not ring', cause_markdown: 'Likely cause: the app has no permission to ring.', fix_markdown: 'Fix: allow notifications for M91.' },
    { problem_markdown: 'The callback never arrives', cause_markdown: 'Likely cause: the callback URL is not public.', fix_markdown: 'Fix: use a public HTTPS URL.' }
  ], '"Likely cause:" and "Fix:" on consecutive lines are split into cause and fix')
})

test('segments that break a rule are dropped with a reason; their parts stay plain text', () => {
  const p = parsed()
  const P = p.parts
  const plan = {
    segments: [
      seg('steps_checklist', range(P, 'An agent that deletes')), // a paragraph, not a list
      seg('callout', range(P, '> Never')), // tone "none"
      seg('phone_ring_sim', range(P, '1. The agent reaches'), { moment_actors: ['agent', 'phone'] }), // 2 actors for 4 moments
      seg('agent_terminal_replay', range(P, '```js')), // js is not a terminal language
      seg('faq_accordion', range(P, '### The phone does not ring', 'Fix: allow')), // not questions
      seg('try_it', range(P, '| Option')), // not a Designer block
      seg('code_tabs', [range(P, '```bash')[0], range(P, '| Option')[0]]), // not contiguous
      seg('comparison_table', ['N999']), // unknown part
      seg('steps_checklist', range(P, '1. Create a channel')), // ok
      seg('callout', range(P, '> Never'), { callout_tone: 'tip' }), // before the previous kept segment
      seg('escalation_timeline', range(P, '1. Create a channel')) // overlaps
    ]
  }
  const r = buildBlocks(plan, p, { maxBlocks: 6 })
  assert.deepEqual(r.kept.map((k) => k.block_type), ['steps_checklist'])
  const reasons = r.dropped.map((d) => `${d.block_type}: ${d.reason}`)
  assert.match(reasons[0], /^steps_checklist: steps_checklist uses exactly one ordered list/)
  assert.match(reasons[1], /^callout: callout needs a tone/)
  assert.match(reasons[2], /^phone_ring_sim: phone_ring_sim needs one actor per moment \(4\), got 2/)
  assert.match(reasons[3], /^agent_terminal_replay: .*got "js"/)
  assert.match(reasons[4], /^faq_accordion: faq_accordion: N\d+ must be an H3 question/)
  assert.match(reasons[5], /^try_it: "try_it" is not a block type the Designer may choose/)
  assert.match(reasons[6], /not a contiguous range/)
  assert.match(reasons[7], /unknown part id\(s\): N999/)
  assert.match(reasons[8], /^callout: overlaps or comes before/)
  assert.match(reasons[9], /^escalation_timeline: overlaps or comes before/)
  assert.equal(r.blocks.filter((b) => b.type === 'rich_text').length, 2, 'the text before and after the checklist')
})

test('the interactive block limit; zero segments; an empty plan → one rich_text block', () => {
  const p = parsed()
  const r = buildBlocks(everyBlockPlan(p.parts), p, { maxBlocks: 2 })
  assert.equal(r.kept.length, 2)
  assert.equal(r.dropped.length, 8)
  assert.ok(r.dropped.every((d) => d.reason === 'over the limit of 2 interactive blocks'))
  const none = buildBlocks({ segments: [], notes: 'none' }, p)
  assert.deepEqual(none.blocks, [{ type: 'rich_text', id: 'b1', data: { markdown: EVERY_BLOCK_MD.trimEnd() } }])
  assert.deepEqual(buildBlocks(null, p).blocks.length, 1)
})

test('variants: two paragraphs as a callout; troubleshooting with separate Fix paragraphs; tab labels', () => {
  const md = 'First line of a tip.\n\nSecond line.\n\n### A\n\nLikely cause: x.\n\nFix: y.\n\n### B\n\n**Likely cause:** z.\n**Fix:** w.'
  const p = parseParts(md)
  const r = buildBlocks({ segments: [seg('callout', ['N1', 'N2'], { callout_tone: 'info' }), seg('troubleshooting_picker', ['N3', 'N4', 'N5', 'N6', 'N7'])] }, p)
  assert.deepEqual(r.dropped, [])
  assert.equal(r.blocks[0].data.markdown, 'First line of a tip.\n\nSecond line.')
  assert.deepEqual(r.blocks[1].data.items[1], { problem_markdown: 'B', cause_markdown: '**Likely cause:** z.', fix_markdown: '**Fix:** w.' })
  assert.deepEqual(['bash', 'sh', 'js', 'python', 'json', 'yaml', '', 'kotlin'].map(languageLabel), ['Terminal', 'Terminal', 'JavaScript', 'Python', 'JSON', 'YAML', 'Text', 'Kotlin'])
  const tabs = buildBlocks({ segments: [seg('code_tabs', ['N1', 'N2'])] }, parseParts('```bash\na\n```\n\n```bash\nb\n```')).blocks[0].data.tabs
  assert.deepEqual(tabs.map((t) => t.label), ['Terminal', 'Terminal (2)'])
})
