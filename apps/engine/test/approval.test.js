// The human approval gate (Phase 5.5, Part B): approve, human_revise, reject_topic. Mocked AI and Mem0.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRunManager } from '../src/runs.js'
import { defaultAgents } from '../src/orchestrator.js'
import { stubAgents } from '../src/agents/stubs.js'
import { replay, resetEvents } from '../src/events.js'
import { createNotifier } from '../src/notify.js'
import { humanFeedbackItems, NOT_REVIEWED_MESSAGE } from '../src/approval.js'
import { setSink } from '../src/util/log.js'
import { memoryStore, fakeNotifier, fakeFetch, mockReviewer } from './helpers.js'
import { NOW, BRIEF_ID, config, brief, draftAnswer, fakeAi, okChecker, GOOD_MD } from './writer/fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const now = () => NOW
const recordsOf = (store, type) => [...store.records.values()].filter((r) => r.type === type)

/** A brief whose v1 draft waits for the human, its cluster lead, and a run manager (fake Writer AI, mock Reviewer, stub promo). */
/** reviewed: 'pass' | 'fail' | null — the review record of v1; hardPassed: v1's hard content checks (null = no results). */
async function setup({ env = {}, reviewer = mockReviewer(), writerAnswers = {}, notifier = fakeNotifier(), draftStatus = 'awaiting_human', reviewed = 'pass', hardPassed = true } = {}) {
  const cfg = config(env)
  const store = memoryStore()
  await store.createRecord({ type: 'question_cluster', payload: { cluster_id: 'C-1', main_question: 'How does agent approval work?' }, status: 'used' })
  await store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief(), status: 'awaiting_human', version: 1 })
  const d = { ...draftAnswer(), brief_id: BRIEF_ID, version: 1, brief_version: 1, ...(hardPassed !== null && { checks: { hard_passed: hardPassed, results: [] } }) }
  const draft = await store.createRecord({ type: 'draft', briefId: BRIEF_ID, payload: d, status: draftStatus, version: 1, meta: { brief_version: 1, review_total: 88 } })
  if (reviewed) await store.createRecord({ type: 'review', briefId: BRIEF_ID, payload: { brief_id: BRIEF_ID, version: 1, brief_version: 1, pass: reviewed === 'pass', total: reviewed === 'pass' ? 88 : 70, feedback: [] }, status: reviewed, version: 1, meta: { brief_version: 1 } })
  const ai = fakeAi(writerAnswers)
  const manager = createRunManager({
    config: cfg,
    storeFactory: () => store,
    notifierFactory: () => notifier,
    agentsFactory: (rc, { store: st, notifier: nt }) => ({
      ...defaultAgents({ config: rc, store: st, notifier: nt, agentDeps: { aiSend: ai, urlChecker: okChecker(), now } }),
      reviewer,
      promo: stubAgents.promo
    })
  })
  const run = async (mode, params = {}) => {
    const { run_id } = await manager.startRun({ mode, params: { brief_id: BRIEF_ID, ...params } })
    return { run_id, ...(await manager.wait(run_id)) }
  }
  return { cfg, store, ai, manager, notifier, draft, run }
}

