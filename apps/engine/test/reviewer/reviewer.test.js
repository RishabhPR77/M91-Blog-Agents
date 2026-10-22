// The Reviewer (Phase 5 brief, Part B): decide rules and runReviewer with a mocked AI and store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, computeTotal, passRule, quoteFound, WEIGHTS, reviewSummaryLine } from '../../src/reviewer/decide.js'
import { reviewSchemaErrors, GATE_IDS, AREA_IDS } from '../../src/reviewer/schemas.js'
import { REVIEWER_PROMPT, buildReviewerPrompt } from '../../src/reviewer/prompts.js'
import { runReviewer, reviewerThreadId } from '../../src/reviewer/index.js'
import { buildReviewerMessage } from '../../src/reviewer/inputs.js'
import { setSink } from '../../src/util/log.js'
import { memoryStore } from '../helpers.js'
import { config, reviewAnswer, item, fakeReviewerAi, savedDraft, BRIEF_ID, brief, GOOD_MD } from './fixtures.js'

const quiet = () => setSink(() => {})
const cfg = config()
const ctx = (over = {}) => ({ markdown: GOOD_MD, checkResults: savedDraft().checks.results, config: cfg, ...over })
const areasAll = (n) => AREA_IDS.map((id) => ({ id, score: n }))

test('weights add up to 100; total = Σ(score/10 × weight), 1 decimal', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100)
  assert.equal(computeTotal(areasAll(10)), 100)
  assert.equal(computeTotal(areasAll(8)), 80)
  const mixed = AREA_IDS.map((id) => ({ id, score: ['answers_question', 'simplicity', 'accuracy', 'to_the_point'].includes(id) ? 9 : 8 }))
  assert.equal(computeTotal(mixed), 86, 'Phase 12: those four weigh 60 (15 + 20 + 15 + 10)')
})

test('Phase 12 weights: simplicity 20 and to_the_point 15 (structure, tone, originality 5; seo 10); with the Experience Designer, experience 10', async () => {
  const { LEGACY_WEIGHTS } = await import('../../src/reviewer/decide.js')
  assert.deepEqual({ ...LEGACY_WEIGHTS }, { answers_question: 15, simplicity: 20, accuracy: 15, seo: 10, structure: 5, tone: 5, originality: 5, ai_answer_readiness: 5, to_the_point: 15, m91_fit_cta: 5 })
  assert.equal(Object.values(LEGACY_WEIGHTS).reduce((a, b) => a + b, 0), 100)
  assert.deepEqual([WEIGHTS.simplicity, WEIGHTS.to_the_point, WEIGHTS.seo, WEIGHTS.experience], [20, 10, 5, 10])
})

test('pass rule edges: 79.9 fails, 80.0 passes (PASS_SCORE_MIN=80, Phase 9); 84.9 fails at 85; one area at 6 fails; a failed AI gate fails; a failed code gate fails even with 95', () => {
  const gates = [...GATE_IDS, 'checks_hard_passed', 'sources_contradicted'].map((id) => ({ id, passed: true }))
  const g = cfg.gates
  assert.equal(g.passScoreMin, 80)
  assert.equal(passRule({ gates, areas: areasAll(9), total: 79.9 }, g), false)
  assert.equal(passRule({ gates, areas: areasAll(9), total: 80.0 }, g), true)
  const g85 = { ...g, passScoreMin: 85 }
  assert.equal(passRule({ gates, areas: areasAll(9), total: 84.9 }, g85), false)
  assert.equal(passRule({ gates, areas: areasAll(9), total: 85.0 }, g85), true)
  // PASS_AREA_MIN=6 (the default since 2026-10-21): an area at 6 passes, at 5 fails; with 7, an area at 6 fails.
  assert.equal(g.passAreaMin, 6)
  assert.equal(passRule({ gates, areas: [...areasAll(10).slice(1), { id: 'answers_question', score: 6 }], total: 94 }, g), true)
  assert.equal(passRule({ gates, areas: [...areasAll(10).slice(1), { id: 'answers_question', score: 5 }], total: 94 }, g), false)
  assert.equal(passRule({ gates, areas: [...areasAll(10).slice(1), { id: 'answers_question', score: 6 }], total: 94 }, { ...g, passAreaMin: 7 }), false)

  const failedGate = decide(reviewAnswer({ scores: {}, gates: { no_invented_content: false } }), ctx())
  assert.equal(failedGate.pass, false)
  const codeGate = decide(reviewAnswer({ scores: Object.fromEntries(AREA_IDS.map((id) => [id, 10])) }), ctx({ checkResults: savedDraft({ hardFail: true }).checks.results }))
  assert.equal(codeGate.total, 100)
  assert.equal(codeGate.pass, false)
  assert.match(codeGate.gates.find((x) => x.id === 'checks_hard_passed').evidence, /ai_written_code/)
  const contradicted = decide(reviewAnswer({ sources: [{ url: 'https://m91.msg91.com/llms.txt', claim: 'rings until answered', verdict: 'contradicts' }] }), ctx())
  assert.equal(contradicted.gates.find((x) => x.id === 'sources_contradicted').passed, false)
  assert.equal(contradicted.pass, false)
  assert.equal(contradicted.gates.length, 11, '9 AI gates (Phase 10: no_new_facts_in_design) + 2 code gates')
})

