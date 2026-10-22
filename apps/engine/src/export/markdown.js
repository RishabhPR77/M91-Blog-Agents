// The final Markdown export (Phase 11): a reviewed draft as one clean, Docstar-ready Markdown file. Pure code,
// 0 AI calls. Plain CommonMark with GFM tables and fenced code only (no HTML), metadata as YAML front matter:
//
//   ---                 (front matter: title, slug, description, keyword, tags, topic, brief_id, version,
//   …                    review score, date; for our records and Docstar's file import)
//   ---
//   # Title
//   Description
//   ## TL;DR            (the three takeaways)
//   …the body…          (the post without its H1 and TL;DR; old M91 site links → M91_CTA_URL; M91 docs links →
//                        https://m91.msg91.com/; raw HTML removed)
//   ## Sources          (every outside link, unless the body already has a Sources section; never a docs link)
//   ## Try M91          (the call to action, unless the body already links to M91_CTA_URL)
//
// Docstar's editor turns pasted or imported Markdown into blocks; its documented syntax covers headings, lists,
// quotes, fenced code with a language, tables, links and images. It documents no front matter, so the Docstar
// adapter sends `body` (the file without its front matter) and the title and slug as separate fields.

import { stripTitleAndTldr, chooseSlug, sourcesOf, tagsOf, rewriteOldSiteLinks } from '../publisher/post.js'
import { urlKey } from '../checks/content.js'
import { istDate } from '../util/time.js'
import { stripDocsLinks, docsLinksIn, M91_SITE_URL } from '../util/m91links.js'

export const TOPIC_NAMES = Object.freeze({ 1: 'AI agents', 2: 'Fintech', 3: 'On-call', 4: 'Best practices', 5: 'Comparisons' })
export const CTA_HEADING = 'Try M91'
const CTA_LINE = 'M91 rings a person’s phone when your software needs a decision, and sends the answer back.'

/** A YAML scalar: numbers and booleans as they are, every string double-quoted (a JSON string is valid YAML). */
const yamlValue = (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v === null || v === undefined ? 'null' : JSON.stringify(String(v)))

/** YAML front matter from a flat object (arrays become flow lists). Keys keep their order. */
export function frontMatter(meta) {
  const lines = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map(yamlValue).join(', ')}]` : yamlValue(v)}`)
  return `---\n${lines.join('\n')}\n---\n`
}

/**
 * Raw HTML tags outside code (fenced blocks and inline code) are removed: the export is Markdown only.
 * Returns { text, removed }.
 */
export function stripHtml(markdown) {
  let removed = 0
  let fence = null
  const out = String(markdown).split('\n').map((line) => {
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      return line
    }
    if (fence) return line
    // Inline code spans are kept as they are; tags elsewhere on the line are removed.
    return line.split(/(`[^`]*`)/).map((piece, i) => (i % 2 ? piece : piece.replace(/<\/?[A-Za-z][^<>]*>|<!--[\s\S]*?-->/g, () => { removed++; return '' }))).join('')
  })
  return { text: out.join('\n'), removed }
}

const hasHeading = (md, re) => md.split('\n').some((l) => /^#{1,3}\s/.test(l) && re.test(l.replace(/^#+\s*/, '')))

/**
 * @param {{ draft: object, brief?: object, review?: object|null, briefId: string, published?: object[], config, now?: () => number }} input
 *   draft: the draft record ({ version, metadata, payload }); review: its review payload (or null)
 * @returns {{ slug, filename, title, markdown, body, front_matter, warnings }}
 */
export function buildMarkdownExport({ draft, brief = {}, review = null, briefId, published = [], config, now = Date.now }) {
  const d = draft.payload ?? draft
  const warnings = []
  const version = Number(draft.version ?? d.version)
  const briefVersion = Number(draft.metadata?.brief_version ?? d.brief_version ?? 1)
  const slug = chooseSlug({ briefId, brief, draft: d, published })
  const title = String(d.title ?? brief.titles?.[0] ?? briefId).trim()
  const description = String(d.seo?.meta_description ?? '').trim()
  const ctaUrl = config.m91?.ctaUrl

  const stripped = stripTitleAndTldr(d.post_markdown ?? '')
  warnings.push(...stripped.warnings)
  const { text: linked, count: oldLinks } = rewriteOldSiteLinks(stripped.markdown, ctaUrl)
  if (oldLinks) warnings.push(`replaced ${oldLinks} link${oldLinks === 1 ? '' : 's'} to the old M91 site with M91_CTA_URL`)
  // No M91 docs links: each becomes M91's main site (link text kept); the Sources list drops docs links and duplicates.
  const docs = stripDocsLinks(linked, config)
  warnings.push(...docs.fixes)
  const { text: body, removed } = stripHtml(docs.markdown)
  if (removed) warnings.push(`removed ${removed} raw HTML tag${removed === 1 ? '' : 's'} (the export is Markdown only)`)

  const sections = [`# ${title}`]
  if (description) sections.push(description)
  const tldr = (d.tldr ?? []).map((t) => String(t).trim()).filter(Boolean)
  if (tldr.length) sections.push(`## TL;DR\n\n${tldr.map((t) => `- ${t}`).join('\n')}`)
  sections.push(body.trim())
  const sources = sourcesOf(body, { baseUrl: config.blog?.baseUrl ?? '', ctaUrl }).filter((s) => urlKey(s.url) !== urlKey(M91_SITE_URL))
  if (sources.length && !hasHeading(body, /^sources?\b/i)) sections.push(`## Sources\n\n${sources.map((s, i) => `${i + 1}. [${s.title.replace(/[[\]]/g, '')}](${s.url})`).join('\n')}`)
  const linksCta = ctaUrl && sourcesOf(body, { baseUrl: '', ctaUrl: null }).some((s) => urlKey(s.url) === urlKey(ctaUrl))
  if (ctaUrl && !linksCta) sections.push(`## ${CTA_HEADING}\n\n${CTA_LINE} [Get started with M91](${ctaUrl}).`)
  const content = `${sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`

  const at = new Date(now())
  const meta = {
    title,
    slug,
    description,
    keyword: brief.keyword ?? undefined,
    tags: tagsOf(brief),
    topic: TOPIC_NAMES[Number(brief.topic_group ?? d.topic_group)] ?? undefined,
    topic_group: Number(brief.topic_group ?? d.topic_group ?? 0) || undefined,
    brief_id: briefId,
    version,
    brief_version: briefVersion,
    review_score: typeof review?.total === 'number' ? review.total : null,
    review_passed: typeof review?.pass === 'boolean' ? review.pass : null,
    date: istDate(at)
  }
  return { slug, filename: `${slug}.md`, title, markdown: `${frontMatter(meta)}\n${content}`, body: content, front_matter: meta, warnings, docs_links: docsLinksIn(content, config) }
}
