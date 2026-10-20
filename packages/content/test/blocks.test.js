// Phase 8: one data schema per built block type; validatePost checks types, ids and data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBlock, validatePost, BLOCK_SCHEMAS, BUILT_BLOCK_TYPES, BLOCK_TYPES } from '../src/index.js'

const md = (s) => s
const two = (f) => [f(1), f(2)]

// One valid data object per built type, and broken variants that must fail.
const VALID = {
  rich_text: { markdown: md('## Why\n\nPlain text.') },
  callout: { tone: 'warning', markdown: md('Never auto-approve when the answer is missing.') },
  steps_checklist: { steps: two((n) => ({ markdown: `Step ${n}` })) },
  code_tabs: { tabs: [{ label: 'Terminal', language: 'bash', code: 'curl -sS "$M91_SEND_LINK"' }, { label: 'JavaScript', language: 'js', code: 'await fetch(url)' }] },
  comparison_table: { markdown: md('| A | B |\n|---|---|\n| 1 | 2 |') },
  faq_accordion: { items: two((n) => ({ question_markdown: `### Question ${n}?`, answer_markdown: `Answer ${n}.` })) },
  phone_ring_sim: { moments: [{ actor: 'agent', markdown: 'The agent asks.' }, { actor: 'phone', markdown: 'The phone rings.' }, { actor: 'human', markdown: 'A person approves.' }] },
  escalation_timeline: { steps: two((n) => ({ markdown: `Minute ${n}` })) },
  agent_terminal_replay: { language: 'console', lines: ['$ m91 alert', ''] },
  choice_explorer: { options: two((n) => ({ choice_markdown: `**Option ${n}**`, outcome_markdown: `What happens ${n}.` })) },
  troubleshooting_picker: { items: two((n) => ({ problem_markdown: `### Problem ${n}`, cause_markdown: `Likely cause: ${n}`, fix_markdown: `Fix: ${n}` })) }
}

const INVALID = {
  rich_text: [{}, { markdown: '' }, { markdown: 'x', extra: 1 }],
  callout: [{ tone: 'danger', markdown: 'x' }, { tone: 'tip' }, { tone: 'none', markdown: 'x' }],
  steps_checklist: [{ steps: [{ markdown: 'only one' }] }, { steps: Array.from({ length: 13 }, () => ({ markdown: 's' })) }, { steps: [{ markdown: '' }, { markdown: 'x' }] }],
  code_tabs: [{ tabs: [{ label: 'Terminal', language: 'bash', code: 'x' }] }, { tabs: Array.from({ length: 6 }, () => ({ label: 'L', language: 'js', code: 'x' })) }, { tabs: [{ label: '', language: 'bash', code: 'x' }, { label: 'L', language: 'js', code: 'y' }] }],
  comparison_table: [{ markdown: '' }, { rows: [] }],
  faq_accordion: [{ items: [{ question_markdown: 'Q?', answer_markdown: 'A' }] }, { items: [{ question_markdown: 'Q?' }, { question_markdown: 'Q2?', answer_markdown: 'A' }] }],
  phone_ring_sim: [{ moments: [{ actor: 'agent', markdown: 'a' }, { actor: 'phone', markdown: 'b' }] }, { moments: [{ actor: 'robot', markdown: 'a' }, { actor: 'phone', markdown: 'b' }, { actor: 'human', markdown: 'c' }] }, { moments: Array.from({ length: 9 }, () => ({ actor: 'agent', markdown: 'a' })) }],
  escalation_timeline: [{ steps: [{ markdown: 'one' }] }, { steps: Array.from({ length: 11 }, () => ({ markdown: 's' })) }],
  agent_terminal_replay: [{ language: 'python', lines: ['a', 'b'] }, { language: 'bash', lines: ['only one'] }, { language: 'log', lines: Array.from({ length: 41 }, () => 'x') }],
  choice_explorer: [{ options: [{ choice_markdown: '**A**', outcome_markdown: 'x' }] }, { options: Array.from({ length: 5 }, () => ({ choice_markdown: '**A**', outcome_markdown: 'x' })) }],
  troubleshooting_picker: [{ items: [{ problem_markdown: 'P', cause_markdown: 'C', fix_markdown: 'F' }] }, { items: [{ problem_markdown: 'P', cause_markdown: 'C' }, { problem_markdown: 'P2', cause_markdown: 'C2', fix_markdown: 'F2' }] }]
}

test('a data schema exists for every built block type, and only for those', () => {
  assert.deepEqual(Object.keys(BLOCK_SCHEMAS).sort(), [...BUILT_BLOCK_TYPES].sort())
  assert.equal(BUILT_BLOCK_TYPES.length, 11)
  for (const t of BUILT_BLOCK_TYPES) assert.ok(BLOCK_TYPES.includes(t), t)
  for (const t of ['takeaways', 'alert_triage_quiz', 'try_it', 'diagram', 'cta_panel']) assert.ok(!BUILT_BLOCK_TYPES.includes(t), t)
})

for (const type of Object.keys(VALID)) {
  test(`${type}: valid data passes; broken data fails`, () => {
    assert.deepEqual(validateBlock({ type, id: 'b1', data: VALID[type] }), [])
    for (const bad of INVALID[type]) {
      const errors = validateBlock({ type, id: 'b1', data: bad })
      assert.ok(errors.length > 0, `${type} must reject ${JSON.stringify(bad).slice(0, 80)}`)
      assert.ok(errors.every((e) => e.includes(`(${type})`)), errors.join('; '))
    }
  })
}

test('block ids look like b1, b2 … and are unique in a post; reserved types only need a data object', () => {
  assert.match(validateBlock({ type: 'rich_text', id: 'block-1', data: VALID.rich_text }).join(), /must look like b1/)
  assert.match(validateBlock({ type: 'rich_text', id: 'b0', data: VALID.rich_text }).join(), /must look like b1/)
  assert.match(validateBlock({ type: 'rich_text', id: 'b1', data: [] }).join(), /data must be an object/)
  assert.deepEqual(validateBlock({ type: 'diagram', id: 'b3', data: { anything: true } }), [])
  const post = {
    slug: 's', title: 'T', description: 'D', tldr: ['a', 'b', 'c'], published_at: '2026-10-20T07:00:00Z', updated_at: '2026-10-20T07:00:00Z',
    topic_group: 1, tags: [], reading_time_min: 1, markdown: 'x', seo: { title_tag: 'T', meta_description: '', og_image: '' }, sources: [],
    related_slugs: [], noindex: true, canonical_url: 'https://m91-blog.embarko.app/posts/s/', brief_id: '261020-0700-ABCD', version: 1,
    blocks: [{ type: 'rich_text', id: 'b1', data: VALID.rich_text }, { type: 'callout', id: 'b1', data: VALID.callout }]
  }
  const r = validatePost(post)
  assert.equal(r.valid, false)
  assert.match(r.errors.join(), /\/blocks\/1\/id "b1" is used twice/)
  post.blocks[1].id = 'b2'
  assert.deepEqual(validatePost(post), { valid: true, errors: [] })
  post.blocks[1].data = { tone: 'loud', markdown: 'x' }
  assert.match(validatePost(post).errors.join(), /\/blocks\/1\/data\/tone .*\(callout\)/)
})
