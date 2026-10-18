// Scheduler (Phase 3.5, Task 6): runs the full pipeline on SCHEDULE_CRON in TIMEZONE.
// Off by default. A `setting` record (key "schedule", saved from the dashboard) overrides
// SCHEDULE_ENABLED. A tick while a run is in progress is skipped and logged.

import { Cron } from 'croner'
import { log } from './util/log.js'
import { istIso } from './util/time.js'

export const SETTING_KEY = 'schedule'

const defaultCronFactory = (pattern, options, fn) => new Cron(pattern, options, fn)

/**
 * @param {{ config, store, manager, cronFactory?, now? }} deps  cronFactory(pattern, { timezone }, fn) → { nextRun(), stop() }
 */
export function createScheduler({ config, store, manager, cronFactory = defaultCronFactory, now = Date.now }) {
  let job = null
  let enabled = Boolean(config.schedule.enabled)
  let source = 'env'
  let settingRecordId = null
  let lastTick = null

  async function loadSetting() {
    const rows = (await store.getRecords({ type: 'setting' })).filter((r) => r.payload?.key === SETTING_KEY)
    const latest = rows.sort((a, b) => String(b.payload?.updated_at).localeCompare(String(a.payload?.updated_at)))[0]
    return latest ?? null
  }

  async function tick() {
    lastTick = istIso(new Date(now()))
    if (manager.isRunning()) {
      log.info('scheduled run skipped: a run is in progress', { active: manager.activeRunId() })
      return { skipped: true }
    }
    try {
      const { run_id } = await manager.startRun({ mode: 'full', trigger: 'cron', dryRun: config.runtime.dryRun })
      log.info('scheduled run started', { run_id })
      return { run_id }
    } catch (error) {
      log.warn('scheduled run not started', { error })
      return { skipped: true, error: error.message }
    }
  }

  function apply() {
    job?.stop()
    job = enabled ? cronFactory(config.schedule.cron, { timezone: config.content.timezone, protect: true }, tick) : null
  }

  function status() {
    const next = job?.nextRun?.()
    return {
      enabled,
      source,
      cron: config.schedule.cron,
      timezone: config.content.timezone,
      next_run_at: next ? istIso(next) : null,
      last_tick_at: lastTick
    }
  }

  return {
    /** Reads the saved setting (if any) and starts the cron job when enabled. */
    async start() {
      try {
        const saved = await loadSetting()
        if (saved && typeof saved.payload.enabled === 'boolean') {
          enabled = saved.payload.enabled
          source = 'setting'
          settingRecordId = saved.id
        }
      } catch (error) {
        log.warn('could not read the schedule setting; using SCHEDULE_ENABLED', { error })
      }
      apply()
      log.info('scheduler ready', status())
      return status()
    },
    /** Saves the dashboard's choice as a `setting` record (updated in place) and applies it. */
    async setEnabled(value) {
      const payload = { key: SETTING_KEY, enabled: Boolean(value), updated_at: istIso(new Date(now())) }
      if (settingRecordId) await store.updateRecord(settingRecordId, payload, { status: 'current' })
      else settingRecordId = (await store.createRecord({ type: 'setting', briefId: null, payload, status: 'current' })).id
      enabled = Boolean(value)
      source = 'setting'
      apply()
      return status()
    },
    status,
    tick,
    stop() {
      job?.stop()
      job = null
    }
  }
}
