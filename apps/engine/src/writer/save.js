// Saving drafts and status updates (Phase 4 brief, section 11).

import { istDate } from '../util/time.js'
import { log } from '../util/log.js'

/** Drafts of a brief (any brief version), newest version first. */
export async function draftsOf(store, briefId) {
  return (await store.getRecords({ type: 'draft', brief_id: briefId }))
    .filter((r) => (r.briefId ?? r.payload?.brief_id) === briefId)
    .sort((a, b) => (b.version ?? b.payload?.version ?? 0) - (a.version ?? a.payload?.version ?? 0))
}

/** Next draft version for a brief: 1 for the first draft, then +1 per draft (across brief versions). */
export async function nextDraftVersion(store, briefId) {
  const latest = (await draftsOf(store, briefId))[0]
  return (latest?.version ?? latest?.payload?.version ?? 0) + 1
}

/**
 * Saves one draft record, then supersedes older versions and marks the brief "drafted".
 * Returns { record, warnings[] }.
 */
export async function saveDraft(store, { briefId, briefRecord, version, briefVersion, topicGroup, payload, hardPassed }) {
  const warnings = []
  const status = hardPassed ? 'drafted' : 'drafted_with_issues'
  const record = await store.createRecord({ type: 'draft', briefId, payload: { ...payload, brief_id: briefId, version, brief_version: briefVersion }, status, version, topicGroup, date: istDate() })
  for (const old of await draftsOf(store, briefId)) {
    const v = old.version ?? old.payload?.version ?? 0
    if (v < version && old.status !== 'superseded' && old.id !== record.id) {
      try {
        await store.updateRecord(old.id, undefined, { status: 'superseded' })
      } catch (error) {
        warnings.push(`could not mark draft v${v} superseded: ${error.message}`)
      }
    }
  }
  if (briefRecord?.id && briefRecord.status !== 'drafted' && briefRecord.status !== 'approved') {
    try {
      await store.updateRecord(briefRecord.id, undefined, { status: 'drafted' })
    } catch (error) {
      warnings.push(`could not mark the brief drafted: ${error.message}`)
    }
  }
  if (warnings.length) log.warn('draft saved with warnings', { briefId, version, warnings })
  return { record, status, warnings }
}