test('approve: statuses approved (by human, with time), promo pack, placeholder Designer and Publisher steps, Slack, approval.approved', async () => {
  const restore = quiet()
  const s = await setup()
  const r = await s.run('approve')
  restore()
  assert.equal(r.status, 'succeeded')
  assert.equal(r.run.result_summary, 'approved by you (v1, score 88)')
  assert.deepEqual(r.run.steps.map((x) => [x.name, x.status, x.summary]), [
    ['promo', 'succeeded', 'Promo pack ok: LinkedIn 65 chars · X thread 3 posts · 3 video scenes · 0 issue(s)'],
    ['designer', 'succeeded', 'Designer: not built yet (Phase 8)'],
    ['publisher', 'succeeded', 'Publishing is off (AUTO_PUBLISH=false): use Publish in the dashboard']
  ])
  const d = s.store.records.get(s.draft.id)
  assert.equal(d.status, 'approved')
  assert.equal(d.metadata.approved_by, 'human')
  assert.ok(d.metadata.approved_at)
  assert.equal(recordsOf(s.store, 'brief')[0].status, 'approved')
  assert.equal(s.notifier.sent.slack[0], '✅ Approved by you: *How agent approval works with a phone call* · v1')
  assert.match(s.notifier.sent.slack[1], /^Promo pack preview \(ok\):\n\nLinkedIn:\n/)
  assert.deepEqual(replay(r.run_id).find((e) => e.type === 'approval.approved').data, { brief_id: BRIEF_ID, version: 1, total: 88, approved_unreviewed: false })
  assert.ok(!JSON.stringify(replay(r.run_id)).includes('A pause keeps a person in charge'), 'no post text in events')
})

test('approve with the real notifier: skipped in DRY_RUN, and "pending flows" with empty webhook URLs — nothing sent', async () => {
  const restore = quiet()
  const fetch = fakeFetch(() => ({ body: {} }))
  const dry = await setup({ env: { DRY_RUN: 'false' }, notifier: createNotifier({ config: config({ DRY_RUN: 'true' }), fetch }) })
  assert.equal((await dry.run('approve')).status, 'succeeded')
  const pending = await setup({ notifier: createNotifier({ config: config({ SLACK_POST_WEBHOOK_URL: '' }), fetch }) })
  const r = await pending.run('approve')
  restore()
  assert.ok(r.run.warnings.some((w) => /Slack message skipped: pending flows \(SLACK_POST_WEBHOOK_URL is empty\)/.test(w)))
  assert.equal(fetch.calls.length, 0)
})

