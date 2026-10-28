// Published guides (msg91.com/guide): the M91 posts that are already live, whoever wrote them. Code only, no AI.
//
// The guide site lists every MSG91 post; only M91 posts matter here (the other products' posts are ignored). Each M91
// guide becomes one `published_guide` record in Mem0 (title, URL, date, headings, summary, keywords), so the agents
// know what readers can already read:
//   - the Roadmap Planner marks the slots those guides already cover, and the picker never writes them again;
//   - the knowledge map lists them (a new post points to them instead of re-explaining);
//   - the Strategist may link them (internal links), and lists them as already covered.
//
// Sources: the RSS feed (the 20 newest posts, with titles and descriptions) and the listing page (more links). A page is
// fetched only for a post not seen before (its headings, keywords and words), at most GUIDES_MAX_PAGES per sync. Posts
// found not to be about M91 are remembered in a small local file, so they are never fetched again.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../util/runlock.js'
import { istIso } from '../util/time.js'

export const GUIDE_TYPE = 'published_guide'
export const SEEN_FILE = 'guides-seen.json'
const UA = 'Mozilla/5.0 (compatible; M91BlogEngine/1.0; guide sync)'
// "M91" on its own, never inside "MSG91".
const M91_RE = /(?<![A-Za-z0-9])M91(?![A-Za-z0-9])/g

