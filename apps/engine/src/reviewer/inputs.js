// Reviewer inputs, built by code (Phase 5 brief, B3).

import { urlKey } from '../checks/content.js'
import { MESSAGE_MAX } from '../scout/prompts.js'
import { allowedUrlSet, supportedSources, toneSection, factSheet, briefRules } from '../writer/inputs.js'
import { draftVersion, draftBriefVersion, isEarlierDraft } from '../writer/save.js'
import { guideForReviewer } from '../experience/review.js'
import { docsLinkRule, M91_SITE_URL } from '../util/m91links.js'

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

/** The current m91_facts record's payload: the same one the Writer gets. */
export { loadFacts } from '../writer/inputs.js'

/** The newest review written for an earlier draft of this brief (B3 PREVIOUS REVIEW), or null. */
export async function loadPreviousReview(store, briefId, current) {
  const reviews = (await store.getRecords({ type: 'review', brief_id: briefId }))
    .map((r) => ({ ...r, version: r.payload?.version ?? r.version, metadata: { ...r.metadata, brief_version: r.payload?.brief_version ?? r.metadata?.brief_version } }))
    .filter((r) => draftVersion(r) !== null && isEarlierDraft(r, current))
    .sort((a, b) => draftBriefVersion(b) - draftBriefVersion(a) || draftVersion(b) - draftVersion(a))
  return reviews[0]?.payload ?? null
}

/**
 * Every allowed URL with a short label (B3): the Writer's set, labelled by where it came from. With `config`,
 * M91 docs links are left out and M91's main site is in (no docs links in posts).
 */
export function labelledAllowedUrls(brief, { sourcePack = null, ctaUrl, snippets = [], config = null } = {}) {
  const labels = new Map()
  const isDocs = config ? docsLinkRule(config).isDocs : () => false
  const add = (url, label) => {
    if (!url || isDocs(url)) return
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
  if (config) add(M91_SITE_URL, "M91's main site (the only M91 link besides the call to action)")
  const { set } = allowedUrlSet(brief, { sourcePack, ctaUrl, snippets, config })
  return { set, list: [...labels.values()].map((x) => `- ${x.url} (${x.labels.join('; ') || 'allowed'})`) }
}

/**
 * Builds the message sections (B3). Returns { sections, allowed }.
 * @param {{ draft, brief, facts, sourcePack, story, previousReview, snippets }} input
 */
export async function buildReviewerSections({ store, config, draft, brief, facts, sourcePack, story, previousReview, snippets = [], guide = null, sourceText = '' }) {
  const allowed = labelledAllowedUrls(brief, { sourcePack, ctaUrl: config.m91.ctaUrl, snippets, config })
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
    // Phase 10: the guide built from this draft (null: no guide; the post is reviewed as written).
    guide: guide ? JSON.stringify(guideForReviewer(guide)) : null,
    brief: JSON.stringify(brief),
    // Used only when the message is too long (a long post): the brief fields the Reviewer judges by, and the failed
    // checks (the passed ones counted).
    briefCompact: JSON.stringify({ ...briefRules(brief), questions: brief.questions ?? [] }),
    checks: JSON.stringify(results),
    checksCompact: JSON.stringify({ failed: results.filter((r) => !r.passed), passed: results.filter((r) => r.passed).length }),
    facts: facts ? factSheet(facts) : '(no current m91_facts record: treat every M91 claim as unverified)',
    allowedUrls: allowed.list.join('\n'),
    story: brief.story?.use ? JSON.stringify(story ?? brief.story) : null,
    // Where each code block in the post comes from. The code itself is in POST (the tutorial's steps are in BRIEF):
    // sending each snippet's whole source again, a long script included, pushed the message over 50,000 characters.
    tutorial: isTutorial ? JSON.stringify({ code_in_post_from: snippets.map(({ id, language, source_url, code }) => ({ id, language, source_url, lines: String(code ?? '').split('\n').length })) }) : null,
    sourcePack: sourcePack ? JSON.stringify(sourcePack.claims ?? sourcePack.payload?.claims ?? sourcePack) : null,
    // The text of the outside pages the post cites (the Writer had the same).
    sourceText: sourceText || null,
    previousReview: previousReview ? JSON.stringify({
      feedback: (previousReview.feedback ?? []).map(({ area, quote, problem, fix, severity }) => ({ area, quote, problem, fix, severity })),
      revision_notes: draft.revision_notes ?? []
    }) : null,
    tone: tone.text
  }
  return { sections, allowed }
}

/**
 * Message in B3's order, under viaSocket's 50,000-character cap. POST is never cut. When too long, in this order:
 * the brief down to the fields the Reviewer judges by, the check results down to the failed ones, the tone notes,
 * the source pack, the story record, the integrations list. Returns { message, trimmed[] }.
 */
const TONE_KEEP = 1500
const SOURCE_TEXT_KEEP = 6000

export function buildReviewerMessage(s, tail = '', max = MESSAGE_MAX) {
  const order = [
    ['post', 'POST'], ['guide', 'GUIDE'], ['brief', 'BRIEF'], ['checks', 'CHECK RESULTS'], ['facts', 'M91 FACTS'], ['allowedUrls', 'ALLOWED URLS'],
    ['story', 'STORY'], ['tutorial', 'TUTORIAL'], ['sourcePack', 'SOURCE PACK'], ['sourceText', 'SOURCE TEXT'], ['previousReview', 'PREVIOUS REVIEW'], ['tone', 'TONE NOTES']
  ]
  const sec = { ...s }
  const build = () => [...order.filter(([k]) => sec[k]).map(([k, label]) => `--- ${label} ---\n${sec[k]}`), ...(tail ? [tail] : [])].join('\n')
  const trimmed = []
  let message = build()
  for (const [key, compact, what] of [['brief', 'briefCompact', 'brief (the fields the Reviewer judges by)'], ['checks', 'checksCompact', 'check results (failed checks only)']]) {
    if (message.length <= max || !sec[compact] || sec[compact].length >= (sec[key]?.length ?? 0)) continue
    sec[key] = sec[compact]
    trimmed.push(what)
    message = build()
  }
  if (message.length > max && sec.tone && sec.tone.length > TONE_KEEP) {
    sec.tone = `${sec.tone.slice(0, TONE_KEEP)} …(trimmed)`
    trimmed.push('tone notes')
    message = build()
  }
  // The source pages: cut from the end (the outline's links come last), first down to SOURCE_TEXT_KEEP, at the end to
  // whatever fits.
  const cutSources = (keep) => {
    if (message.length <= max || !sec.sourceText) return
    const target = Math.max(keep, sec.sourceText.length - (message.length - max) - 50)
    if (target >= sec.sourceText.length) return
    sec.sourceText = target > 0 ? `${sec.sourceText.slice(0, target)} …(trimmed)` : null
    if (!trimmed.includes('source pages')) trimmed.push('source pages')
    message = build()
  }
  cutSources(SOURCE_TEXT_KEEP)
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
  cutSources(0)
  if (message.length > max) throw new ReviewerInputError(`Reviewer message is ${message.length} characters; viaSocket's limit is ${max}`)
  return { message, trimmed }
}
