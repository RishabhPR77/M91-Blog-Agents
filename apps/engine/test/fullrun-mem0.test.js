// Phase 9 A6: Mem0 requests of a full pipeline run and of the decision runs, with fake AI over the real store
// (a fake Mem0 client counts every request). The same harness measured the code before Phase 9 at 160
// requests (102 reads, 3 searches, 55 writes); the real counter saw 157 on 2026-10-19. See PHASE9_NOTES.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setSink } from '../src/util/log.js'
import { measureFullRun, table } from './fixtures/fullrun.js'

test('full run: 28 Mem0 requests (was 160): no searches, no run_log, reads only for data from before the run', async (t) => {
  const restore = setSink(() => {})
  const m = await measureFullRun({ EMBARKO_DEPLOY_TOKEN: 'emb_faketokenfortests_0123456789' }, { decisions: true })
  restore()
  t.diagnostic(`\n${table(m)}`)
  assert.equal(m.status, 'succeeded', m.summary)
  assert.deepEqual(m.ai, { scout: 8, strategist: 1, writer: 2, reviewer: 2 })
  assert.deepEqual(m.total, { reads: 12, searches: 0, writes: 16 })
  assert.equal(m.types.run_log, undefined, 'no run_log records')
  assert.equal(m.types.lock, undefined, 'no lock records (the lock is a local file)')
  // Reads are the lists of data from before the run, each once: the Scout's, then only the new types later.
  assert.deepEqual(Object.fromEntries(Object.entries(m.byStep).map(([k, v]) => [k, v.reads])), { run: 0, scout: 8, strategist: 3, writer: 1, reviewer: 0 })
  // Writes: what must outlast the run (facts note, cluster, brief, lead, drafts, reviews, run record).
  assert.equal(m.byStep.run.writes, 5, 'the run record: start, waiting for approval, end; the brief and draft statuses')

  t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(m.decisions).map(([k, v]) => [k, v.total]))))
  for (const [mode, d] of Object.entries(m.decisions)) assert.equal(d.status, 'succeeded', `${mode}: ${d.summary}`)
  const req = (mode) => m.decisions[mode].total.reads + m.decisions[mode].total.searches + m.decisions[mode].total.writes
  assert.deepEqual(Object.fromEntries(Object.keys(m.decisions).map((k) => [k, req(k)])), { human_revise: 17, approve: 11, designer: 6, publish: 13, unpublish: 10 })
  for (const mode of Object.keys(m.decisions)) assert.equal(m.decisions[mode].total.searches, 0, mode)
})
