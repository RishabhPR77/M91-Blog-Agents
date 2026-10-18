import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Cron } from 'croner'
import { createScheduler } from '../src/scheduler.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, memoryStore } from './helpers.js'

/** A fake cron: records the pattern, lets the test fire ticks by hand. */
function fakeCron() {
  const jobs = []
  const factory = (pattern, options, fn) => {
    const job = { pattern, options, fn, stopped: false, nextRun: () => new Date('2026-10-19T01:30:00Z'), stop() { this.stopped = true } }
    jobs.push(job)
    return job
  }
  return { factory, jobs, active: () => jobs.filter((j) => !j.stopped) }
}

function fakeManager({ running = false } = {}) {
  const started = []
  return { started, isRunning: () => running, activeRunId: () => (running ? 'R-x' : null), startRun: async (args) => { started.push(args); return { run_id: 'R-261019-0700-ABCD' } } }
}

const quiet = () => setSink(() => {})

test('off by default: no cron job', async () => {
  const restore = quiet()
  const cron = fakeCron()
  const s = createScheduler({ config: fakeConfig(), store: memoryStore(), manager: fakeManager(), cronFactory: cron.factory })
  const st = await s.start()
  restore()
  assert.equal(st.enabled, false)
  assert.equal(st.next_run_at, null)
  assert.equal(cron.active().length, 0)
})

test('SCHEDULE_ENABLED=true: pattern and timezone from config; a tick starts a full cron run', async () => {
  const restore = quiet()
  const cron = fakeCron()
  const manager = fakeManager()
  const s = createScheduler({ config: fakeConfig({ SCHEDULE_ENABLED: 'true', DRY_RUN: 'true' }), store: memoryStore(), manager, cronFactory: cron.factory })
  const st = await s.start()
  assert.equal(st.enabled, true)
  assert.equal(st.source, 'env')
  assert.equal(st.next_run_at, '2026-10-19T07:00:00+05:30')
  assert.equal(cron.jobs[0].pattern, '0 7 * * 1,3,5')
  assert.equal(cron.jobs[0].options.timezone, 'Asia/Kolkata')
  await cron.jobs[0].fn()
  restore()
  assert.deepEqual(manager.started, [{ mode: 'full', trigger: 'cron', dryRun: true }])
})

test('a tick while a run is in progress is skipped', async () => {
  const restore = quiet()
  const cron = fakeCron()
  const manager = fakeManager({ running: true })
  const s = createScheduler({ config: fakeConfig({ SCHEDULE_ENABLED: 'true' }), store: memoryStore(), manager, cronFactory: cron.factory })
  await s.start()
  const r = await cron.jobs[0].fn()
  restore()
  assert.deepEqual(r, { skipped: true })
  assert.equal(manager.started.length, 0)
})

test('the setting record overrides the env value, and setEnabled saves one record (updated in place)', async () => {
  const restore = quiet()
  const store = memoryStore()
  await store.createRecord({ type: 'setting', status: 'current', payload: { key: 'schedule', enabled: true, updated_at: '2026-10-18T09:00:00+05:30' } })
  const cron = fakeCron()
  const s = createScheduler({ config: fakeConfig({ SCHEDULE_ENABLED: 'false' }), store, manager: fakeManager(), cronFactory: cron.factory })
  const st = await s.start()
  assert.equal(st.enabled, true)
  assert.equal(st.source, 'setting')
  assert.equal(cron.active().length, 1)

  const off = await s.setEnabled(false)
  assert.equal(off.enabled, false)
  assert.equal(cron.active().length, 0)
  const on = await s.setEnabled(true)
  restore()
  assert.equal(on.enabled, true)
  assert.equal(cron.active().length, 1)
  const settings = [...store.records.values()].filter((r) => r.type === 'setting')
  assert.equal(settings.length, 1, 'updated by memory id, never a second copy')
  assert.equal(settings[0].payload.enabled, true)
})

test('the real croner computes the next run in the time zone (Mon/Wed/Fri 07:00 IST)', () => {
  const job = new Cron('0 7 * * 1,3,5', { timezone: 'Asia/Kolkata', paused: true, startAt: '2026-10-18T00:00:00+05:30' })
  const next = job.nextRun(new Date('2026-10-18T00:00:00+05:30')) // a Sunday
  job.stop()
  assert.equal(next.toISOString(), '2026-10-19T01:30:00.000Z') // Monday 07:00 IST
})

test('SCHEDULE_CRON is validated', () => {
  assert.throws(() => fakeConfig({ SCHEDULE_CRON: 'every monday' }), /SCHEDULE_CRON/)
  assert.doesNotThrow(() => fakeConfig({ SCHEDULE_CRON: '*/15 9-18 * * 1-5' }))
})
