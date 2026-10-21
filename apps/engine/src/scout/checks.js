// Code checks run on every Scout answer (brief section 11): schema, source URLs, https,
// copy protection and date rules. The AI's output is never trusted as-is.

import Ajv from 'ajv'
import { SCHEMAS, scout_m91_facts_inline } from './schemas.js'
import { istDate } from '../util/time.js'

// ---------- 11.1 schema validation ----------

const ajv = new Ajv({ allErrors: true, strict: false })
const validators = new Map()
for (const s of [...Object.values(SCHEMAS), scout_m91_facts_inline]) {
  if (!validators.has(s.name)) validators.set(s.name, ajv.compile(s.schema))
}

/** Parses (rtlayer content is a string) and validates. Returns { valid, value, errors }. */
export function validateAgainst(schemaName, content) {
  const validate = validators.get(schemaName)
  if (!validate) throw new Error(`no schema named ${schemaName}`)
  let value = content
  if (typeof content === 'string') {
    try {
      value = JSON.parse(content)
    } catch {
      return { valid: false, value: null, errors: ['answer is not valid JSON'] }
    }
  }
  const valid = validate(value)
  return { valid, value: valid ? value : null, errors: valid ? [] : validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`) }
}

// ---------- 11.2 / 11.3 URLs ----------

const SEARCH_PAGES = [
  /^https?:\/\/(www\.)?google\.[a-z.]+\/(search|url)\b/i,
  /^https?:\/\/(www\.)?bing\.com\/search\b/i,
  /^https?:\/\/(html\.)?duckduckgo\.com\/(\?|html)/i,
  /^https?:\/\/search\.yahoo\.com\//i,
  /^https?:\/\/(www\.)?reddit\.com\/search\b/i,
  /^https?:\/\/news\.ycombinator\.com\/?$/i,
  /^https?:\/\/hn\.algolia\.com\//i,
  /^https?:\/\/(www\.)?stackoverflow\.com\/search\b/i,
  /^https?:\/\/github\.com\/search\b/i
]

export const isSearchResultsUrl = (url) => SEARCH_PAGES.some((re) => re.test(url))

/** Trims, and forces https:// for the M91 docs hosts. Returns null for anything not http(s). */
export function normaliseUrl(url, docsHosts = []) {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  try {
    const u = new URL(trimmed)
    if (u.protocol === 'http:' && docsHosts.includes(u.hostname.toLowerCase())) u.protocol = 'https:'
    return u.toString()
  } catch {
    return null
  }
}

/** Status a URL check gives: ok and blocked are kept, dead and invalid are dropped. */
export function classifyStatus(status) {
  if (status >= 200 && status < 400) return 'ok'
  if (status === 404 || status === 410) return 'dead'
  // 401/403/429 are common bot blocks (Reddit, news sites). Other 4xx/5xx prove nothing either: keep, marked blocked.
  return 'blocked'
}

const keep = (s) => s === 'ok' || s === 'blocked'
export { keep as isKeptStatus }

/** Runs at most max of the given async functions at a time (the URL checker; the Scout's parallel calls). */
export function limiter(max) {
  let active = 0
  const queue = []
  const next = () => {
    if (active >= max || !queue.length) return
    active++
    const { fn, resolve, reject } = queue.shift()
    fn().then(resolve, reject).finally(() => { active--; next() })
  }
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next() })
}

/**
 * URL checker with a per-run cache: each unique URL is requested once, at most 8 at a time.
 * HEAD first, GET when HEAD does not answer 2xx/3xx. 404/410, DNS failure and timeouts are "dead".
 */
export function createUrlChecker({ fetch = globalThis.fetch, timeoutMs = 10000, concurrency = 8 } = {}) {
  const cache = new Map()
  const limit = limiter(concurrency)
  const stats = { requests: 0 }

  async function request(url, method) {
    stats.requests++
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; M91BlogEngine/1.0; source link check)', accept: '*/*' }
      })
      res.body?.cancel?.().catch?.(() => {})
      return classifyStatus(res.status)
    } catch {
      return 'dead' // DNS failure, refused connection, timeout
    }
  }

  async function check(rawUrl) {
    if (typeof rawUrl !== 'string' || !/^https?:\/\//i.test(rawUrl.trim()) || isSearchResultsUrl(rawUrl)) return 'invalid'
    const url = rawUrl.trim()
    if (!cache.has(url)) {
      cache.set(url, limit(async () => {
        const head = await request(url, 'HEAD')
        return head === 'ok' ? head : request(url, 'GET')
      }))
    }
    return cache.get(url)
  }

  return { check, cache, stats }
}

// ---------- 11.4 copy protection ----------

const QUOTE_RE = /"([^"]+)"|“([^”]+)”|‘([^’]+)’/g
const words = (s) => s.trim().split(/\s+/).filter(Boolean)

/** Removes any quotation longer than 15 words. Returns { text, removed }. */
export function removeLongQuotes(text) {
  if (typeof text !== 'string') return { text, removed: 0 }
  let removed = 0
  const out = text.replace(QUOTE_RE, (match, a, b, c) => {
    if (words(a ?? b ?? c).length > 15) {
      removed++
      return ''
    }
    return match
  })
  return { text: removed ? out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim() : text, removed }
}

/** More than 2 sentences or 60 words → first 2 sentences (then at most 60 words). */
export function trimSummary(text) {
  if (typeof text !== 'string') return text
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [text]
  if (sentences.length <= 2 && words(text).length <= 60) return text.trim()
  let out = sentences.slice(0, 2).join(' ')
  const w = words(out)
  if (w.length > 60) out = w.slice(0, 60).join(' ') + '…'
  return out
}

/** Applies both rules to the named fields of an item, in place. Returns quotes removed. */
export function protectFields(item, summaryFields = [], otherFields = []) {
  let removed = 0
  for (const f of [...summaryFields, ...otherFields]) {
    if (typeof item[f] !== 'string') continue
    const r = removeLongQuotes(item[f])
    removed += r.removed
    item[f] = summaryFields.includes(f) ? trimSummary(r.text) : r.text
  }
  return removed
}

// ---------- 11.5 dates ----------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Whole days from `dateStr` (YYYY-MM-DD) to `today` (YYYY-MM-DD); null if not a valid date. */
export function daysAgo(dateStr, today) {
  const m = typeof dateStr === 'string' && dateStr.match(DATE_RE)
  if (!m) return null
  const d = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const check = new Date(d)
  if (check.getUTCMonth() !== +m[2] - 1) return null
  const t = DATE_RE.exec(today)
  return Math.round((Date.UTC(+t[1], +t[2] - 1, +t[3]) - d) / 86400000)
}

/**
 * Story date rule. Unknown (or future) dates are kept but never rapid-response.
 * @returns {{ keep: boolean, rapid: boolean, age: number|null }}
 */
export function storyDateRule(publishedDate, { today = istDate(), lookbackDays, rapidDays }) {
  const age = daysAgo(publishedDate, today)
  if (age === null || age < 0) return { keep: true, rapid: false, age: null }
  if (age > lookbackDays) return { keep: false, rapid: false, age }
  return { keep: true, rapid: age <= rapidDays, age }
}

/** Cluster freshness from its questions' date_seen values: this_week if any is within 7 days. */
export function freshnessFromDates(dates, today = istDate()) {
  return dates.some((d) => {
    const age = daysAgo(d, today)
    return age !== null && age >= 0 && age <= 7
  }) ? 'this_week' : 'ongoing'
}
