// What the person does with the roadmap (Phase 12, Tasks 2 and 7): approve it, edit, move, skip or restore a
// slot, accept or reject a slot the Scout proposed. Each action checks the result with roadmapProblems and saves
// the one roadmap record (about 2 Mem0 requests). An edit to an approved roadmap keeps it approved.

import { loadRoadmap, saveRoadmap, LOCKED_STATUSES } from './model.js'
import { roadmapProblems } from './checks.js'

export class RoadmapError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = 'RoadmapError'
    this.code = code
    this.status = status
  }
}

async function current(store) {
  const rec = await loadRoadmap(store)
  if (!rec?.payload) throw new RoadmapError('no_roadmap', 'there is no roadmap yet: generate it first (npm run roadmap -- --generate)', 404)
  return rec
}

function findSlot(roadmap, slotId) {
  for (const st of roadmap.stages) {
    const i = st.slots.findIndex((s) => s.slot_id === slotId)
    if (i >= 0) return { stage: st, index: i, slot: st.slots[i] }
  }
  throw new RoadmapError('unknown_slot', `no slot ${slotId}`, 404)
}

async function commit(store, rec, roadmap, now) {
  const problems = roadmapProblems(roadmap)
  if (problems.length) throw new RoadmapError('roadmap_invalid', `the roadmap would not be valid: ${problems.slice(0, 3).join('; ')}`, 400)
  return saveRoadmap(store, roadmap, rec, { now })
}

const clone = (x) => structuredClone(x)

/** The person approves the roadmap: runs can start. */
export async function approveRoadmap(store, { now = Date.now } = {}) {
  const rec = await current(store)
  const roadmap = { ...clone(rec.payload), status: 'approved', approved_at: new Date(now()).toISOString() }
  return commit(store, rec, roadmap, now)
}

/** Edits a slot's words or its needs. Only planned or proposed slots (work on the others has started). */
export async function editSlot(store, slotId, changes = {}, { now = Date.now } = {}) {
  const rec = await current(store)
  const roadmap = clone(rec.payload)
  const { slot } = findSlot(roadmap, slotId)
  if (LOCKED_STATUSES.includes(slot.status) && slot.status !== 'skipped') throw new RoadmapError('slot_locked', `slot ${slotId} is ${slot.status}: it can no longer be edited`)
  for (const k of ['title_idea', 'question']) if (changes[k] !== undefined) slot[k] = String(changes[k]).trim()
  for (const k of ['teaches', 'needs']) if (changes[k] !== undefined) slot[k] = Array.isArray(changes[k]) ? changes[k].map((x) => String(x).trim()).filter(Boolean) : slot[k]
  return commit(store, rec, roadmap, now)
}

/** Moves a slot up or down within its stage (needs must still point to earlier slots). */
export async function moveSlot(store, slotId, direction, { now = Date.now } = {}) {
  if (!['up', 'down'].includes(direction)) throw new RoadmapError('bad_params', 'direction must be up or down', 400)
  const rec = await current(store)
  const roadmap = clone(rec.payload)
  const { stage, index } = findSlot(roadmap, slotId)
  const j = direction === 'up' ? index - 1 : index + 1
  if (j < 0 || j >= stage.slots.length) throw new RoadmapError('cannot_move', `slot ${slotId} is already at the ${direction === 'up' ? 'top' : 'bottom'} of its stage`, 400)
  ;[stage.slots[index], stage.slots[j]] = [stage.slots[j], stage.slots[index]]
  return commit(store, rec, roadmap, now)
}

/** Skips a planned slot (never picked), or restores a skipped one to planned. */
export async function setSkipped(store, slotId, skipped, { now = Date.now } = {}) {
  const rec = await current(store)
  const roadmap = clone(rec.payload)
  const { slot } = findSlot(roadmap, slotId)
  if (skipped && slot.status !== 'planned') throw new RoadmapError('slot_locked', `only a planned slot can be skipped (${slotId} is ${slot.status})`)
  if (!skipped && slot.status !== 'skipped') throw new RoadmapError('bad_params', `slot ${slotId} is not skipped`, 400)
  slot.status = skipped ? 'skipped' : 'planned'
  return commit(store, rec, roadmap, now)
}

/** Accepts a slot the Scout proposed (it becomes planned) or rejects it (it is removed). */
export async function decideProposed(store, slotId, accept, { now = Date.now } = {}) {
  const rec = await current(store)
  const roadmap = clone(rec.payload)
  const { stage, index, slot } = findSlot(roadmap, slotId)
  if (slot.status !== 'proposed') throw new RoadmapError('not_proposed', `slot ${slotId} is ${slot.status}, not proposed`)
  if (accept) slot.status = 'planned'
  else stage.slots.splice(index, 1)
  return commit(store, rec, roadmap, now)
}

/**
 * Marks a planned slot as covered by a published guide (it is done, never written), or puts a covered slot back to
 * planned (guide null). guide: { url, title } of a known published guide.
 */
export async function setCovered(store, slotId, guide, { now = Date.now } = {}) {
  const rec = await current(store)
  const roadmap = clone(rec.payload)
  const { slot } = findSlot(roadmap, slotId)
  if (guide) {
    if (slot.status !== 'planned') throw new RoadmapError('slot_locked', `only a planned slot can be marked covered (${slotId} is ${slot.status})`)
    slot.status = 'covered'
    slot.covered_by = { url: guide.url, title: guide.title }
  } else {
    if (slot.status !== 'covered') throw new RoadmapError('bad_params', `slot ${slotId} is not covered`, 400)
    slot.status = 'planned'
    delete slot.covered_by
  }
  return commit(store, rec, roadmap, now)
}

