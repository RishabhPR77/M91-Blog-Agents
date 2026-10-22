// No M91 docs links in posts (Phase 12): a post's links and its Sources list may contain only real outside
// sources and M91's main site. The agents still READ the docs for facts; only the reader-facing links change.
//
// A docs link is: any URL on m91-api.msg91.com (or another M91_DOCS_HOSTS host that is not the main site), any
// path on m91.msg91.com other than the home page (llms.txt, /api/public/*.md, docs.html, quickstart, …), and the
// M91 skill repository on GitHub (M91_SKILL_REPO_URL). M91_CTA_URL is kept unless it is itself a docs page.
import { parseRepo } from '../scout/docs.js'

// The same key as checks/content.js urlKey (not imported: content.js imports this module).
const urlKey = (u) => String(u ?? '').trim().replace(/\/+$/, '').toLowerCase()

export const M91_SITE_URL = 'https://m91.msg91.com/'
const SITE_HOST = 'm91.msg91.com'
// Pages that are docs wherever they are (the CTA is never let through when it matches one).
const DOCS_PAGE_RE = /(^|\/)(llms\.txt|docs\.html|quickstart[^/]*)$|^\/api\/public\//i

/** The rule for a config: { isDocs(url), siteUrl }. */
export function docsLinkRule(config = {}) {
  const hosts = (config.scout?.docsHosts ?? []).map((h) => String(h).toLowerCase())
  const repo = parseRepo(config.m91?.skillRepoUrl ?? '')
  const ctaKey = config.m91?.ctaUrl ? urlKey(config.m91.ctaUrl) : null
  const isDocs = (url) => {
    let u
    try {
      u = new URL(String(url))
    } catch {
      return false
    }
    if (!/^https?:$/.test(u.protocol)) return false
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    if (repo && host === 'github.com' && path.toLowerCase().startsWith(`/${repo.owner}/${repo.repo}`.toLowerCase())) {
      const rest = path.slice(`/${repo.owner}/${repo.repo}`.length)
      if (rest === '' || rest.startsWith('/')) return true
    }
    if (host === SITE_HOST) {
      if (path === '' && !u.search) return false
      if (ctaKey && urlKey(url) === ctaKey && !DOCS_PAGE_RE.test(u.pathname)) return false
      return true
    }
    return hosts.includes(host)
  }
  return { isDocs, siteUrl: M91_SITE_URL }
}

/** Splits Markdown into prose and code: [{ text, code }], fenced blocks and inline code spans kept whole. */
function pieces(markdown) {
  const out = []
  let fence = null
  for (const line of String(markdown ?? '').split('\n')) {
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (f || fence) {
      if (f) fence = fence ? (f[1][0] === fence ? null : fence) : f[1][0]
      out.push({ text: line, code: true, line: true })
      continue
    }
    out.push({ text: line, code: false, line: true })
  }
  return out
}

const LINK_RE = /(!?)\[([^\]]*)\]\((\S+?)\)/g
const BARE_RE = /<?(https?:\/\/[^\s()<>[\]"'`]+)>?/g

/**
 * The automatic fix (0 AI): every docs link outside code becomes [same text](https://m91.msg91.com/), a bare
 * docs URL becomes the main site, a leftover snippet line "Source: [..](docs)" is removed, and the Sources list
 * drops docs links and duplicates. Code (fenced blocks, inline spans) is never changed.
 * @returns {{ markdown, fixes: string[] }}
 */
export function stripDocsLinks(markdown, config) {
  const { isDocs, siteUrl } = docsLinkRule(config)
  let rewritten = 0
  let sourceLines = 0
  let dropped = 0
  let inSources = false
  const seen = new Set()
  const out = []
  for (const p of pieces(markdown)) {
    if (p.code) {
      out.push(p.text)
      continue
    }
    const line = p.text
    if (/^#{1,6}\s/.test(line)) inSources = /^#{1,6}\s+sources?\b/i.test(line)
    const only = line.match(/^\s*Source:\s*\[[^\]]*\]\((\S+?)\)\s*$/)
    if (only && isDocs(only[1])) {
      sourceLines++
      continue
    }
    if (inSources) {
      const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+.*?\]\((\S+?)\)/)
      if (item) {
        if (isDocs(item[1]) || seen.has(urlKey(item[1]))) {
          dropped++
          continue
        }
        seen.add(urlKey(item[1]))
      }
    }
    const fixed = line.split(/(`[^`]*`)/).map((part, i) => {
      if (i % 2) return part
      const links = []
      let s = part.replace(LINK_RE, (all, bang, text, url) => {
        if (bang || !isDocs(url)) return all
        rewritten++
        return `[${text}](${siteUrl})`
      })
      // Bare URLs outside Markdown links (a link's own URL was handled above and is now the main site).
      s = s.replace(/\[[^\]]*\]\(\S+?\)/g, (m) => `\u0000${links.push(m) - 1}\u0000`)
      s = s.replace(BARE_RE, (all, url) => {
        const clean = url.replace(/[.,;:!?]+$/, '')
        if (!isDocs(clean)) return all
        rewritten++
        return all.replace(url, siteUrl + url.slice(clean.length)).replace(/^<|>$/g, '')
      })
      return s.replace(/\u0000(\d+)\u0000/g, (m, i) => links[Number(i)])
    }).join('')
    out.push(fixed)
  }
  const fixes = []
  if (rewritten) fixes.push(`docs links: rewrote ${rewritten} M91 docs link${rewritten === 1 ? '' : 's'} to ${siteUrl}`)
  if (sourceLines) fixes.push(`docs links: removed ${sourceLines} docs "Source:" line${sourceLines === 1 ? '' : 's'} under code`)
  if (dropped) fixes.push(`docs links: dropped ${dropped} docs or duplicate Sources item${dropped === 1 ? '' : 's'}`)
  return { markdown: out.join('\n'), fixes }
}

/** True for a fix note written by stripDocsLinks (they also go into the run's warnings). */
export const isDocsFix = (note) => String(note).startsWith('docs links: ')

/** Every docs link left outside code (Markdown links and bare URLs), unique, for the hard check. */
export function docsLinksIn(markdown, config) {
  const { isDocs } = docsLinkRule(config)
  const found = []
  for (const p of pieces(markdown)) {
    if (p.code) continue
    for (const part of p.text.split(/(`[^`]*`)/).filter((_, i) => i % 2 === 0)) {
      for (const m of part.matchAll(LINK_RE)) if (!m[1] && isDocs(m[3]) && !found.includes(m[3])) found.push(m[3])
      for (const m of part.replace(LINK_RE, ' ').matchAll(BARE_RE)) {
        const u = m[1].replace(/[.,;:!?]+$/, '')
        if (isDocs(u) && !found.includes(u)) found.push(u)
      }
    }
  }
  return found
}
