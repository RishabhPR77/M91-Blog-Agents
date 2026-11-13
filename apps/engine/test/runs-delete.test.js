// DELETE /api/runs: a run's records and its per-call logs go; the post's own records stay; bad ids are refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier } from './helpers.js'

test('deleting runs removes their run and run_log records, nothing else', async () => {
  const restore = setSink(() => {})
  const store = memoryStore()
  const A = 'R-261106-0113-2DAY'
  const B = 'R-261105-1021-CLA6'
  await store.createRecord({ type: 'run', briefId: A, payload: { run_id: A, status: 'failed' }, status: 'failed' })
  await store.createRecord({ type: 'run_log', briefId: A, payload: { step: 'writer', error: 'x' }, status: 'error' })
  await store.createRecord({ type: 'run', briefId: B, payload: { run_id: B, status: 'succeeded' }, status: 'succeeded' })
  await store.createRecord({ type: 'brief', briefId: '261106-0113-36P7', payload: { brief_id: '261106-0113-36P7' }, status: 'failed_review' })
  const config = fakeConfig()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  const del = (body) => fetch(`${base}/api/runs`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const res = await del({ run_ids: [A] })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.deleted.length, 2, 'the run and its log')
    const left = (await store.getRecords({ type: 'run' })).map((r) => r.payload.run_id)
    assert.deepEqual(left, [B])
    assert.equal((await store.getRecords({ type: 'run_log' })).length, 0)
    assert.equal((await store.getRecords({ type: 'brief' })).length, 1, "the post's brief stays")
    assert.equal((await del({ run_ids: ['not-a-run'] })).status, 400)
    assert.equal((await del({ run_ids: [] })).status, 400)
  } finally {
    await new Promise((ok) => server.close(ok))
    restore()
  }
})

test('at start-up, a run left "running" by a restart is closed as failed, with its open step', async () => {
  const { closeInterruptedRuns, INTERRUPTED_SUMMARY } = await import('../src/runs.js')
  const store = memoryStore()
  const A = 'R-261112-1000-WXYZ'
  await store.createRecord({ type: 'run', briefId: A, payload: { run_id: A, status: 'running', steps: [{ name: 'scout', status: 'succeeded' }, { name: 'writer', status: 'running' }] }, status: 'running' })
  await store.createRecord({ type: 'run', briefId: 'R-261112-0900-ABCD', payload: { run_id: 'R-261112-0900-ABCD', status: 'succeeded', steps: [] }, status: 'succeeded' })
  assert.deepEqual(await closeInterruptedRuns(store, { now: () => Date.parse('2026-11-12T10:00:00Z') }), [A])
  const r = (await store.getRecords({ type: 'run' })).find((x) => x.payload.run_id === A)
  assert.equal(r.payload.status, 'failed')
  assert.equal(r.payload.result_summary, INTERRUPTED_SUMMARY)
  assert.deepEqual(r.payload.steps.map((s) => s.status), ['succeeded', 'failed'])
  assert.deepEqual(await closeInterruptedRuns(store), [], 'nothing left to close')
})

test('deleting a failed post removes everything it stored; an approved post is refused', async () => {
  const restore = setSink(() => {})
  const store = memoryStore()
  const F = '261106-0113-36P7'
  const L = '261029-1515-RATA'
  const R = 'R-261106-0113-2DAY'
  await store.createRecord({ type: 'brief', briefId: F, payload: { brief_id: F }, status: 'failed_review' })
  for (const v of [1, 2, 3]) await store.createRecord({ type: 'draft', briefId: F, payload: { brief_id: F, version: v, post_markdown: '# x' }, status: 'failed_review', version: v })
  await store.createRecord({ type: 'review', briefId: F, payload: { brief_id: F, total: 78 }, status: 'fail' })
  await store.createRecord({ type: 'weekly_pick', briefId: F, payload: { brief_id: F }, status: 'written' })
  await store.createRecord({ type: 'run', briefId: R, payload: { run_id: R, brief_id: F, status: 'failed' }, status: 'failed' })
  await store.createRecord({ type: 'run_log', briefId: R, payload: { step: 'writer', error: 'x' }, status: 'error' })
  await store.createRecord({ type: 'brief', briefId: L, payload: { brief_id: L }, status: 'approved' })
  await store.createRecord({ type: 'draft', briefId: L, payload: { brief_id: L, version: 3 }, status: 'approved', version: 3 })
  const config = fakeConfig()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const res = await fetch(`${base}/api/briefs/${F}`, { method: 'DELETE' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.deleted.length, 8, 'brief, 3 drafts, review, pick, run, run log')
    const left = async (type) => (await store.getRecords({ type })).map((r) => r.briefId)
    assert.deepEqual(await left('brief'), [L])
    assert.deepEqual(await left('draft'), [L])
    assert.deepEqual(await left('run'), [])
    assert.equal((await fetch(`${base}/api/briefs/${L}`, { method: 'DELETE' })).status, 409, 'an approved post is kept')
    assert.equal((await fetch(`${base}/api/briefs/not-a-brief`, { method: 'DELETE' })).status, 400)
  } finally {
    await new Promise((ok) => server.close(ok))
    restore()
  }
})

test('a run kept twice (its full local record and a memory summary the index shows once the record is gone) is deleted for good', async () => {
  const restore = setSink(() => {})
  const store = memoryStore()
  const A = 'R-261113-1456-W3XQ'
  // As live: the full record has a local "w-" id; the summary is a memory record flagged metadata.summary.
  const full = await store.createRecord({ type: 'run', briefId: A, payload: { run_id: A, status: 'succeeded', steps: [] }, status: 'succeeded' })
  store.records.delete(full.id)
  full.id = 'w-run-1'
  store.records.set(full.id, full)
  await store.createRecord({ type: 'run', briefId: A, payload: { run_id: A, status: 'succeeded' }, status: 'succeeded', meta: { summary: true } })
  const config = fakeConfig()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    const res = await fetch(`${url}/api/runs`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ run_ids: [A] }) })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).deleted.length, 2, 'the full record and its summary')
    assert.deepEqual(store.byType('run'), [], 'nothing comes back')
  } finally {
    await new Promise((ok) => server.close(ok))
    restore()
  }
})
