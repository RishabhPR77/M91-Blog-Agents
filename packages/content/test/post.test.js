import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePost, BLOCK_TYPES } from '../src/index.js'

const post = (over = {}) => ({
  slug: 'map-human-approvals-to-the-right-agent-tool-call',
  title: 'Map Human Approvals to the Right Agent Tool Call',
  description: 'How to make sure each approval reaches the exact tool call it belongs to.',
  tldr: ['One', 'Two', 'Three'],
  published_at: '2026-10-18T07:00:00+05:30',
  updated_at: '2026-10-18T07:00:00Z',
  topic_group: 1,
  tags: ['ai-agents', 'approvals'],
  reading_time_min: 6,
  markdown: '# Title\n\nBody.',
  blocks: [{ type: 'steps_checklist', id: 'b1', data: { steps: [] } }],
  seo: { title_tag: 'Map Human Approvals to the Right Tool Call', meta_description: 'Short description.', og_image: '' },
  sources: [{ url: 'https://github.com/example/issues/1', title: 'Issue' }],
  related_slugs: [],
  noindex: true,
  canonical_url: 'https://m91-blog.embarko.app/map-human-approvals-to-the-right-agent-tool-call',
  brief_id: '261017-2257-3MMH',
  version: 1,
  ...over
})

test('a valid post passes; blocks may be null', () => {
  assert.deepEqual(validatePost(post()), { valid: true, errors: [] })
  assert.equal(validatePost(post({ blocks: null })).valid, true)
})

test('missing fields fail', () => {
  const p = post()
  delete p.title
  delete p.seo
  const r = validatePost(p)
  assert.equal(r.valid, false)
  assert.ok(r.errors.some((e) => /title/.test(e)))
  assert.ok(r.errors.some((e) => /seo/.test(e)))
})

test('a long or badly formed slug fails', () => {
  assert.equal(validatePost(post({ slug: 'a'.repeat(61) })).valid, false)
  assert.equal(validatePost(post({ slug: 'Not A Slug' })).valid, false)
})

test('tldr must have exactly 3 items', () => {
  assert.equal(validatePost(post({ tldr: ['One', 'Two'] })).valid, false)
})

test('an unknown block type fails', () => {
  const r = validatePost(post({ blocks: [{ type: 'carousel', id: 'b1', data: {} }] }))
  assert.equal(r.valid, false)
  assert.match(r.errors.join(), /"carousel" is not a known block type/)
})

test('seo and description length limits; bad dates fail', () => {
  assert.equal(validatePost(post({ description: 'x'.repeat(156) })).valid, false)
  assert.equal(validatePost(post({ seo: { title_tag: 'x'.repeat(61), meta_description: '', og_image: '' } })).valid, false)
  assert.equal(validatePost(post({ published_at: '18/10/2026' })).valid, false)
})

test('16 block types are defined', () => {
  assert.equal(BLOCK_TYPES.length, 16)
  assert.ok(BLOCK_TYPES.includes('phone_ring_sim'))
})
