// Phase 10, C2/C3: the Experience Designer with hand-written answers and a fake AI client (no AI, no Mem0, no
// network): an ok plan, a repair, components dropped after the checks, and a fallback with no guide.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { validatePost } from '@m91/content'
import { runExperience, latestGuideDoc, experienceSummary } from '../../src/experience/index.js'
import { EXPERIENCE_PROMPT, buildExperiencePrompt } from '../../src/experience/prompts.js'
import { buildGuide, checkCoverage } from '../../src/experience/build.js'
import { factProblems, guideCorpus } from '../../src/experience/checks.js'
import { parseParts } from '../../src/designer/parts.js'
import { resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { fakeConfig, memoryStore } from '../helpers.js'
import { EVERY_BLOCK_MD } from '../designer/fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const BRIEF = '261021-1000-EXPD'
const TITLE = 'Approvals with one owner for risky agent steps'
const POST_MD = `# ${TITLE}\n\n**TL;DR**\n- One.\n- Two.\n- Three.\n\n${EVERY_BLOCK_MD}`
const parsed = parseParts(EVERY_BLOCK_MD)
const ids = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `N${a + i}`)

/** A plan that uses every component and places every part once. */
export function goodPlan() {
  return {
    title_accent: 'one owner',
    hero: { agent: 'Deploy agent', request: 'Delete 4,200 test accounts?', person: 'Aryan, on call', decision: 'approved', result: 'Accounts deleted, approved by Aryan' },
    status_states: [{ state: 'waiting', chapter: 1 }, { state: 'ringing', chapter: 3 }, { state: 'approved', chapter: 4 }, { state: 'continuing', chapter: 6 }],
    chapters: [
      { label: 'The problem', heading_part_id: 'N1', heading: '', intro: '', components: [
        { type: 'prose', part_ids: ['N2', 'N3'] },
        { type: 'journey_steps', current: 1, steps: [{ title: 'Agent asks', text: 'It stops before the risky step.' }, { title: 'Phone rings', text: 'One person is called.' }, { title: 'Person decides', text: 'Approve or reject.' }] }
      ] },
      { label: 'Set it up', heading_part_id: 'N4', heading: '', intro: '', components: [
        { type: 'steps_checklist', part_ids: ['N5'], intro: 'Tap a number when it is done.', titles: ['Create a channel', 'Add the link', 'Send a test'], stuck: [{ step: 1, cause: 'No send link yet.', fix: 'Create the channel first.' }] }
      ] },
      { label: 'How it flows', heading_part_id: 'N6', heading: '', intro: '', components: [
        { type: 'phone_ring_sim', part_ids: ['N7'], states: ['waiting', 'ringing', 'approved', 'continuing'] },
        { type: 'approve_demo', request: 'Your agent wants to delete 4,200 test accounts', context: 'Example data only.', approve_label: 'Approve', approve_outcome: 'The agent deletes them and logs who approved.', reject_label: 'Reject', reject_outcome: 'The agent stops and tells the team.' }
      ] },
      { label: 'Send it', heading_part_id: 'N8', heading: '', intro: '', components: [
        { type: 'file_card', part_ids: ['N9'], snippet_id: '', line_from: 0, line_to: 0, filename: 'send-alert.sh', what: 'Sends the approval request.', preview_lines: 0 },
        { type: 'prose', part_ids: ['N10'] }
      ] },
      { label: 'Compare', heading_part_id: 'N11', heading: '', intro: '', components: [
        { type: 'comparison_table', part_ids: ['N12'], caption: 'Slack message or M91 call' },
        { type: 'route_compare', caption: 'Two routes to an answer', routes: [{ name: 'Slack message', best_for: 'Questions that can wait', stops: ['Post it', 'Someone reads it'], highlight: false }, { name: 'M91 call', best_for: 'One decision now', stops: ['Phone rings'], highlight: true }] }
      ] },
      { label: 'Nobody answers', heading_part_id: 'N13', heading: '', intro: '', components: [{ type: 'prose', part_ids: ids(14, 14) }] },
      { label: 'A run', heading_part_id: 'N15', heading: '', intro: '', components: [{ type: 'prose', part_ids: ['N16'] }] },
      { label: 'Timeouts', heading_part_id: 'N17', heading: '', intro: '', components: [{ type: 'prose', part_ids: ids(18, 20) }] },
      { label: 'Questions', heading_part_id: 'N21', heading: '', intro: '', components: [{ type: 'faq', part_ids: ids(22, 25) }] },
      { label: 'Stuck?', heading_part_id: 'N26', heading: '', intro: '', components: [{ type: 'troubleshooting_picker', part_ids: ids(27, 31), question: 'What are you seeing?' }] },
      { label: 'Next', heading_part_id: 'N32', heading: '', intro: '', components: [
        { type: 'prose', part_ids: ['N33'] },
        { type: 'tool_picker', question: 'Where does your agent run?', options: [{ id: 'shell', label: 'A shell script', steps: ['Send the alert with curl.'], snippet_id: 'S1', done: '' }, { id: 'node', label: 'Node.js', steps: ['Send the alert with fetch.'], snippet_id: '', done: 'Your phone rings.' }] }
      ] }
    ],
    your_turn_title: 'Let your agent ask before it deletes.',
    notes: 'none'
  }
}

