// The promo pack, approval and "pending flows" (Phase 5 brief, Part D). No network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promoProblems } from '../../src/promo/checks.js'
import { runPromo, promoThreadId } from '../../src/promo/index.js'
import { PROMO_PROMPT, buildPromoPrompt, POST_URL } from '../../src/promo/prompts.js'
import { runPipeline } from '../../src/orchestrator.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { createNotifier } from '../../src/notify.js'
import { setSink } from '../../src/util/log.js'
import { memoryStore, fakeNotifier, fakeFetch, mockReviewer, fakeConfig } from '../helpers.js'
import { BRIEF_ID, brief, draftAnswer, config } from '../writer/fixtures.js'
import { fakeReviewerAi } from '../reviewer/fixtures.js'

const quiet = () => setSink(() => {})
const limits = { linkedinMax: 1300, xMax: 270 }
const U = POST_URL

export const goodPack = (over = {}) => ({
  linkedin_post: `Agent approval pauses a risky step until a person says yes.\nM91 rings the phone until someone answers. #AI\n${U}`,
  x_thread: ['A risky step can wait for a person.', 'The phone rings until someone answers.', `How it works: ${U}`],
  newsletter_blurb: `Agent approval pauses a risky step until a person answers a phone call and decides. ${U}`,
  video_script: [
    { on_screen_text: 'A risky step is coming', voiceover: 'Your software is about to do something risky.' },
    { on_screen_text: 'The phone rings', voiceover: 'A person answers and decides.' },
    { on_screen_text: `Read more: ${U}`, voiceover: 'Read the full post.' }
  ],
  community_question: 'Which agent actions do you make wait for a person?',
  ...over
})

test('promo checks: a good pack passes; each rule fails on its own', () => {
  assert.deepEqual(promoProblems(goodPack(), limits), [])
  const cases = [
    [{ linkedin_post: 'x'.repeat(1301) + U }, /linkedin_post is 1313 characters; the limit is 1300/],
    [{ linkedin_post: `${U} first, not last` }, /linkedin_post must end with \{\{POST_URL\}\}/],
    [{ x_thread: ['a', U] }, /x_thread has 2 posts/],
    [{ x_thread: ['a', 'y'.repeat(271), U] }, /x_thread\[2\] is 271 characters/],
    [{ x_thread: ['a', 'b', 'no link'] }, /last x_thread post must contain/],
    [{ newsletter_blurb: `${'word '.repeat(61)}${U}` }, /newsletter_blurb is 62 words/],
    [{ video_script: goodPack().video_script.slice(0, 2) }, /video_script has 2 scenes/],
    [{ video_script: [...goodPack().video_script.slice(0, 2), { on_screen_text: 'no link here', voiceover: 'v' }] }, /last video scene's on_screen_text must point/],
    [{ video_script: [{ on_screen_text: 'one two three four five six seven eight nine', voiceover: 'v' }, ...goodPack().video_script.slice(1)] }, /on_screen_text is 9 words/],
    [{ community_question: `What do you think? ${U}` }, /community_question must not contain a link/],
    [{ newsletter_blurb: `See https://example.com and ${U}` }, /newsletter_blurb has a URL other than/],
    [{ linkedin_post: `A post #a #b #c #d\n${U}` }, /linkedin_post has 4 hashtags/],
    [{ linkedin_post: `Ring ring 📞📞\n${U}` }, /linkedin_post has 2 emojis/],
    [{ linkedin_post: `Let's dive in.\n${U}` }, /linkedin_post uses banned phrase/],
    [{ newsletter_blurb: `We've seen this work. ${U}` }, /newsletter_blurb makes an experience claim/]
  ]
  for (const [over, re] of cases) {
    const p = promoProblems(goodPack(over), limits)
    assert.ok(p.some((x) => re.test(x)), `${re} in ${JSON.stringify(p)}`)
  }
})

test('promo prompt: exact D1 text, limits filled, {{POST_URL}} kept literally', () => {
  const p = buildPromoPrompt(config())
  assert.match(p, /"linkedin_post": at most 1300 characters/)
  assert.match(p, /each at most 270 characters/)
  assert.match(p, /with the exact placeholder \{\{POST_URL\}\} and no other URL/)
  assert.equal(p.split('\n').length, PROMO_PROMPT.split('\n').length)
})

function fakePromoAi(answers) {
  const requests = []
  const fn = async (opts) => {
    requests.push(opts)
    const a = answers[Math.min(requests.length - 1, answers.length - 1)]
    if (a instanceof Error) throw a
    return { content: structuredClone(a), threadId: opts.threadId, finishReason: 'completed', model: 'gpt-5-mini', ms: 3, delivery: 'sync', parseFixes: [] }
  }
  fn.requests = requests
  return fn
}

async function approvedStore() {
  const store = memoryStore()
  await store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief(), status: 'approved', version: 1 })
  await store.createRecord({ type: 'draft', briefId: BRIEF_ID, payload: { ...draftAnswer(), version: 1, brief_version: 1 }, status: 'approved', version: 1, meta: { brief_version: 1 } })
  return store
}