const decode = (s) => String(s ?? '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
// CDATA markers go first: "<![CDATA[ … ]]>" would otherwise look like one tag and be removed with its text.
const plain = (s) => decode(String(s ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
export const m91Mentions = (text) => (String(text ?? '').match(M91_RE) ?? []).length

/** https://msg91.com/guide/<slug> (no language part, no query, no trailing slash), or null for anything else. */
export function canonicalGuideUrl(url, base = 'https://msg91.com') {
  try {
    const u = new URL(url, base)
    if (!/(^|\.)msg91\.com$/i.test(u.hostname)) return null
    const m = u.pathname.match(/^\/(?:[a-z]{2}\/)?guide\/([^/?#]+)\/?$/i)
    if (!m || m[1] === 'feed.xml') return null
    return `https://msg91.com/guide/${m[1]}`
  } catch {
    return null
  }
}
export const slugOfGuide = (url) => String(url).split('/guide/')[1] ?? ''

/** Feed items: { url, title, description, published_at, categories }. */
export function parseFeed(xml) {
  return [...String(xml ?? '').matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const tag = (t) => it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? ''
    const date = Date.parse(plain(tag('pubDate')))
    return {
      url: canonicalGuideUrl(plain(tag('link'))),
      title: plain(tag('title')),
      description: plain(tag('description')),
      published_at: Number.isFinite(date) ? new Date(date).toISOString() : null,
      categories: [...it.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)].map((m) => plain(m[1])).filter(Boolean)
    }
  }).filter((i) => i.url)
}

/** Every guide link on the listing page, canonical and unique. */
export function parseListing(html) {
  return [...new Set([...String(html ?? '').matchAll(/href="([^"]+)"/g)].map((m) => canonicalGuideUrl(decode(m[1]))).filter(Boolean))]
}

/**
 * One guide page: { title, description, keywords, published_at, headings, summary, words, m91 }. The page renders its
 * article from data embedded in scripts, so the text is read from there; the "Keep reading" list of other posts at
 * the end is left out.
 */
export function parseGuidePage(html) {
  const raw = String(html ?? '')
  const meta = (name) => decode(raw.match(new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)"`))?.[1] ?? '')
  // The article lives in escaped HTML inside the page's scripts.
  let s = raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>').replace(/\\u0026/gi, '&').replace(/ /g, ' ')
  const ld = s.match(/\{"@context":"https:\/\/schema\.org","@type":"BlogPosting"[^]*?"headline":"([^"]*)"\}/)
  const ldAt = s.indexOf('"@type":"BlogPosting"')
  const ldText = ldAt >= 0 ? s.slice(ldAt, ldAt + 4000) : ''
  const ldDesc = ldText.match(/"description":"([^"]*)"/)?.[1]
  const ldDate = ldText.match(/"datePublished":"([^"]+)"/)?.[1] ?? ldText.match(/"dateModified":"([^"]+)"/)?.[1]
  const cut = s.search(/Keep reading/)
  if (cut > 0) s = s.slice(0, cut)
  const start = s.search(/"@type":"BlogPosting"/)
  if (start > 0) s = s.slice(start)
  const blocks = [...s.matchAll(/<(h[1-4]|p|li|td|th)[^>]*>([\s\S]*?)<\/\1>/g)].map(([, tag, inner]) => ({ tag, text: plain(inner) })).filter((b) => b.text.length > 1)
  const seen = new Set()
  const unique = blocks.filter((b) => (seen.has(`${b.tag}|${b.text}`) ? false : seen.add(`${b.tag}|${b.text}`)))
  const headings = unique.filter((b) => /^h[234]$/.test(b.tag)).map((b) => b.text.slice(0, 140)).slice(0, 25)
  // The page's own header ("All articles · EN · <date> · <title> · N min read") is not prose.
  const prose = unique.filter((b) => !/^h/.test(b.tag)).map((b) => b.text.replace(/^All articles.*?\d+\s*min read\s*/i, '').trim()).filter(Boolean)
  const text = prose.join(' ')
  const title = decode(ld?.[1] ?? '') || meta('og:title') || plain(raw.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '')
  const description = decode(ldDesc ?? '') || meta('description') || meta('og:description')
  const date = Date.parse(ldDate ?? '')
  return {
    title,
    description,
    keywords: meta('keywords').split(',').map((k) => k.trim()).filter(Boolean).slice(0, 20),
    published_at: Number.isFinite(date) ? new Date(date).toISOString() : null,
    headings,
    summary: (description || prose.find((p) => p.split(/\s+/).length >= 8) || '').slice(0, 300),
    words: text.split(/\s+/).filter(Boolean).length,
    m91: m91Mentions(`${title} ${description} ${text}`)
  }
}

/** The guide records (index or Mem0), newest first, as plain objects. */
export async function listGuides(store) {
  const recs = await store.getRecords({ type: GUIDE_TYPE })
  return recs
    .filter((r) => r.status !== 'removed' && r.payload?.url)
    .map((r) => ({ record_id: r.id, ...r.payload }))
    .sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')))
}

function readSeen(config) {
  try {
    return JSON.parse(readFileSync(join(dataDir(config), SEEN_FILE), 'utf8'))
  } catch {
    return {}
  }
}
function writeSeen(config, seen) {
  try {
    mkdirSync(dataDir(config), { recursive: true })
    writeFileSync(join(dataDir(config), SEEN_FILE), JSON.stringify(seen, null, 2))
  } catch {}
}

async function getText(fetchImpl, url, timeoutMs) {
  const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

/**
 * Reads the guide site and saves each new M91 guide (one Mem0 add each). Existing guide records are left as they are.
 * @returns {{ known, added: [{ url, title }], checked, not_m91, pending, warnings }}
 *   pending: links not checked yet (over GUIDES_MAX_PAGES); the next sync checks them.
 */
export async function syncGuides({ store, config, fetchImpl = globalThis.fetch, now = Date.now }) {
  const gc = config.guides
  const warnings = []
  const existing = await listGuides(store)
  const known = new Set(existing.map((g) => g.url))
  const seen = readSeen(config)
  const feedItems = []
  const links = []
  try {
    feedItems.push(...parseFeed(await getText(fetchImpl, gc.feedUrl, gc.timeoutMs)))
  } catch (error) {
    warnings.push(`the guide feed could not be read (${error.message})`)
  }
  try {
    links.push(...parseListing(await getText(fetchImpl, gc.listUrl, gc.timeoutMs)))
  } catch (error) {
    warnings.push(`the guide list could not be read (${error.message})`)
  }
  if (!feedItems.length && !links.length) return { known: existing.length, added: [], checked: 0, not_m91: 0, pending: 0, warnings }

  const byUrl = new Map(feedItems.map((i) => [i.url, i]))
  const candidates = [...new Set([...feedItems.map((i) => i.url), ...links])].filter((u) => !known.has(u) && seen[u]?.m91 !== false)
  const added = []
  let checked = 0
  let notM91 = 0
  let pending = 0
  for (const url of candidates) {
    const item = byUrl.get(url)
    // The feed says what a post is about: an MSG91 post never names M91 on its own, so it is not fetched.
    if (item && !m91Mentions(`${item.title} ${item.description}`)) {
      seen[url] = { m91: false, at: istIso(new Date(now())) }
      notM91++
      continue
    }
    if (checked >= gc.maxPages) {
      pending++
      continue
    }
    checked++
    let page
    try {
      page = parseGuidePage(await getText(fetchImpl, url, gc.timeoutMs))
    } catch (error) {
      warnings.push(`${url}: ${error.message}`)
      continue
    }
    const titleSaysM91 = m91Mentions(item?.title ?? page.title) > 0
    if (!titleSaysM91 && page.m91 < 3) {
      seen[url] = { m91: false, at: istIso(new Date(now())) }
      notM91++
      continue
    }
    const payload = {
      url,
      slug: slugOfGuide(url),
      title: item?.title || page.title,
      description: item?.description || page.description,
      published_at: item?.published_at ?? page.published_at,
      headings: page.headings,
      summary: page.summary || item?.description || '',
      keywords: page.keywords,
      categories: item?.categories ?? [],
      words: page.words,
      source: 'msg91.com/guide',
      synced_at: istIso(new Date(now()))
    }
    await store.createRecord({ type: GUIDE_TYPE, payload, status: 'live' })
    added.push({ url, title: payload.title })
  }
  writeSeen(config, seen)
  return { known: existing.length + added.length, added, checked, not_m91: notM91, pending, warnings }
}

/** The guides as the Strategist's PUBLISHED POSTS (allowed internal links): { title, url, topic_group, summary }. */
export const guidesAsPublishedPosts = (guides) => guides.map((g) => ({ title: g.title, url: g.url, topic_group: null, summary: String(g.summary ?? g.description ?? '').slice(0, 200) }))

/** The guides as knowledge-map entries (what readers can already read). */
export const guidesAsKnowledge = (guides, coveredBy = new Map()) => guides.map((g) => ({
  brief_id: null, title: g.title, slot_id: coveredBy.get(g.url) ?? null, stage: null, stage_name: null,
  concepts: (g.keywords ?? []).slice(0, 6), terms_defined: [], summary: String(g.summary ?? g.description ?? '').slice(0, 200),
  link: g.url, export_slug: null, approved_at: g.published_at ?? null, source: 'published_guide'
}))

/** One line about a guide sync: how many guides are known, which are new, what is left for next time. */
export function guidesSummary(out) {
  const added = out.added ?? []
  return `published guides: ${out.known} known${added.length ? `, ${added.length} new (${added.map((g) => g.title).join('; ')})` : ', none new'}${out.pending ? `, ${out.pending} left to check next time` : ''}`
}
