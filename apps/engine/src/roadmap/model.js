// The Roadmap (Phase 12, Task 2): one `roadmap` record holds the planned learning path. Six fixed stages, each
// with slots (one future post each). Code owns the stages; the Roadmap Planner (src/planner/) fills the slots,
// and the person approves the roadmap before any pipeline run (Task 3).

export const LEVELS = Object.freeze(['beginner', 'intermediate', 'advanced'])
// covered: a guide already live on msg91.com/guide answers this slot (slot.covered_by = { url, title }); it is done
// and never written again.
export const SLOT_STATUSES = Object.freeze(['planned', 'drafting', 'in_review', 'approved', 'skipped', 'proposed', 'covered'])
/** Slots a (re)generation never changes: work has started on them, or the person decided about them. */
export const LOCKED_STATUSES = Object.freeze(['drafting', 'in_review', 'approved', 'skipped', 'covered'])

export const STAGES = Object.freeze([
  { number: 0, name: 'Starter', level: 'beginner', goal: 'What M91 is, why software needs a human sometimes, and how it works, for someone who has never heard of it.' },
  { number: 1, name: 'Foundations', level: 'beginner', goal: 'The ideas behind it in plain words: a human decision in a running process, an alert that wakes a person, one owner, the answer going back to the software.' },
  { number: 2, name: 'First steps', level: 'beginner', goal: 'Set it up and send the first alerts, step by step, only from the M91 docs and their code.' },
  { number: 3, name: 'Use cases', level: 'intermediate', goal: 'Where it helps: real situations (AI agents, payments, on-call, deployments, operations) and what the human decides in each.' },
  { number: 4, name: 'Best practices', level: 'intermediate', goal: 'Doing it well: what is worth waking someone for, timeouts and safe defaults, escalation, clear alert text, testing.' },
  { number: 5, name: 'Comparisons and migrations', level: 'advanced', goal: 'M91 next to other ways of reaching a person, and moving from them.' }
])

export const SLOT_ID_RE = /^s([0-5])-([1-9][0-9]?)$/
/** Comparisons, "vs" and migrations belong in Stage 5 only. */
export const COMPARISON_RE = /\b(vs\.?|versus|compared? (to|with)|comparisons?|alternatives? to|instead of|migrat(e|es|ing|ion))\b/i

/** Every slot in reading order: stage by stage, then as listed. */
export const allSlots = (roadmap) => (roadmap?.stages ?? []).flatMap((st) => (st.slots ?? []).map((s) => ({ ...s, stage: st.number })))

/** slot_id → slot (with its stage number). */
export function slotIndex(roadmap) {
  return new Map(allSlots(roadmap).map((s) => [s.slot_id, s]))
}

/** The newest roadmap record, or null. */
export async function loadRoadmap(store) {
  const recs = await store.getRecords({ type: 'roadmap' })
  return recs.sort((a, b) => String(b.payload?.updated_at ?? b.date).localeCompare(String(a.payload?.updated_at ?? a.date)))[0] ?? null
}

/** Saves the roadmap: updates its one record (create when there is none). The record status follows roadmap.status. */
export async function saveRoadmap(store, roadmap, existing = null, { now = Date.now } = {}) {
  const payload = { ...roadmap, updated_at: new Date(now()).toISOString() }
  if (existing?.id) {
    await store.updateRecord(existing.id, payload, { status: payload.status }, { known: existing })
    return { ...existing, status: payload.status, payload }
  }
  return store.createRecord({ type: 'roadmap', payload, status: payload.status })
}

/** A stage list (from STAGES) with the given slots per stage number. */
export function withStages(slotsByStage) {
  return STAGES.map((st) => ({ ...st, slots: (slotsByStage[st.number] ?? []).map((s) => ({ ...s })) }))
}
