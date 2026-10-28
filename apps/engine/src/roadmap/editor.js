// The editor (code only, no AI): what the next run writes, like an editor would decide, instead of blindly taking the
// next roadmap slot. A pinned topic that is due and a news card you chose with Write now still go first (pick.js).
//
// 1. Candidates: the roadmap slots that are ready (planned, everything they need done) in the lowest stage that is not
//    finished, plus ready tutorial slots up to one stage further; fresh news cards the news check found (not
//    expired, medium or high urgency).
// 2. No near-repeats: a candidate too close to a guide already live on msg91.com/guide, an approved post, or a post
//    being written or in review is left out (and the reason is shown). Close = similar titles, or most of the
//    candidate's words (title, question, what it teaches) already in that post's title, headings and keywords.
// 3. The mix:
//    - news, when a fresh relevant card exists, no news post went out in the last NEXT_NEWS_GAP_DAYS days, the Starter
//      has an approved post and TIMELY_MAX_PER_WEEK allows it;
//    - a tutorial, when none of the last NEXT_TUTORIAL_EVERY - 1 posts was a tutorial and one is ready;
//    - otherwise the next roadmap slot in reading order.
// Every choice carries a one-line reason (the run and "Next up" show it) and the candidates it left out.
import { similarity, words } from '../dedupe.js'
import { listGuides } from '../guides/sync.js'
import { listOpportunities, isExpired, starterApproved, timelyThisWeek } from '../timely/model.js'
import { istDate } from '../util/time.js'

const DONE = new Set(['approved', 'skipped', 'covered'])
const URGENCY = { high: 2, medium: 1, low: 0 }
// Words every M91 post shares: they say nothing about what a post is about.
const GENERIC = new Set(['m91', 'alert', 'alerts', 'use', 'using', 'get', 'work', 'works', 'guide', 'post', 'step', 'steps', 'it', 'you', 'we', 'about', 'without', 'from', 'that', 'this', 'its', 'be', 'will', 'should', 'would', 'into', 'up', 'there', 'their', 'they', 'them', 'than', 'then', 'which', 'who', 'where', 'here', 'more', 'most', 'just', 'only'])
const TUTORIAL_RE = /\b(how to|set ?up|step[- ]by[- ]step|connect|send (your|the) first|test(ing)?|install|integrat\w*|tutorial|first alert|walk ?through)\b/i

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

/** Is a slot a tutorial: the First steps stage, or a how-to title or question. */
export const isTutorialSlot = (slot, stageNumber) => stageNumber === 2 || TUTORIAL_RE.test(`${slot.title_idea} ${slot.question}`)

/** What a post is, for the mix: news | tutorial | other. */
export function kindOfBrief(b = {}) {
  if (b.post_type === 'rapid_response' || b.news?.is_news_based) return 'news'
  if (b.post_type === 'tutorial' || b.format === 'tutorial' || b.tutorial?.use) return 'tutorial'
  return 'other'
}
const kindOfGuide = (g) => (TUTORIAL_RE.test(g.title ?? '') ? 'tutorial' : 'other')

/** The posts readers have or will soon have: what a candidate must not repeat. { title, text, kind, at, where } */
async function existingPosts(store, roadmap) {
  const out = []
  for (const g of await listGuides(store)) {
    out.push({ title: g.title, text: [g.title, g.description, g.summary, ...(g.headings ?? []), ...(g.keywords ?? [])].filter(Boolean).join(' '), kind: kindOfGuide(g), at: g.published_at ?? g.synced_at ?? '', where: 'a published guide' })
  }
  const briefs = await store.getRecords({ type: 'brief' })
  const latest = new Map()
  for (const r of briefs) {
    const id = r.briefId ?? r.payload?.brief_id
    if (!id) continue
    const v = Number(r.version ?? r.payload?.version ?? 1)
    if (!latest.has(id) || v > latest.get(id).v) latest.set(id, { r, v })
  }
  for (const { r } of latest.values()) {
    if (!['approved', 'published', 'awaiting_human', 'drafted', 'active', 'new'].includes(r.status)) continue
    const p = r.payload ?? {}
    const live = ['approved', 'published'].includes(r.status)
    out.push({ title: p.titles?.[0] ?? p.topic ?? '', text: [p.titles?.[0], p.keyword, ...(p.supporting_keywords ?? []), ...(p.outline ?? []).map((s) => s.heading)].filter(Boolean).join(' '), kind: kindOfBrief(p), at: r.payload?.approved_at ?? r.date ?? '', where: live ? 'an approved post' : 'a post being written' })
  }
  for (const st of roadmap?.stages ?? []) {
    for (const s of st.slots ?? []) {
      if (s.status === 'drafting' || s.status === 'in_review') out.push({ title: s.title_idea, text: `${s.title_idea} ${s.question} ${(s.teaches ?? []).join(' ')}`, kind: isTutorialSlot(s, st.number) ? 'tutorial' : 'other', at: '', where: `slot ${s.slot_id} (${s.status.replace('_', ' ')})` })
    }
  }
  return out.filter((p) => p.title)
}

/** The closest existing post, when the candidate repeats it. */
function repeats(candidateTitle, candidateText, posts, threshold) {
  const words = topicWords(candidateText)
  let best = null
  for (const p of posts) {
    const score = Math.max(similarity(candidateTitle, p.title), coverage(words, `${p.title} ${p.text}`))
    if (score >= threshold && (!best || score > best.score)) best = { ...p, score }
  }
  return best
}

