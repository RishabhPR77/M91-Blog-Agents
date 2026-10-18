import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAgainst, createUrlChecker, normaliseUrl, isSearchResultsUrl, removeLongQuotes, trimSummary, storyDateRule, freshnessFromDates, daysAgo } from '../../src/scout/checks.js'
import { SCHEMAS } from '../../src/scout/schemas.js'
import { VALID, INVALID } from './fixtures.js'

test('schemas: every schema accepts its valid fixture and rejects its invalid one', () => {
  for (const name of Object.keys(SCHEMAS)) {
    assert.equal(validateAgainst(name, VALID[name]).valid, true, `${name} valid`)
    const bad = validateAgainst(name, INVALID[name])
    assert.equal(bad.valid, false, `${name} invalid`)
    assert.ok(bad.errors.length > 0)
  }
})

test('schemas: string content (rtlayer) is parsed first; non-JSON is invalid', () => {
  assert.equal(validateAgainst('scout_style', JSON.stringify(VALID.scout_style)).valid, true)
  assert.deepEqual(validateAgainst('scout_style', 'not json').errors, ['answer is not valid JSON'])
})

test('schemas are strict: additionalProperties false and every property required', () => {
  const walk = (s) => {
    if (s?.type === 'object' && s.properties) {
      assert.equal(s.additionalProperties, false)
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort())
    }
    for (const v of Object.values(s ?? {})) if (v && typeof v === 'object') walk(v)
  }
  for (const s of Object.values(SCHEMAS)) walk(s.schema)
})

function fakeFetch(byUrl) {
  const calls = []
  const fn = async (url, init) => {
    calls.push([init.method, url])
    const a = byUrl[url]
    if (a instanceof Error) throw a
    const status = typeof a === 'object' ? a[init.method] : a
    return { status, body: null }
  }
  fn.calls = calls
  return fn
}

test('URL check: ok, blocked kept, 404/timeout dead, search pages invalid, HEAD→GET fallback, cache', async () => {
  const fetch = fakeFetch({
    'https://a.com/ok': 200,
    'https://a.com/redirect': 301,
    'https://a.com/forbidden': 403,
    'https://a.com/limited': 429,
    'https://a.com/gone': 404,
    'https://a.com/gone410': 410,
    'https://a.com/timeout': new Error('The operation was aborted due to timeout'),
    'https://a.com/nohead': { HEAD: 405, GET: 200 }
  })
  const c = createUrlChecker({ fetch, timeoutMs: 50 })
  assert.equal(await c.check('https://a.com/ok'), 'ok')
  assert.equal(await c.check('https://a.com/redirect'), 'ok')
  assert.equal(await c.check('https://a.com/forbidden'), 'blocked')
  assert.equal(await c.check('https://a.com/limited'), 'blocked')
  assert.equal(await c.check('https://a.com/gone'), 'dead')
  assert.equal(await c.check('https://a.com/gone410'), 'dead')
  assert.equal(await c.check('https://a.com/timeout'), 'dead')
  assert.equal(await c.check('https://a.com/nohead'), 'ok')
  assert.equal(await c.check('https://www.google.com/search?q=x'), 'invalid')
  assert.equal(await c.check('ftp://a.com/x'), 'invalid')
  const before = fetch.calls.length
  await c.check('https://a.com/ok')
  assert.equal(fetch.calls.length, before, 'cached')
})

test('URL check: at most 8 requests in flight', async () => {
  let active = 0
  let peak = 0
  const fetch = async () => {
    active++
    peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 5))
    active--
    return { status: 200 }
  }
  const c = createUrlChecker({ fetch })
  await Promise.all(Array.from({ length: 30 }, (_, i) => c.check(`https://a.com/${i}`)))
  assert.ok(peak <= 8, `peak ${peak}`)
})

test('https normalisation for docs hosts only', () => {
  assert.equal(normaliseUrl('http://m91.msg91.com/docs/a', ['m91.msg91.com']), 'https://m91.msg91.com/docs/a')
  assert.equal(normaliseUrl('http://other.com/a', ['m91.msg91.com']), 'http://other.com/a')
  assert.equal(normaliseUrl('javascript:alert(1)', []), null)
  assert.ok(isSearchResultsUrl('https://www.bing.com/search?q=x'))
  assert.ok(!isSearchResultsUrl('https://www.reddit.com/r/devops/comments/abc'))
})

test('copy protection: quotes over 15 words removed, short quotes kept', () => {
  const long = '"' + 'word '.repeat(16).trim() + '"'
  const r = removeLongQuotes(`They said ${long} yesterday.`)
  assert.equal(r.removed, 1)
  assert.equal(r.text, 'They said yesterday.')
  assert.equal(removeLongQuotes('He said "ship it now" today.').removed, 0)
  assert.equal(removeLongQuotes(`“${'a '.repeat(20)}”`).removed, 1)
})

test('copy protection: summaries trimmed to 2 sentences / 60 words', () => {
  assert.equal(trimSummary('One. Two. Three.'), 'One. Two.')
  assert.equal(trimSummary('Short one.'), 'Short one.')
  const long = trimSummary(Array.from({ length: 80 }, () => 'w').join(' ') + '.')
  assert.ok(long.split(/\s+/).length <= 60)
})

test('dates: expiry, rapid-response window, unknown and future dates', () => {
  const opts = { today: '2026-10-17', lookbackDays: 30, rapidDays: 7 }
  assert.deepEqual(storyDateRule('2026-10-14', opts), { keep: true, rapid: true, age: 3 })
  assert.deepEqual(storyDateRule('2026-10-01', opts), { keep: true, rapid: false, age: 16 })
  assert.equal(storyDateRule('2026-09-01', opts).keep, false)
  assert.deepEqual(storyDateRule('unknown', opts), { keep: true, rapid: false, age: null })
  assert.equal(storyDateRule('2026-12-01', opts).rapid, false)
  assert.equal(daysAgo('2026-02-30', '2026-10-17'), null)
  assert.equal(freshnessFromDates(['unknown', '2026-10-12'], '2026-10-17'), 'this_week')
  assert.equal(freshnessFromDates(['2026-09-01'], '2026-10-17'), 'ongoing')
})
