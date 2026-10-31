// A full run with agents that save real brief, draft and review records (no AI): the drafts' hard checks pass unless
// hardFails names versions; the Reviewer answers from a script ({ pass, total }). For the auto-approve and email tests.
import { createRunManager } from '../../src/runs.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { memoryStore, fakeNotifier } from '../helpers.js'
import { brief, draftAnswer } from '../writer/fixtures.js'

/** Agents that save real brief and draft records; the drafts' hard checks pass unless hardFails says which versions fail. */
export function agents({ reviews, hardFails = [] }) {
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

export async function fullRun(config, opts) {
  const store = memoryStore()
  const notifier = fakeNotifier()
  const m = createRunManager({ config, storeFactory: () => store, notifierFactory: () => notifier, agentsFactory: agents(opts) })
  const r = await m.wait((await m.startRun({ mode: 'full' })).run_id)
  return { store, notifier, r, m }
}