test('consistency rules: a fail with no "must" item gets generic ones; a pass with "must" items downgrades them', () => {
  const failNoMust = decide(reviewAnswer({ scores: { simplicity: 5 }, feedback: [item()] }), ctx())
  assert.equal(failNoMust.pass, false)
  const gen = failNoMust.feedback.filter((f) => f.generated)
  assert.deepEqual(gen.map((f) => [f.area, f.severity, f.send_to]), [['simplicity', 'must', 'writer']])
  assert.equal(failNoMust.feedback[0].severity, 'must', '"must" items first')
  assert.ok(failNoMust.warnings.some((w) => /generic "must" items/.test(w)))

  const passWithMust = decide(reviewAnswer({ feedback: [item({ severity: 'must' })] }), ctx())
  assert.equal(passWithMust.pass, true)
  assert.deepEqual(passWithMust.feedback.map((f) => f.severity), ['should'])
  assert.match(reviewSummaryLine(passWithMust), /^Score 90\/100 · pass · gates 11\/11 · 1 should-fix item$/)
  assert.match(reviewSummaryLine(failNoMust), /^Score \d+(\.\d)?\/100 · fail · simplicity 5 → writer$/)
})

test('quotes: found despite Markdown, quote marks, spacing and case; marked quote_found false otherwise', () => {
  assert.equal(quoteFound(GOOD_MD, 'You can read how one framework handles it.'), true, 'link markup ignored')
  assert.equal(quoteFound(GOOD_MD, '“If you approve”, the software   runs the step.'), false)
  assert.equal(quoteFound(GOOD_MD, 'if you approve, the software runs the step.'), true, 'bold and case ignored')
  assert.equal(quoteFound(GOOD_MD, ''), false)
  const d = decide(reviewAnswer({ feedback: [item(), item({ quote: 'A sentence that is not in the post.' })] }), ctx())
  assert.deepEqual(d.feedback.map((f) => f.quote_found), [true, false])
  assert.ok(d.warnings.some((w) => /1 feedback quote\(s\) not found/.test(w)))
})

test('route hint from "must" items: strategist, then scout with claims, then writer; claims only kept for scout items', () => {
  const low = { scores: { accuracy: 5 } }
  assert.equal(decide(reviewAnswer({ ...low, feedback: [item({ severity: 'must' }), item({ severity: 'must', send_to: 'strategist' })] }), ctx()).route_hint, 'strategist')
  assert.equal(decide(reviewAnswer({ ...low, feedback: [item({ severity: 'must', send_to: 'scout', claims: ['x'] })] }), ctx()).route_hint, 'scout')
  const w = decide(reviewAnswer({ ...low, feedback: [item({ severity: 'must', claims: ['ignored'] })] }), ctx())
  assert.equal(w.route_hint, 'writer')
  assert.deepEqual(w.feedback[0].claims, [])
})

