// Picking the next post (Phase 12, Task 3): code only, no AI. A pinned topic that is due goes first, then one timely
// opportunity you chose with Write now (the timely lane: once the Starter has an approved post, at most
// TIMELY_MAX_PER_WEEK per 7 days; it never uses up a slot). Otherwise the
// lowest stage that is not finished, then its first planned slot whose needs are all done. A slot is done when it
// is approved (its Markdown export is saved on approval), skipped, or covered by a published guide. Proposed slots are
// never picked.
// Also the slot status updates of a run: drafting → in_review → approved, back to planned when the run fails,
// skipped when the topic is rejected. Each is one write of the roadmap record.

import { loadRoadmap, saveRoadmap } from './model.js'
import { istDate } from '../util/time.js'
import { log } from '../util/log.js'
import { nextTimely, timelyTarget } from '../timely/model.js'
import { chooseNext } from './editor.js'

const DONE = new Set(['approved', 'skipped', 'covered'])

/**
 * The next slot of an approved roadmap: { slot, stage } or { slot: null, reason }.
 * Only "planned" slots are picked; a stage is finished when every slot in it (except proposed ones) is done.
 */
export function nextSlot(roadmap) {
  if (!roadmap) return { slot: null, reason: 'there is no roadmap yet: generate it (Roadmap page, or npm run roadmap -- --generate)' }
  if (roadmap.status !== 'approved') return { slot: null, reason: 'Approve the roadmap first' }
  const status = new Map(roadmap.stages.flatMap((st) => st.slots.map((s) => [s.slot_id, s.status])))
  for (const st of [...roadmap.stages].sort((a, b) => a.number - b.number)) {
    const slots = st.slots.filter((s) => s.status !== 'proposed')
    if (slots.every((s) => DONE.has(s.status))) continue
    const ready = slots.find((s) => s.status === 'planned' && (s.needs ?? []).every((n) => DONE.has(status.get(n))))
    if (ready) return { slot: { ...ready }, stage: { number: st.number, name: st.name, level: st.level, goal: st.goal } }
    const busy = slots.filter((s) => s.status === 'drafting' || s.status === 'in_review').map((s) => `${s.slot_id} is ${s.status.replace('_', ' ')}`)
    const blocked = slots.filter((s) => s.status === 'planned').map((s) => `${s.slot_id} needs ${(s.needs ?? []).filter((n) => !DONE.has(status.get(n))).join(', ')}`)
    return { slot: null, reason: `stage ${st.number} (${st.name}) has nothing ready: ${[...busy, ...blocked].join('; ') || 'no planned slot'}` }
  }
  return { slot: null, reason: 'every stage of the roadmap is finished' }
}

/** Pinned topics that are due today or earlier (open), high priority first, then the earliest date. */
export function duePins(pins, { today }) {
  return pins
    .filter((r) => r.status === 'open' && String(r.payload?.target_date) <= today)
    .sort((a, b) => (a.payload.priority === 'high' ? -1 : 0) - (b.payload.priority === 'high' ? -1 : 0) || String(a.payload.target_date).localeCompare(String(b.payload.target_date)))
}

/**
 * What the next run writes about: { kind: 'pinned', pin } | { kind: 'timely', opportunity } |
 * { kind: 'slot', slot, stage, roadmapRecord } | { kind: 'none', reason }. A slot or none may carry timelyWaiting
 * ({ title, reason }): a Write now card that waits. Reads the pinned topics, the timely cards and the roadmap
 * (from the engine's index when it runs). config: needed for the timely lane (without it, the lane is off).
 */
export async function pickTarget(store, { now = Date.now, config = null } = {}) {
  const today = istDate(new Date(now()))
  const pins = duePins(await store.getRecords({ type: 'pinned_topic' }), { today })
  if (pins.length) return { kind: 'pinned', pin: { pinned_id: pins[0].payload.pinned_id, topic: pins[0].payload.topic, notes: pins[0].payload.notes ?? '', record_id: pins[0].id } }
  const timely = await nextTimely(store, { config, now })
  if (timely.record) return timelyTarget(timely.record)
  const timelyWaiting = timely.waiting ? { title: timely.waiting.payload?.title ?? '', opportunity_id: timely.waiting.payload?.opportunity_id ?? null, reason: timely.reason } : null
  const rec = await loadRoadmap(store)
  // The editor (NEXT_PICK=editor): news, a tutorial or the next slot, never a near-repeat, with a reason.
  if (config && config.editor?.mode !== 'roadmap') {
    const c = await chooseNext(store, { config, roadmap: rec?.payload ?? null, now })
    const extra = { why: c.why ?? null, skipped: c.skipped ?? [], ...(timelyWaiting && { timelyWaiting }) }
    if (c.kind === 'timely') return { ...timelyTarget(c.record), chosenByEditor: true, ...extra }
    if (c.kind === 'slot') return { kind: 'slot', slot: c.slot, stage: c.stage, roadmapRecord: rec, ...extra }
    if (c.reason) return { kind: 'none', reason: c.reason, ...extra }
  }
  const picked = nextSlot(rec?.payload ?? null)
  if (!picked.slot) return { kind: 'none', reason: picked.reason, ...(timelyWaiting && { timelyWaiting }) }
  return { kind: 'slot', slot: picked.slot, stage: picked.stage, roadmapRecord: rec, ...(timelyWaiting && { timelyWaiting }) }
}

/**
 * Sets one slot's status (and brief id). Finds the slot by slot_id, or by brief_id when no slot_id is given.
 * Never throws: a failed update is logged and returned as { ok: false } (the run or the approval stands).
 */
export async function setSlotStatus(store, { slotId = null, briefId = null }, status, { setBriefId, now = Date.now } = {}) {
  try {
    const rec = await loadRoadmap(store)
    if (!rec?.payload) return { ok: false, reason: 'no roadmap' }
    const roadmap = structuredClone(rec.payload)
    const slot = roadmap.stages.flatMap((st) => st.slots).find((s) => (slotId ? s.slot_id === slotId : briefId && s.brief_id === briefId))
    if (!slot) return { ok: false, reason: 'no such slot' }
    if (slot.status === status && (setBriefId === undefined || slot.brief_id === setBriefId)) return { ok: true, unchanged: true, slot_id: slot.slot_id }
    slot.status = status
    if (setBriefId !== undefined) slot.brief_id = setBriefId
    await saveRoadmap(store, roadmap, rec, { now })
    return { ok: true, slot_id: slot.slot_id }
  } catch (error) {
    log.warn('roadmap slot status not saved', { slotId, briefId, status, error })
    return { ok: false, reason: error.message }
  }
}
