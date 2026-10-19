// Reviewer inputs, built by code (Phase 5 brief, B3).

import { urlKey } from '../checks/content.js'
import { MESSAGE_MAX } from '../scout/prompts.js'
import { allowedUrlSet, supportedSources, toneSection } from '../writer/inputs.js'
import { draftVersion, draftBriefVersion, isEarlierDraft } from '../writer/save.js'

export class ReviewerInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ReviewerInputError'
  }
}

/** The draft to review: the given version (within the brief version, if given), else the newest. */
export async function loadDraft(store, briefId, { version, briefVersion } = {}) {
  const drafts = (await store.getRecords({ type: 'draft', brief_id: briefId }))
    .filter((r) => (r.briefId ?? r.payload?.brief_id) === briefId && draftVersion(r) !== null)
    .sort((a, b) => draftBriefVersion(b) - draftBriefVersion(a) || draftVersion(b) - draftVersion(a))
  return drafts.find((d) => (version == null || draftVersion(d) === Number(version)) && (briefVersion == null || draftBriefVersion(d) === Number(briefVersion))) ?? null
}

/** The current m91_facts record's payload (newest date first), or null. */
export async function loadFacts(store) {
  const recs = (await store.getRecords({ type: 'm91_facts', status: 'current' })).sort((a, b) => String(b.date).localeCompare(String(a.date)))
  return recs[0]?.payload ?? null
}

/** The newest review written for an earlier draft of this brief (B3 PREVIOUS REVIEW), or null. */
export async function loadPreviousReview(store, briefId, current) {
  const reviews = (await store.getRecords({ type: 'review', brief_id: briefId }))
    .map((r) => ({ ...r, version: r.payload?.version ?? r.version, metadata: { ...r.metadata, brief_version: r.payload?.brief_version ?? r.metadata?.brief_version } }))
    .filter((r) => draftVersion(r) !== null && isEarlierDraft(r, current))
    .sort((a, b) => draftBriefVersion(b) - draftBriefVersion(a) || draftVersion(b) - draftVersion(a))
  return reviews[0]?.payload ?? null
}

/** Every allowed URL with a short label (B3): the Writer's set, labelled by where it came from. */
export function labelledAllowedUrls(brief, { sourcePack = null, ctaUrl, snippets = [] } = {}) {
  const labels = new Map()
  const add = (url, label) => {
    if (!url) return
    const k = urlKey(url)
    if (!labels.has(k)) labels.set(k, { url, labels: [] })
    if (label && labels.get(k).labels.length < 2) labels.get(k).labels.push(String(label).slice(0, 100))
  }
  for (const s of brief.sources ?? []) add(s.url, `source: ${s.what_it_supports ?? ''}`)
  for (const f of brief.m91_facts_to_use ?? []) add(f.source_url, `M91 fact: ${f.fact ?? ''}`)
  if (brief.story?.use) add(brief.story.source_url, `story: ${brief.story.attribution_line ?? ''}`)
  if (brief.news?.is_news_based) add(brief.news.source_url, `news: ${brief.news.outlet ?? ''}`)
  for (const s of brief.tutorial?.steps ?? []) add(s.source_url, `tutorial step: ${s.step ?? ''}`)
  for (const s of brief.outline ?? []) for (const u of s.source_urls ?? []) add(u, `outline: ${s.heading ?? ''}`)
  for (const l of brief.internal_links ?? []) add(l.url, `internal link: ${l.anchor_text ?? ''}`)
  for (const r of supportedSources(sourcePack)) add(r.url, `source pack: ${r.publisher ?? ''} — ${r.claim ?? ''}`)
  for (const s of snippets) add(s.source_url, `code snippet ${s.id}`)
  add(ctaUrl, 'M91 call to action')
  const { set } = allowedUrlSet(brief, { sourcePack, ctaUrl, snippets })
  return { set, list: [...labels.values()].map((x) => `- ${x.url} (${x.labels.join('; ') || 'allowed'})`) }
}

