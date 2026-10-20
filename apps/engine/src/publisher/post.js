// The post JSON (format v1) for one approved draft (Phase 7 C3). Pure functions: the draft, its brief and
// the published_post records in; the post and any warnings out. Validated with @m91/content.

import { validatePost } from '@m91/content'
import { parseMarkdown, urlKey } from '../checks/content.js'
import { words } from '../checks/readability.js'

export class PostBuildError extends Error {
  constructor(message, errors = []) {
    super(message)
    this.name = 'PostBuildError'
    this.errors = errors
  }
}

const SLUG_MAX = 60

/** lowercase words joined by hyphens, at most 60 characters (no trailing hyphen). */
export function slugify(text, max = SLUG_MAX) {
  const s = String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s.slice(0, max).replace(/-+$/, '')
}

/** The live published_post records (published or being published). */
const live = (records) => records.filter((r) => r.status === 'published' || r.status === 'publishing')
const slugOf = (r) => r.payload?.slug ?? r.payload?.post?.slug ?? r.metadata?.slug ?? null

/**
 * The slug: a republish of the same brief keeps its slug; otherwise brief.slug, else seo.slug_suggestion,
 * slugified; when another live post already uses it, -2, -3, … (still at most 60 characters).
 */
export function chooseSlug({ briefId, brief, draft, published = [] }) {
  const own = published.find((r) => (r.payload?.brief_id ?? r.briefId) === briefId && slugOf(r))
  if (own) return slugOf(own)
  const base = slugify(brief?.slug) || slugify(draft?.seo?.slug_suggestion) || slugify(draft?.title) || 'post'
  const taken = new Set(live(published).filter((r) => (r.payload?.brief_id ?? r.briefId) !== briefId).map(slugOf))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * The Markdown without its H1 line and its TL;DR block (the page renders both separately). Each part is
 * removed only when found exactly; a part that isn't found stays, with a warning.
 */
export function stripTitleAndTldr(markdown) {
  const warnings = []
  let lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n')
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l))
  if (h1 >= 0 && lines.slice(0, h1).every((l) => !l.trim())) lines = lines.slice(h1 + 1)
  else warnings.push('the H1 line was not found at the top of the post: kept as is')
  const t = lines.findIndex((l) => /^\s*\*\*TL;DR\*\*\s*:?\s*$/i.test(l) || /^\s*TL;DR:?\s*$/i.test(l))
  if (t >= 0) {
    let end = t + 1
    while (end < lines.length && !lines[end].trim()) end++
    let bullets = 0
    while (end < lines.length && /^\s*[-*+]\s+\S/.test(lines[end])) { end++; bullets++ }
    if (bullets > 0) lines = [...lines.slice(0, t), ...lines.slice(end)]
    else warnings.push('the TL;DR heading has no bullet list after it: kept as is')
  } else warnings.push('the TL;DR block was not found: kept as is')
  const md = lines.join('\n').replace(/^\s*\n/, '').replace(/\n{3,}/g, '\n\n').trim()
  return { markdown: md, warnings }
}

/** Prose words ÷ 200, rounded up, at least 1. */
export const readingTime = (markdown) => Math.max(1, Math.ceil(words(parseMarkdown(markdown).prose).length / 200))

/**
 * keyword + supporting keywords: lowercase, punctuation removed, unique, at most 6. Only short phrases
 * (at most 4 words and 40 characters) become tags: older briefs used whole questions as keywords.
 */
