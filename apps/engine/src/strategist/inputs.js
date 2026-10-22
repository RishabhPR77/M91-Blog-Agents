// Inputs for the Strategist, gathered by code from Mem0 (Phase 3 brief, section 6). Never by the AI.

import { istDate } from '../util/time.js'
import { storyDateRule } from '../scout/checks.js'
import { MESSAGE_MAX } from '../scout/prompts.js'

export class InputsError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InputsError'
  }
}

export const urlKey = (u) => String(u ?? '').trim().replace(/\/+$/, '').toLowerCase()
const byDateDesc = (a, b) => String(b ?? '').localeCompare(String(a ?? ''))

/** Latest version per brief_id, newest first, superseded versions left out. */
export function latestBriefs(records) {
  const byId = new Map()
  for (const r of records) {
    if (r.status === 'superseded') continue
    const id = r.briefId ?? r.payload?.brief_id
    const v = r.payload?.brief_version ?? r.version ?? 1
    const cur = byId.get(id)
    if (!cur || v > (cur.payload?.brief_version ?? cur.version ?? 1)) byId.set(id, r)
  }
  return [...byId.values()].sort((a, b) => byDateDesc(a.payload?.created_at ?? a.date, b.payload?.created_at ?? b.date))
}

/** blocked_group: the group both of the 2 most recent briefs used (or null). */
export function blockedGroup(recent) {
  const [a, b] = recent
  return a && b && a.topic_group != null && Number(a.topic_group) === Number(b.topic_group) ? Number(a.topic_group) : null
}

/** Topic groups with the fewest briefs in the window (ties all included), ascending by group. */
export function leastUsedGroups(recent) {
  const counts = new Map([1, 2, 3, 4, 5].map((g) => [g, 0]))
  for (const r of recent) if (counts.has(Number(r.topic_group))) counts.set(Number(r.topic_group), counts.get(Number(r.topic_group)) + 1)
  const min = Math.min(...counts.values())
  return [...counts.entries()].filter(([, n]) => n === min).map(([g]) => g)
}

const compactCluster = (p) => ({
  cluster_id: p.cluster_id, main_question: p.main_question, related_questions: p.related_questions ?? [], topic_group: p.topic_group,
  reader_type: p.reader_type, intent: p.intent, freshness: p.freshness, demand: p.demand, m91_fit: p.m91_fit,
  update_candidate: Boolean(p.update_candidate), rank_score: p.rank_score ?? null, source_urls: (p.source_urls ?? []).map((u) => (typeof u === 'string' ? u : u.url))
})
const compactStory = (p) => ({
  story_id: p.story_id, title: p.title, summary: p.summary, why_it_matters: p.why_it_matters, source_url: p.source_url,
  source_name: p.source_name, published_date: p.published_date, attribution_line: p.attribution_line, topic_group: p.topic_group
})
const compactTutorial = (p) => ({
  tutorial_id: p.tutorial_id, title: p.title, target: p.target, reader_outcome: p.reader_outcome,
  supporting_facts: p.supporting_facts ?? [], steps_outline: p.steps_outline ?? [], gaps: p.gaps ?? [], topic_group: p.topic_group
})
const compactPinned = (p) => ({ pinned_id: p.pinned_id, topic: p.topic, target_date: p.target_date, priority: p.priority ?? 'normal', notes: p.notes ?? '' })

/**
 * Builds the Strategist's inputs. `forBriefId` (re-brief) keeps the leads that brief already uses and
 * leaves that brief out of ALREADY COVERED and RECENT BRIEFS.
 */
