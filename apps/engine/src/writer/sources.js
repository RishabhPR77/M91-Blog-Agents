// SOURCE TEXT for the Writer: the text of the outside pages a brief cites (2026-11-13). The Reviewer opens these pages
// to check the post; the Writer used to get only a one-line summary of each, so whatever it wrote beyond the summary
// was a guess the Reviewer could catch (a headline, who did the research, how an API behaves). Now both read the same
// pages. Plain fetches, no AI. A page that does not load is marked, and the Writer keeps to what BRIEF says of it.
import { htmlToText } from '../scout/docs.js'
import { urlKey } from '../checks/content.js'
import { docsLinkRule, M91_SITE_URL } from '../util/m91links.js'

/** Pages loaded per post, characters kept per page, and in all (well under viaSocket's 50,000 per message). */
export const SOURCE_PAGES_MAX = 8
export const SOURCE_PAGE_MAX = 3500
export const SOURCE_TEXT_MAX = 22000

/**
 * The outside pages a brief relies on, each once, most important first (the news, the story, the sources, the
 * outline's links), with what the brief uses each for. M91's own docs and site are left out: they reach the Writer as
 * M91 FACTS and CODE SNIPPETS, and posts never link to them.
 */
export function citedPages(brief, { config, extra = [] } = {}) {
  const isDocs = docsLinkRule(config ?? {}).isDocs
  const skip = new Set([urlKey(M91_SITE_URL), urlKey(config?.m91?.ctaUrl ?? '')])
  const pages = new Map()
  const add = (url, what) => {
    if (!url || !/^https?:\/\//i.test(String(url)) || isDocs(url) || skip.has(urlKey(url))) return
    const k = urlKey(url)
    if (!pages.has(k)) pages.set(k, { url: String(url).trim(), uses: [] })
    const uses = pages.get(k).uses
    if (what && uses.length < 3 && !uses.includes(what)) uses.push(String(what).slice(0, 160))
  }
  if (brief?.news?.is_news_based) add(brief.news.source_url, `news: ${brief.news.claim_in_own_words ?? ''}`)
  if (brief?.story?.use) add(brief.story.source_url, `story: ${brief.story.how_to_use || brief.story.attribution_line || ''}`)
  for (const s of brief?.sources ?? []) add(s.url, s.what_it_supports)
  for (const e of extra) add(e.url, e.what)
  for (const s of brief?.outline ?? []) for (const u of s.source_urls ?? []) add(u, `section: ${s.heading}`)
  return [...pages.values()]
}

const WORD = /[a-z0-9]{4,}/g
// Common words that say nothing about a page's topic.
const STOP = new Set(['about', 'after', 'also', 'been', 'does', 'each', 'from', 'have', 'here', 'into', 'just', 'like', 'more', 'most', 'only', 'over', 'should', 'some', 'than', 'that', 'their', 'them', 'then', 'there', 'they', 'this', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your'])
// A light stem, so "events" finds "event" and "answered" finds "answer".
const stem = (w) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w.length > 4 ? w.replace(/s$/, '') : w)
const words = (s) => (String(s).toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)).map(stem)

/**
 * The parts of a long page worth keeping, in page order: its opening (the headline and lede, up to 700 characters and
 * at most 30% of the room),
 * then the paragraphs that share the most words with what the brief uses the page for. Gaps are marked "…".
 */
export function keepRelevant(text, hints, max) {
  const paras = String(text).split(/\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 1)
  const whole = paras.join('\n')
  if (whole.length <= max) return whole
  const want = new Set(hints.flatMap(words))
  const chosen = new Set()
  let used = 0
  // The opening takes at most 30% of the room, so the relevant paragraphs always fit too.
  const lead = Math.min(700, Math.floor(max * 0.3))
  for (let i = 0; i < paras.length && used + paras[i].length < lead; i++) {
    chosen.add(i)
    used += paras[i].length + 1
  }
  const scored = paras
    .map((p, i) => ({ i, score: words(p).filter((w) => want.has(w)).length / Math.sqrt(p.length / 80 + 1) }))
    .filter((x) => !chosen.has(x.i) && x.score > 0)
    .sort((a, b) => b.score - a.score)
  for (const x of scored) {
    if (used + paras[x.i].length + 1 > max) continue
    chosen.add(x.i)
    used += paras[x.i].length + 1
  }
  const order = [...chosen].sort((a, b) => a - b)
  const out = []
  order.forEach((i, n) => {
    if (n > 0 && i !== order[n - 1] + 1) out.push('…')
    out.push(paras[i])
  })
  return out.join('\n').slice(0, max)
}

/** One page as { title, text }: the og:title or <title> of an HTML page, its readable text. */
async function loadPage(url, { fetch, timeoutMs }) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'text/html, text/markdown, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'Mozilla/5.0 (compatible; source-reader/1.0)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const type = res.headers?.get?.('content-type') ?? ''
  if (type && !/html|text|markdown|json|xml/i.test(type)) throw new Error(`not a text page (${type.split(';')[0]})`)
  const body = await res.text()
  const html = /html/i.test(type) || /^\s*<(!doctype|html)/i.test(body)
  if (!html) return { title: '', text: body.trim() }
  const raw = body.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
  return { title: htmlToText(raw).replace(/\s+/g, ' ').trim(), text: htmlToText(body) }
}

