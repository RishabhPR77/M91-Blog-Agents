// Automatic fix (code, 0 AI): a post built on a news story or story lead must link that outside source where it first
// names it. The Writer often names the outlet ("reported by The Hacker News") and forgets the link; the Reviewer's
// gate sources_support_claims then fails the post, a failure the Writer would only fix by luck. The outlet's name is
// linked to the brief's own source URL (always in ALLOWED URLS); no wording changes, so the attribution check still
// finds "reported by" and the outlet.
import { urlKey } from '../checks/content.js'

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The sources the post must link: { url, outlet } from the brief's story (when used) and news. */
export function newsSourcesOf(brief = {}) {
  const out = []
  const add = (url, outlet) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url) && typeof outlet === 'string' && outlet.trim() && !out.some((s) => urlKey(s.url) === urlKey(url))) out.push({ url, outlet: outlet.trim() })
  }
  if (brief.story?.use) {
    // The story's outlet is the one in its attribution line ("reported by <outlet>"), else the news outlet.
    const m = /reported by\s+(.+?)\s*[.,;:]?\s*$/i.exec(String(brief.story.attribution_line ?? ''))
    add(brief.story.source_url, m?.[1] ?? brief.news?.outlet)
  }
  if (brief.news?.is_news_based) add(brief.news.source_url, brief.news.outlet)
  return out
}

/** Does the Markdown (outside code) already link this URL? */
const linksTo = (lines, url) => lines.some((l) => !l.code && [...l.text.matchAll(/\]\((\S+?)\)/g)].some((m) => urlKey(m[1]) === urlKey(url)))

/**
 * Links each news source's outlet name at its first mention in prose (a heading, code, an existing link text and a
 * mention that already is a link are skipped; "reported by <outlet>" is preferred). Returns { markdown, fixes }.
 */
export function linkNewsSource(markdown, brief) {
  const sources = newsSourcesOf(brief)
  if (!sources.length) return { markdown, fixes: [] }
  let fence = null
  const lines = String(markdown ?? '').split('\n').map((text) => {
    const f = text.match(/^\s*(`{3,}|~{3,})/)
    if (f) {
      fence = fence ? (f[1][0] === fence ? null : fence) : f[1][0]
      return { text, code: true }
    }
    return { text, code: Boolean(fence) || /^#{1,6}\s/.test(text) }
  })
  const fixes = []
  for (const { url, outlet } of sources) {
    if (linksTo(lines, url)) continue
    const name = escapeRe(outlet)
    // "reported by <outlet>" first, then any mention of the outlet.
    const patterns = [new RegExp(`(reported by\\s+)(${name})(?![\\w])`, 'i'), new RegExp(`(?<![\\w\\[])()(${name})(?![\\w\\]])`, 'i')]
    let done = false
    for (const re of patterns) {
      for (const line of lines) {
        if (line.code || done) continue
        // Inline code spans and the text of existing links stay as they are.
        const parts = line.text.split(/(`[^`]*`|\[[^\]]*\]\([^)]*\))/)
        for (let i = 0; i < parts.length && !done; i += 2) {
          const m = re.exec(parts[i])
          if (!m) continue
          parts[i] = `${parts[i].slice(0, m.index)}${m[1]}[${m[2]}](${url})${parts[i].slice(m.index + m[0].length)}`
          done = true
        }
        if (done) line.text = parts.join('')
      }
      if (done) break
    }
    if (done) fixes.push(`linked the news source (${outlet}) at its first mention`)
  }
  return { markdown: lines.map((l) => l.text).join('\n'), fixes }
}