const SNIPPETS = [{ id: 'S1', language: 'bash', code: 'curl -sS -X POST "$M91_SEND_LINK" -d \'{"title":"Deploy 4821"}\'', source_url: 'https://m91-api.msg91.com/quickstart.md' }]

async function setup(env = {}) {
  const config = fakeConfig(env)
  const store = memoryStore()
  await store.createRecord({ type: 'brief', briefId: BRIEF, payload: { brief_id: BRIEF, brief_version: 1, titles: [TITLE], topic_group: 1, claims_to_avoid: ['M91 guarantees a person will answer'], m91_facts_to_use: [], sources: [] }, status: 'drafted', version: 1 })
  await store.createRecord({ type: 'draft', briefId: BRIEF, payload: { title: TITLE, tldr: ['One.', 'Two.', 'Three.'], version: 1, brief_version: 1, post_markdown: POST_MD, snippets: SNIPPETS }, status: 'drafted', version: 1, meta: { brief_version: 1 } })
  return { config, store }
}

function fakeAi(answers) {
  const calls = []
  const send = async (p) => {
    calls.push(p)
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]
    if (a instanceof Error) throw a
    return { content: typeof a === 'function' ? a() : a, model: 'claude-sonnet-4-6', ms: 5, delivery: 'rtlayer' }
  }
  send.calls = calls
  return send
}
const recordsOf = (store, type) => [...store.records.values()].filter((r) => r.type === type)
const types = (guide) => guide.chapters.flatMap((c) => c.components.map((x) => x.type))

test('the prompt: the approved text with the two fixes (designed to ring through silent mode; a 10-year-old)', () => {
  assert.match(EXPERIENCE_PROMPT, /M91 \(by MSG91\) is designed to ring through silent mode when software or an AI agent needs a human/)
  assert.ok(!/even on silent/i.test(EXPERIENCE_PROMPT))
  assert.match(EXPERIENCE_PROMPT, /Clear enough for a 10-year-old; useful enough for an engineer\./)
  assert.match(EXPERIENCE_PROMPT, /NO NEW FACTS/)
  assert.match(buildExperiencePrompt(fakeConfig()), /At most 10 designed components/)
})

