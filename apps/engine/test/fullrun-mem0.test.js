// Phase 9 A6: Mem0 requests of a full pipeline run and of the decision runs, with fake AI over the real store
// (a fake Mem0 client counts every request). The same harness measured the code before Phase 9 at 160
// requests (102 reads, 3 searches, 55 writes); the real counter saw 157 on 2026-10-19. See PHASE9_NOTES.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setSink } from '../src/util/log.js'
import { measureFullRun, table } from './fixtures/fullrun.js'

// WORK_STORE=mem0 (fakeConfig's default): every step in Mem0, as before the work store.
test('full run: 30 Mem0 requests (28 before Phase 10, 160 before Phase 9): no searches, no run_log, reads only for data from before the run', async (t) => {
  const restore = setSink(() => {})
  const m = await measureFullRun({ EMBARKO_DEPLOY_TOKEN: 'emb_faketokenfortests_0123456789' }, { decisions: true })
  restore()
  t.diagnostic(`\n${table(m)}`)
  assert.equal(m.status, 'succeeded', m.summary)
  assert.deepEqual(m.ai, { scout: 8, strategist: 1, writer: 2, designer: 2, reviewer: 2 })
  // Phase 10: one guide_doc write per draft version (2 here), no reads: the Experience Designer gets its inputs from the run.
  assert.deepEqual(m.total, { reads: 12, searches: 0, writes: 18 })
  assert.equal(m.types.run_log, undefined, 'no run_log records')
  assert.equal(m.types.lock, undefined, 'no lock records (the lock is a local file)')
  // Reads are the lists of data from before the run, each once: the Scout's, then only the new types later.
  assert.deepEqual(Object.fromEntries(Object.entries(m.byStep).map(([k, v]) => [k, v.reads])), { run: 0, scout: 8, strategist: 3, writer: 1, designer: 0, reviewer: 0 })
  // Writes: what must outlast the run (facts note, cluster, brief, lead, drafts, reviews, run record).
  assert.equal(m.byStep.run.writes, 5, 'the run record: start, waiting for approval, end; the brief and draft statuses')

  t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(m.decisions).map(([k, v]) => [k, v.total]))))
  for (const [mode, d] of Object.entries(m.decisions)) assert.equal(d.status, 'succeeded', `${mode}: ${d.summary}`)
  const req = (mode) => m.decisions[mode].total.reads + m.decisions[mode].total.searches + m.decisions[mode].total.writes
  // Phase 11: approve also saves the final Markdown export (its record, and the reads that build it).
  assert.deepEqual(Object.fromEntries(Object.keys(m.decisions).map((k) => [k, req(k)])), { human_revise: 18, approve: 12, designer: 7, publish: 12, unpublish: 10 })
  for (const mode of Object.keys(m.decisions)) assert.equal(m.decisions[mode].total.searches, 0, mode)
})

test('WORK_STORE=local: a full run sends 17 Mem0 requests (30 with every step in Mem0); the approved post is copied to Mem0, the failed attempts never are', async (t) => {
  const restore = setSink(() => {})
  const m = await measureFullRun({ EMBARKO_DEPLOY_TOKEN: 'emb_faketokenfortests_0123456789', WORK_STORE: 'local' }, { decisions: true })
  restore()
  t.diagnostic(`\n${table(m)}`)
  assert.equal(m.status, 'succeeded', m.summary)
  // Reads are unchanged (data from before the run); writes are the context (facts, cluster, lead) and the run summary.
  assert.deepEqual(m.total, { reads: 12, searches: 0, writes: 5 })
  for (const type of ['brief', 'draft', 'review', 'guide_doc', 'source_pack']) assert.equal(m.types[type], undefined, `no ${type} in Mem0 while the post waits`)
  assert.equal(m.types.run, 1, 'one short run summary')
  for (const [mode, d] of Object.entries(m.decisions)) assert.equal(d.status, 'succeeded', `${mode}: ${d.summary}`)
  const req = (mode) => m.decisions[mode].total.reads + m.decisions[mode].total.searches + m.decisions[mode].total.writes
  // approve: the brief, the approved draft, its review and guide (4 copies), the Markdown export and the run summary.
  assert.deepEqual(Object.fromEntries(Object.keys(m.decisions).map((k) => [k, req(k)])), { human_revise: 4, approve: 8, designer: 5, publish: 10, unpublish: 8 })
  assert.equal(m.decisions.approve.total.writes, 6)
  // After approve, publish and unpublish: one copy of the finished post; v1, v2 and their reviews never reached Mem0.
  const after = m.typesAfter
  assert.equal(after['brief:approved'], 1, JSON.stringify(after))
  assert.equal(after['draft:approved'], 1, JSON.stringify(after))
  assert.equal(Object.keys(after).filter((k) => k.startsWith('draft:')).length, 1, JSON.stringify(after))
  assert.equal(after['review:pass'], 1, JSON.stringify(after))
  assert.equal(after['review:fail'], undefined, JSON.stringify(after))
  assert.ok(after['guide_doc:ok'] >= 1, JSON.stringify(after))
})
