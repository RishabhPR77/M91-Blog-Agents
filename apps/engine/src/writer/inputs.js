// Writer inputs, built by code (Phase 4 brief, section 6).

import { htmlToText, parseRepo, sourceHeader } from '../scout/docs.js'
import { MESSAGE_MAX } from '../scout/prompts.js'
import { urlKey } from '../checks/content.js'
import { defaultToneNotes } from './tones.js'

export class WriterInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WriterInputError'
  }
}

// Fields the Writer doesn't need (brief 6.1).
const DROP_FROM_BRIEF = ['review_flags', 'run_id', 'created_at', 'lead']

/** The latest (non-superseded) brief version, or the given version. */
export async function loadBrief(store, briefId, briefVersion) {
  const versions = (await store.getRecords({ type: 'brief', brief_id: briefId })).filter((r) => r.payload?.brief_id === briefId || r.briefId === briefId)
  if (!versions.length) return null
  const v = (r) => r.payload?.brief_version ?? r.version ?? 1
  if (briefVersion !== undefined && briefVersion !== null) return versions.find((r) => v(r) === Number(briefVersion)) ?? null
  const live = versions.filter((r) => r.status !== 'superseded')
  return (live.length ? live : versions).sort((a, b) => v(b) - v(a))[0]
}

/** Every URL the post may link to (brief 6.5). Returns a Set of urlKey()s plus the plain list. */
export function allowedUrlSet(brief, { sourcePack = null, ctaUrl, snippets = [] } = {}) {
  const urls = [
    ...snippets.map((s) => s.source_url),
    ...(brief.sources ?? []).map((s) => s.url),
    ...(brief.m91_facts_to_use ?? []).map((f) => f.source_url),
    brief.story?.use ? brief.story.source_url : null,
    brief.news?.is_news_based ? brief.news.source_url : null,
    ...(brief.tutorial?.steps ?? []).map((s) => s.source_url),
    ...(brief.outline ?? []).flatMap((s) => s.source_urls ?? []),
    ...(brief.internal_links ?? []).map((l) => l.url),
    ...supportedSources(sourcePack).map((r) => r.url),
    ctaUrl
  ].filter(Boolean)
  const list = [...new Map(urls.map((u) => [urlKey(u), u])).values()]
  return { set: new Set(list.map(urlKey)), list }
}

/** The source pack's supported results: { claim, url, publisher, note }. */
export function supportedSources(sourcePack) {
  const claims = sourcePack?.claims ?? sourcePack?.payload?.claims ?? []
  return claims.flatMap((c) => (c.results ?? []).filter((r) => r.verdict === 'supports').map((r) => ({ claim: c.claim, url: r.url, publisher: r.publisher, note: r.note })))
}

/** TONE section text. */
export async function toneSection(store, brief, config) {
  const guidance = brief.tone?.guidance ?? []
  if (brief.tone?.source === 'style_notes' && brief.tone?.profile_id) {
    const p = (await store.getRecords({ type: 'tone_profile' })).find((r) => r.payload?.profile_id === brief.tone.profile_id)
    if (p) {
      const n = p.payload.notes ?? {}
      const notes = [n.opening_pattern, n.sentence_length, n.paragraph_style, n.explanation_style, n.examples, n.headings, ...(n.avoid ?? []).map((a) => `Avoid: ${a}`)].filter(Boolean)
      return { id: brief.tone.profile_id, text: `profile: ${brief.tone.profile_id}\nnotes: ${notes.join(' | ')}\nguidance: ${guidance.join(' | ')}` }
    }
  }
  const id = brief.tone?.source === 'default' && brief.tone?.profile_id ? brief.tone.profile_id : config.content.defaultTone
  return { id, text: `profile: ${id}\nnotes: ${defaultToneNotes(id).join(' | ')}\nguidance: ${guidance.join(' | ')}` }
}

