// What the next run writes about, before the editor (code only, no AI): a pinned topic that is due goes first, then
// a news card you chose with Write now (at most TIMELY_MAX_PER_WEEK per 7 days). Otherwise the weekly editor decides
// from this week's signals ({ kind: 'editor' }).
import { istDate } from '../util/time.js'
import { nextTimely, timelyTarget } from '../timely/model.js'

/** Pinned topics that are due today or earlier (open), high priority first, then the earliest date. */
export function duePins(pins, { today }) {
  return pins
    .filter((r) => r.status === 'open' && String(r.payload?.target_date) <= today)
    .sort((a, b) => (a.payload.priority === 'high' ? -1 : 0) - (b.payload.priority === 'high' ? -1 : 0) || String(a.payload.target_date).localeCompare(String(b.payload.target_date)))
}

/**
 * { kind: 'pinned', pin } | { kind: 'timely', opportunity } | { kind: 'editor' }. Any of them may carry
 * timelyWaiting ({ title, opportunity_id, reason }): a Write now card that has to wait.
 */
export async function pickTarget(store, { now = Date.now, config = null } = {}) {
  const today = istDate(new Date(now()))
  const pins = duePins(await store.getRecords({ type: 'pinned_topic' }), { today })
  if (pins.length) return { kind: 'pinned', pin: { pinned_id: pins[0].payload.pinned_id, topic: pins[0].payload.topic, notes: pins[0].payload.notes ?? '', record_id: pins[0].id } }
  const timely = await nextTimely(store, { config, now })
  if (timely.record) return timelyTarget(timely.record)
  const timelyWaiting = timely.waiting ? { title: timely.waiting.payload?.title ?? '', opportunity_id: timely.waiting.payload?.opportunity_id ?? null, reason: timely.reason } : null
  return { kind: 'editor', ...(timelyWaiting && { timelyWaiting }) }
}
