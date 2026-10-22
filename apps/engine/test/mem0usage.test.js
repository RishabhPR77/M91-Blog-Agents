// Phase 9 A5: the Mem0 quota guard — usage file (numbers only, month rollover), warn and stop levels,
// refused runs and refreshes at the stop level, the run summary line at the warn level. Phase 12: retrievals (reads
// + searches) against MEM0_MONTHLY_LIMIT, adds (writes) against MEM0_MONTHLY_ADD_LIMIT.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { configureUsage, recordUsage, usageStatus, resetsOn, stopMessage, resetUsageTarget, setUsage, USAGE_FILE } from '../src/util/mem0usage.js'
import { countMem0 } from '../src/util/mem0count.js'
import { createRunManager, RunError } from '../src/runs.js'
import { createServer } from '../src/server.js'
import { resetEvents } from '../src/events.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer, TEST_DATA_DIR } from './helpers.js'

const FILE = join(TEST_DATA_DIR, USAGE_FILE)
const OCT20 = Date.parse('2026-10-20T10:00:00Z')

beforeEach(() => {
  resetEvents()
  rmSync(FILE, { force: true })
  resetUsageTarget()
})

/** Sets this month's usage to `used` requests (all reads). */
function seedUsage(used, t = Date.now()) {
  const month = new Date(t).toISOString().slice(0, 7)
  writeFileSync(FILE, JSON.stringify({ month, total: { reads: used, searches: 0, writes: 0 }, days: {} }))
}

test('every counted request adds to the month and the day; cache hits do not; the file holds numbers only', () => {
  const config = fakeConfig()
  let t = OCT20
  configureUsage(config, { now: () => t })
  countMem0('reads', 2)
  countMem0('writes')
  countMem0('searches')
  countMem0('cache_hits', 5)
  t += 24 * 3600 * 1000
  recordUsage('writes')
  const file = JSON.parse(readFileSync(FILE, 'utf8'))
  assert.deepEqual(file, { month: '2026-10', seed: 0, seed_adds: 0, total: { reads: 2, searches: 1, writes: 2 }, days: { '2026-10-20': { reads: 2, searches: 1, writes: 1 }, '2026-10-21': { reads: 0, searches: 0, writes: 1 } } })
  assert.ok(!/[a-z]{12,}/i.test(readFileSync(FILE, 'utf8').replace(/reads|searches|writes|month|total|days|seed_adds/g, '')), 'no content, only numbers and dates')
  const u = usageStatus(config, { now: () => t })
  assert.deepEqual([u.used, u.limit, u.level, u.resets_on], [3, 1000, 'ok', '2026-11-01T00:00:00.000Z'], 'retrievals only: 2 reads + 1 search')
  assert.deepEqual(u.adds, { used: 2, limit: 10000, pct: 0, level: 'ok' }, 'the 2 writes are adds')
})

test('month rollover: a new month starts from zero', () => {
  const config = fakeConfig()
  let t = Date.parse('2026-10-31T23:59:00Z')
  configureUsage(config, { now: () => t })
  recordUsage('reads', 900)
  assert.equal(usageStatus(config, { now: () => t }).used, 900)
  t = Date.parse('2026-11-01T00:01:00Z')
  assert.equal(usageStatus(config, { now: () => t }).used, 0)
  recordUsage('writes')
  assert.deepEqual(JSON.parse(readFileSync(FILE, 'utf8')).total, { reads: 0, searches: 0, writes: 1 })
  assert.equal(resetsOn(Date.parse('2026-12-15T00:00:00Z')), '2027-01-01T00:00:00.000Z')
})

test('levels: ok below MEM0_WARN_PCT, warn from it, stop from MEM0_STOP_PCT', () => {
  const config = fakeConfig({ MEM0_MONTHLY_LIMIT: '1000', MEM0_WARN_PCT: '80', MEM0_STOP_PCT: '95' })
  for (const [used, level] of [[799, 'ok'], [800, 'warn'], [949, 'warn'], [950, 'stop'], [1200, 'stop']]) {
    seedUsage(used)
    assert.equal(usageStatus(config).level, level, String(used))
  }
  assert.match(stopMessage(usageStatus(config)), /^Mem0 retrieval quota almost used: 1200\/1000\. Runs paused until 1 [A-Z][a-z]{2} \d{4} or a higher limit/)
})

