// Duplicate checks (Phase 9 A3). DEDUPE_MODE=local (default) compares titles in memory with a character
// trigram similarity, against lists the run has already read (the run store serves each list once).
// DEDUPE_MODE=mem0 keeps the old Mem0 semantic search (one search request per check).

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'with', 'is', 'are', 'my', 'your', 'i', 'do', 'does', 'how', 'what', 'why', 'when', 'can'])

/** Lowercase words without punctuation or very common words. */
export function words(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !STOP.has(w))
}

/** Character trigrams of each word (padded), as a Set. */
export function trigrams(text) {
  const out = new Set()
  for (const w of words(text)) {
    const p = `  ${w} `
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3))
  }
  return out
}

/** Dice similarity of two texts' trigram sets: 0 (nothing shared) … 1 (same words). */
export function similarity(a, b) {
  const ta = a instanceof Set ? a : trigrams(a)
  const tb = b instanceof Set ? b : trigrams(b)
  if (!ta.size || !tb.size) return 0
  let shared = 0
  for (const g of ta) if (tb.has(g)) shared++
  return (2 * shared) / (ta.size + tb.size)
}

/** The text a record is compared by. */
export function titleOf(record) {
  const p = record?.payload ?? {}
  switch (record?.type) {
    case 'question_cluster': return p.main_question ?? ''
    case 'brief': return [p.titles?.[0] ?? p.title, p.keyword].filter(Boolean).join(' — ')
    case 'draft': return p.title ?? ''
    case 'tutorial_lead':
    case 'story_lead': return p.title ?? ''
    default: return p.title ?? p.main_question ?? ''
  }
}

/** { mode, threshold } from config: local uses DEDUPE_SIMILARITY_LOCAL, mem0 uses DEDUPE_SIMILARITY. */
export function dedupeSettings(config) {
  const sc = config?.scout ?? {}
  const mode = sc.dedupeMode ?? 'local'
  return { mode, threshold: mode === 'mem0' ? sc.dedupeSimilarity : sc.dedupeSimilarityLocal ?? 0.65 }
}

/**
 * Records of the given types most similar to `text`, best first, each with a `score` (0–1).
 * local: one list per type from the store (the run store answers it from memory after the first read).
 * mem0: one Mem0 semantic search (scores on Mem0's own scale).
 */
export async function findSimilar(store, text, { types, mode = 'local', topK = 20 } = {}) {
  if (mode === 'mem0') {
    const hits = await store.searchSimilar(text, { topK, ...(types.length === 1 && { type: types[0] }) })
    return hits.filter((h) => types.includes(h.type) && typeof h.score === 'number').sort((a, b) => b.score - a.score)
  }
  const want = trigrams(text)
  const scored = []
  for (const type of types) {
    for (const r of await store.getRecords({ type })) {
      const t = titleOf(r)
      if (t) scored.push({ ...r, score: Number(similarity(want, trigrams(t)).toFixed(3)) })
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK)
}
