// Mem0's own monthly limit (the error seen live on 2026-10-28): recognised, recorded with Mem0's reset date (the 19th,
// not the 1st), runs refused before they send anything, and a clear 429 instead of "internal error". Fakes only.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mem0LimitOf, limitMessage, Mem0LimitError } from '../src/util/mem0limit.js'
import { recordMem0Limit, usageStatus, setUsage, stopMessage } from '../src/util/mem0usage.js'
import { createStore } from '../src/store.js'
import { createServer } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { stubAgents } from '../src/agents/stubs.js'
import { resetEvents } from '../src/events.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, fakeNotifier, memoryStore } from './helpers.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})

// The exact error mem0ai 3.3.1 threw (RateLimitError, its message is Mem0's JSON answer).
const BODY = { error: 'Monthly retrieval limit reached (1000 of 1000). Connect your own LLM key to raise it to 10,000 a month: https://app.mem0.ai/dashboard/settings?tab=org-llm', event_type: 'SEARCH', quota_limit: 1000, quota_used: 1000, quota_reset: '2026-11-19T00:00:00+00:00', next_step: 'add_llm_key', next_step_url: 'https://app.mem0.ai/dashboard/settings?tab=org-llm' }
const limitError = () => Object.assign(new Error(JSON.stringify(BODY)), { name: 'RateLimitError' })
const OCT28 = Date.parse('2026-10-28T13:35:00Z')
const dataConfig = (over = {}) => fakeConfig({ ENGINE_DATA_DIR: mkdtempSync(join(tmpdir(), 'm91-limit-')), ...over })

test('recognised: kind, figures, Mem0\'s reset date, the link; a burst rate limit or another error is not the monthly limit', () => {
  assert.deepEqual(mem0LimitOf(limitError()), { kind: 'retrievals', limit: 1000, used: 1000, reset_at: '2026-11-19T00:00:00.000Z', event_type: 'SEARCH', next_step_url: 'https://app.mem0.ai/dashboard/settings?tab=org-llm' })
  assert.equal(mem0LimitOf(Object.assign(new Error('{"error":"Monthly add limit reached (10000 of 10000)."}'), { name: 'RateLimitError' })).kind, 'adds')
  assert.equal(mem0LimitOf(Object.assign(new Error('{"error":"Too many requests, slow down"}'), { name: 'RateLimitError' })), null)
  assert.equal(mem0LimitOf(new Error('fetch failed')), null)
  assert.equal(mem0LimitOf(null), null)
  const msg = limitMessage(mem0LimitOf(limitError()))
  assert.match(msg, /^Mem0's monthly retrieval limit is reached \(1000 of 1000\)\. Mem0 resets it on 19 Nov 2026; until then the engine cannot read its data/)
  const e = new Mem0LimitError(mem0LimitOf(limitError()))
  assert.deepEqual([e.status, e.code, e.message], [429, 'mem0_quota', msg])
  assert.deepEqual(mem0LimitOf(e), e.info)
})

test('the guard records it: stop until Mem0\'s reset (the 19th, kept across the month change), cleared by setting the figures', () => {
  const config = dataConfig()
  recordMem0Limit(mem0LimitOf(limitError()), { config, now: () => OCT28 })
  let u = usageStatus(config, { now: () => OCT28 })
  assert.deepEqual([u.level, u.limited, u.used, u.limit, u.pct, u.resets_on], ['stop', 'retrievals', 1000, 1000, 100, '2026-11-19T00:00:00.000Z'])
  assert.match(stopMessage(u), /^Mem0's monthly retrieval limit is reached \(Mem0 says 1000 of 1000\)\. Runs paused until Mem0 resets it on 19 Nov 2026/)
  // 1 November: a new month for the estimate, but Mem0 has not reset yet.
  u = usageStatus(config, { now: () => Date.parse('2026-11-01T06:00:00Z') })
  assert.equal(u.level, 'stop')
  // 19 November: Mem0's reset date has passed.
  assert.equal(usageStatus(config, { now: () => Date.parse('2026-11-19T06:00:00Z') }).level, 'ok')
  // Raised in Mem0, then the figures set again: the stop is gone.
  setUsage(config, 120, { now: () => OCT28 })
  assert.deepEqual([usageStatus(config, { now: () => OCT28 }).level, usageStatus(config, { now: () => OCT28 }).blocked], ['ok', undefined])
  // Without a reset date from Mem0: one day.
  const c2 = dataConfig()
  recordMem0Limit({ kind: 'retrievals', limit: null, used: null, reset_at: null }, { config: c2, now: () => OCT28 })
  assert.equal(usageStatus(c2, { now: () => OCT28 }).resets_on, '2026-10-29T13:35:00.000Z')
})

test('the store turns Mem0\'s limit error into Mem0LimitError and records it (no retry)', async () => {
  const restore = quiet()
  const config = dataConfig({ WORK_STORE: 'mem0' })
  let calls = 0
  const client = { getAll: async () => { calls++; throw limitError() }, add: async () => { calls++; throw limitError() } }
  const store = createStore({ config, clientFactory: async () => client, fetch: async () => { throw new Error('no fetch') }, sleepFn: async () => {} })
  try {
    await assert.rejects(store.getRecords({ type: 'draft' }), (e) => e instanceof Mem0LimitError && e.status === 429)
    assert.equal(calls, 1, 'not retried')
    await assert.rejects(store.createRecord({ type: 'lesson', payload: { text: 'x' }, status: 'current' }), (e) => e instanceof Mem0LimitError)
    assert.equal(usageStatus(config).level, 'stop')
  } finally {
    restore()
  }
})

test('API: a request that hits the limit answers 429 mem0_quota with the plain message; a new run is refused before it starts', async () => {
  const restore = quiet()
  const config = dataConfig()
  const store = memoryStore()
  store.getRecords = async () => { throw new Mem0LimitError(mem0LimitOf(limitError())) }
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const srv = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const r = await fetch(`${base}/api/approvals`)
    assert.equal(r.status, 429)
    const body = await r.json()
    assert.equal(body.error.code, 'mem0_quota')
    assert.match(body.error.message, /^Mem0's monthly retrieval limit is reached \(1000 of 1000\)/)
    // The guard now knows (the store's error was recorded where the real store records it; here we record it directly).
    recordMem0Limit(mem0LimitOf(limitError()), { config })
    const run = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'scout' }) })
    assert.equal(run.status, 429)
    assert.match((await run.json()).error.message, /Runs paused until Mem0 resets it on 19 Nov 2026/)
    const health = await (await fetch(`${base}/api/health`)).json()
    assert.equal(health.mem0_usage.blocked.until, '2026-11-19T00:00:00.000Z')
  } finally {
    await new Promise((r) => srv.close(r))
    restore()
  }
})
