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