export async function buildInputs({ config, store, scoutResult, now = Date.now, forBriefId = null }) {
  const today = istDate(new Date(now()))
  const sc = config.scout
  const st = config.strategist
  const mine = (r) => forBriefId && r.payload?.used_by === forBriefId
  const usable = (r) => r.status === 'open' || mine(r)

  // Mem0 records, plus (DRY_RUN only) the records the Scout made in memory this run and could not save.
  const inMemory = config.runtime.dryRun ? scoutResult?.dry_run_records ?? {} : {}
  const records = async (type, status) => {
    const saved = await store.getRecords({ type, ...(status && { status }) })
    const extra = (inMemory[type] ?? []).filter((r) => (!status || r.status === status) && !saved.some((s) => s.id === r.id))
    return [...saved, ...extra]
  }

  // M91 facts: today's current record, or the Scout must run first.
  const factsRec = (await records('m91_facts', 'current')).find((r) => r.date === today)
  if (!factsRec) throw new InputsError(`No m91_facts record for today (${today}). Run the Scout first (npm run scout, or npm run strategist -- --with-scout).`)
  const facts = { can: factsRec.payload.can ?? [], cannot: factsRec.payload.cannot ?? [], integrations: factsRec.payload.integrations ?? [] }

  // Pinned topics due.
  const pinnedDue = (await records('pinned_topic'))
    .filter((r) => usable(r) && String(r.payload?.target_date) <= today)
    .sort((a, b) => (a.payload.priority === 'high' ? -1 : 0) - (b.payload.priority === 'high' ? -1 : 0) || String(a.payload.target_date).localeCompare(String(b.payload.target_date)))

  // Stories: rapid-response window recomputed from the published date.
  const stories = (await records('story_lead')).filter(usable)
  // Phase 12: RAPID_RESPONSE_ENABLED=false turns the rapid-response path off (recent stories are ordinary stories).
  const isRapid = (r) => sc.rapidResponseEnabled !== false && storyDateRule(r.payload?.published_date, { today, lookbackDays: sc.storyLookbackDays, rapidDays: sc.rapidResponseDays }).rapid
  const rapidStories = stories.filter(isRapid)
  const otherStories = stories.filter((r) => !isRapid(r)).sort((a, b) => byDateDesc(a.payload?.published_date, b.payload?.published_date)).slice(0, 10)

  // Clusters: the ScoutResult's top clusters first, then by rank score; at most 8.
  const topIds = (scoutResult?.top_clusters ?? []).map((c) => c.cluster_id)
  const clusters = (await records('question_cluster'))
    .filter(usable)
    .sort((a, b) => {
      const ia = topIds.indexOf(a.payload?.cluster_id)
      const ib = topIds.indexOf(b.payload?.cluster_id)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (b.payload?.rank_score ?? 0) - (a.payload?.rank_score ?? 0)
    })
    .slice(0, 8)

  const tutorials = (await records('tutorial_lead')).filter(usable).slice(0, 5)

  // Style notes: newest current profile per topic group within STYLE_REUSE_DAYS.
  const styleNotes = []
  for (const r of (await records('tone_profile', 'current')).sort((a, b) => byDateDesc(a.date, b.date))) {
    const g = Number(r.topicGroup ?? r.payload?.topic_group)
    const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.date}T00:00:00Z`)) / 86400000
    if (styleNotes.some((s) => s.topic_group === g) || !(age <= sc.styleReuseDays)) continue
    styleNotes.push({ profile_id: r.payload.profile_id, topic_group: g, topic: r.payload.topic, notes: r.payload.notes, article_titles: (r.payload.based_on ?? []).map((b) => b.title) })
  }

  // Recent briefs, balance and coverage.
  const briefRecords = (await store.getRecords({ type: 'brief' })).filter((r) => (r.briefId ?? r.payload?.brief_id) !== forBriefId)
  const recentBriefs = latestBriefs(briefRecords).slice(0, st.recentBriefsWindow).map((r) => ({
    brief_id: r.briefId ?? r.payload?.brief_id, date: r.date, topic_group: r.payload?.topic_group ?? r.topicGroup ?? null,
    post_type: r.payload?.post_type ?? null, title: r.payload?.titles?.[0] ?? r.payload?.topic ?? ''
  }))
  const covered = []
  for (const r of latestBriefs(briefRecords)) covered.push({ date: r.date, text: `${r.payload?.titles?.[0] ?? r.payload?.topic ?? 'untitled'} — ${r.payload?.angle ?? ''}` })
  for (const r of await store.getRecords({ type: 'draft' })) {
    if ((r.briefId ?? r.payload?.brief_id) === forBriefId) continue
    covered.push({ date: r.date, text: `${r.payload?.title ?? 'untitled'} — ${typeof r.payload?.context === 'string' ? r.payload.context : r.payload?.context?.summary ?? ''}` })
  }
  const alreadyCovered = covered.sort((a, b) => byDateDesc(a.date, b.date)).slice(0, 60).map((l) => `- ${l.text.replace(/\s+/g, ' ').slice(0, 200)}`)

  // Lessons (Phase 5 writes them).
  // Published posts (Phase 7 writes them): the only allowed targets for internal_links.
  const publishedPosts = (await store.getRecords({ type: 'published_post' }))
    // Phase 7 C7: only posts that are live now (status published).
    .filter((r) => r.status === 'published' && r.payload?.url)
    .sort((a, b) => byDateDesc(a.payload?.published_at ?? a.date, b.payload?.published_at ?? b.date))
    .slice(0, 40)
    .map((r) => ({ title: r.payload.title ?? '', url: r.payload.url, topic_group: r.payload.topic_group ?? r.topicGroup ?? null, summary: String(r.payload.summary ?? r.payload.description ?? '').slice(0, 200) }))

  const lessons = st.lessonsLimit > 0
    ? (await store.getRecords({ type: 'lesson' })).sort((a, b) => byDateDesc(a.date, b.date)).slice(0, st.lessonsLimit)
      .map((r) => (typeof r.payload === 'string' ? r.payload : r.payload?.text ?? JSON.stringify(r.payload)))
    : []

  // Every lead by id, and every URL that appears in the inputs.
  const leadIndex = new Map()
  for (const r of pinnedDue) leadIndex.set(r.payload.pinned_id, { kind: 'pinned', record: r })
  for (const r of [...rapidStories, ...otherStories]) leadIndex.set(r.payload.story_id, { kind: 'story', record: r, rapid: isRapid(r) })
  for (const r of clusters) leadIndex.set(r.payload.cluster_id, { kind: 'cluster', record: r })
  for (const r of tutorials) leadIndex.set(r.payload.tutorial_id, { kind: 'tutorial', record: r })

  const factUrls = new Set([...facts.can, ...facts.cannot, ...facts.integrations].map((f) => urlKey(f.source_url)))
  const allowed = new Set(factUrls)
  for (const r of [...rapidStories, ...otherStories]) allowed.add(urlKey(r.payload.source_url))
  for (const r of clusters) for (const u of compactCluster(r.payload).source_urls) allowed.add(urlKey(u))
  for (const r of tutorials) for (const s of [...(r.payload.steps_outline ?? []), ...(r.payload.supporting_facts ?? [])]) allowed.add(urlKey(s.source_url))
  allowed.delete('')

  const blocked = blockedGroup(recentBriefs)
  return {
    today,
    factsRecordId: factsRec.id,
    facts,
    factUrls,
    pinnedDue: pinnedDue.map((r) => compactPinned(r.payload)),
    rapidStories: rapidStories.map((r) => compactStory(r.payload)),
    otherStories: otherStories.map((r) => compactStory(r.payload)),
    clusters: clusters.map((r) => compactCluster(r.payload)),
    tutorials: tutorials.map((r) => compactTutorial(r.payload)),
    styleNotes,
    recentBriefs,
    blockedGroup: blocked,
    leastUsedGroups: leastUsedGroups(recentBriefs),
    alreadyCovered,
    lessons,
    publishedPosts,
    publishedUrls: new Set(publishedPosts.map((p) => urlKey(p.url))),
    competitors: sc.competitors,
    leadIndex,
    allowedUrls: allowed,
    leadCount: leadIndex.size
  }
}

const json = (v) => JSON.stringify(v)
const listOrNone = (arr) => (arr.length ? json(arr) : 'none')

/** The message (brief 9.4), kept under viaSocket's 50,000-character limit by trimming the least important lists. */
export function buildStrategistMessage(inputs, tail = '', max = MESSAGE_MAX) {
  const take = { other: 10, covered: 60, clusters: 8, tutorials: 5 }
  const build = () => [
    '--- TODAY ---', inputs.today,
    '--- PINNED TOPICS DUE ---', listOrNone(inputs.pinnedDue),
    '--- RAPID-RESPONSE STORIES ---', listOrNone(inputs.rapidStories),
    '--- OTHER STORIES ---', listOrNone(inputs.otherStories.slice(0, take.other)),
    '--- QUESTION CLUSTERS ---', listOrNone(inputs.clusters.slice(0, take.clusters)),
    '--- TUTORIAL LEADS ---', listOrNone(inputs.tutorials.slice(0, take.tutorials)),
    '--- STYLE NOTES ---', listOrNone(inputs.styleNotes),
    '--- M91 FACTS ---', json(inputs.facts),
    '--- RECENT BRIEFS ---', json(inputs.recentBriefs.map(({ date, topic_group, post_type, title }) => ({ date, topic_group, post_type, title }))),
    '--- PUBLISHED POSTS ---', listOrNone(inputs.publishedPosts ?? []),
    '--- ALREADY COVERED ---', inputs.alreadyCovered.slice(0, take.covered).join('\n') || 'none',
    '--- LESSONS ---', inputs.lessons.length ? inputs.lessons.map((l) => `- ${l}`).join('\n') : 'none',
    '--- COMPETITORS ---', inputs.competitors.join(', '),
    ...(tail ? [tail] : [])
  ].join('\n')
  const steps = [() => (take.other = 3), () => (take.covered = 20), () => (take.tutorials = 3), () => (take.clusters = 5), () => (take.other = 0), () => (take.covered = 5)]
  let message = build()
  const trimmed = []
  for (const step of steps) {
    if (message.length <= max) break
    step()
    trimmed.push(Object.entries(take).map(([k, v]) => `${k}=${v}`).join(' '))
    message = build()
  }
  if (message.length > max) throw new InputsError(`Strategist message is ${message.length} characters; the limit is ${max}`)
  return { message, trimmed }
}
