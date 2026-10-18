// Duplicate checks against Mem0 (brief 11.6).

import { istDate } from '../util/time.js'

const COVERED_STATUSES = ['approved', 'published']

/** Best similar record of the given types for `text`. */
async function topMatch(store, text, types) {
  const hits = await store.searchSimilar(text, { topK: 20 })
  return hits
    .filter((h) => types.includes(h.type) && typeof h.score === 'number')
    .sort((a, b) => b.score - a.score)[0] ?? null
}

const unique = (xs) => [...new Set(xs)]
const byUrl = (items) => {
  const seen = new Map()
  for (const it of items) if (!seen.has(it.url)) seen.set(it.url, it)
  return [...seen.values()]
}

/**
 * Decides what to do with one new cluster:
 * - covered: similar to an approved/published post or its brief (or a used cluster) → save, flagged as an update candidate
 * - merge:   similar to an open cluster → append questions and URLs to that record, create nothing
 * - new:     otherwise
 * @returns {{ action: 'new'|'merge'|'covered', match?: object, coveredBy?: string }}
 */
export async function classifyCluster(store, cluster, threshold) {
  const match = await topMatch(store, cluster.main_question, ['brief', 'draft', 'question_cluster'])
  if (!match || match.score < threshold) return { action: 'new' }
  if (match.type === 'question_cluster' && match.status === 'open') return { action: 'merge', match }
  const covered = COVERED_STATUSES.includes(match.status) || (match.type === 'question_cluster' && match.status === 'used')
  if (covered) {
    const coveredBy = match.briefId ?? match.payload?.already_covered_by ?? match.payload?.brief_id ?? null
    return { action: 'covered', match, coveredBy }
  }
  return { action: 'new' }
}

/** The merged payload for an open cluster that absorbs `incoming`. */
export function mergeClusterPayload(existing, incoming, today = istDate()) {
  const related = unique([...(existing.related_questions ?? []), incoming.main_question, ...(incoming.related_questions ?? [])])
    .filter((q) => q && q !== existing.main_question)
  return {
    ...existing,
    related_questions: related,
    source_urls: byUrl([...(existing.source_urls ?? []), ...(incoming.source_urls ?? [])]),
    freshness: existing.freshness === 'this_week' || incoming.freshness === 'this_week' ? 'this_week' : 'ongoing',
    last_seen: today
  }
}

/** Source URLs of stories already stored. */
export async function storedStoryUrls(store) {
  return new Set((await store.getRecords({ type: 'story_lead' })).map((r) => r.payload?.source_url).filter(Boolean))
}

/** A tutorial with the same target and a similar title already exists. */
export async function isDuplicateTutorial(store, tutorial, threshold) {
  const hits = await store.searchSimilar(tutorial.title, { type: 'tutorial_lead', topK: 20 })
  const target = String(tutorial.target).trim().toLowerCase()
  return hits.some((h) => h.score >= threshold && String(h.payload?.target ?? '').trim().toLowerCase() === target)
}