/**
 * The SOURCE TEXT section for a brief: each cited page with its real title, what the brief uses it for, and its
 * relevant text; a page that does not load says so. Returns { text, loaded, failed } (text '' when no pages).
 * warnings gets one line when some pages did not load.
 */
export async function citedSourceText(brief, { config, fetch = globalThis.fetch, timeoutMs = 15000, warnings = [], extra = [] } = {}) {
  const pages = citedPages(brief, { config, extra }).slice(0, SOURCE_PAGES_MAX)
  if (!pages.length) return { text: '', loaded: 0, failed: [] }
  const per = Math.min(SOURCE_PAGE_MAX, Math.floor(SOURCE_TEXT_MAX / pages.length))
  const results = await Promise.all(pages.map(async (p) => {
    try {
      return { ...p, ...(await loadPage(p.url, { fetch, timeoutMs })) }
    } catch (error) {
      return { ...p, error: error?.cause?.message ?? error?.message ?? 'could not be loaded' }
    }
  }))
  const failed = results.filter((r) => r.error || !r.text)
  const parts = results.map((r) => {
    const head = [`=== SOURCE: ${r.url} ===`, ...(r.uses.length ? [`the brief uses it for: ${r.uses.join(' | ')}`] : [])]
    if (r.error || !r.text) return [...head, `(could not be loaded${r.error ? `: ${r.error}` : ''}. Use only what BRIEF says about this source, with no added detail.)`].join('\n')
    return [...head, ...(r.title ? [`title: ${r.title}`] : []), keepRelevant(r.text, r.uses, per)].join('\n')
  })
  if (failed.length) warnings.push(`source pages: ${failed.length} of ${results.length} could not be loaded (${failed.slice(0, 3).map((f) => f.url).join(', ')}${failed.length > 3 ? ', …' : ''}); the Writer keeps to the brief for those`)
  return { text: parts.join('\n\n'), loaded: results.length - failed.length, failed: failed.map((f) => f.url) }
}

/** Characters of M91 docs text kept for the Writer and the Reviewer (the parts about the post's topic). */
export const DOCS_TEXT_MAX = 12000

/** The words a post is about: its keyword, supporting keywords, outline headings and M91 facts. */
export const briefHints = (brief) => [brief?.keyword, ...(brief?.supporting_keywords ?? []), ...(brief?.outline ?? []).map((s) => s.heading), ...(brief?.m91_facts_to_use ?? []).map((f) => f.fact)].filter(Boolean)

/**
 * M91 DOCS TEXT: the docs pages a brief cites ("=== SOURCE: url ===" blocks, code already replaced by [[SNIPPET:Sn]]
 * tokens), each cut to its parts about the post. The Writer used to get M91's docs only as the short fact sheet and
 * guessed the API's details (how many callbacks, when it polls); the Reviewer knew them.
 */
export function docsTextFor(text, hints, max = DOCS_TEXT_MAX) {
  const pages = String(text ?? '').split(/^(?==== SOURCE: )/m).map((p) => p.trim()).filter((p) => p.startsWith('=== SOURCE: '))
  if (!pages.length) return ''
  const per = Math.floor(max / pages.length)
  return pages.map((p) => {
    const [head, ...rest] = p.split('\n')
    return `${head}\n${keepRelevant(rest.join('\n'), hints, per)}`
  }).join('\n\n')
}
