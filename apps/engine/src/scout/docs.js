// Inputs gathered by code (brief 5.1, 5.2): the M91 docs bundle and the skill repo README.

export class DocsError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DocsError'
  }
}

/** Every http(s) link in llms.txt: Markdown links first-seen order, then bare URLs. */
export function extractLinks(text) {
  const found = []
  const re = /\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()"'`\]]+)/g
  for (const m of String(text).matchAll(re)) {
    const url = (m[1] ?? m[2]).replace(/[.,;:]+$/, '')
    if (!found.includes(url)) found.push(url)
  }
  return found
}

/** Keeps links on the allowed hosts, forced to https, without #fragments; de-duplicated. */
export function filterDocLinks(links, hosts) {
  const out = []
  for (const link of links) {
    let u
    try {
      u = new URL(link)
    } catch {
      continue
    }
    if (!hosts.includes(u.hostname.toLowerCase())) continue
    u.protocol = 'https:'
    u.hash = ''
    const s = u.toString()
    if (!out.includes(s)) out.push(s)
  }
  return out
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** Plain text from HTML: drops script/style/nav, keeps block breaks, decodes common entities. */
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|pre|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (ENTITIES[e]) return ENTITIES[e]
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      return m
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fetchText(fetch, url, timeoutMs) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'text/markdown, text/plain, text/html;q=0.9, */*;q=0.5' } })
  if (!res.ok) throw new DocsError(`HTTP ${res.status} for ${url}`)
  const type = res.headers?.get?.('content-type') ?? ''
  const body = await res.text()
  return /html/i.test(type) || /^\s*<(!doctype|html)/i.test(body) ? htmlToText(body) : body.trim()
}

export const sourceHeader = (url) => `=== SOURCE: ${url} ===`

/**
 * Fetches llms.txt and the doc pages it links (allowed hosts only, in order) until the page or
 * character cap. llms.txt itself is the first page of the bundle. Fails if llms.txt cannot be fetched.
 * @returns {{ bundle, sources: string[], pagesFetched, chars, warnings: string[] }}
 */
export async function buildDocsBundle({ docsUrl, hosts, maxPages, maxChars, fetch = globalThis.fetch, timeoutMs = 15000 }) {
  const warnings = []
  const llmsUrl = filterDocLinks([docsUrl], hosts)[0] ?? docsUrl
  let llms
  try {
    llms = await fetchText(fetch, llmsUrl, timeoutMs)
  } catch (error) {
    throw new DocsError(`M91 llms.txt could not be fetched (${error.message})`)
  }
  const parts = []
  const sources = []
  let chars = 0
  const add = (url, text) => {
    const room = maxChars - chars
    if (room <= 0) return false
    const body = text.length > room ? text.slice(0, room) : text
    if (body.length < text.length) warnings.push(`docs bundle hit DOCS_MAX_CHARS; ${url} was cut`)
    parts.push(`${sourceHeader(url)}\n${body}`)
    sources.push(url)
    chars += body.length
    return body.length === text.length
  }
  add(llmsUrl, llms)

  const links = filterDocLinks(extractLinks(llms), hosts).filter((u) => u !== llmsUrl)
  for (const url of links) {
    if (sources.length >= maxPages || chars >= maxChars) break
    try {
      if (!add(url, await fetchText(fetch, url, timeoutMs))) break
    } catch (error) {
      warnings.push(`doc page skipped: ${url} (${error.message})`)
    }
  }
  return { bundle: parts.join('\n\n'), sources, pagesFetched: sources.length, chars, warnings }
}

/** github.com/<owner>/<repo> → { owner, repo }. */
export function parseRepo(repoUrl) {
  const m = String(repoUrl).match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)/i)
  if (!m) return null
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') }
}

/** The skill repo README via the GitHub API (no token). Null plus a warning when it can't be fetched. */
export async function fetchSkillReadme({ repoUrl, fetch = globalThis.fetch, timeoutMs = 15000 }) {
  const parsed = parseRepo(repoUrl)
  if (!parsed) return { text: null, warning: 'M91_SKILL_REPO_URL is not a github.com/<owner>/<repo> URL; README skipped' }
  const canonical = `https://github.com/${parsed.owner}/${parsed.repo}`
  try {
    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`, {
      headers: { accept: 'application/vnd.github.raw', 'user-agent': 'M91BlogEngine/1.0' },
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return { text: null, warning: `skill repo README not fetched (HTTP ${res.status})` }
    return { text: `${sourceHeader(canonical)}\n${(await res.text()).trim()}`, url: canonical, warning: null }
  } catch (error) {
    return { text: null, warning: `skill repo README not fetched (${error.message})` }
  }
}
