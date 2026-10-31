// AUTO_APPROVE and PUBLISH_TARGET=slack: a post that passes the AI review is approved, exported and sent to Slack (one
// message with the .md download link) in the same run; with APPROVE_BEST_ON_FAIL the best of the rejected versions
// goes instead of failing (only when its hard checks passed). Fakes only: no AI, no Mem0, no network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRunManager } from '../src/runs.js'
import { stubAgents } from '../src/agents/stubs.js'
import { resetEvents } from '../src/events.js'
import { setSink } from '../src/util/log.js'
import { buildJourney } from '../src/journey.js'
import { slackPostText } from '../src/publisher/slack.js'
import { memoryStore, fakeNotifier } from './helpers.js'
import { config, brief, draftAnswer } from './writer/fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const cfg = (env = {}) => config({ AUTO_APPROVE: 'true', APPROVE_BEST_ON_FAIL: 'true', PUBLISH_TARGET: 'slack', DRY_RUN: 'false', EXPERIENCE_ENABLED: 'false', ...env })
const byType = (store, type) => [...store.records.values()].filter((r) => r.type === type)

/** Agents that save real brief and draft records; the drafts' hard checks pass unless hardFails says which versions fail. */
function agents({ reviews, hardFails = [] }) {
  let n = 0
  return (rc, { store }) => ({
    ...stubAgents,
    async strategist(ctx) {
      const b = brief({ brief_id: ctx.briefId })
      const rec = await store.createRecord({ type: 'brief', briefId: ctx.briefId, payload: b, status: 'new', version: 1, topicGroup: 1 })
      return { model: 'stub', output: { brief_id: ctx.briefId, brief_version: 1, record_id: rec.id, brief: b, title: b.titles[0], lead: b.lead, repairs_used: 0 } }
    },
    async writer(ctx) {
      const version = (await store.getRecords({ type: 'draft', brief_id: ctx.briefId })).length + 1
      const payload = { ...draftAnswer(), brief_id: ctx.briefId, version, brief_version: 1, word_count: 1300, reading: { post_grade: 7.2, intro_grade: 6.5 }, checks: { hard_passed: !hardFails.includes(version), results: [] } }
      const rec = await store.createRecord({ type: 'draft', briefId: ctx.briefId, payload, status: 'drafted', version, meta: { brief_version: 1 } })
      return { model: 'stub', output: { record_id: rec.id, version, brief_version: 1, title: payload.title, draft: payload } }
    },
    async reviewer(ctx) {
      const r = reviews[Math.min(n++, reviews.length - 1)]
      const output = r.pass ? { pass: true, total: r.total, feedback: [] } : { pass: false, total: r.total, summary: 'Not yet.', feedback: [{ area: 'simplicity', quote: '', problem: 'Too dense.', fix: 'Shorter.', severity: 'must', send_to: 'writer', claims: [] }] }
      await store.createRecord({ type: 'review', briefId: ctx.briefId, payload: { brief_id: ctx.briefId, version: ctx.draft?.version, brief_version: 1, ...output }, status: output.pass ? 'pass' : 'fail', version: ctx.draft?.version, meta: { brief_version: 1 } })
      return { model: 'stub', output: { ...output, record_id: 'saved' } }
    }
  })
}

async function fullRun(env, opts) {
  const store = memoryStore()
  const notifier = fakeNotifier()
  const m = createRunManager({ config: cfg(env), storeFactory: () => store, notifierFactory: () => notifier, agentsFactory: agents(opts) })
  const r = await m.wait((await m.startRun({ mode: 'full' })).run_id)
  return { store, notifier, r, m }
}

test('an AI-passed post is approved automatically, exported and sent to Slack in the same run: one message with the download link', async () => {
  const restore = quiet()
  const { store, notifier, r } = await fullRun({}, { reviews: [{ pass: true, total: 88 }] })
  restore()
  assert.equal(r.status, 'succeeded', r.run?.result_summary)
  assert.match(r.run.result_summary, /approved automatically \(v1, score 88\); Markdown export: how-agent-approval-works\.md; sent to Slack$/)
  assert.deepEqual(r.run.steps.map((s) => s.name).slice(-3), ['promo', 'export', 'publisher'])
  const [d] = byType(store, 'draft')
  assert.deepEqual([d.status, d.metadata.approved_by, d.metadata.approved_unreviewed], ['approved', 'auto', false])
  // One Slack message per post: no "ready for your approval", no separate "approved" line, no post text.
  assert.equal(notifier.sent.slack.length, 1, JSON.stringify(notifier.sent.slack))
  const msg = notifier.sent.slack[0]
  const briefId = r.run.brief_id
  assert.match(msg, /^📄 New post \(approved automatically\): \*How agent approval works with a phone call\*\nAI review 88\/100 · 1,300 words · reading grade 7\.2\n/)
  assert.match(msg, new RegExp(`Download the Markdown \\(how-agent-approval-works\\.md\\): http://localhost:8080/api/exports/${briefId}/download\nOpen the post: http://localhost:8080/approvals/${briefId}$`))
  const [exp] = byType(store, 'markdown_export')
  assert.ok(exp.payload.slack_sent_at, 'the export keeps when it was sent')
  // The post's journey: approved automatically, sent to Slack.
  const j = buildJourney({ briefs: byType(store, 'brief'), drafts: byType(store, 'draft'), reviews: byType(store, 'review'), exportRec: exp, runs: byType(store, 'run'), target: 'slack' })
  const stage = (id) => j.stages.find((s) => s.id === id)
  assert.match(stage('you').detail, /^Approved automatically/)
  assert.deepEqual([stage('published').state, stage('published').detail], ['done', 'Sent to Slack'])
})