test('web limit (A2): a source check outside ALLOWED URLS is dropped and never trips sources_contradicted; too many checks warn', () => {
  const allowed = new Set(['https://m91.msg91.com/llms.txt'])
  const sources = [
    { url: 'https://m91.msg91.com', claim: 'The CTA URL is reachable.', verdict: 'contradicts' },
    { url: 'https://m91.msg91.com/llms.txt', claim: 'rings until answered', verdict: 'supports' }
  ]
  const d = decide(reviewAnswer({ sources }), ctx({ allowedUrls: allowed }))
  assert.deepEqual(d.sources_checked.map((x) => x.url), ['https://m91.msg91.com/llms.txt'])
  assert.equal(d.gates.find((g) => g.id === 'sources_contradicted').passed, true)
  assert.equal(d.pass, true)
  assert.ok(d.warnings.some((w) => w.includes('dropped 1 source check(s) of URL(s) outside ALLOWED URLS: https://m91.msg91.com (contradicts)')), d.warnings.join(' | '))
  // An allowed source that contradicts still fails the gate.
  const bad = decide(reviewAnswer({ sources: [{ ...sources[1], verdict: 'contradicts' }] }), ctx({ allowedUrls: allowed }))
  assert.equal(bad.gates.find((g) => g.id === 'sources_contradicted').passed, false)
  const many = Array.from({ length: 6 }, (_, i) => ({ url: `https://m91.msg91.com/p${i}`, claim: 'c', verdict: 'supports' }))
  assert.ok(decide(reviewAnswer({ sources: many }), ctx()).warnings.some((w) => /checked 6 sources; REVIEWER_MAX_SOURCE_CHECKS is 5/.test(w)))
})

test('prompt: links in the post outside ALLOWED URLS are reported, not opened', () => {
  assert.ok(buildReviewerPrompt(cfg).includes('Do not open any other page.\nIf a link in the post is not in ALLOWED URLS, do not open it; report it as a "must" feedback item instead.\n'))
})

test('schema: exactly one entry per gate and area id', () => {
  assert.deepEqual(reviewSchemaErrors(reviewAnswer()), [])
  const a = reviewAnswer()
  a.gates.pop()
  a.areas.push({ id: 'seo', score: 5, evidence: 'x' })
  assert.deepEqual(reviewSchemaErrors(a), ['missing gate id(s): no_new_facts_in_design', 'duplicate area id(s): seo'])
  assert.match(reviewSchemaErrors({ gates: [] })[0], /must have required property/)
})

test('prompt: exact B5 text with the limits filled in', () => {
  const p = buildReviewerPrompt(cfg)
  assert.ok(p.startsWith("You are the Reviewer for M91's blog: the strict, final check before a post is approved."))
  assert.match(p, /at most 5 of them, to verify the claims/)
  assert.match(p, /List at most 8 items, "must" items first\./)
  assert.match(p, /Add up to 3 general lessons/)
  assert.ok(!/\{\{/.test(p))
  // The Phase 10 design gate and area are two more lines; with EXPERIENCE_ENABLED=false the text is the pre-Phase-10 one.
  assert.equal(p.split('\n').length, REVIEWER_PROMPT.split('\n').length + 2)
  const legacy = buildReviewerPrompt(config({ EXPERIENCE_ENABLED: 'false' }))
  assert.equal(legacy.split('\n').length, REVIEWER_PROMPT.split('\n').length)
  assert.ok(!/no_new_facts_in_design|- experience:|"designer"|GUIDE/.test(legacy))
})

async function setup({ answers, draftOver = {}, env = {}, seedReview } = {}) {
  const c = config(env)
  const store = memoryStore()
  await store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief(), status: 'drafted', version: 1 })
  await store.createRecord({ type: 'm91_facts', payload: { can: [{ fact: 'Rings every phone in a channel until someone answers.', source_url: 'https://m91.msg91.com/llms.txt' }], cannot: [], integrations: [] }, status: 'current', date: '2026-10-19' })
  const d = savedDraft(draftOver)
  await store.createRecord({ type: 'draft', briefId: BRIEF_ID, payload: d, status: 'drafted', version: d.version, meta: { brief_version: d.brief_version } })
  if (seedReview) await store.createRecord({ type: 'review', briefId: BRIEF_ID, payload: seedReview, status: 'fail', version: seedReview.version, meta: { brief_version: 1 } })
  if (c.runtime.dryRun) store.setDryRun(true)
  const ai = fakeReviewerAi(answers ?? [reviewAnswer()])
  return { store, ai, run: (params = {}) => runReviewer({ briefId: BRIEF_ID, runId: 'R-1', ...params }, { config: c, store, aiSend: ai }) }
}

