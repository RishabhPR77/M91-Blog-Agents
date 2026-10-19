// Live checks after a deploy (Phase 7 C4 step 7): the post URL answers 200 and shows the post title;
// for an indexed post the home page lists it. After an unpublish, the post URL no longer shows the post.

import { sleep as defaultSleep } from '../util/retry.js'

export class VerifyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'VerifyError'
  }
}

const decode = (html) => String(html)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&#x27;/g, "'")

/** A fresh copy (no cached page): a throwaway query string; the static site ignores it. */
const bust = (url, n) => `${url}${url.includes('?') ? '&' : '?'}check=${Date.now()}-${n}`

async function until(check, { timeoutMs, intervalMs, sleepFn, what }) {
  const started = Date.now()
  let attempts = 0
  let last = ''
  for (;;) {
    attempts++
    try {
      const r = await check(attempts)
      if (r.ok) return { attempts, ms: Date.now() - started }
      last = r.why
    } catch (error) {
      last = error.message
    }
    if (Date.now() - started + intervalMs > timeoutMs) throw new VerifyError(`${what} not confirmed within ${Math.round(timeoutMs / 1000)} s (${attempts} tries; last: ${last})`)
    await sleepFn(intervalMs)
  }
}

/** The post page is live: 200 with the title; for an indexed post the home page lists it; for a noindex post it carries the robots meta. */
export function verifyLive({ url, title, slug, noindex, homeUrl, fetch = globalThis.fetch, timeoutMs, intervalMs = 3000, sleepFn = defaultSleep }) {
  return until(async (n) => {
    const res = await fetch(bust(url, n), { headers: { 'cache-control': 'no-cache' } })
    if (res.status !== 200) return { ok: false, why: `HTTP ${res.status}` }
    const html = await res.text()
    if (!decode(html).includes(title)) return { ok: false, why: 'the page does not show the post title yet' }
    if (noindex && !/<meta name="robots" content="noindex, nofollow">/.test(html)) return { ok: false, why: 'the page has no noindex meta yet' }
    if (!noindex && homeUrl) {
      const home = await fetch(bust(homeUrl, n), { headers: { 'cache-control': 'no-cache' } })
      if (home.status !== 200) return { ok: false, why: `home page HTTP ${home.status}` }
      if (!(await home.text()).includes(`/posts/${slug}/`)) return { ok: false, why: 'the home page does not list the post yet' }
    }
    return { ok: true }
  }, { timeoutMs, intervalMs, sleepFn, what: `the post ${url}` })
}

/** The home page (or any page) answers 200. */
export function verifyPage({ url, fetch = globalThis.fetch, timeoutMs, intervalMs = 3000, sleepFn = defaultSleep }) {
  return until(async (n) => {
    const res = await fetch(bust(url, n), { headers: { 'cache-control': 'no-cache' } })
    return res.status === 200 ? { ok: true } : { ok: false, why: `HTTP ${res.status}` }
  }, { timeoutMs, intervalMs, sleepFn, what: `the page ${url}` })
}

/** After an unpublish: the post URL answers 404, or a page that no longer shows the post title. */
export function verifyGone({ url, title, fetch = globalThis.fetch, timeoutMs, intervalMs = 3000, sleepFn = defaultSleep }) {
  return until(async (n) => {
    const res = await fetch(bust(url, n), { headers: { 'cache-control': 'no-cache' } })
    if (res.status === 404) return { ok: true }
    const html = await res.text()
    return decode(html).includes(title) ? { ok: false, why: `HTTP ${res.status} and the post is still shown` } : { ok: true }
  }, { timeoutMs, intervalMs, sleepFn, what: `the removal of ${url}` })
}