/**
 * Tutorial source text (brief 6.3): each step URL once, in step order. M91 docs pages are fetched
 * directly; the skill repository root gives its README and a file URL in it gives that file
 * (both through the GitHub API). Capped at maxChars (whole pages kept; the last one cut).
 */
export async function tutorialSourceText(brief, { config, fetch = globalThis.fetch, timeoutMs = 15000 }) {
  const urls = (brief.tutorial?.steps ?? []).map((s) => s.source_url)
  const { text } = await fetchSourcePages(urls, { config, fetch, timeoutMs, onError: (url, error) => {
    throw new WriterInputError(`tutorial source ${url} could not be fetched (${error.message}); no tutorial without its source text`)
  } })
  if (!text) throw new WriterInputError('the tutorial has no fetchable source text (M91 docs or the skill repository)')
  return text
}

// At most this many cited docs pages are fetched for a non-tutorial post's snippets.
const CITED_PAGES_MAX = 4

/**
 * Snippet source for a post that is not a tutorial (Phase 5 A1.6): the M91 docs pages and skill
 * repository files the brief cites, so any code it shows comes from them. A page that fails to load
 * is skipped with a warning (the post then describes code in words).
 */
export async function citedDocsSourceText(brief, { config, fetch = globalThis.fetch, timeoutMs = 15000, warnings = [] }) {
  const urls = [
    ...(brief.sources ?? []).map((s) => s.url),
    ...(brief.m91_facts_to_use ?? []).map((f) => f.source_url),
    ...(brief.outline ?? []).flatMap((s) => s.source_urls ?? [])
  ]
  const { text } = await fetchSourcePages(urls, { config, fetch, timeoutMs, maxPages: CITED_PAGES_MAX, onError: (url, error) => warnings.push(`snippet source ${url} not fetched (${error.message})`) })
  return text
}

/**
 * Fetches each M91 docs page or skill repository file once, in order: docs pages directly, the
 * repository root as its README and a file in it through the GitHub API. Other URLs are skipped
 * (the Writer may cite them, but gets no code from them). Capped at TUTORIAL_SOURCE_MAX_CHARS
 * (whole pages kept; the last one cut). Returns { text, urls }.
 */
export async function fetchSourcePages(rawUrls, { config, fetch = globalThis.fetch, timeoutMs = 15000, maxPages = Infinity, onError }) {
  const urls = [...new Map(rawUrls.filter(Boolean).map((u) => [urlKey(u), u])).values()]
  const repo = parseRepo(config.m91.skillRepoUrl)
  const hosts = config.scout.docsHosts
  const parts = []
  const used = []
  let chars = 0
  for (const url of urls) {
    if (used.length >= maxPages) break
    let text
    try {
      const u = new URL(url)
      const res = await (async () => {
        if (hosts.includes(u.hostname.toLowerCase())) return fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
        const m = repo && url.match(new RegExp(`^https://github\\.com/${repo.owner}/${repo.repo}(?:/(?:blob|tree)/[^/]+/(.+))?/?$`, 'i'))
        if (m) {
          const api = m[1] ? `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${m[1]}` : `https://api.github.com/repos/${repo.owner}/${repo.repo}/readme`
          return fetch(api, { headers: { accept: 'application/vnd.github.raw', 'user-agent': 'M91BlogEngine/1.0' }, signal: AbortSignal.timeout(timeoutMs) })
        }
        return null
      })()
      if (!res) continue
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.text()
      text = /^\s*<(!doctype|html)/i.test(body) ? htmlToText(body) : body.trim()
    } catch (error) {
      if (error instanceof WriterInputError) throw error
      onError?.(url, error)
      continue
    }
    const block = `${sourceHeader(url)}\n${text}`
    const room = config.writer.tutorialSourceMaxChars - chars
    if (room <= 0) break
    parts.push(block.length > room ? block.slice(0, room) : block)
    used.push(url)
    chars += Math.min(block.length, room)
  }
  return { text: parts.join('\n\n'), urls: used }
}

