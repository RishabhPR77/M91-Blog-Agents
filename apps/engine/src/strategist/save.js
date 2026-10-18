// Saving the brief and updating leads (Phase 3 brief, sections 11–12).
// Order matters: the brief is saved first, then the leads; a lead update is retried once.

import { slugify } from '../util/ids.js'
import { istDate, istIso } from '../util/time.js'
import { log } from '../util/log.js'

/** Adds the fields code owns (brief 8, last paragraph). */
export function finalizeBrief(brief, { briefId, briefVersion, runId, config, now = Date.now }) {
  const d = new Date(now())
  return {
    ...brief,
    brief_id: briefId,
    brief_version: briefVersion,
    slug: slugify(brief.titles[0] ?? briefId),
    date: istDate(d),
    word_target: { min: config.content.targetWordsMin, max: config.content.targetWordsMax },
    reading_level: { intro_max_grade: config.content.readingGradeIntroMax, post_max_grade: config.content.readingGradePostMax },
    run_id: runId,
    created_at: istIso(d)
  }
}

export async function saveBrief(store, brief) {
  return store.createRecord({
    type: 'brief',
    briefId: brief.brief_id,
    payload: brief,
    status: 'new',
    version: brief.brief_version,
    topicGroup: brief.topic_group,
    date: brief.date
  })
}

/** Sets a lead record's status (and used_by), retrying once. Returns a warning string on failure. */
export async function setLeadStatus(store, record, status, usedBy) {
  const payload = { ...record.payload, ...(usedBy !== undefined && { used_by: usedBy }) }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await store.updateRecord(record.id, payload, { status })
      return null
    } catch (error) {
      if (attempt === 2) {
        const w = `could not set ${record.type ?? 'lead'} ${record.id} to ${status}: ${error.message}`
        log.warn(w)
        return w
      }
    }
  }
}

/** Marks the brief's lead used, plus any cluster whose main question a story-based post drew on. */
export async function markLeadsUsed(store, brief, inputs) {
  const warnings = []
  const lead = inputs.leadIndex.get(brief.lead.id)
  if (lead) {
    const w = await setLeadStatus(store, lead.record, 'used', brief.brief_id)
    if (w) warnings.push(w)
  }
  if (brief.post_type === 'story' || brief.post_type === 'rapid_response') {
    const asked = new Set(brief.questions.map((q) => q.toLowerCase()))
    for (const [id, entry] of inputs.leadIndex) {
      if (entry.kind !== 'cluster' || id === brief.lead.id) continue
      const c = entry.record.payload
      if (asked.has(String(c.main_question).toLowerCase())) {
        const w = await setLeadStatus(store, entry.record, 'used', brief.brief_id)
        if (w) warnings.push(w)
      }
    }
  }
  return warnings
}
