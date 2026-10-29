// What readers already have, and "is this a near-repeat?" (code, no AI): the guides live on msg91.com/guide, our
// approved posts and the posts being written. A candidate is a repeat when its title is close to one of them, or
// most of its words (title, question) are already in that post's title, headings and keywords.
import { similarity, words } from '../dedupe.js'
import { listGuides } from '../guides/sync.js'

// Words every M91 post shares: they say nothing about what a post is about.
const GENERIC = new Set(['m91', 'alert', 'alerts', 'use', 'using', 'get', 'work', 'works', 'guide', 'post', 'step', 'steps', 'it', 'you', 'we', 'about', 'without', 'from', 'that', 'this', 'its', 'be', 'will', 'should', 'would', 'into', 'up', 'there', 'their', 'they', 'them', 'than', 'then', 'which', 'who', 'where', 'here', 'more', 'most', 'just', 'only', 'how', 'what', 'why', 'when', 'can', 'does', 'do'])
const TUTORIAL_RE = /\b(how to|set ?up|step[- ]by[- ]step|connect|send (your|the) first|install|integrat\w*|tutorial|walk ?through)\b/i

const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)
/** The meaningful words of a text (lowercase, no stop or generic words, simple plural stem). */
export const topicWords = (text) => new Set(words(text).map(stem).filter((w) => w.length > 2 && !GENERIC.has(w)))

/** How much of the candidate is already said by the other text: shared words / the candidate's words (0–1). */
export function coverage(candidate, other) {
  const a = candidate instanceof Set ? candidate : topicWords(candidate)
  const b = other instanceof Set ? other : topicWords(other)
  if (a.size < 3) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / a.size
}

/** A post's format, for the variety rule: the editor's format when it chose it, else from the brief. */
export function formatOfBrief(b = {}) {
  if (b.weekly?.format) return b.weekly.format
  if (b.post_type === 'rapid_response' || b.news?.is_news_based) return 'news_analysis'
  if (b.post_type === 'tutorial' || b.format === 'tutorial' || b.tutorial?.use) return 'tutorial'
  return 'explainer'
}
const formatOfGuide = (g) => (TUTORIAL_RE.test(g.title ?? '') ? 'tutorial' : 'explainer')

/** The posts readers have or will soon have: [{ title, text, format, at, where }], newest first. */
export async function existingPosts(store) {
  const out = []
  for (const g of await listGuides(store)) {
    out.push({ title: g.title, text: [g.title, g.description, g.summary, ...(g.headings ?? []), ...(g.keywords ?? [])].filter(Boolean).join(' '), format: formatOfGuide(g), at: g.published_at ?? g.synced_at ?? '', where: 'a live guide', url: g.url ?? null })
  }
  const latest = new Map()
  for (const r of await store.getRecords({ type: 'brief' })) {
    const id = r.briefId ?? r.payload?.brief_id
    if (!id) continue
    const v = Number(r.version ?? r.payload?.version ?? 1)
    if (!latest.has(id) || v > latest.get(id).v) latest.set(id, { r, v })
  }
  for (const { r } of latest.values()) {
    if (!['approved', 'published', 'awaiting_human', 'drafted', 'active', 'new'].includes(r.status)) continue
    const p = r.payload ?? {}
    const live = ['approved', 'published'].includes(r.status)
    out.push({ title: p.titles?.[0] ?? p.topic ?? '', text: [p.titles?.[0], p.keyword, ...(p.supporting_keywords ?? []), ...(p.outline ?? []).map((s) => s.heading)].filter(Boolean).join(' '), format: formatOfBrief(p), at: p.approved_at ?? r.metadata?.approved_at ?? r.date ?? '', where: live ? 'an approved post' : 'a post being written', url: null })
  }
  return out.filter((p) => p.title).sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

/** The closest existing post when the candidate repeats it, else null. */
export function repeats(candidateTitle, candidateText, posts, threshold) {
  const w = topicWords(candidateText)
  let best = null
  for (const p of posts) {
    const score = Math.max(similarity(candidateTitle, p.title), coverage(w, `${p.title} ${p.text}`))
    if (score >= threshold && (!best || score > best.score)) best = { ...p, score }
  }
  return best
}
