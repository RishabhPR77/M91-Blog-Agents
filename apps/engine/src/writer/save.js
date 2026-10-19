// Saving drafts and status updates (Phase 4 brief, section 11; numbering per brief version, Phase 5 A3).

import { istDate } from '../util/time.js'
import { log } from '../util/log.js'

/** A draft's version as a positive integer, or null when it isn't one. */
export function draftVersion(d) {
  const v = Number(d?.version ?? d?.payload?.version)
  return Number.isInteger(v) && v > 0 ? v : null
}

/** The brief version a draft was written for (1 for drafts saved before Phase 5 said so in metadata). */
export function draftBriefVersion(d) {
  const v = Number(d?.metadata?.brief_version ?? d?.payload?.brief_version ?? 1)
  return Number.isInteger(v) && v > 0 ? v : 1
}

const KEEP_STATUS = ['superseded', 'changes_requested', 'approved', 'rejected', 'failed_review']

/** True when draft a was written before draft b: an older brief version, or the same one with a lower version. */
export const isEarlierDraft = (a, b) => draftBriefVersion(a) < draftBriefVersion(b) ||
  (draftBriefVersion(a) === draftBriefVersion(b) && (draftVersion(a) ?? 0) < (draftVersion(b) ?? 0))

/** Drafts of a brief (every brief version), newest first: brief version, then version. */
export async function draftsOf(store, briefId) {
  return (await store.getRecords({ type: 'draft', brief_id: briefId }))
    .filter((r) => (r.briefId ?? r.payload?.brief_id) === briefId)
    .sort((a, b) => draftBriefVersion(b) - draftBriefVersion(a) || (draftVersion(b) ?? 0) - (draftVersion(a) ?? 0))
}

/**
 * Next draft version for one brief version: max(valid versions of its drafts) + 1, so a new brief
 * version starts again at 1. Records whose version is not a positive integer are ignored (warned).
 */
export async function nextDraftVersion(store, briefId, briefVersion = 1) {
  const drafts = (await draftsOf(store, briefId)).filter((d) => draftBriefVersion(d) === Number(briefVersion ?? 1))
  const invalid = drafts.filter((d) => draftVersion(d) === null)
  if (invalid.length) log.warn('drafts with an invalid version ignored for numbering', { briefId, briefVersion, records: invalid.map((d) => ({ id: d.id, version: d.version ?? d.payload?.version ?? null })) })
  return Math.max(0, ...drafts.map(draftVersion).filter((v) => v !== null)) + 1
}

/**
 * Saves one draft record, then supersedes earlier drafts (older brief versions too) and marks the
 * brief "drafted". Returns { record, warnings[] }.
 */
export async function saveDraft(store, { briefId, briefRecord, version, briefVersion, topicGroup, payload, hardPassed }) {
  const warnings = []
  const status = hardPassed ? 'drafted' : 'drafted_with_issues'
  const record = await store.createRecord({ type: 'draft', briefId, payload: { ...payload, brief_id: briefId, version, brief_version: briefVersion }, status, version, topicGroup, date: istDate(), meta: { brief_version: briefVersion } })
  const mine = { version, metadata: { brief_version: briefVersion } }
  for (const old of await draftsOf(store, briefId)) {
    // A draft with a decision on it (changes requested, approved, rejected, failed review) keeps its status: it is history.
    if (old.id !== record.id && !KEEP_STATUS.includes(old.status) && isEarlierDraft(old, mine)) {
      try {
        await store.updateRecord(old.id, undefined, { status: 'superseded' })
      } catch (error) {
        warnings.push(`could not mark draft b${draftBriefVersion(old)} v${old.version} superseded: ${error.message}`)
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
