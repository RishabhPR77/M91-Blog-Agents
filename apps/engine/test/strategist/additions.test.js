// Phase 3.5 Task 7: interactive_ideas and AI-chosen internal_links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInputs, buildStrategistMessage } from '../../src/strategist/inputs.js'
import { autoFix, findProblems, validateBrief } from '../../src/strategist/checks.js'
import { runStrategist } from '../../src/strategist/index.js'
import { NOW, config, seededStore, validBrief, fakeAi } from './fixtures.js'

const now = () => NOW
const POST_URL = 'https://m91-blog.embarko.app/agent-approvals-basics'

async function ctx({ published = false } = {}) {
  const cfg = config()
  const store = await seededStore()
  if (published) await store.createRecord({ type: 'published_post', status: 'published', payload: { title: 'Agent approvals: the basics', url: POST_URL, topic_group: 1, summary: 'What an approval step is.' } })
  const inputs = await buildInputs({ config: cfg, store, now })
  return { cfg, store, inputs }
}
const problems = async (brief, c) => findProblems(autoFix(brief, { config: c.cfg, inputs: c.inputs }).brief, { config: c.cfg, inputs: c.inputs, store: c.store })

test('schema: interactive_ideas block_type must be a known block name', () => {
  assert.deepEqual(validateBrief(validBrief()).errors, [])
  assert.ok(validateBrief(validBrief({ interactive_ideas: [{ block_type: 'carousel', why: 'x' }] })).errors.length)
  assert.ok(validateBrief(validBrief({ internal_links: [{ url: POST_URL }] })).errors.length, 'internal_links items need url, anchor_text, why')
})

test('interactive_ideas: 0–4 valid ideas pass; more than 4 or an empty why is a problem', async () => {
  const c = await ctx()
  assert.deepEqual(await problems(validBrief({ interactive_ideas: [] }), c), [])
  const five = Array.from({ length: 5 }, () => ({ block_type: 'callout', why: 'x' }))
  assert.ok((await problems(validBrief({ interactive_ideas: five }), c)).some((p) => /interactive_ideas has 5 items/.test(p)))
  assert.ok((await problems(validBrief({ interactive_ideas: [{ block_type: 'try_it', why: '' }] }), c)).some((p) => /why is empty/.test(p)))
})

test('internal_links: cleared automatically when there are no published posts', async () => {
  const c = await ctx()
  const { brief, fixes } = autoFix(validBrief({ internal_links: [{ url: 'https://elsewhere.example.com/x', anchor_text: 'x', why: 'x' }] }), { config: c.cfg, inputs: c.inputs })
  assert.deepEqual(brief.internal_links, [])
  assert.ok(fixes.some((f) => /cleared internal_links/.test(f)))
  assert.match(buildStrategistMessage(c.inputs).message, /--- PUBLISHED POSTS ---\nnone/)
})

test('internal_links: published URLs pass; an unpublished URL is a problem; at most 3', async () => {
  const c = await ctx({ published: true })
  assert.match(buildStrategistMessage(c.inputs).message, /--- PUBLISHED POSTS ---\n\[\{"title":"Agent approvals: the basics","url":"https:\/\/m91-blog\.embarko\.app\/agent-approvals-basics"/)
  assert.deepEqual(await problems(validBrief({ internal_links: [{ url: POST_URL, anchor_text: 'approval basics', why: 'background' }] }), c), [])
  assert.ok((await problems(validBrief({ internal_links: [{ url: 'https://m91-blog.embarko.app/not-published', anchor_text: 'x', why: 'x' }] }), c)).some((p) => /not a URL from PUBLISHED POSTS/.test(p)))
  const four = Array.from({ length: 4 }, () => ({ url: POST_URL, anchor_text: 'a', why: 'w' }))
  assert.ok((await problems(validBrief({ internal_links: four }), c)).some((p) => /internal_links has 4 items/.test(p)))
})

test('a planned brief carries interactive_ideas and the AI-chosen internal_links (no longer forced to [])', async () => {
  const c = await ctx({ published: true })
  const ai = fakeAi({ plan: validBrief({ internal_links: [{ url: POST_URL, anchor_text: 'approval basics', why: 'background' }] }) })
  const r = await runStrategist({ mode: 'plan', runId: 'R-1', briefId: '261018-0700-ABCD' }, { config: c.cfg, store: c.store, aiSend: ai, now })
  assert.deepEqual(r.brief.interactive_ideas, [{ block_type: 'phone_ring_sim', why: 'Shows the approval call the reader is setting up.' }])
  assert.equal(r.brief.internal_links[0].url, POST_URL)
  assert.match(ai.requests[0].prompt, /"interactive_ideas": up to 4 interactive blocks/)
  assert.match(ai.requests[0].prompt, /"internal_links": up to 3 links to PUBLISHED POSTS/)
})