test('human_revise: draft → changes_requested with human_feedback; Writer revises with source "human" items; re-reviewed → awaiting_human', async () => {
  const restore = quiet()
  const reviewer = mockReviewer(['pass'])
  const s = await setup({ reviewer, writerAnswers: { revise: draftAnswer({ revision_notes: [{ feedback_quote: 'A ringing phone gets attention fast.', what_changed: 'shortened the first paragraph' }] }) } })
  const quote = 'A ringing phone gets attention fast.'
  const r = await s.run('human_revise', { feedback: 'Make the first paragraph shorter and explain webhook in plain words.', quotes: [quote] })
  restore()
  assert.equal(r.status, 'succeeded', r.run.result_summary)
  assert.equal(r.run.result_summary, 'awaiting human approval (v2, score 90)')
  const old = s.store.records.get(s.draft.id)
  assert.equal(old.status, 'changes_requested')
  assert.deepEqual([old.payload.human_feedback.text, old.payload.human_feedback.quotes], ['Make the first paragraph shorter and explain webhook in plain words.', [quote]])
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['revise'])
  const msg = s.ai.requests[0].message
  assert.match(msg, /--- FEEDBACK ---\n\[\{"source":"human","area":"human","quote":"A ringing phone gets attention fast\.","problem":"Make the first paragraph shorter/)
  assert.match(msg, /--- QUOTED EXCERPTS ---\n- "A ringing phone gets attention fast\." → A ringing phone gets attention fast\./)
  assert.match(s.ai.requests[0].prompt, /Feedback from "human" comes from the editor: follow it closely\./)
  assert.equal(reviewer.count(), 1, 're-reviewed')
  const v2 = recordsOf(s.store, 'draft').find((d) => d.version === 2)
  assert.equal(v2.status, 'awaiting_human')
  assert.deepEqual(v2.payload.revision_notes, [{ feedback_quote: 'A ringing phone gets attention fast.', what_changed: 'shortened the first paragraph' }])
  const ev = replay(r.run_id)
  assert.deepEqual(ev.find((e) => e.type === 'approval.changes_requested').data, { brief_id: BRIEF_ID, version: 1, human_revisions_used: 1, max: 5 })
  assert.deepEqual(ev.find((e) => e.type === 'approval.waiting').data, { brief_id: BRIEF_ID, version: 2, total: 90 })
})

test('human_revise with REREVIEW_AFTER_HUMAN=false: no Reviewer, straight back to awaiting_human', async () => {
  const restore = quiet()
  const reviewer = mockReviewer(['fail'])
  const s = await setup({ env: { REREVIEW_AFTER_HUMAN: 'false' }, reviewer, writerAnswers: { revise: draftAnswer({ revision_notes: [{ feedback_quote: '', what_changed: 'w' }] }) } })
  const r = await s.run('human_revise', { feedback: 'Use a shorter title.' })
  restore()
  assert.equal(r.status, 'succeeded')
  assert.equal(r.run.result_summary, 'awaiting human approval (v2, not re-reviewed)')
  assert.equal(reviewer.count(), 0)
  assert.deepEqual(r.run.steps.map((x) => x.name), ['writer', 'checks'])
})

test('human feedback asking for an invented fact: the prompt says to refuse it, and the refusal is kept as a revision note', async () => {
  const restore = quiet()
  const note = { feedback_quote: '', what_changed: 'Not added: "90% of teams use M91" is not in the brief; the HONESTY RULES forbid invented numbers.' }
  const s = await setup({ writerAnswers: { revise: draftAnswer({ revision_notes: [note] }) } })
  await s.run('human_revise', { feedback: 'Add that 90% of teams use M91.' })
  restore()
  assert.match(s.ai.requests[0].prompt, /If it asks for something the HONESTY RULES forbid \(a fact not in the brief, a claim in claims_to_avoid, an invented example, code that is not a snippet\), do not do that part; explain why in revision_notes\./)
  assert.deepEqual(recordsOf(s.store, 'draft').find((d) => d.version === 2).payload.revision_notes, [note])
})

test('human_revise limits and checks: MAX_HUMAN_REVISIONS (409), quotes not in the draft (400), feedback length (400)', async () => {
  const restore = quiet()
  const s = await setup({ env: { MAX_HUMAN_REVISIONS: '1' } })
  await assert.rejects(s.run('human_revise', { feedback: 'ok' }), (e) => e.code === 'bad_params' && e.status === 400)
  await assert.rejects(s.run('human_revise', { feedback: 'x'.repeat(2001) }), (e) => e.code === 'bad_params')
  await assert.rejects(s.run('human_revise', { feedback: 'Shorter please.', quotes: ['This sentence is not in the post.'] }), (e) => e.code === 'quote_not_found' && e.status === 400)
  assert.equal((await s.run('human_revise', { feedback: 'Shorter please.' })).status, 'succeeded')
  await assert.rejects(s.run('human_revise', { feedback: 'Shorter again.' }), (e) => e.code === 'max_human_revisions' && e.status === 409 && /approve or reject the topic/.test(e.message))
  restore()
})

test('reject_topic: brief and draft rejected, the lead discarded, the reason saved as a lesson, approval.rejected; no AI call', async () => {
  const restore = quiet()
  const s = await setup()
  const r = await s.run('reject_topic', { reason: 'We covered this last month.' })
  restore()
  assert.equal(r.status, 'succeeded')
  assert.match(r.run.result_summary, /^topic rejected \(v1\); lead cluster C-1 discarded$/)
  assert.equal(s.store.records.get(s.draft.id).status, 'rejected')
  assert.equal(recordsOf(s.store, 'brief')[0].status, 'rejected')
  assert.equal(recordsOf(s.store, 'question_cluster')[0].status, 'discarded')
  assert.deepEqual(s.store.lessons, [{ text: 'Topic rejected by the human: We covered this last month.', meta: { source: 'human', brief_id: BRIEF_ID } }])
  assert.equal(s.ai.requests.length, 0)
  assert.deepEqual(replay(r.run_id).find((e) => e.type === 'approval.rejected').data, { brief_id: BRIEF_ID, version: 1, lead: { kind: 'cluster', id: 'C-1' }, lesson_saved: true })
})

test('every decision needs a draft that is awaiting_human: otherwise 409', async () => {
  const restore = quiet()
  const s = await setup({ draftStatus: 'approved' })
  for (const [mode, params] of [['approve', {}], ['human_revise', { feedback: 'Shorter please.' }], ['reject_topic', {}]]) {
    await assert.rejects(s.run(mode, params), (e) => e.code === 'not_awaiting_human' && e.status === 409, mode)
  }
  restore()
  assert.deepEqual(humanFeedbackItems('t'), [{ source: 'human', area: 'human', quote: '', problem: 't', fix: 't', severity: 'must' }])
  assert.ok(GOOD_MD.includes('A ringing phone gets attention fast.'))
})

test('human_revise that fails review after the limits: the existing failure path (failed_review, Slack, LOW M91 alert)', async () => {
  const restore = quiet()
  const s = await setup({ env: { MAX_WRITER_REVISIONS: '0' }, reviewer: mockReviewer(['fail']), writerAnswers: { revise: draftAnswer({ revision_notes: [{ feedback_quote: '', what_changed: 'w' }] }) } })
  const r = await s.run('human_revise', { feedback: 'Shorter please.' })
  restore()
  assert.equal(r.status, 'failed')
  assert.match(r.run.result_summary, /MAX_WRITER_REVISIONS/)
  assert.equal(recordsOf(s.store, 'draft').find((d) => d.version === 2).status, 'failed_review')
  assert.equal(s.store.records.get(s.draft.id).status, 'changes_requested')
  assert.equal(s.notifier.sent.m91[0].title, 'Blog post failed review')
})

test('human_revise with the run param rereview_after_human: false skips the Reviewer for that run only', async () => {
  const restore = quiet()
  const reviewer = mockReviewer(['fail'])
  const s = await setup({ reviewer, writerAnswers: { revise: draftAnswer({ revision_notes: [{ feedback_quote: '', what_changed: 'w' }] }) } })
  const r = await s.run('human_revise', { feedback: 'Use a shorter title.', rereview_after_human: false })
  restore()
  assert.equal(r.status, 'succeeded')
  assert.equal(r.run.result_summary, 'awaiting human approval (v2, not re-reviewed)')
  assert.equal(reviewer.count(), 0)
  assert.equal(s.cfg.approval.rereviewAfterHuman, true, 'config unchanged')
})

// Open issue #2: approving a version the Reviewer never passed.
test('approve refuses a version without a passing review (REREVIEW_AFTER_HUMAN=true): 409 not_reviewed, nothing changes', async () => {
  const restore = quiet()
  for (const reviewed of [null, 'fail']) {
    const s = await setup({ reviewed })
    await assert.rejects(s.run('approve'), (e) => e.code === 'not_reviewed' && e.status === 409 && e.message === NOT_REVIEWED_MESSAGE, String(reviewed))
    assert.equal(s.store.records.get(s.draft.id).status, 'awaiting_human')
    assert.equal(recordsOf(s.store, 'promo_pack').length, 0)
    assert.equal(s.notifier.sent.slack.length, 0)
  }
  restore()
  assert.equal(NOT_REVIEWED_MESSAGE, 'This version was not checked by the Reviewer. Review it first, or approve with force_unreviewed.')
})

test('approve with force_unreviewed: approved, approved_unreviewed saved on the draft and shown in the run record', async () => {
  const restore = quiet()
  const s = await setup({ reviewed: null })
  await assert.rejects(s.run('approve', { force_unreviewed: 'yes' }), (e) => e.code === 'bad_params' && e.status === 400)
  const r = await s.run('approve', { force_unreviewed: true })
  // REREVIEW_AFTER_HUMAN=false: no review needed, but the approval is still marked unreviewed.
  const off = await setup({ reviewed: null, env: { REREVIEW_AFTER_HUMAN: 'false' } })
  const r2 = await off.run('approve')
  // A reviewed version: approved_unreviewed is false.
  const ok = await setup()
  const r3 = await ok.run('approve')
  restore()
  assert.equal(r.status, 'succeeded')
  const d = s.store.records.get(s.draft.id)
  assert.equal(d.status, 'approved')
  assert.equal(d.metadata.approved_unreviewed, true)
  assert.equal(r.run.approved_unreviewed, true)
  assert.equal(r.run.result_summary, 'approved by you (v1, not reviewed)')
  assert.ok(r.run.warnings.includes('v1 approved without a Reviewer pass (force_unreviewed)'))
  assert.equal(replay(r.run_id).find((e) => e.type === 'approval.approved').data.approved_unreviewed, true)
  assert.equal(r2.status, 'succeeded')
  assert.equal(off.store.records.get(off.draft.id).metadata.approved_unreviewed, true)
  assert.ok(r2.run.warnings.includes('v1 approved without a Reviewer pass (REREVIEW_AFTER_HUMAN=false)'))
  assert.equal(r3.run.approved_unreviewed, false)
  assert.equal(ok.store.records.get(ok.draft.id).metadata.approved_unreviewed, false)
})

test('approval_review: one Reviewer call, review recorded, the draft stays awaiting_human (pass and fail); a pass unlocks approve', async () => {
  const restore = quiet()
  const pass = await setup({ reviewed: null, reviewer: mockReviewer(['pass']) })
  const r = await pass.run('approval_review')
  const after = await pass.run('approve')
  const failing = await setup({ reviewed: null, reviewer: mockReviewer(['fail']) })
  const f = await failing.run('approval_review')
  const notAwaiting = await setup({ draftStatus: 'approved' })
  await assert.rejects(notAwaiting.run('approval_review'), (e) => e.code === 'not_awaiting_human' && e.status === 409)
  await assert.rejects(failing.run('approve'), (e) => e.code === 'not_reviewed')
  restore()
  assert.equal(r.status, 'succeeded')
  assert.equal(r.run.result_summary, 'review of v1: pass (score 90); still awaiting your approval')
  assert.deepEqual(r.run.steps.map((x) => [x.name, x.status]), [['reviewer', 'succeeded']])
  assert.equal(pass.ai.requests.length, 0, 'no Writer call')
  const reviews = recordsOf(pass.store, 'review')
  assert.equal(reviews.length, 1)
  assert.equal(reviews[0].payload.pass, true)
  assert.equal(reviews[0].payload.version, 1)
  assert.equal(pass.store.records.get(pass.draft.id).metadata.review_total, 90)
  assert.deepEqual(replay(r.run_id).find((e) => e.type === 'approval.reviewed').data, { brief_id: BRIEF_ID, version: 1, total: 90, pass: true })
  assert.equal(after.status, 'succeeded')
  assert.equal(after.run.approved_unreviewed, false)
  assert.equal(f.status, 'succeeded')
  assert.match(f.run.result_summary, /^review of v1: fail \(score 70\); still awaiting you/)
  assert.equal(failing.store.records.get(failing.draft.id).status, 'awaiting_human')
  assert.equal(recordsOf(failing.store, 'review')[0].payload.pass, false)
})

test('hard content checks must pass in every case: force_unreviewed, a passing review or REREVIEW_AFTER_HUMAN=false never override them', async () => {
  const restore = quiet()
  const cases = [
    [{ hardPassed: false }, {}],
    [{ hardPassed: false }, { force_unreviewed: true }],
    [{ hardPassed: false, reviewed: null, env: { REREVIEW_AFTER_HUMAN: 'false' } }, {}],
    [{ hardPassed: null }, { force_unreviewed: true }]
  ]
  for (const [opts, params] of cases) {
    const s = await setup(opts)
    await assert.rejects(s.run('approve', params), (e) => e.code === 'hard_checks_failed' && e.status === 409 && /force_unreviewed does not override/.test(e.message), JSON.stringify([opts, params]))
    assert.equal(s.store.records.get(s.draft.id).status, 'awaiting_human')
  }
  restore()
})
