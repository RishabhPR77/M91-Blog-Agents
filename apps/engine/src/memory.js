// The Memory manager (dashboard /memory): why a record may no longer be useful, and whether it may be deleted.
// Works on records already in the engine's index, so judging costs 0 Mem0 requests; each delete costs 1.

import { findCandidates } from './cleanup.js'
import { draftVersion, draftBriefVersion } from './writer/save.js'
import { BRIEF_ID_RE } from './util/ids.js'

/** Statuses that mean a record was replaced, ran out or was dropped. */
export const DEAD_STATUSES = Object.freeze(['superseded', 'expired', 'discarded', 'cancelled', 'old', 'failed', 'rejected', 'failed_review', 'publish_failed', 'unpublished'])
/** Records made for one brief (deleting the brief leaves these behind). */
const CHILD_TYPES = new Set(['draft', 'review', 'promo_pack', 'guide_doc', 'block_doc', 'markdown_export', 'source_pack'])
/** Records judged by "old and nothing refers to them". */
const LEAD_TYPES = new Set(['question_cluster', 'story_lead', 'tutorial_lead', 'timely_opportunity'])
/** Leads whose title is compared for duplicates. */
const TITLE_DUP_TYPES = new Set([...LEAD_TYPES, 'pinned_topic', 'lesson'])
const LIVE_POST = new Set(['approved', 'published'])

export const DEFAULT_STALE_DAYS = 30
const DAY = 86400000

const keyIdOf = (p = {}) => p?.cluster_id ?? p?.story_id ?? p?.tutorial_id ?? p?.profile_id ?? p?.pinned_id ?? p?.opportunity_id ?? p?.run_id ?? null
const titleOf = (r) => {
  const p = r.payload
  if (typeof p === 'string') return p
  return String(p?.titles?.[0] ?? p?.title ?? p?.main_question ?? p?.topic ?? '')
}
const briefVersionOf = (r) => Number(r.payload?.brief_version ?? r.metadata?.brief_version ?? r.version) || 1

/** When a record was made: Mem0's created_at, else its date (YYYY-MM-DD). ms or null. */
export function createdMs(r) {
  const t = Date.parse(r.createdAt ?? r.created_at ?? r.date ?? '')
  return Number.isNaN(t) ? null : t
}

/**
 * Judges every record. Returns Map(id → { reasons: [{ code, text }], protection: null | 'never' | 'confirm', protection_reason }).
 * reasons codes: status, test (dry run), smoke, version (broken numbering), brief_dead, draft_dead, orphan, no_draft, duplicate, stale.
 * protection 'never': cannot be deleted here; 'confirm': needs the extra confirm.
 */