test('rejected at the limit: the best-scoring version is sent instead (marked as such); with best-on-fail off it fails as before', async () => {
  const restore = quiet()
  const reviews = [{ pass: false, total: 60 }, { pass: false, total: 74 }, { pass: false, total: 70 }]
  const { store, notifier, r } = await fullRun({ MAX_WRITER_REVISIONS: '2' }, { reviews })
  assert.equal(r.status, 'succeeded', r.run?.result_summary)
  // The best one (v2, 74) goes ahead as v4, a copy of it with its review.
  assert.match(r.run.result_summary, /best of 3 rejected versions\); approved automatically \(v4, not reviewed\)/)
  const v4 = byType(store, 'draft').find((d) => d.version === 4)
  assert.deepEqual([v4.status, v4.metadata.approved_by, v4.metadata.approved_unreviewed, v4.payload.best_of], ['approved', 'auto', true, { version: 2, total: 74, reviews: 3 }])
  assert.equal(byType(store, 'review').find((x) => x.version === 4).payload.copied_from_version, 2)
  assert.equal(notifier.sent.slack.length, 1)
  assert.match(notifier.sent.slack[0], /^📄 New post \(sent automatically, best version\)/)
  assert.match(notifier.sent.slack[0], /⚠️ The AI review did not pass any of 3 versions; this is the best one \(v2, 74\/100\)\. Read it before you publish it\./)
  // Off: the run fails, the failure note goes to Slack.
  const off = await fullRun({ MAX_WRITER_REVISIONS: '2', APPROVE_BEST_ON_FAIL: 'false' }, { reviews })
  restore()
  assert.equal(off.r.status, 'failed')
  assert.match(off.notifier.sent.slack[0], /^❌ Not approved:/)
})

test('the best version failed its hard checks: nothing is sent, the run fails as before', async () => {
  const restore = quiet()
  const { store, notifier, r } = await fullRun({ MAX_WRITER_REVISIONS: '2' }, { reviews: [{ pass: false, total: 60 }, { pass: false, total: 80 }, { pass: false, total: 70 }], hardFails: [2] })
  restore()
  assert.equal(r.status, 'failed')
  assert.ok(r.run.warnings.some((w) => /the best version \(v2, 80\/100\) failed its hard content checks/.test(w)), JSON.stringify(r.run.warnings))
  assert.equal(byType(store, 'draft').filter((d) => d.status === 'approved').length, 0)
  assert.match(notifier.sent.slack[0], /^❌ Not approved:/)
})

test('AUTO_APPROVE off: the post waits for you (ready line in Slack); Publish later sends the Slack message', async () => {
  const restore = quiet()
  const { store, notifier, r, m } = await fullRun({ AUTO_APPROVE: 'false' }, { reviews: [{ pass: true, total: 90 }] })
  assert.equal(r.status, 'succeeded')
  assert.equal(byType(store, 'draft')[0].status, 'awaiting_human')
  assert.match(notifier.sent.slack[0], /^📝 Ready for your approval:/)
  const a = await m.wait((await m.startRun({ mode: 'approve', params: { brief_id: r.run.brief_id } })).run_id)
  assert.equal(a.status, 'succeeded', a.run?.result_summary)
  assert.equal(a.run.steps.find((s) => s.name === 'publisher').summary, 'Not sent to Slack: approved only. Use Publish in the dashboard (or npm run publish)')
  const p = await m.wait((await m.startRun({ mode: 'publish', params: { brief_id: r.run.brief_id } })).run_id)
  restore()
  assert.equal(p.status, 'succeeded', p.run?.result_summary)
  assert.match(p.run.result_summary, /^Sent to Slack with the download link: how-agent-approval-works\.md$/)
  assert.match(notifier.sent.slack.at(-1), /^📄 New post \(approved\): /)
})

test('the message text: optional parts are left out', () => {
  const t = slackPostText({ title: 'T', briefId: '261031-1000-ABCD', publicUrl: 'https://m91-engine.embarko.app', filename: 't.md' })
  assert.equal(t, '📄 New post (approved): *T*\nDownload the Markdown (t.md): https://m91-engine.embarko.app/api/exports/261031-1000-ABCD/download\nOpen the post: https://m91-engine.embarko.app/approvals/261031-1000-ABCD')
})