function manager(config) {
  return createRunManager({ config, storeFactory: () => memoryStore(), notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
}

test('stop level: new runs are refused with the message; approve of a waiting draft is not blocked by the guard', async () => {
  const config = fakeConfig()
  seedUsage(960)
  const m = manager(config)
  await assert.rejects(m.startRun({ mode: 'full' }), (e) => e instanceof RunError && e.code === 'mem0_quota' && e.status === 429 && /960\/1000/.test(e.message))
  // approve goes past the guard (it then fails its own check: there is no waiting draft in this empty store).
  await assert.rejects(m.startRun({ mode: 'approve', params: { brief_id: '261020-1000-ABCD' } }), (e) => e.code !== 'mem0_quota')
})

test('warn level: the run summary gets a quota line; ok level: none', async () => {
  const restore = setSink(() => {})
  const config = fakeConfig()
  seedUsage(850)
  const m = manager(config)
  const { run_id } = await m.startRun({ mode: 'full' })
  const r = await m.wait(run_id)
  assert.ok(r.run.warnings.some((w) => /^Mem0 quota: 85\d\/1000 retrievals \(\d+(\.\d)?%\) and \d+\/10000 adds this month/.test(w)), JSON.stringify(r.run.warnings))
  seedUsage(10)
  const { run_id: id2 } = await m.startRun({ mode: 'full' })
  const r2 = await m.wait(id2)
  restore()
  assert.ok(!r2.run.warnings.some((w) => /Mem0 quota/.test(w)))
})

test('API: /api/health shows the estimate; at the stop level POST /api/index/refresh and POST /api/runs answer 429', async () => {
  const restore = setSink(() => {})
  const config = fakeConfig()
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager: manager(config), store: memoryStore(), config })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    seedUsage(500)
    let health = await (await fetch(`${url}/api/health`)).json()
    assert.deepEqual([health.mem0_usage.used, health.mem0_usage.limit, health.mem0_usage.level], [500, 1000, 'ok'])
    seedUsage(990)
    health = await (await fetch(`${url}/api/health`)).json()
    assert.equal(health.mem0_usage.level, 'stop')
    const refresh = await fetch(`${url}/api/index/refresh`, { method: 'POST' })
    assert.equal(refresh.status, 429)
    assert.match((await refresh.json()).error.message, /Mem0 retrieval quota almost used: 990\/1000/)
    const run = await fetch(`${url}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"mode":"full"}' })
    assert.equal(run.status, 429)
  } finally {
    await new Promise((r) => server.close(r))
    restore()
  }
})

test('--set: the figure from the Mem0 console, plus what is counted after it; a new month starts from zero', () => {
  const config = fakeConfig()
  let t = OCT20
  configureUsage(config, { now: () => t })
  recordUsage('reads', 30)
  const u = setUsage(config, 847, { now: () => t })
  assert.deepEqual([u.used, u.level, u.seed], [847, 'warn', 847])
  recordUsage('reads', 3)
  recordUsage('writes', 5)
  assert.equal(usageStatus(config, { now: () => t }).used, 850, 'writes are not retrievals')
  assert.throws(() => setUsage(config, -1), /whole number/)
  t = Date.parse('2026-11-01T00:00:01Z')
  assert.equal(usageStatus(config, { now: () => t }).used, 0)
})

test('Phase 12: writes never count against the 1,000 retrievals; the add quota has its own limit and can stop runs too', () => {
  const config = fakeConfig({ MEM0_MONTHLY_ADD_LIMIT: '200' })
  const month = new Date().toISOString().slice(0, 7)
  writeFileSync(FILE, JSON.stringify({ month, total: { reads: 100, searches: 0, writes: 900 }, days: {} }))
  const lots = usageStatus(fakeConfig())
  assert.deepEqual([lots.used, lots.level, lots.adds.used, lots.adds.level], [100, 'ok', 900, 'ok'], '900 writes are far from 10,000 adds')
  writeFileSync(FILE, JSON.stringify({ month, total: { reads: 10, searches: 0, writes: 195 }, days: {} }))
  const u = usageStatus(config)
  assert.deepEqual([u.used, u.level, u.limited, u.adds.used, u.adds.limit], [10, 'stop', 'adds', 195, 200])
  assert.match(stopMessage(u), /^Mem0 add quota almost used: 195\/200\. .*MEM0_MONTHLY_ADD_LIMIT/)
})

test('Phase 12 --set and --set-adds: both console figures; without adds the add figure keeps what was counted', () => {
  const config = fakeConfig()
  let t = OCT20
  configureUsage(config, { now: () => t })
  recordUsage('writes', 4)
  let u = setUsage(config, 619, { now: () => t })
  assert.deepEqual([u.used, u.seed, u.adds.used, u.seed_adds], [619, 619, 4, 4])
  u = setUsage(config, 619, { now: () => t, adds: 146 })
  assert.deepEqual([u.used, u.adds.used, u.level], [619, 146, 'ok'])
  recordUsage('searches', 1)
  recordUsage('writes', 2)
  u = usageStatus(config, { now: () => t })
  assert.deepEqual([u.used, u.adds.used], [620, 148])
  assert.throws(() => setUsage(config, 1, { adds: -2 }), /add figure/)
  // A file from before Phase 12 (one seed): taken as retrievals.
  writeFileSync(FILE, JSON.stringify({ month: '2026-10', seed: 552, total: { reads: 0, searches: 0, writes: 0 }, days: {} }))
  u = usageStatus(config, { now: () => t })
  assert.deepEqual([u.used, u.adds.used], [552, 0])
})
