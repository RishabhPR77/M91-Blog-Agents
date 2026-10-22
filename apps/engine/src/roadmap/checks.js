// Code checks for a roadmap (Phase 12, Task 2): what the Roadmap Planner (and every dashboard edit) must satisfy.
// They return plain problem lines; the Planner gets one repair call with them, an edit is refused with them.

import { STAGES, SLOT_ID_RE, SLOT_STATUSES, COMPARISON_RE } from './model.js'

export const SLOTS_MIN = 3
export const SLOTS_MAX = 6
export const STARTER_SLOTS = 2
const TITLE_MAX = 90
const QUESTION_MAX = 160
const TEACH_MAX = 5

/**
 * Slots that count towards a stage's size: every slot except the Scout's proposals waiting for the person. A
 * skipped slot still counts, so the person can always skip one (the picker treats it as done for "needs").
 */
const counted = (s) => s.status !== 'proposed'

/** All problems of a roadmap ([] when it is valid). */
export function roadmapProblems(roadmap) {
  const problems = []
  const stages = roadmap?.stages ?? []
  const numbers = stages.map((s) => s.number)
  for (const st of STAGES) if (numbers.filter((n) => n === st.number).length !== 1) problems.push(`stage ${st.number} (${st.name}) must appear exactly once`)
  if (stages.some((s) => !STAGES.some((x) => x.number === s.number))) problems.push('only stages 0–5 exist')

  const seen = new Map() // slot_id → position in reading order
  let pos = 0
  for (const st of [...stages].sort((a, b) => a.number - b.number)) {
    const slots = st.slots ?? []
    const n = slots.filter(counted).length
    if (st.number === 0 && n !== STARTER_SLOTS) problems.push(`stage 0 (Starter) must have exactly ${STARTER_SLOTS} slots (has ${n})`)
    if (st.number > 0 && (n < SLOTS_MIN || n > SLOTS_MAX)) problems.push(`stage ${st.number} (${st.name ?? ''}) must have ${SLOTS_MIN}–${SLOTS_MAX} slots (has ${n})`)
    for (const s of slots) {
      const id = String(s.slot_id ?? '')
      const where = `slot ${id || '(no id)'}`
      const m = id.match(SLOT_ID_RE)
      if (!m) problems.push(`${where}: slot_id must look like s<stage>-<n> (e.g. s1-2)`)
      else if (Number(m[1]) !== st.number) problems.push(`${where}: its id says stage ${m[1]} but it is in stage ${st.number}`)
      if (seen.has(id)) problems.push(`${where}: duplicate slot_id`)
      if (!SLOT_STATUSES.includes(s.status)) problems.push(`${where}: unknown status "${s.status}"`)
      const title = String(s.title_idea ?? '').trim()
      const question = String(s.question ?? '').trim()
      if (!title || title.length > TITLE_MAX) problems.push(`${where}: title_idea must be 1–${TITLE_MAX} characters`)
      if (!question.endsWith('?') || question.length > QUESTION_MAX) problems.push(`${where}: question must be the reader's question, ending with "?", at most ${QUESTION_MAX} characters`)
      if (!Array.isArray(s.teaches) || s.teaches.length < 1 || s.teaches.length > TEACH_MAX || s.teaches.some((t) => !String(t).trim())) problems.push(`${where}: teaches must list 1–${TEACH_MAX} concepts`)
      if (st.number !== 5 && COMPARISON_RE.test(`${title} ${question}`)) problems.push(`${where}: comparisons and migrations belong in stage 5 only`)
      // needs: only slots earlier in the reading order (no forward links, no circles, never itself).
      for (const need of s.needs ?? []) {
        if (need === id) problems.push(`${where}: needs itself`)
        else if (!seen.has(need)) problems.push(`${where}: needs ${need}, which ${roadmapHas(stages, need) ? 'comes later (needs may only point to earlier slots)' : 'does not exist'}`)
      }
      seen.set(id, pos++)
    }
  }
  return problems
}

const roadmapHas = (stages, id) => stages.some((st) => (st.slots ?? []).some((s) => s.slot_id === id))