test('runPromo: summary inputs only (never the full post), fresh promo thread, record saved with status ok', async () => {
  const restore = quiet()
  const store = await approvedStore()
  const ai = fakePromoAi([goodPack()])
  const r = await runPromo({ briefId: BRIEF_ID }, { config: config(), store, aiSend: ai })
  restore()
  const q = ai.requests[0]
  assert.equal(q.agent, 'promo')
  assert.equal(q.call, 'promo')
  assert.match(q.threadId, /^promo-261018-1400-ABCD-v1-[a-z0-9]{4}$/)
  assert.match(q.message, /--- POST SUMMARY ---\nExplains agent approval with a phone call\.\n--- KEY POINTS ---\n- pause\n- ring\n- answer\n--- KEYWORD ---\nagent approval\n--- READER ---\nDevelopers\n--- POST URL ---\n\{\{POST_URL\}\}$/)
  assert.doesNotMatch(q.message, /## What is agent approval\?/, 'not the full post')
  assert.equal(r.status, 'ok')
  const rec = store.byType('promo_pack')[0]
  assert.equal(rec.status, 'ok')
  assert.deepEqual([rec.briefId, rec.version, rec.metadata.brief_version], [BRIEF_ID, 1, 1])
  assert.equal(rec.payload.linkedin_post, goodPack().linkedin_post)
  assert.ok(promoThreadId('B', 1) !== promoThreadId('B', 1))
})

test('runPromo: failing checks get one repair; still failing → saved "with_issues" with a warning', async () => {
  const restore = quiet()
  const store = await approvedStore()
  const bad = goodPack({ newsletter_blurb: 'No link at all.' })
  const ai = fakePromoAi([bad, bad])
  const r = await runPromo({ briefId: BRIEF_ID }, { config: config(), store, aiSend: ai })
  restore()
  assert.deepEqual(ai.requests.map((q) => q.call), ['promo', 'promo_repair'])
  assert.match(ai.requests[1].message, /--- PROBLEMS FOUND BY THE CHECKER ---\n- newsletter_blurb must end with \{\{POST_URL\}\}/)
  assert.equal(r.status, 'with_issues')
  assert.equal(store.byType('promo_pack')[0].status, 'with_issues')
  assert.ok(r.warnings.some((w) => /promo pack saved with issues/.test(w)))
  const fixed = fakePromoAi([bad, goodPack()])
  const ok = await runPromo({ briefId: BRIEF_ID }, { config: config(), store: await approvedStore(), aiSend: fixed })
  assert.equal(ok.status, 'ok')
  assert.equal(ok.repairs_used, 1)
})

test('runPromo in DRY_RUN: uses the in-memory approved draft; nothing saved', async () => {
  const restore = quiet()
  const store = memoryStore({ dryRun: true })
  const r = await runPromo({ briefId: BRIEF_ID, draft: { ...draftAnswer(), version: 2, brief_version: 1 }, brief: brief() }, { config: config({ DRY_RUN: 'true' }), store, aiSend: fakePromoAi([goodPack()]) })
  restore()
  assert.equal(r.version, 2)
  assert.match(r.record_id, /^dryrun-/)
  assert.equal(store.byType('promo_pack').length, 0)
})

test('approval: a failing promo pack never blocks it (warning); statuses approved; run summary "approved (v1, score 90)"', async () => {
  const restore = quiet()
  const store = memoryStore()
  const agents = { ...stubAgents, reviewer: mockReviewer(), promo: async () => { throw new Error('promo model down') } }
  const r = await runPipeline({ config: fakeConfig(), store, notifier: fakeNotifier(), agents })
  restore()
  assert.equal(r.state, 'approved')
  assert.equal(r.summary, 'approved (v1, score 90)')
  assert.ok(r.warnings.some((w) => /promo pack failed \(approval stands\): promo model down/.test(w)))
  assert.equal(store.byType('brief')[0].status, 'approved')
})

test('pending flows: with empty webhook URLs the approval Slack lines and the failure alert are skipped and reported, nothing sent', async () => {
  const restore = quiet()
  const fetch = fakeFetch(() => ({ body: {} }))
  const cfg = fakeConfig({ SLACK_POST_WEBHOOK_URL: '', M91_ALERT_WEBHOOK_URL: '' })
  const notifier = createNotifier({ config: cfg, fetch })
  const ok = await runPipeline({ config: cfg, store: memoryStore(), notifier, agents: { ...stubAgents, reviewer: mockReviewer() } })
  assert.equal(ok.state, 'approved')
  assert.ok(ok.warnings.some((w) => /Slack message skipped: pending flows \(SLACK_POST_WEBHOOK_URL is empty\)/.test(w)))
  const failed = await runPipeline({ config: fakeConfig({ SLACK_POST_WEBHOOK_URL: '', M91_ALERT_WEBHOOK_URL: '', MAX_WRITER_REVISIONS: '0' }), store: memoryStore(), notifier: createNotifier({ config: fakeConfig({ SLACK_POST_WEBHOOK_URL: '', M91_ALERT_WEBHOOK_URL: '' }), fetch }), agents: { ...stubAgents, reviewer: mockReviewer(['fail']) } })
  restore()
  assert.equal(failed.state, 'failed')
  assert.ok(failed.warnings.some((w) => /M91 alert skipped: pending flows \(M91_ALERT_WEBHOOK_URL is empty\)/.test(w)))
  assert.equal(fetch.calls.length, 0)
})

test('a real Reviewer pass in the loop runs the real promo step after it (fake AIs), and the promo step is in the run steps', async () => {
  const restore = quiet()
  const { defaultAgents } = await import('../../src/orchestrator.js')
  const { reviewAnswer } = await import('../reviewer/fixtures.js')
  const cfg = config({ DRY_RUN: 'true' })
  const store = memoryStore({ dryRun: true })
  const reviewerAi = fakeReviewerAi([reviewAnswer()])
  const promoAi = fakePromoAi([goodPack()])
  const aiSend = (opts) => (opts.agent === 'reviewer' ? reviewerAi(opts) : promoAi(opts))
  const agents = { ...defaultAgents({ config: cfg, store, notifier: fakeNotifier(), agentDeps: { aiSend } }), scout: stubAgents.scout, strategist: stubAgents.strategist, writer: async () => ({ model: 'm', output: { record_id: 'dryrun-9', version: 1, brief_version: 1, title: 'T', draft: { ...draftAnswer(), checks: { hard_passed: true, results: [] } } } }) }
  const r = await runPipeline({ config: cfg, store, notifier: fakeNotifier(), agents, briefId: BRIEF_ID })
  restore()
  assert.equal(r.state, 'approved', r.error)
  assert.deepEqual(r.steps.map((x) => x.agent), ['scout', 'strategist', 'writer', 'reviewer', 'promo', 'orchestrator'])
  assert.equal(promoAi.requests.length, 1)
})
