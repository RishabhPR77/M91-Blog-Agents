// Phase 10, B1: the guide document — its shape, one data schema per component, and the rules a schema can't say.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateGuide, validatePost, GUIDE_COMPONENT_TYPES, GUIDE_COMPONENT_SCHEMAS } from '../src/index.js'

const sample = JSON.parse(readFileSync(new URL('../../../apps/blog/samples/sample-guide-refund-approval.json', import.meta.url), 'utf8'))
const clone = (x) => structuredClone(x)
const withComponent = (type, data) => {
  const g = clone(sample.guide)
  g.chapters[0].components = [{ type, id: 'g1', data }]
  return g
}

test('the sample guide is valid and uses every component type', () => {
  assert.deepEqual(validatePost(sample), { valid: true, errors: [] })
  const used = new Set(sample.guide.chapters.flatMap((c) => c.components.map((x) => x.type)))
  assert.deepEqual([...used].sort(), [...GUIDE_COMPONENT_TYPES].sort())
  assert.deepEqual(Object.keys(GUIDE_COMPONENT_SCHEMAS).sort(), [...GUIDE_COMPONENT_TYPES].sort())
})

test('a post without a guide (or with guide: null) is still valid: old posts keep working', () => {
  const { guide, ...old } = sample
  assert.equal(validatePost(old).valid, true)
  assert.equal(validatePost({ ...old, guide: null }).valid, true)
})

test('component data is checked against its type, with limits', () => {
  const bad = {
    prose: { markdown: '' },
    journey_steps: { steps: [{ title: 'a', text_markdown: 'b' }], current: 0 },
    phone_ring_sim: { moments: [{ state: 'sleeping', actor: 'agent', markdown: 'x' }, { state: 'waiting', actor: 'agent', markdown: 'x' }, { state: 'waiting', actor: 'agent', markdown: 'x' }] },
    approve_demo: { request: 'x', approve: { label: 'A', outcome_markdown: 'y' }, reject: { label: 'R', outcome_markdown: 'z' } },
    route_compare: { caption: 'c', routes: [{ name: 'one', stops: ['a'] }] },
    steps_checklist: { steps: [{ markdown: 'only one' }] },
    tool_picker: { question: 'q', options: [{ id: 'Bad Id', label: 'x', steps: [{ markdown: 'y' }] }, { id: 'b', label: 'y', steps: [{ markdown: 'z' }] }] },
    file_card: { filename: '../etc/passwd', language: 'json', what: 'x', code: '{}' },
    troubleshooting_picker: { items: [{ problem_markdown: 'p', cause_markdown: 'c' }, { problem_markdown: 'p', cause_markdown: 'c', fix_markdown: 'f' }] },
    comparison_table: { markdown: 'x', extra: 1 },
    faq: { items: [] }
  }
  for (const type of GUIDE_COMPONENT_TYPES) {
    const errors = validateGuide(withComponent(type, bad[type]), sample)
    assert.ok(errors.length > 0 && errors.some((e) => e.includes(`(${type})`)), `${type}: ${errors.join(' | ')}`)
  }
  // A text field over its limit fails too.
  const long = validateGuide(withComponent('approve_demo', { example: true, request: 'x'.repeat(141), approve: { label: 'A', outcome_markdown: 'y' }, reject: { label: 'R', outcome_markdown: 'z' } }), sample)
  assert.ok(long.some((e) => /request must NOT have more than 140 characters/.test(e)), long.join(' | '))
})

test('example data must say so: approve_demo and the hero need example: true', () => {
  const g = clone(sample.guide)
  delete g.hero.example
  assert.ok(validateGuide(g, sample).some((e) => e.startsWith('/guide/hero')))
  const demo = sample.guide.chapters[2].components[0]
  const { example, ...noFlag } = demo.data
  assert.ok(validateGuide(withComponent('approve_demo', noFlag), sample).length > 0)
})

test('rules: accent in the title, chapters numbered in order, unique ids, states once and in chapter order', () => {
  const cases = [
    [(g) => { g.title_accent = 'not in title' }, /title_accent "not in title" is not in the title/],
    [(g) => { g.chapters[1].number = 5 }, /chapters\/1\/number must be 2/],
    [(g) => { g.chapters[1].id = 'c1' }, /chapters ids must be unique/],
    [(g) => { g.chapters[1].components[0].id = 'g1' }, /component ids must be unique/],
    [(g) => { g.status_states[1].state = 'waiting' }, /each state may appear once/],
    [(g) => { g.status_states[2].chapter = 'c9' }, /"c9" is not a chapter/],
    [(g) => { g.status_states[3].chapter = 'c1' }, /must not point at an earlier chapter/],
    [(g) => { g.chapters[0].components[2].data.markdown = 'no table here' }, /must be a Markdown table/],
    [(g) => { g.chapters[0].components[1].data.current = 4 }, /current must point at a step/]
  ]
  for (const [change, re] of cases) {
    const g = clone(sample.guide)
    change(g)
    const errors = validateGuide(g, sample)
    assert.ok(errors.some((e) => re.test(e)), `${re}: ${errors.join(' | ')}`)
  }
})

test('validatePost reports guide errors under /guide (so the blog can drop just the guide)', () => {
  const post = clone(sample)
  post.guide.chapters[0].components[0].data = {}
  const { valid, errors } = validatePost(post)
  assert.equal(valid, false)
  assert.ok(errors.every((e) => e.startsWith('/guide')), errors.join(' | '))
})
