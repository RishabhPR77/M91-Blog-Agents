// Test-data clean-up (Phase 5 brief, A3.2). Lists candidates; deletes only ids it is given.

import { draftVersion, draftBriefVersion } from './writer/save.js'

// Never deleted by --delete-listed (only when their ids are given explicitly).
export const PROTECTED_TYPES = Object.freeze(['published_post', 'lesson', 'tone_profile', 'm91_facts'])

const isDryRun = (r) => r.metadata?.dry_run === true || r.metadata?.dry_run === 'true' || r.payload?.dry_run === true
const isTest = (r) => r.metadata?.test === true || r.metadata?.test === 'true'
const briefVersionOf = (r) => {
  const v = Number(r.payload?.brief_version ?? r.version)
  return Number.isInteger(v) && v > 0 ? v : null
}
const created = (r) => String(r.createdAt ?? r.date ?? '')

/**
 * Versions that break the numbering in one group (one brief's briefs, or one brief version's drafts):
 * a version more than one above the previous one (a gap, e.g. v1 then v11) or a repeated version
 * (the later-created copy). Returns Map(record id → reason).
 */
export function outOfOrder(records, versionOf, label) {
  const out = new Map()
  const valid = records.filter((r) => versionOf(r) !== null).sort((a, b) => versionOf(a) - versionOf(b) || created(a).localeCompare(created(b)))
  let prev = 0
  for (const r of valid) {
    const v = versionOf(r)
    if (v === prev) out.set(r.id, `${label} v${v} repeated`)
    else if (v > prev + 1) out.set(r.id, `${label} v${v} after v${prev} (gap)`)
    prev = Math.max(prev, v)
  }
  return out
}

/**
 * Candidate test records: drafts or briefs with non-integer or out-of-order versions, records with
 * dry_run: true, and records tagged by smoke tests (metadata.test). Protected types never appear.
 * @returns {{ id, type, brief_id, version, status, date, reasons: string[] }[]}
 */
export function findCandidates(records) {
  const reasons = new Map()
  const add = (r, why) => {
    if (PROTECTED_TYPES.includes(r.type)) return
    if (!reasons.has(r.id)) reasons.set(r.id, { r, why: [] })
    reasons.get(r.id).why.push(why)
  }
  const groups = new Map()
  for (const r of records) {
    if (isDryRun(r)) add(r, 'dry_run: true')
    if (isTest(r)) add(r, 'smoke test (metadata.test)')
    if (r.type === 'draft') {
      if (draftVersion(r) === null) add(r, `draft version "${r.version ?? r.payload?.version ?? ''}" is not a positive integer`)
      const key = `draft|${r.briefId}|${draftBriefVersion(r)}`
      if (!groups.has(key)) groups.set(key, { list: [], versionOf: draftVersion, label: `draft b${draftBriefVersion(r)}` })
      groups.get(key).list.push(r)
    }
    if (r.type === 'brief') {
      if (briefVersionOf(r) === null) add(r, `brief version "${r.payload?.brief_version ?? r.version ?? ''}" is not a positive integer`)
      const key = `brief|${r.briefId}`
      if (!groups.has(key)) groups.set(key, { list: [], versionOf: briefVersionOf, label: 'brief' })
      groups.get(key).list.push(r)
    }
  }
  for (const { list, versionOf, label } of groups.values()) {
    const byId = new Map(list.map((r) => [r.id, r]))
    for (const [id, why] of outOfOrder(list, versionOf, label)) add(byId.get(id), why)
  }
  return [...reasons.values()].map(({ r, why }) => ({
    id: r.id, type: r.type, brief_id: r.briefId ?? null, version: r.version ?? null, status: r.status ?? null, date: r.date ?? null, reasons: why
  })).sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.brief_id).localeCompare(String(b.brief_id)) || String(a.version).localeCompare(String(b.version)))
}

/** Deletes exactly the given ids, one by one. Returns { deleted[], failed[{ id, error }] }. */
export async function deleteIds(store, ids) {
  const deleted = []
  const failed = []
  for (const id of ids) {
    try {
      await store.deleteRecord(id)
      deleted.push(id)
    } catch (error) {
      failed.push({ id, error: error.message })
    }
  }
  return { deleted, failed }
}