/** Ready slots: planned, all needs done, in the lowest unfinished stage (tutorials: up to one stage later). */
export function readySlots(roadmap) {
  if (!roadmap || roadmap.status !== 'approved') return { slots: [], lowest: null }
  const status = new Map(roadmap.stages.flatMap((st) => st.slots.map((s) => [s.slot_id, s.status])))
  const stages = [...roadmap.stages].sort((a, b) => a.number - b.number)
  const unfinished = stages.find((st) => st.slots.filter((s) => s.status !== 'proposed').some((s) => !DONE.has(s.status)))
  if (!unfinished) return { slots: [], lowest: null }
  const ready = (st) => st.slots.filter((s) => s.status === 'planned' && (s.needs ?? []).every((n) => DONE.has(status.get(n))))
    .map((s) => ({ slot: s, stage: { number: st.number, name: st.name, level: st.level, goal: st.goal }, tutorial: isTutorialSlot(s, st.number) }))
  const next = stages.find((st) => st.number === unfinished.number + 1)
  return { slots: [...ready(unfinished), ...(next ? ready(next).filter((c) => c.tutorial) : [])], lowest: unfinished.number }
}

/**
 * The editor's choice. Returns { kind: 'slot', slot, stage, why, skipped } | { kind: 'timely', record, why, skipped } |
 * { kind: 'none', reason, skipped }. skipped: [{ id, title, why }] candidates left out as near-repeats.
 */
export async function chooseNext(store, { config, roadmap, now = Date.now }) {
  const ec = config?.editor ?? {}
  const threshold = ec.similarity ?? 0.6
  const t = now()
  const today = istDate(new Date(t))
  const posts = await existingPosts(store, roadmap)
  const skipped = []
  const fresh = (p) => !p.at || t - Date.parse(p.at) <= (ec.newsGapDays ?? 7) * 86400000

  // News cards the news check found (proposed), still fresh and relevant.
  let news = []
  if (config?.timely?.enabled) {
    const all = await listOpportunities(store)
    const cards = all.filter((r) => r.status === 'proposed' && !r.payload?.brief_id && !isExpired(r, { today, windowDays: config.timely.windowDays }) && (URGENCY[r.payload?.urgency] ?? 0) >= 1)
    for (const r of cards) {
      const close = repeats(r.payload.title, `${r.payload.title} ${r.payload.what_happened ?? ''}`, posts, threshold)
      if (close) skipped.push({ id: r.payload.opportunity_id, title: r.payload.title, why: `close to ${close.where} "${close.title}"` })
      else news.push(r)
    }
    news.sort((a, b) => (URGENCY[b.payload.urgency] ?? 0) - (URGENCY[a.payload.urgency] ?? 0) || String(b.payload.published_date).localeCompare(String(a.payload.published_date)))
    const recentNews = posts.some((p) => p.kind === 'news' && p.at && fresh(p))
    if (news.length && recentNews) news = []
    else if (news.length && !(await starterApproved(store))) news = []
    else if (news.length && timelyThisWeek(all, { now }) >= config.timely.maxPerWeek) news = []
  }

  const { slots } = readySlots(roadmap)
  const candidates = []
  for (const c of slots) {
    const close = repeats(c.slot.title_idea, `${c.slot.title_idea} ${c.slot.question} ${(c.slot.teaches ?? []).join(' ')}`, posts, threshold)
    if (close) skipped.push({ id: c.slot.slot_id, title: c.slot.title_idea, why: `close to ${close.where} "${close.title}"` })
    else candidates.push(c)
  }

  if (news.length) {
    const r = news[0]
    return { kind: 'timely', record: r, why: `news: "${r.payload.title}" (reported by ${r.payload.outlet}, ${r.payload.published_date}, ${r.payload.urgency} urgency); no news post in the last ${ec.newsGapDays ?? 7} days`, skipped }
  }
  // The mix: a tutorial when the last posts were not tutorials.
  const every = ec.tutorialEvery ?? 3
  const recent = posts.filter((p) => p.where !== 'a post being written' && p.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, Math.max(1, every - 1))
  const tutorial = candidates.find((c) => c.tutorial)
  const first = candidates.find((c) => c.stage.number === Math.min(...candidates.map((x) => x.stage.number)))
  if (tutorial && recent.length >= every - 1 && !recent.some((p) => p.kind === 'tutorial') && tutorial !== first) {
    return { kind: 'slot', slot: { ...tutorial.slot }, stage: tutorial.stage, why: `a tutorial: none of the last ${recent.length} posts was one`, skipped }
  }
  if (first) {
    const why = first.tutorial && !recent.some((p) => p.kind === 'tutorial') ? 'next on the roadmap (a tutorial)' : 'next on the roadmap'
    return { kind: 'slot', slot: { ...first.slot }, stage: first.stage, why: skipped.length ? `${why}; left out as repeats: ${skipped.map((s) => s.id).join(', ')}` : why, skipped }
  }
  if (skipped.length) return { kind: 'none', reason: `every ready topic repeats a post readers already have (${skipped.map((s) => `${s.id}: ${s.why}`).join('; ')}). Mark those slots covered or edit them on the Roadmap page`, skipped }
  return { kind: 'none', reason: null, skipped }
}