test('a good plan: one call, a valid guide with the exact post text, a guide_doc "ok"', async () => {
  const restore = quiet()
  const s = await setup()
  const ai = fakeAi([goodPlan()])
  const out = await runExperience({ briefId: BRIEF, runId: 'R-1' }, { config: s.config, store: s.store, aiSend: ai })
  restore()
  assert.equal(out.status, 'ok', out.error)
  assert.equal(ai.calls.length, 1)
  const call = ai.calls[0]
  assert.equal(call.agent, 'designer')
  assert.equal(call.jsonSchema.name, 'experience_plan')
  assert.match(call.threadId, /^experience-261021-1000-EXPD-v1-[a-z0-9]{4}$/)
  // The message carries the full parts (the Designer places them), the snippets and the catalog.
  assert.match(call.message, /\[N9\] code\n```bash\ncurl -sS/)
  assert.match(call.message, /=== SNIPPETS ===\n\[S1\] bash, 1 lines/)
  assert.match(call.message, /=== CLAIMS TO AVOID ===\n- M91 guarantees a person will answer/)
  // Every component type is in the guide, which is valid post format v1.
  assert.deepEqual([...new Set(types(out.guide))].sort(), ['approve_demo', 'comparison_table', 'faq', 'file_card', 'journey_steps', 'phone_ring_sim', 'prose', 'route_compare', 'steps_checklist', 'tool_picker', 'troubleshooting_picker'])
  const post = { slug: 'x', title: TITLE, description: '', tldr: ['a', 'b', 'c'], published_at: '2026-10-21T10:00:00+05:30', updated_at: '2026-10-21T10:00:00+05:30', topic_group: 1, tags: [], reading_time_min: 3, markdown: EVERY_BLOCK_MD, blocks: null, seo: { title_tag: '', meta_description: '', og_image: '' }, sources: [], related_slugs: [], noindex: false, canonical_url: '', brief_id: BRIEF, version: 1, guide: out.guide }
  assert.deepEqual(validatePost(post), { valid: true, errors: [] })
  // The Writer's text is copied exactly: chapter headings, steps, the flow, the code.
  assert.equal(out.guide.chapters[0].heading, 'Why approvals need one owner')
  const steps = out.guide.chapters[1].components[0].data.steps
  assert.equal(steps[0].markdown, 'Create a channel in M91.\n   What you should see: a send link.')
  assert.equal(steps[0].title, 'Create a channel')
  assert.deepEqual(steps[0].stuck, { cause_markdown: 'No send link yet.', fix_markdown: 'Create the channel first.' })
  assert.deepEqual(out.guide.chapters[2].components[0].data.moments.map((m) => [m.state, m.actor]), [['waiting', 'agent'], ['ringing', 'm91'], ['approved', 'human'], ['continuing', 'software']])
  assert.equal(out.guide.chapters[3].components[0].data.code, 'curl -sS -X POST "$M91_SEND_LINK" -d \'{"title":"Deploy 4821"}\'')
  assert.equal(out.guide.chapters[10].components[1].data.options[0].file.code, SNIPPETS[0].code)
  assert.deepEqual(out.guide.hero, { example: true, agent: 'Deploy agent', request: 'Delete 4,200 test accounts?', person: 'Aryan, on call', decision: 'approved', result: 'Accounts deleted, approved by Aryan' })
  assert.deepEqual(out.coverage, { passed: true, details: [] })
  const docs = recordsOf(s.store, 'guide_doc')
  assert.equal(docs.length, 1)
  assert.equal(docs[0].status, 'ok')
  assert.equal(docs[0].payload.repairs_used, 0)
  assert.equal((await latestGuideDoc(s.store, BRIEF, 1)).id, docs[0].id)
  assert.match(out.summary_line, /^11 chapters · 10 components: .* · checks passed$/)
})

test('coverage: a missing part fails the plan; the repair fixes it (2 calls)', async () => {
  const restore = quiet()
  const s = await setup()
  const bad = goodPlan()
  bad.chapters[7].components[0].part_ids = ['N18', 'N19'] // N20 left out
  const ai = fakeAi([bad, goodPlan()])
  const out = await runExperience({ briefId: BRIEF }, { config: s.config, store: s.store, aiSend: ai })
  restore()
  assert.equal(ai.calls.length, 2)
  assert.equal(ai.calls[1].call, 'designer_repair')
  assert.match(ai.calls[1].message, /coverage: these parts are not used: N20/)
  assert.notEqual(ai.calls[0].threadId, ai.calls[1].threadId, 'a fresh thread for every call')
  assert.equal(out.status, 'ok')
  assert.equal(out.repairs_used, 1)
})

test('coverage still failing after the repair: no guide, guide_doc "fallback", the run goes on', async () => {
  const restore = quiet()
  const s = await setup()
  const bad = goodPlan()
  bad.chapters.splice(5, 1) // drops N13–N14
  const ai = fakeAi([bad])
  const out = await runExperience({ briefId: BRIEF }, { config: s.config, store: s.store, aiSend: ai })
  restore()
  assert.equal(ai.calls.length, 2)
  assert.equal(out.status, 'fallback')
  assert.equal(out.guide, null)
  assert.match(out.error, /coverage: these parts are not used: N13, N14/)
  assert.ok(out.warnings.some((w) => /no guide, the post is shown as written/.test(w)))
  assert.equal(recordsOf(s.store, 'guide_doc')[0].status, 'fallback')
})

test('no new facts: a made-up number fails; after the repair it is dropped and its parts become prose', async () => {
  const restore = quiet()
  const s = await setup()
  const bad = () => {
    const p = goodPlan()
    p.chapters[1].components[0].stuck = [{ step: 1, cause: 'The link expires after 30 minutes.', fix: 'Create a new one.' }]
    return p
  }
  const ai = fakeAi([bad, bad])
  const out = await runExperience({ briefId: BRIEF }, { config: s.config, store: s.store, aiSend: ai })
  restore()
  assert.equal(ai.calls.length, 2)
  assert.match(ai.calls[1].message, /chapter 2 component 1 step 1 stuck cause: "30 minutes" is not in the post, the brief or M91 facts/)
  assert.equal(out.status, 'ok')
  assert.ok(!types(out.guide).includes('steps_checklist'), 'the checklist is dropped')
  assert.equal(out.guide.chapters[1].components[0].type, 'prose')
  assert.match(out.guide.chapters[1].components[0].data.markdown, /^1\. Create a channel in M91\./)
  assert.ok(out.dropped.some((d) => d.type === 'steps_checklist'))
  assert.equal(out.checks.final.length, 0)
})

test('example fields may hold made-up amounts, never URLs; claims to avoid and first person fail anywhere', () => {
  const corpus = guideCorpus({ draft: { post_markdown: EVERY_BLOCK_MD }, snippets: SNIPPETS })
  const p = (key, text, example = false) => factProblems([{ key, field: 'f', text, example }], { corpus, claimsToAvoid: ['M91 guarantees a person will answer'] })
  assert.deepEqual(p('hero', 'Refund ₹48,000 to order #1182?', true), [])
  assert.match(p('0:1', 'Refund ₹48,000 to order #1182?')[0].problem, /"₹48,000" is not in the post/)
  assert.match(p('hero', 'See https://example.com/x', true)[0].problem, /example text never has URLs/)
  assert.deepEqual(p('0:1', 'Minute 5: the next person is called.'), [], 'numbers from the post are fine')
  assert.match(p('0:1', 'We built this for you.')[0].problem, /first person/)
  assert.match(p('0:1', 'M91 guarantees a person will answer it.').map((x) => x.problem).join(' '), /too close to a claim to avoid|claim M91 does not make|absolute promise/)
  assert.match(p('0:1', 'It rings even on silent.')[0].problem, /absolute promise/)
  assert.match(p('0:1', 'Run `rm -rf /tmp/x` first.')[0].problem, /no new code/)
  assert.deepEqual(p('0:1', 'Send it with `curl -sS`.'), [], 'code from the snippets is fine')
  assert.deepEqual(p('0:1', 'Three steps, two routes.'), [])
})

test('build rules: a component that breaks its pattern is dropped and its parts stay as prose; bad ids are a problem', () => {
  const plan = goodPlan()
  plan.chapters[2].components[0].states = ['waiting', 'continuing', 'approved', 'ringing'] // wrong order
  const b = buildGuide(plan, { title: TITLE, parsed, snippets: SNIPPETS, maxComponents: 10 })
  assert.ok(b.guide)
  assert.ok(b.dropped.some((d) => d.type === 'phone_ring_sim'))
  assert.equal(b.guide.chapters[2].components[0].type, 'prose')
  assert.match(b.guide.chapters[2].components[0].data.markdown, /^1\. The agent reaches a risky step/)
  const bad = goodPlan()
  bad.chapters[0].components[0].part_ids = ['N2', 'N9']
  const b2 = buildGuide(bad, { title: TITLE, parsed, snippets: SNIPPETS })
  assert.equal(b2.guide, null)
  assert.ok(b2.problems.some((p) => /not consecutive/.test(p)))
  // Over the component limit: the extras are dropped.
  const b3 = buildGuide(goodPlan(), { title: TITLE, parsed, snippets: SNIPPETS, maxComponents: 3 })
  assert.equal(types(b3.guide).filter((t) => t !== 'prose').length, 3)
  // A wrong accent gets a safe one from the title (and a problem for the repair).
  const b4 = buildGuide({ ...goodPlan(), title_accent: 'not here' }, { title: TITLE, parsed, snippets: SNIPPETS })
  assert.ok(TITLE.includes(b4.guide.title_accent))
  assert.ok(b4.problems.some((p) => /title_accent/.test(p)))
})

test('coverage helper: missing, twice, out of order', () => {
  assert.deepEqual(checkCoverage(['N1', 'N2', 'N3'], ['N1', 'N2', 'N3']), { passed: true, details: [] })
  assert.match(checkCoverage(['N1', 'N2', 'N3'], ['N1', 'N3']).details[0], /not used: N2/)
  assert.match(checkCoverage(['N1', 'N2'], ['N1', 'N2', 'N2']).details[0], /used twice: N2/)
  assert.match(checkCoverage(['N1', 'N2'], ['N2', 'N1']).details[0], /not in the post's order/)
})

test('a failed call: no guide, the run goes on (fallback)', async () => {
  const restore = quiet()
  const s = await setup()
  const out = await runExperience({ briefId: BRIEF }, { config: s.config, store: s.store, aiSend: fakeAi([new Error('network down')]) })
  restore()
  assert.equal(out.status, 'fallback')
  assert.match(out.error, /the call failed: network down/)
  assert.match(experienceSummary(out), /^no guide/)
})