export function tagsOf(brief) {
  const all = [brief?.keyword, ...(brief?.supporting_keywords ?? [])]
    .map((t) => String(t ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t && t.length <= 40 && t.split(' ').length <= 4)
  return [...new Set(all)].slice(0, 6)
}

const isBlogUrl = (u, baseUrl) => {
  try {
    return new URL(u, baseUrl).host === new URL(baseUrl).host
  } catch {
    return false
  }
}

/** Every outside link in the post (not the blog, not the CTA), its link text as the title, deduplicated. */
export function sourcesOf(markdown, { baseUrl, ctaUrl }) {
  const seen = new Map()
  for (const l of parseMarkdown(markdown).links) {
    if (!/^https?:\/\//.test(l.url) || isBlogUrl(l.url, baseUrl) || (ctaUrl && urlKey(l.url) === urlKey(ctaUrl))) continue
    const k = urlKey(l.url)
    if (!seen.has(k)) seen.set(k, { url: l.url, title: l.text.trim() || new URL(l.url).host })
  }
  return [...seen.values()]
}

/** Slugs of live posts the post links to, then the newest live posts in the same topic; max 3, never itself. */
export function relatedSlugs(markdown, { slug, topicGroup, baseUrl, published = [] }) {
  const liveSlugs = new Set(live(published).map(slugOf))
  const linked = []
  for (const l of parseMarkdown(markdown).links) {
    if (!isBlogUrl(l.url, baseUrl) && !l.url.startsWith('/')) continue
    const m = new URL(l.url, baseUrl).pathname.match(/\/posts\/([a-z0-9-]+)\/?$/)
    if (m && m[1] !== slug && liveSlugs.has(m[1]) && !linked.includes(m[1])) linked.push(m[1])
  }
  const sameTopic = live(published)
    .filter((r) => (r.payload?.topic_group ?? r.payload?.post?.topic_group) === topicGroup && slugOf(r) !== slug && !linked.includes(slugOf(r)))
    .sort((a, b) => String(b.payload?.post?.published_at ?? '').localeCompare(String(a.payload?.post?.published_at ?? '')))
    .map(slugOf)
  return [...linked, ...sameTopic].slice(0, 3)
}

/**
 * noindex: a republish (or a set_index choice) keeps the post's current value; a first publish is noindex
 * while fewer than NOINDEX_FIRST_N_POSTS posts have ever been published (unpublished test posts don't count).
 */
export function noindexFor({ existing, published = [], firstN }) {
  if (typeof existing?.payload?.noindex_override === 'boolean') return existing.payload.noindex_override
  if (existing?.payload?.first_published_at && typeof existing.payload.noindex === 'boolean') return existing.payload.noindex
  const ever = published.filter((r) => r.id !== existing?.id && r.payload?.first_published_at && !(r.status === 'unpublished' && (r.metadata?.test === true || r.payload?.test === true)))
  return ever.length < firstN
}

/** The M91 site's old address. Drafts written before the site moved still link to it. */
export const OLD_M91_SITE = 'https://m91-site.embarko.app'
// The old site's home page only (with or without the trailing slash), not a longer path on it.
const OLD_SITE_RE = /https:\/\/m91-site\.embarko\.app\/?(?![\w/#?%~+=&-]|\.\w)/gi

/** Every link to the old M91 site's home page → ctaUrl (M91_CTA_URL). No ctaUrl: unchanged. */
export function rewriteOldSiteLinks(text, ctaUrl) {
  if (!ctaUrl || typeof text !== 'string') return { text, count: 0 }
  let count = 0
  const out = text.replace(OLD_SITE_RE, () => {
    count++
    return ctaUrl
  })
  return { text: out, count }
}
/** The same rewrite in every string of the blocks' data (they are slices of the same body). */
const rewriteDeep = (v, ctaUrl) =>
  typeof v === 'string' ? rewriteOldSiteLinks(v, ctaUrl).text
    : Array.isArray(v) ? v.map((x) => rewriteDeep(x, ctaUrl))
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewriteDeep(x, ctaUrl)])) : v

/**
 * The post JSON (format v1).
 * @param {{ draft: object, briefId, brief, published: object[], config, now: () => number, istIso: (Date) => string, blocks?: object[]|null }} input
 *   draft: the draft record ({ version, payload }); published: every published_post record; blocks: from
 *   chooseBlocks (publisher/blocks.js), already checked against this body (null: plain Markdown).
 * @returns {{ post, slug, existing, warnings[] }}  Throws PostBuildError when the post is not valid.
 */
export function buildPost({ draft, briefId, brief, published = [], config, now = Date.now, istIso, blocks = null }) {
  const d = draft.payload ?? draft
  const warnings = []
  const baseUrl = config.blog.baseUrl
  const slug = chooseSlug({ briefId, brief, draft: d, published })
  const existing = published.find((r) => slugOf(r) === slug) ?? null
  const { markdown: stripped, warnings: stripWarnings } = stripTitleAndTldr(d.post_markdown)
  warnings.push(...stripWarnings)
  // Links to the old M91 site become M91_CTA_URL, in the body and the blocks alike (so the sources skip them too).
  const ctaUrl = config.m91?.ctaUrl
  const { text: markdown, count: oldLinks } = rewriteOldSiteLinks(stripped, ctaUrl)
  if (oldLinks) {
    blocks = blocks && rewriteDeep(blocks, ctaUrl)
    warnings.push(`replaced ${oldLinks} link${oldLinks === 1 ? '' : 's'} to the old M91 site (${OLD_M91_SITE}) with M91_CTA_URL (${ctaUrl})`)
  }
  const at = istIso(new Date(now()))
  const topicGroup = Number(brief?.topic_group ?? d.topic_group ?? 1)
  const post = {
    slug,
    title: d.title,
    description: d.seo?.meta_description ?? '',
    tldr: d.tldr,
    published_at: existing?.payload?.post?.published_at ?? at,
    updated_at: at,
    topic_group: topicGroup,
    tags: tagsOf(brief),
    reading_time_min: readingTime(markdown),
    markdown,
    blocks,
    seo: { title_tag: d.seo?.title_tag ?? d.title, meta_description: d.seo?.meta_description ?? '', og_image: `${baseUrl}/og/${slug}.png` },
    sources: sourcesOf(markdown, { baseUrl, ctaUrl }),
    related_slugs: relatedSlugs(markdown, { slug, topicGroup, baseUrl, published }),
    noindex: noindexFor({ existing, published, firstN: config.blog.noindexFirstNPosts }),
    canonical_url: `${baseUrl}/posts/${slug}/`,
    brief_id: briefId,
    version: Number(draft.version ?? d.version)
  }
  const { valid, errors } = validatePost(post)
  if (!valid) throw new PostBuildError(`the post JSON is not valid (format v1): ${errors.slice(0, 5).join('; ')}`, errors)
  return { post, slug, existing, warnings }
}
