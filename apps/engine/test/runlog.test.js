// Phase 9 A2: run_log records only for errors.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isErrorEntry, saveRunLog } from '../src/util/runlog.js'
import { memoryStore } from './helpers.js'

test('only errors become run_log records', async () => {
  assert.equal(isErrorEntry({ result: 'ok', error: null }, 'ok'), false)
  assert.equal(isErrorEntry({ result: 'problems', error: null }, 'problems'), false)
  assert.equal(isErrorEntry({ result: 'cancelled', error: null }, 'cancelled'), false)
  assert.equal(isErrorEntry({ result: 'awaiting_human', error: null }, 'awaiting_human'), false)
  assert.equal(isErrorEntry({ error: 'boom' }, 'ok'), true)
  assert.equal(isErrorEntry({ result: 'failed', error: null }, 'failed'), true)
  assert.equal(isErrorEntry({ result: 'error' }, 'error'), true)
  const store = memoryStore()
  assert.equal(await saveRunLog(store, { briefId: 'R1', payload: { result: 'ok', error: null }, status: 'ok' }), null)
  const rec = await saveRunLog(store, { briefId: 'R1', payload: { result: 'error', error: 'boom' }, status: 'error', version: 2 })
  assert.equal(rec.type, 'run_log')
  assert.equal(rec.version, 2)
  assert.equal(store.byType('run_log').length, 1)
})