export function judgeRecords(records, { now = Date.now(), staleDays = DEFAULT_STALE_DAYS } = {}) {
  const out = new Map(records.map((r) => [r.id, { reasons: [], protection: null, protection_reason: null }]))
  const add = (r, code, text) => {
    const j = out.get(r.id)
    if (!j.reasons.some((x) => x.code === code)) j.reasons.push({ code, text })
  }
  const protect = (r, level, why) => {
    const j = out.get(r.id)
    if (j.protection === 'never') return
    j.protection = level
    j.protection_reason = why
  }
  const of = (type) => records.filter((r) => r.type === type)
  const ageDays = (r) => {
    const t = createdMs(r)
    return t === null ? null : Math.floor((now - t) / DAY)
  }
  const old = (r) => (ageDays(r) ?? 0) > staleDays

  // Per brief: its newest brief version, its drafts, and whether it became a live post.
  const briefs = new Map()
  const chain = (id) => {
    if (!briefs.has(id)) briefs.set(id, { briefs: [], drafts: [], live: false })
    return briefs.get(id)
  }
  for (const r of of('brief')) if (r.briefId) chain(r.briefId).briefs.push(r)
  for (const r of of('draft')) if (r.briefId) chain(r.briefId).drafts.push(r)
  for (const r of of('published_post')) {
    const id = r.briefId ?? r.payload?.brief_id
    if (id && r.status !== 'unpublished') chain(id).live = true
  }
  for (const c of briefs.values()) {
    c.newest = [...c.briefs].sort((a, b) => briefVersionOf(b) - briefVersionOf(a))[0] ?? null
    c.newestVersion = c.newest ? briefVersionOf(c.newest) : null
    if (c.drafts.some((d) => LIVE_POST.has(d.status)) || (c.newest && LIVE_POST.has(c.newest.status))) c.live = true
  }

  // Everything that refers to records: briefs (cluster/story/tutorial ids), runs (record ids), the roadmap, knowledge.
  const refText = [...of('brief'), ...of('run'), ...of('roadmap'), ...of('knowledge'), ...of('draft')].map((r) => JSON.stringify(r.payload ?? '')).join('\n')
  const referenced = (r) => refText.includes(r.id) || (keyIdOf(r.payload) && refText.includes(keyIdOf(r.payload)))

  // 1. Test data and broken version numbering (the cleanup command's rules).
  const byId = new Map(records.map((r) => [r.id, r]))
  for (const c of findCandidates(records)) {
    const r = byId.get(c.id)
    for (const why of c.reasons) {
      if (/dry_run/.test(why)) add(r, 'test', 'dry-run record')
      else if (/smoke/.test(why)) add(r, 'smoke', 'smoke-test record')
      else add(r, 'version', why)
    }
  }

  for (const r of records) {
    // 2. Replaced, ran out, dropped or failed.
    if (r.status && DEAD_STATUSES.includes(r.status)) add(r, 'status', `status "${r.status}"`)
    if (r.type === 'run' && (r.payload?.dry_run === true || r.metadata?.dry_run === true)) add(r, 'test', 'dry-run record')

    // 3. Made for a brief that was rejected, replaced by a newer version, or is gone.
    if (CHILD_TYPES.has(r.type) && r.briefId && BRIEF_ID_RE.test(r.briefId)) {
      const c = briefs.get(r.briefId)
      if (!c?.newest) add(r, 'orphan', `its brief ${r.briefId} is no longer in memory`)
      else if (!c.live && c.newest.status === 'rejected') add(r, 'brief_dead', `its brief ${r.briefId} was rejected`)
      else if (r.type !== 'markdown_export' && !c.live && briefVersionOf(r) < c.newestVersion && r.type !== 'source_pack') add(r, 'brief_dead', `made for brief v${briefVersionOf(r)}; the brief is now v${c.newestVersion}`)
    }
    if (r.type === 'brief' && r.briefId) {
      const c = briefs.get(r.briefId)
      if (c?.newest && r.id !== c.newest.id && !c.live) add(r, 'brief_dead', `older brief version (v${briefVersionOf(r)}; newest v${c.newestVersion})`)
      if (c?.newest?.id === r.id && !c.drafts.length && old(r) && !['approved', 'published'].includes(r.status)) add(r, 'no_draft', `no draft was written in ${ageDays(r)} days`)
    }
    // Reviews and docs of a draft that was replaced or rejected.
    if (['review', 'promo_pack', 'guide_doc', 'block_doc'].includes(r.type) && r.briefId) {
      const c = briefs.get(r.briefId)
      const d = c?.drafts.find((x) => draftVersion(x) === Number(r.version) && draftBriefVersion(x) === briefVersionOf(r))
      if (c && !c.live && d && ['superseded', 'rejected'].includes(d.status)) add(r, 'draft_dead', `its draft v${draftVersion(d)} is ${d.status}`)
    }

    // 5. Old and nothing refers to it.
    if (LEAD_TYPES.has(r.type) && old(r) && !referenced(r) && !['used'].includes(r.status)) add(r, 'stale', `older than ${staleDays} days and not used by any brief`)
    if ((r.type === 'run' || r.type === 'run_log') && old(r)) add(r, 'stale', `${r.type === 'run' ? 'run history' : 'per-call log'} older than ${staleDays} days`)
    if (r.type === 'lock' && old(r)) add(r, 'stale', 'an old run lock (locks are no longer used)')

    // Protection.
    if (r.type === 'published_post') r.status === 'published' || r.status === 'publishing' ? protect(r, 'never', 'a published post') : protect(r, 'confirm', 'a blog post record')
    if ((r.type === 'm91_facts' || r.type === 'tone_profile') && r.status === 'current') protect(r, 'never', `the current ${r.type === 'm91_facts' ? 'M91 facts' : 'style notes'}`)
    if (r.type === 'roadmap') r.status === 'approved' ? protect(r, 'never', 'the approved roadmap') : protect(r, 'confirm', 'the roadmap')
    if (r.type === 'knowledge' && r.status === 'current') protect(r, 'never', 'what an approved post taught (the roadmap uses it)')
    if (r.type === 'markdown_export' && r.briefId && briefs.get(r.briefId)?.live) protect(r, 'never', "an approved post's export")
    if (r.type === 'lesson') protect(r, 'confirm', 'a lesson the agents learn from')
    if (r.type === 'pinned_topic' && r.status === 'open') protect(r, 'confirm', 'an open pinned topic')
    if (['brief', 'draft', 'review'].includes(r.type) && r.briefId && briefs.get(r.briefId)?.live) protect(r, 'confirm', 'part of an approved or published post')
    if (r.type === 'setting') protect(r, 'confirm', 'an engine setting')
  }

  // 4. Duplicates: same type and key (brief + version, or the lead's own id), or a lead with the same title. The newest copy is kept.
  const groups = new Map()
  const group = (key, r) => {
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  for (const r of records) {
    if (r.type === 'run_log' || r.type === 'lock') continue
    const k = keyIdOf(r.payload)
    if (r.briefId && r.version != null && ['brief', 'draft', 'review', 'promo_pack', 'guide_doc', 'block_doc', 'markdown_export'].includes(r.type)) group(`v|${r.type}|${r.briefId}|${r.version}|${briefVersionOf(r)}`, r)
    else if (k && r.type !== 'run' && r.type !== 'source_pack') group(`k|${r.type}|${k}`, r)
    if (TITLE_DUP_TYPES.has(r.type)) {
      const t = titleOf(r).trim().toLowerCase().replace(/\s+/g, ' ')
      if (t.length > 3) group(`t|${r.type}|${t}`, r)
    }
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const [keep, ...rest] = [...list].sort((a, b) => (createdMs(b) ?? 0) - (createdMs(a) ?? 0) || String(b.id).localeCompare(String(a.id)))
    for (const r of rest) add(r, 'duplicate', `duplicate of ${keep.id} (newer copy kept)`)
  }
  return out
}

/** The filters the Memory page sends (all optional). */
export function filterRows(rows, { type, status, briefId, before, after, q, notUseful } = {}) {
  const b = before ? Date.parse(before) : null
  const a = after ? Date.parse(after) : null
  const query = q ? String(q).toLowerCase() : null
  return rows.filter((r) =>
    (!type || r.type === type) &&
    (!status || r.status === status) &&
    (!briefId || r.brief_id === briefId) &&
    (b === null || (r.created_ms !== null && r.created_ms < b + DAY)) &&
    (a === null || (r.created_ms !== null && r.created_ms >= a)) &&
    (!query || String(r.title ?? '').toLowerCase().includes(query) || String(r.key_id ?? '').toLowerCase().includes(query) || r.id.toLowerCase().includes(query)) &&
    (!notUseful || r.reasons.length > 0))
}

/**
 * Checks a delete request against the judged records. Returns { ok: [records], refused: [{ id, error }], needsConfirm: [ids] }.
 * 'never' records are refused; 'confirm' records need confirmProtected.
 */
export function planDelete(ids, held, judged, { confirmProtected = false } = {}) {
  const ok = []
  const refused = []
  const needsConfirm = []
  for (const id of new Set(ids)) {
    const r = held.get(id)
    const j = judged.get(id)
    if (!r) refused.push({ id, error: 'not in the engine index (load all types or refresh)' })
    else if (j?.protection === 'never') refused.push({ id, error: `protected: ${j.protection_reason}` })
    else if (j?.protection === 'confirm' && !confirmProtected) needsConfirm.push(id)
    else ok.push(r)
  }
  return { ok, refused, needsConfirm }
}
