// This week's signals for the editor (code, no AI): the news cards the news check found, the questions people asked
// (the Scout's "week" call), M91's new integrations (today's facts against a week ago), M91's integrations, the
// pinned ideas not due yet, and what readers already have (live guides, our recent posts). Every signal gets a short
// id (q1, n1, m1, i1, p1) the editor must cite.
import { similarity } from '../dedupe.js'
import { listOpportunities, isExpired } from '../timely/model.js'
import { daysAgo } from '../scout/checks.js'
import { istDate } from '../util/time.js'
import { existingPosts } from './repeats.js'

const NEWS_MAX = 8
const CHANGES_MAX = 5
const INTEGRATIONS_MAX = 10
const PINS_MAX = 5
const LIVE_MAX = 80
const RECENT_MAX = 8

/** The M91 integrations of the newest facts, and the ones a week-old facts record did not have. */
async function m91Integrations(store) {
  const all = (await store.getRecords({ type: 'm91_facts' })).filter((r) => r.date).sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const current = all[0]
  if (!current) return { integrations: [], changes: [] }
  const integrations = (current.payload?.integrations ?? []).filter((x) => x?.name)
  const older = all.find((r) => (daysAgo(r.date, current.date) ?? 0) >= 5)
  if (!older) return { integrations, changes: [] }
  const before = (older.payload?.integrations ?? []).map((x) => `${x.name} ${x.what_it_enables ?? ''}`)
  const changes = integrations.filter((x) => !before.some((b) => similarity(`${x.name} ${x.what_it_enables ?? ''}`, b) >= 0.8))
  return { integrations, changes }
}

/**
 * @param questions the Scout's "week" questions ([{ question, source_url, where, posted_date, demand_evidence }])
 * @returns {{ questions, news, changes, integrations, pins, live, recent, posts, byId: Map }}
 */
export async function gatherSignals(store, { config, now = Date.now, questions = [] }) {
  const today = istDate(new Date(now()))
  const news = !config?.timely?.enabled ? [] : (await listOpportunities(store))
    .filter((r) => ['proposed', 'write_now'].includes(r.status) && !r.payload?.brief_id && !isExpired(r, { today, windowDays: config.timely.windowDays }))
    .sort((a, b) => String(b.payload?.published_date).localeCompare(String(a.payload?.published_date)))
    .slice(0, NEWS_MAX)
    .map((r, i) => ({ id: `n${i + 1}`, record_id: r.id, opportunity_id: r.payload.opportunity_id, title: r.payload.title, what_happened: r.payload.what_happened, outlet: r.payload.outlet, published_date: r.payload.published_date, source_url: r.payload.source_url, why_m91: r.payload.why_m91, urgency: r.payload.urgency }))
  const { integrations, changes } = await m91Integrations(store)
  const pins = (await store.getRecords({ type: 'pinned_topic' }))
    .filter((r) => r.status === 'open' && String(r.payload?.target_date) > today)
    .sort((a, b) => String(a.payload.target_date).localeCompare(String(b.payload.target_date)))
    .slice(0, PINS_MAX)
    .map((r, i) => ({ id: `p${i + 1}`, topic: r.payload.topic, target_date: r.payload.target_date, notes: r.payload.notes ?? '' }))
  const posts = await existingPosts(store)
  const out = {
    questions: questions.map((q, i) => ({ id: `q${i + 1}`, ...q })),
    news,
    changes: changes.slice(0, CHANGES_MAX).map((x, i) => ({ id: `m${i + 1}`, name: x.name, what_it_enables: x.what_it_enables, source_url: x.source_url })),
    integrations: integrations.slice(0, INTEGRATIONS_MAX).map((x, i) => ({ id: `i${i + 1}`, name: x.name, what_it_enables: x.what_it_enables, source_url: x.source_url })),
    pins,
    live: posts.filter((p) => p.where === 'a live guide').slice(0, LIVE_MAX).map((p) => ({ title: p.title, ...(p.url && { url: p.url }) })),
    recent: posts.filter((p) => p.where !== 'a live guide').slice(0, RECENT_MAX).map((p) => ({ title: p.title, format: p.format, date: String(p.at).slice(0, 10), status: p.where })),
    posts
  }
  out.byId = new Map([...out.questions, ...out.news, ...out.changes, ...out.integrations, ...out.pins].map((s) => [s.id, s]))
  return out
}

/** The counts, for the run's line and the dashboard. */
export const signalCounts = (s) => ({ questions: s.questions.length, news: s.news.length, changes: s.changes.length, integrations: s.integrations.length, pins: s.pins.length, live: s.live.length, recent: s.recent.length })