/**
 * Builds the message sections (B3). Returns { sections, allowed }.
 * @param {{ draft, brief, facts, sourcePack, story, previousReview, snippets }} input
 */
export async function buildReviewerSections({ store, config, draft, brief, facts, sourcePack, story, previousReview, snippets = [] }) {
  const allowed = labelledAllowedUrls(brief, { sourcePack, ctaUrl: config.m91.ctaUrl, snippets })
  const results = (draft.checks?.results ?? []).map(({ id, passed, severity, value, detail }) => ({ id, passed, severity, value, detail }))
  const isTutorial = brief.post_type === 'tutorial' || brief.tutorial?.use === true
  const tone = await toneSection(store, brief, config)
  const sections = {
    post: [
      `title: ${draft.title ?? ''}`,
      `tldr: ${JSON.stringify(draft.tldr ?? [])}`,
      `seo: ${JSON.stringify(draft.seo ?? {})}`,
      'post_markdown:',
      draft.post_markdown ?? ''
    ].join('\n'),
    brief: JSON.stringify(brief),
    checks: JSON.stringify(results),
    facts: facts ? JSON.stringify({ can: facts.can ?? [], cannot: facts.cannot ?? [], integrations: facts.integrations ?? [] }) : '(no current m91_facts record: treat every M91 claim as unverified)',
    allowedUrls: allowed.list.join('\n'),
    story: brief.story?.use ? JSON.stringify(story ?? brief.story) : null,
    tutorial: isTutorial ? JSON.stringify({ tutorial: brief.tutorial, snippets: snippets.map(({ id, language, source_url, code }) => ({ id, language, source_url, code })) }) : null,
    sourcePack: sourcePack ? JSON.stringify(sourcePack.claims ?? sourcePack.payload?.claims ?? sourcePack) : null,
    previousReview: previousReview ? JSON.stringify({
      feedback: (previousReview.feedback ?? []).map(({ area, quote, problem, fix, severity }) => ({ area, quote, problem, fix, severity })),
      revision_notes: draft.revision_notes ?? []
    }) : null,
    tone: tone.text
  }
  return { sections, allowed }
}

/**
 * Message in B3's order, under viaSocket's 50,000-character cap: the source pack, then the story
 * record, then the integrations list are trimmed first. Returns { message, trimmed[] }.
 */
export function buildReviewerMessage(s, tail = '', max = MESSAGE_MAX) {
  const order = [
    ['post', 'POST'], ['brief', 'BRIEF'], ['checks', 'CHECK RESULTS'], ['facts', 'M91 FACTS'], ['allowedUrls', 'ALLOWED URLS'],
    ['story', 'STORY'], ['tutorial', 'TUTORIAL'], ['sourcePack', 'SOURCE PACK'], ['previousReview', 'PREVIOUS REVIEW'], ['tone', 'TONE NOTES']
  ]
  const sec = { ...s }
  const build = () => [...order.filter(([k]) => sec[k]).map(([k, label]) => `--- ${label} ---\n${sec[k]}`), ...(tail ? [tail] : [])].join('\n')
  const trimmed = []
  let message = build()
  for (const [key, what] of [['sourcePack', 'source pack'], ['story', 'story record']]) {
    if (message.length <= max || !sec[key]) continue
    sec[key] = sec[key].slice(0, Math.max(200, sec[key].length - (message.length - max) - 50)) + ' …(trimmed)'
    trimmed.push(what)
    message = build()
  }
  if (message.length > max && sec.facts?.startsWith('{')) {
    const f = JSON.parse(sec.facts)
    sec.facts = JSON.stringify({ can: f.can, cannot: f.cannot })
    trimmed.push('M91 integrations list')
    message = build()
  }
  if (message.length > max) throw new ReviewerInputError(`Reviewer message is ${message.length} characters; viaSocket's limit is ${max}`)
  return { message, trimmed }
}
