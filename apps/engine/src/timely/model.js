// The timely lane (next to the roadmap): timely_opportunity records, their statuses and the person's actions, and
// the rules that decide when a timely post may be written. Code only, no AI.
//
// Statuses: proposed (found by a news check) → write_now (you clicked Write now; the next run writes it) →
// written (approved). Or added_to_roadmap (it became a planned slot), dismissed, expired (TIMELY_WINDOW_DAYS after
// the event's date, if still proposed or write_now and not being written).

import { istDate, istIso } from '../util/time.js'
import { daysAgo } from '../scout/checks.js'
import { loadRoadmap, saveRoadmap } from '../roadmap/model.js'
import { roadmapProblems } from '../roadmap/checks.js'
import { log } from '../util/log.js'

export const TIMELY_STATUSES = Object.freeze(['proposed', 'write_now', 'added_to_roadmap', 'dismissed', 'written', 'expired'])
export const OPEN_STATUSES = Object.freeze(['proposed', 'write_now'])
export const ACTIONS = Object.freeze(['write_now', 'add_to_roadmap', 'dismiss'])

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

/** The Starter (stage 0) has at least one approved post. */
export async function starterApproved(store) {
  const rec = await loadRoadmap(store)
  return Boolean(rec?.payload?.stages?.find((st) => st.number === 0)?.slots?.some((s) => s.status === 'approved'))
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
  if (!(await starterApproved(store))) return { record: null, waiting: ready[0], reason: 'Timely posts start once the Starter (stage 0) has an approved post' }
  const done = timelyThisWeek(all, { now })
  if (done >= config.timely.maxPerWeek) return { record: null, waiting: ready[0], reason: `TIMELY_MAX_PER_WEEK (${config.timely.maxPerWeek}) timely post${config.timely.maxPerWeek === 1 ? '' : 's'} already written in the last 7 days` }
  return { record: ready[0], waiting: null, reason: null }
}

/** The opportunity as the run's target (what the Scout, Strategist and Writer get). */
export const timelyTarget = (rec) => ({ kind: 'timely', opportunity: { record_id: rec.id, ...rec.payload } })

/**
 * The person's action on a card: write_now | add_to_roadmap (with stage) | dismiss. One write (two for
 * add_to_roadmap: the roadmap and the card). Returns the updated card.
 */
export async function applyAction(store, id, action, { stage, now = Date.now } = {}) {
  if (!ACTIONS.includes(action)) throw new TimelyError('bad_params', `action must be one of ${ACTIONS.join(', ')}`)
  const rec = (await listOpportunities(store)).find((r) => r.id === id || r.payload?.opportunity_id === id)
  if (!rec) throw new TimelyError('not_found', `no timely opportunity ${id}`, 404)
  if (rec.payload?.brief_id) throw new TimelyError('in_progress', `${rec.payload.title} is being written (brief ${rec.payload.brief_id})`, 409)
  const allowed = { write_now: ['proposed'], add_to_roadmap: ['proposed', 'write_now'], dismiss: ['proposed', 'write_now'] }[action]
  if (!allowed.includes(rec.status)) throw new TimelyError('bad_status', `${rec.payload?.title ?? id} is ${rec.status}: ${action.replace(/_/g, ' ')} is not possible`, 409)
  const at = istIso(new Date(now()))
  let payload = { ...rec.payload }
  let status = action === 'write_now' ? 'write_now' : action === 'dismiss' ? 'dismissed' : 'added_to_roadmap'
  if (action === 'write_now') payload.write_now_at = at
  if (action === 'dismiss') payload.dismissed_at = at
  if (action === 'add_to_roadmap') {
    const slotId = await addSlot(store, rec.payload, Number(stage), { now })
    payload = { ...payload, slot_id: slotId, added_at: at }
  }
  await store.updateRecord(rec.id, payload, { status }, { known: rec })
  return { ...rec, status, payload }
}

/** Adds a planned slot for the card in the stage picked (the roadmap's checks apply). Returns its slot id. */
async function addSlot(store, opp, stageNumber, { now }) {
  if (!Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > 5) throw new TimelyError('bad_params', 'pick a stage from 1 to 5')
  const rec = await loadRoadmap(store)
  if (!rec?.payload) throw new TimelyError('no_roadmap', 'there is no roadmap yet: generate it first', 409)
  const roadmap = structuredClone(rec.payload)
  const st = roadmap.stages.find((x) => x.number === stageNumber)
  if (!st) throw new TimelyError('bad_params', `the roadmap has no stage ${stageNumber}`)
  const used = new Set(st.slots.map((s) => s.slot_id))
  let n = 1
  while (used.has(`s${st.number}-${n}`)) n++
  const question = /\?$/.test(opp.title) ? opp.title : `What does "${opp.title}" mean for teams that need a person to decide in time?`
  // One concept to start with (the roadmap needs 1–5); edit it on the Roadmap page.
  st.slots.push({ slot_id: `s${st.number}-${n}`, title_idea: String(opp.title).slice(0, 90), question, teaches: [String(opp.title).slice(0, 80)], needs: [], status: 'planned', brief_id: '', from_opportunity: opp.opportunity_id, evidence_url: opp.source_url })
  const problems = roadmapProblems(roadmap)
  if (problems.length) throw new TimelyError('roadmap_problem', `not added to stage ${stageNumber}: ${problems[0]}`, 409)
  await saveRoadmap(store, roadmap, rec, { now })
  return `s${st.number}-${n}`
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
