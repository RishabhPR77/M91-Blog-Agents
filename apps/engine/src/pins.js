// Pinned topics: shared by `npm run pin` and the dashboard API (same rules for both).

import { newRecordId } from './util/ids.js'

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export class PinError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'PinError'
    this.code = code
    this.status = status
  }
}

const view = (r) => ({ pinned_id: r.payload?.pinned_id, topic: r.payload?.topic, target_date: r.payload?.target_date, priority: r.payload?.priority ?? 'normal', notes: r.payload?.notes ?? '', status: r.status, used_by: r.payload?.used_by ?? null })

export async function listPins(store) {
  return (await store.getRecords({ type: 'pinned_topic' }))
    .sort((a, b) => String(a.payload?.target_date).localeCompare(String(b.payload?.target_date)))
    .map(view)
}

/** Validates and saves a pinned topic. Returns { pin, saved } (saved is false in DRY_RUN). */
export async function addPin(store, { topic, date, priority, notes } = {}) {
  const t = typeof topic === 'string' ? topic.trim() : ''
  if (!t) throw new PinError('bad_topic', 'topic is required')
  if (t.length > 300) throw new PinError('bad_topic', 'topic must be at most 300 characters')
  if (!DATE_RE.test(String(date)) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new PinError('bad_date', 'date must be YYYY-MM-DD')
  if (priority !== undefined && priority !== 'high' && priority !== 'normal') throw new PinError('bad_priority', 'priority must be "high" or "normal"')
  if (notes !== undefined && typeof notes !== 'string') throw new PinError('bad_notes', 'notes must be text')
  const payload = { pinned_id: newRecordId('PIN'), topic: t, target_date: date, priority: priority ?? 'normal', notes: notes ?? '' }
  const rec = await store.createRecord({ type: 'pinned_topic', briefId: null, payload, status: 'open' })
  return { pin: view({ ...rec, payload, status: 'open' }), saved: !rec.dryRun }
}

export async function cancelPin(store, pinnedId) {
  const pin = (await store.getRecords({ type: 'pinned_topic' })).find((p) => p.payload?.pinned_id === pinnedId)
  if (!pin) throw new PinError('not_found', `no pinned topic ${pinnedId}`, 404)
  if (pin.status !== 'open') throw new PinError('not_open', `pinned topic ${pinnedId} is ${pin.status}`, 409)
  await store.updateRecord(pin.id, pin.payload, { status: 'cancelled' })
  return view({ ...pin, status: 'cancelled' })
}