test('runReviewer: one call on a fresh reviewer thread, inputs in B3 order, review record saved with code gates and total', async () => {
  const restore = quiet()
  const s = await setup()
  const r = await s.run()
  restore()
  assert.equal(s.ai.requests.length, 1)
  const q = s.ai.requests[0]
  assert.equal(q.agent, 'reviewer')
  assert.equal(q.call, 'review')
  assert.match(q.threadId, /^reviewer-261018-1400-ABCD-v1-[a-z0-9]{4}$/)
  assert.equal(q.jsonSchema.name, 'reviewer_result')
  const order = [...q.message.matchAll(/^--- ([A-Z0-9 ]+) ---$/gm)].map((m) => m[1])
  assert.deepEqual(order, ['POST', 'BRIEF', 'CHECK RESULTS', 'M91 FACTS', 'ALLOWED URLS', 'TONE NOTES'])
  assert.match(q.message, /--- CHECK RESULTS ---\n\[\{"id":"cta_exact","passed":true,"severity":"hard","value":1,"detail":"ok"\}/)
  // No docs links in posts: the docs URL is not an allowed link; M91's main site is.
  const allowedSection = q.message.split('--- ALLOWED URLS ---\n')[1].split('\n--- ')[0]
  assert.ok(!allowedSection.includes('llms.txt'), allowedSection)
  assert.match(allowedSection, /- https:\/\/m91\.msg91\.com\/ \(M91's main site/)
  assert.equal(r.pass, true)
  assert.equal(r.total, 90)
  assert.equal(r.gates.length, 11)
  const rec = s.store.byType('review')[0]
  assert.equal(rec.status, 'pass')
  assert.deepEqual([rec.metadata.brief_version, rec.metadata.pass, rec.metadata.total, rec.version], [1, true, 90, 1])
  for (const k of ['gates', 'areas', 'total', 'pass', 'feedback', 'fixed_previous', 'sources_checked', 'lessons', 'summary', 'model_used', 'ms', 'repairs_used']) assert.ok(k in rec.payload, k)
  assert.ok(reviewerThreadId('B', 2) !== reviewerThreadId('B', 2), 'never reused')
})

test('runReviewer: a missing gate id gets one repair call; still invalid after AI_MAX_RETRIES fails', async () => {
  const restore = quiet()
  const bad = reviewAnswer()
  bad.gates = bad.gates.slice(1)
  const s = await setup({ answers: [bad, reviewAnswer()] })
  const r = await s.run()
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['review', 'review_repair'])
  assert.match(s.ai.requests[1].message, /Your answer had these problems: missing gate id\(s\): m91_claims_correct\. Return a corrected answer\.$/)
  assert.notEqual(s.ai.requests[0].threadId, s.ai.requests[1].threadId)
  assert.equal(r.repairs_used, 1)
  const never = await setup({ answers: [bad] })
  await assert.rejects(never.run(), /no valid review after/)
  restore()
  assert.equal(never.ai.requests.length, 1 + 1 + cfg.viasocket.maxRetries)
})

test('runReviewer: more than half the quotes not found → one repair asking for exact quotes', async () => {
  const restore = quiet()
  const vague = reviewAnswer({ feedback: [item({ quote: 'Not in the post at all.' }), item({ quote: 'Neither is this.' }), item()] })
  const exact = reviewAnswer({ feedback: [item(), item({ quote: 'Start with one small, risky action.' })] })
  const s = await setup({ answers: [vague, exact] })
  const r = await s.run()
  restore()
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['review', 'review_repair'])
  assert.match(s.ai.requests[1].message, /not exact words from POST: "Not in the post at all\.", "Neither is this\."/)
  assert.deepEqual(r.feedback.map((f) => f.quote_found), [true, true])
})

test('runReviewer: version 2 gets PREVIOUS REVIEW (old feedback + revision notes); strictness on a with-issues draft', async () => {
  const restore = quiet()
  const prev = { version: 1, brief_version: 1, feedback: [item({ severity: 'must', quote: 'A ringing phone gets attention fast.' })] }
  const s = await setup({ draftOver: { version: 2, hardFail: true, revisionNotes: [{ feedback_quote: 'A ringing phone gets attention fast.', what_changed: 'shorter' }] }, seedReview: prev })
  const r = await s.run()
  restore()
  assert.match(s.ai.requests[0].message, /--- PREVIOUS REVIEW ---\n\{"feedback":\[\{"area":"simplicity","quote":"A ringing phone gets attention fast\."[^\n]*"revision_notes":\[\{"feedback_quote":"A ringing phone gets attention fast\.","what_changed":"shorter"\}\]\}/)
  assert.equal(r.pass, false, 'checks_hard_passed fails even with 90 points')
  assert.ok(r.feedback.some((f) => f.severity === 'must' && f.area === 'checks_hard_passed'))
  assert.match(r.summary_line, /^Score 90\/100 · fail · checks_hard_passed → writer$/)
})

test('runReviewer in DRY_RUN: reviews the in-memory draft and brief; the review is not saved', async () => {
  const restore = quiet()
  const c = config({ DRY_RUN: 'true' })
  const store = memoryStore({ dryRun: true })
  const ai = fakeReviewerAi([reviewAnswer()])
  const r = await runReviewer({ briefId: BRIEF_ID, draft: savedDraft(), brief: brief() }, { config: c, store, aiSend: ai })
  restore()
  assert.equal(r.pass, true)
  assert.match(r.record_id, /^dryrun-/)
  assert.equal([...store.records.values()].filter((x) => x.type === 'review').length, 0)
})

test('message guard: the source pack is trimmed first to stay under 50,000 characters', () => {
  const { message, trimmed } = buildReviewerMessage({ post: 'p', brief: '{}', checks: '[]', facts: '{}', allowedUrls: '- x', sourcePack: 'y'.repeat(60000), tone: 't' })
  assert.ok(message.length <= 50000)
  assert.deepEqual(trimmed, ['source pack'])
})

test('the Reviewer prompt uses PASS_AREA_MIN for the publishing minimum and for "must" items', () => {
  const p6 = buildReviewerPrompt(cfg)
  assert.ok(p6.includes('6 = acceptable minimum for publishing;'))
  assert.ok(p6.includes('if it causes a failed gate or an area below 6;'))
  const p7 = buildReviewerPrompt(config({ PASS_AREA_MIN: '7' }))
  assert.ok(p7.includes('7 = acceptable minimum for publishing;') && p7.includes('an area below 7;'))
  assert.ok(!p6.includes('{{'), 'every placeholder filled')
})

// ---------- Phase 10 C4: the Reviewer reviews the guide ----------

const GUIDE = {
  version: 1, title_accent: 'phone call',
  hero: { example: true, agent: 'Refund bot', request: 'Refund order #1182?', person: 'Asha (on call)', decision: 'approved', result: 'Refund sent' },
  status_states: ['waiting', 'ringing', 'approved', 'continuing'],
  chapters: [{ id: 'c1', number: 1, label: 'The problem', heading: 'Why a phone call', intro_markdown: 'Start here.', components: [
    { type: 'prose', id: 'p1', data: { markdown: 'x', part_ids: ['N1', 'N2'] } },
    { type: 'approve_demo', id: 'd1', data: { example: true, request: 'Your agent wants to refund order #1182', approve: { label: 'Approve', outcome_markdown: 'The refund goes out.' }, reject: { label: 'Reject', outcome_markdown: 'Nothing happens.' } } }
  ] }],
  faq: [], your_turn: { title: 'Try it on one risky step' }
}

test('C4 decide: no guide → experience scored as structure and no_new_facts_in_design passes (code); with a guide the AI scores count', () => {
  const answer = reviewAnswer({ scores: { structure: 8, experience: 4 }, gates: { no_new_facts_in_design: false } })
  const plain = decide(answer, ctx())
  assert.deepEqual(plain.areas.find((a) => a.id === 'experience'), { id: 'experience', score: 8, evidence: 'no guide: scored as structure', source: 'code' })
  assert.equal(plain.gates.find((g) => g.id === 'no_new_facts_in_design').passed, true)
  const guided = decide(answer, ctx({ guide: GUIDE, guideText: 'Your agent wants to refund order #1182' }))
  assert.equal(guided.areas.find((a) => a.id === 'experience').score, 4)
  assert.equal(guided.gates.find((g) => g.id === 'no_new_facts_in_design').passed, false)
  assert.equal(guided.pass, false, 'a failed design gate fails the review')
  assert.equal(WEIGHTS.experience, 10)
})

test('C4 decide: feedback may quote the guide text; design-only "must" items give route_hint "designer"', () => {
  const fb = [item({ quote: 'Your agent wants to refund order #1182', severity: 'must', send_to: 'designer', area: 'experience' })]
  const d = decide(reviewAnswer({ scores: { experience: 5 }, feedback: fb }), ctx({ guide: GUIDE, guideText: 'Your agent wants to refund order #1182' }))
  assert.equal(d.feedback[0].quote_found, true)
  assert.equal(d.route_hint, 'designer')
  const mixed = decide(reviewAnswer({ scores: { experience: 5 }, feedback: [...fb, item({ severity: 'must' })] }), ctx({ guide: GUIDE, guideText: 'Your agent wants to refund order #1182' }))
  assert.equal(mixed.route_hint, 'writer')
})

test('C4 prompt and schema: the new gate, the experience area and send_to "designer"', () => {
  assert.ok(GATE_IDS.includes('no_new_facts_in_design') && AREA_IDS.includes('experience'))
  const p = buildReviewerPrompt(cfg)
  assert.match(p, /- no_new_facts_in_design: the text in GUIDE/)
  assert.match(p, /- experience: each interactive part in GUIDE helps the reader/)
  assert.match(p, /"send_to": "designer" when only the GUIDE's own text/)
})

test('Phase 11: EXPERIENCE_ENABLED=false reviews with the pre-Phase-10 gates, areas, weights and routes', async () => {
  const { reviewerIds, reviewerResultSchema, reviewSchemaErrors } = await import('../../src/reviewer/schemas.js')
  const { weightsFor, LEGACY_WEIGHTS, decide } = await import('../../src/reviewer/decide.js')
  const legacy = reviewerIds(false)
  assert.ok(!legacy.gates.includes('no_new_facts_in_design') && !legacy.areas.includes('experience') && !legacy.sendTo.includes('designer'))
  assert.deepEqual(weightsFor(false), LEGACY_WEIGHTS)
  assert.equal(Object.values(LEGACY_WEIGHTS).reduce((a, b) => a + b, 0), 100)
  assert.equal(Object.values(weightsFor(true)).reduce((a, b) => a + b, 0), 100)
  assert.ok(!JSON.stringify(reviewerResultSchema(false)).includes('designer'))
  // An answer with the legacy ids is valid in legacy mode only; a Phase 10 answer is not valid in legacy mode.
  const answer = (design) => ({
    gates: reviewerIds(design).gates.map((id) => ({ id, passed: true, evidence: 'ok' })),
    areas: reviewerIds(design).areas.map((id) => ({ id, score: 8, evidence: 'ok' })),
    feedback: [], fixed_previous: [], sources_checked: [], lessons: [], summary: 'Good.'
  })
  assert.deepEqual(reviewSchemaErrors(answer(false), false), [])
  assert.ok(reviewSchemaErrors(answer(false), true).length > 0)
  assert.ok(reviewSchemaErrors(answer(true), false).length > 0)
  const off = config({ EXPERIENCE_ENABLED: 'false' })
  const d = decide(answer(false), { markdown: 'x', config: off })
  assert.equal(d.total, 80)
  assert.ok(!d.areas.some((a) => a.id === 'experience') && !d.gates.some((g) => g.id === 'no_new_facts_in_design'))
})

test('C4 runReviewer: a guide adds a GUIDE section after POST (designer text only, Writer text pointed to); guide_reviewed is saved', async () => {
  const restore = quiet()
  const s = await setup()
  await s.run({ guideDoc: GUIDE })
  restore()
  const q = s.ai.requests[0]
  const order = [...q.message.matchAll(/^--- ([A-Z0-9 ]+) ---$/gm)].map((m) => m[1])
  assert.deepEqual(order.slice(0, 3), ['POST', 'GUIDE', 'BRIEF'])
  const guide = JSON.parse(q.message.match(/--- GUIDE ---\n(.+)\n/)[1])
  assert.deepEqual(guide.chapters[0].components[0], { type: 'prose', writer_parts: 'N1–N2' })
  assert.equal(guide.chapters[0].components[1].request, 'Your agent wants to refund order #1182')
  assert.equal(s.store.byType('review')[0].payload.guide_reviewed, true)
  // Without a guide (null): no GUIDE section, guide_reviewed false.
  const restore2 = quiet()
  const p = await setup()
  await p.run({ guideDoc: null })
  restore2()
  assert.ok(!/--- GUIDE ---/.test(p.ai.requests[0].message))
  assert.equal(p.store.byType('review')[0].payload.guide_reviewed, false)
})
