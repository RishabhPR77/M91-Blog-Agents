// The news cards: timely_opportunity records, their statuses and the person's actions, and the rules that decide
// when a Write now card is written. Code only, no AI. The weekly editor reads the open cards as this week's news.
//
// Statuses: proposed (found by a news check) → write_now (you clicked Write now; the next run writes it) →
// written (approved). Or dismissed, expired (TIMELY_WINDOW_DAYS after the event's date, if still proposed or
// write_now and not being written). added_to_roadmap is kept only so older cards still load.

import { istDate, istIso } from '../util/time.js'
import { daysAgo } from '../scout/checks.js'
import { log } from '../util/log.js'

export const TIMELY_STATUSES = Object.freeze(['proposed', 'write_now', 'added_to_roadmap', 'dismissed', 'written', 'expired'])
export const OPEN_STATUSES = Object.freeze(['proposed', 'write_now'])
export const ACTIONS = Object.freeze(['write_now', 'dismiss'])

export class TimelyError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'TimelyError'
    this.code = code
    this.status = status
  }
}

export const listOpportunities = async (store) => store.getRecords({ type: 'timely_opportunity' })

/** Is a card past its window (TIMELY_WINDOW_DAYS after the event's date)? A card being written never expires. */
export function isExpired(rec, { today, windowDays }) {
  if (!OPEN_STATUSES.includes(rec.status) || rec.payload?.brief_id) return false
  const age = daysAgo(rec.payload?.published_date, today)
  return age === null || age > windowDays
}

/** Marks expired cards (one write each). Returns the number expired. Never throws. */
export async function expireOld(store, { config, now = Date.now }) {
  const today = istDate(new Date(now()))
  let n = 0
  for (const r of await listOpportunities(store)) {
    if (!isExpired(r, { today, windowDays: config.timely.windowDays })) continue
    try {
      await store.updateRecord(r.id, { ...r.payload, expired_at: istIso(new Date(now())) }, { status: 'expired' }, { known: r })
      n++
    } catch (error) {
      log.warn('timely card not expired', { id: r.id, error })
    }
  }
  return n
}

/** Timely posts written (approved) or being written in the last 7 days. */
export function timelyThisWeek(records, { now = Date.now }) {
  const since = now() - 7 * 86400000
  return records.filter((r) => (r.status === 'written' && Date.parse(r.payload?.written_at ?? '') >= since) || (r.status === 'write_now' && r.payload?.brief_id && Date.parse(r.payload?.writing_started_at ?? '') >= since)).length
}

/**
 * The write_now card the next run would write, or why none can be written now.
 * @returns {Promise<{ record: object|null, waiting: object|null, reason: string|null }>}
 *   record: the card to write; waiting: a write_now card that waits (with reason).
 */
export async function nextTimely(store, { config, now = Date.now }) {
  if (!config?.timely?.enabled) return { record: null, waiting: null, reason: null }
  const today = istDate(new Date(now()))
  const all = await listOpportunities(store)
  const ready = all
    .filter((r) => r.status === 'write_now' && !r.payload?.brief_id && !isExpired(r, { today, windowDays: config.timely.windowDays }))
    .sort((a, b) => String(a.payload?.write_now_at ?? '').localeCompare(String(b.payload?.write_now_at ?? '')))
  if (!ready.length) return { record: null, waiting: null, reason: null }
  const done = timelyThisWeek(all, { now })
  if (done >= config.timely.maxPerWeek) return { record: null, waiting: ready[0], reason: `TIMELY_MAX_PER_WEEK (${config.timely.maxPerWeek}) timely post${config.timely.maxPerWeek === 1 ? '' : 's'} already written in the last 7 days` }
  return { record: ready[0], waiting: null, reason: null }
}

/** The opportunity as the run's target (what the Scout, Strategist and Writer get). */
export const timelyTarget = (rec) => ({ kind: 'timely', opportunity: { record_id: rec.id, ...rec.payload } })

/** The person's action on a card: write_now | dismiss (one write). Returns the updated card. */
export async function applyAction(store, id, action, { now = Date.now } = {}) {
  if (!ACTIONS.includes(action)) throw new TimelyError('bad_params', `action must be one of ${ACTIONS.join(', ')}`)
  const rec = (await listOpportunities(store)).find((r) => r.id === id || r.payload?.opportunity_id === id)
  if (!rec) throw new TimelyError('not_found', `no timely opportunity ${id}`, 404)
  if (rec.payload?.brief_id) throw new TimelyError('in_progress', `${rec.payload.title} is being written (brief ${rec.payload.brief_id})`, 409)
  const allowed = { write_now: ['proposed'], dismiss: ['proposed', 'write_now'] }[action]
  if (!allowed.includes(rec.status)) throw new TimelyError('bad_status', `${rec.payload?.title ?? id} is ${rec.status}: ${action.replace(/_/g, ' ')} is not possible`, 409)
  const at = istIso(new Date(now()))
  const payload = { ...rec.payload, ...(action === 'write_now' ? { write_now_at: at } : { dismissed_at: at }) }
  const status = action === 'write_now' ? 'write_now' : 'dismissed'
  await store.updateRecord(rec.id, payload, { status }, { known: rec })
  return { ...rec, status, payload }
}

/** A run starts writing the card (brief id saved). Never throws. */
export async function markWriting(store, recordId, briefId, { now = Date.now } = {}) {
  return setFields(store, recordId, { brief_id: briefId, writing_started_at: istIso(new Date(now())) })
}
/** The run failed or was cancelled: the card waits again (still write_now). */
export async function releaseWriting(store, recordId) {
  return setFields(store, recordId, { brief_id: '', writing_started_at: '' })
}
/** The timely post was approved (status written) or its topic rejected (dismissed). Finds the card by brief id. */
export async function finishTimely(store, briefId, outcome, { now = Date.now } = {}) {
  try {
    const rec = (await listOpportunities(store)).find((r) => r.payload?.brief_id === briefId)
    if (!rec) return { ok: false }
    const at = istIso(new Date(now()))
    const status = outcome === 'approved' ? 'written' : 'dismissed'
    await store.updateRecord(rec.id, { ...rec.payload, ...(status === 'written' ? { written_at: at } : { dismissed_at: at }) }, { status }, { known: rec })
    return { ok: true, opportunity_id: rec.payload?.opportunity_id ?? null, status }
  } catch (error) {
    log.warn('timely card not updated', { briefId, error })
    return { ok: false }
  }
}

async function setFields(store, recordId, fields) {
  try {
    const rec = (await listOpportunities(store)).find((r) => r.id === recordId)
    if (!rec) return { ok: false }
    await store.updateRecord(rec.id, { ...rec.payload, ...fields }, {}, { known: rec })
    return { ok: true }
  } catch (error) {
    log.warn('timely card not updated', { recordId, error })
    return { ok: false }
  }
}