/** The paragraph of `markdown` containing `quote` (case- and space-insensitive), or null. */
export function excerptFor(markdown, quote) {
  const q = String(quote ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!q) return null
  // Reviewers quote the text as it reads, so compare without Markdown link/emphasis markup.
  const plain = (p) => p.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').toLowerCase()
  const paras = String(markdown ?? '').split(/\n\s*\n/)
  return paras.find((p) => plain(p).includes(q.replace(/[*_`]/g, '')))?.trim() ?? null
}

/** The trimmed brief for revise mode (brief 6.2). */
export function briefRules(brief) {
  const keep = ['keyword', 'supporting_keywords', 'reader', 'intent', 'format', 'angle', 'tone', 'm91_facts_to_use', 'claims_to_avoid', 'story', 'tutorial', 'news', 'sources', 'internal_links', 'interactive_ideas', 'cta', 'notes_for_writer', 'word_target', 'reading_level']
  return {
    title: brief.titles?.[0],
    ...Object.fromEntries(keep.filter((k) => brief[k] !== undefined).map((k) => [k, brief[k]])),
    outline: (brief.outline ?? []).map((s) => ({ heading: s.heading, answer_first: s.answer_first }))
  }
}

export const fullBriefForWriter = (brief) => Object.fromEntries(Object.entries(brief).filter(([k]) => !DROP_FROM_BRIEF.includes(k)))

/**
 * Message sections in the brief's order (8.5), only those given. Kept under viaSocket's 50,000-char
 * cap by listing very long CODE SNIPPETS without their lines (snippetsCompact), then trimming TUTORIAL
 * SOURCE TEXT, then a full PREVIOUS DRAFT. Returns { message, tutorialText, trimmed[] }.
 */
export function buildWriterMessage(s, tail = '', max = MESSAGE_MAX) {
  const order = [
    ['brief', 'BRIEF'], ['briefRules', 'BRIEF RULES'], ['tone', 'TONE'], ['lessons', 'LESSONS'], ['allowedUrls', 'ALLOWED URLS'],
    ['internalLinks', 'INTERNAL LINKS'], ['interactiveIdeas', 'INTERACTIVE IDEAS'], ['tutorialText', 'TUTORIAL SOURCE TEXT'], ['snippets', 'CODE SNIPPETS'],
    ['previousContext', 'PREVIOUS CONTEXT'], ['previousDraft', 'PREVIOUS DRAFT'], ['feedback', 'FEEDBACK'],
    ['excerpts', 'QUOTED EXCERPTS'], ['sourcePack', 'SOURCE PACK']
  ]
  const sec = { ...s }
  const build = () => [...order.filter(([k]) => sec[k] !== undefined && sec[k] !== null && sec[k] !== '').map(([k, label]) => `--- ${label} ---\n${sec[k]}`), ...(tail ? [tail] : [])].join('\n')
  const trimmed = []
  let message = build()
  // First, very long snippets (a whole script) are listed without their lines (Phase 5.5 A1).
  if (message.length > max && sec.snippetsCompact && sec.snippetsCompact !== sec.snippets) {
    sec.snippets = sec.snippetsCompact
    trimmed.push('long code snippets (listed without their lines)')
    message = build()
  }
  if (message.length > max && sec.tutorialText) {
    const keep = Math.max(0, sec.tutorialText.length - (message.length - max) - 50)
    sec.tutorialText = sec.tutorialText.slice(0, keep)
    trimmed.push('tutorial source text')
    message = build()
  }
  if (message.length > max && sec.previousDraft && sec.previousContextFallback) {
    sec.previousDraft = sec.previousContextFallback
    trimmed.push('previous draft (context used instead)')
    message = build()
  }
  delete sec.previousContextFallback
  message = build()
  if (message.length > max) throw new WriterInputError(`Writer message is ${message.length} characters; viaSocket's limit is ${max}`)
  return { message, tutorialText: sec.tutorialText ?? '', trimmed }
}
