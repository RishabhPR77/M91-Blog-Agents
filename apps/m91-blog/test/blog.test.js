// The M91 blog: the Markdown, the pages and the engine copy. A fake engine (a fetch stand-in), no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { renderPost, safeHref, slugify } from '../src/markdown.js'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { cleanPost } from '../src/posts.js'
import { fmtDay } from '../src/pages.js'

const MD = `# How to add human approval to an AI agent

An agent can act in seconds. A person has to say yes first.

Short second paragraph.

## TL;DR

- Pause the risky steps.
- M91 rings a phone until someone answers.

## What needs a pause?

Only the steps you cannot undo. See [the M91 site](https://m91.msg91.com/) and [this post](/posts/older-post).

| Action | Pause? |
| --- | --- |
| Read a file | No |
| Delete a table | **Yes** |

\`\`\`js
const ok = await askPerson('<drop table>')
\`\`\`

<script>alert(1)</script>

[bad link](javascript:alert(1)) and <b>raw html</b>.

### What needs a pause?

Same title, another level.

## Sources

1. [Agent safety report](https://example.com/report)

## Try M91

M91 rings a person's phone when your software needs a decision. [Get started with M91](https://m91.msg91.com/).
`

const POSTS = [
  { slug: 'how-to-add-human-approval', title: 'How to add human approval to an AI agent', description: 'Pause the risky steps and ring a phone.', topic: 'AI agents', tags: ['approvals'], date: '2026-11-14', updated_at: '2026-11-14T15:56:00+05:30', reading_minutes: 6 },
  { slug: 'shared-alert-responsibility', title: 'How M91 Handles Shared Alert Responsibility', description: 'One person takes it.', topic: 'On-call', tags: [], date: '2026-10-29', updated_at: null, reading_minutes: 5 },
  { slug: 'older-post', title: 'An <older> post', description: '', topic: 'AI agents', tags: [], date: '2026-10-20', updated_at: null, reading_minutes: 4 }
]

function fakeEngine({ posts = POSTS, down = false } = {}) {
  const calls = []
  const state = { down, posts }
  const fetchImpl = async (url) => {
    calls.push(url.replace('https://engine.test', ''))
    if (state.down) throw new TypeError('fetch failed')
    const path = new URL(url).pathname
    if (path === '/api/public/posts') return Response.json({ posts: state.posts, total: state.posts.length })
    const slug = path.split('/').pop()
    const p = state.posts.find((x) => x.slug === slug)
    return p ? Response.json({ post: { ...p, markdown: slug === 'how-to-add-human-approval' ? MD : `# ${p.title}\n\nBody of ${slug}.\n` } }) : Response.json({ error: { code: 'not_found' } }, { status: 404 })
  }
  return { fetchImpl, calls, state }
}

async function serve(engine, { clock } = {}) {
  const cfg = loadConfig({ ENGINE_URL: 'https://engine.test', SITE_URL: 'https://blog.test' })
  const app = createApp(cfg, { fetchImpl: engine.fetchImpl, ...(clock && { now: clock }) })
  const server = http.createServer((req, res) => app.handle(req, res))
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  const get = async (path, init = {}) => {
    const r = await fetch(base + path, { redirect: 'manual', ...init })
    return { status: r.status, headers: r.headers, text: await r.text() }
  }
  return { get, app, close: () => new Promise((ok) => server.close(ok)) }
}

// ---------- the Markdown ----------

test('the post: the title out, the intro as the lead, TL;DR, Sources and Try M91 as their own blocks', () => {
  const { title, html, toc } = renderPost(MD, { siteUrl: 'https://blog.test' })
  assert.equal(title, 'How to add human approval to an AI agent')
  assert.ok(!html.includes('<h1'), 'the page shows the title itself')
  assert.match(html, /^<div class="lead"><p>An agent can act in seconds\. A person has to say yes first\.<\/p>\n<p>Short second paragraph\.<\/p>/)
  assert.match(html, /<aside class="tldr" id="tl-dr" aria-label="TL;DR"><p class="tldr-k">TL;DR<\/p><ul>\n<li>Pause the risky steps\.<\/li>/)
  assert.match(html, /<section class="sources" id="sources"/)
  assert.match(html, /<section class="cta" id="try-m91" aria-labelledby="try-m91-h"><p class="cta-k" id="try-m91-h">Try M91<\/p>/)
  assert.deepEqual(toc, [{ id: 'what-needs-a-pause', text: 'What needs a pause?' }, { id: 'sources', text: 'Sources' }])
  assert.match(html, /<h3 id="what-needs-a-pause-2">/, 'ids stay unique')
  assert.match(html, /<div class="table-wrap"><table><thead><tr><th>Action<\/th>/)
  assert.match(html, /<td><strong>Yes<\/strong><\/td>/)
})

test('safety: no raw HTML, no javascript: links, code is escaped; outside links open a new tab', () => {
  const { html } = renderPost(MD, { siteUrl: 'https://blog.test' })
  assert.ok(!/<script|<b>|alert\(1\)<\/script>/.test(html))
  assert.ok(!html.includes('javascript:'))
  assert.match(html, /bad link and raw html\./)
  assert.match(html, /askPerson\(&#39;&lt;drop table&gt;&#39;\)|askPerson\(&#39;&lt;drop table&gt;&#39;\)|askPerson\('&lt;drop table&gt;'\)/)
  assert.match(html, /<a href="https:\/\/m91\.msg91\.com\/" target="_blank" rel="noopener noreferrer">the M91 site<\/a>/)
  assert.match(html, /<a href="\/posts\/older-post">this post<\/a>/)
  assert.equal(safeHref('javascript:alert(1)'), null)
  assert.equal(safeHref('data:text/html,x'), null)
  assert.equal(safeHref('//evil.test/x'), null)
  assert.equal(safeHref('#faq'), '#faq')
  assert.equal(safeHref('mailto:support@msg91.com'), 'mailto:support@msg91.com')
  assert.equal(slugify('TL;DR'), 'tl-dr')
  assert.equal(slugify('   '), 'section')
})

test('a post from the engine is checked field by field', () => {
  assert.equal(cleanPost({ slug: '../x', title: 'X' }), null)
  assert.equal(cleanPost({ slug: 'x', title: '' }), null)
  assert.equal(cleanPost({ slug: 'x', title: 'X' }, { withBody: true }), null, 'a post needs its Markdown')
  assert.deepEqual(cleanPost({ slug: 'x', title: 'X', date: 'yesterday', reading_minutes: -3, tags: ['a', 7, ''] }), { slug: 'x', title: 'X', description: '', topic: null, tags: ['a'], date: null, updated_at: null, reading_minutes: 1 })
  assert.equal(fmtDay('2026-11-14'), '14 Nov 2026')
})

// ---------- the pages ----------

test('the list: every post as a card, newest first, topics to filter by, safe headers, no script', async () => {
  const s = await serve(fakeEngine())
  try {
    const r = await s.get('/')
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type'), /text\/html/)
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/)
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/m91\.msg91\.com/)
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(r.headers.get('cache-control'), 'public, max-age=60')
    const cards = [...r.text.matchAll(/<a class="bl-card" href="\/posts\/([^"]+)">/g)].map((m) => m[1])
    assert.deepEqual(cards, ['how-to-add-human-approval', 'shared-alert-responsibility', 'older-post'])
    assert.match(r.text, /Notes on waking people up\./)
    assert.match(r.text, /14 Nov 2026 · 6 min read/)
    assert.match(r.text, /An &lt;older&gt; post/, 'titles are escaped')
    assert.match(r.text, /<a class="chip" href="\/\?topic=on-call">On-call<\/a>/)
    assert.ok(!/<script(?! type="application\/ld\+json")/.test(r.text), 'no script runs on the page')
    assert.match(r.text, /<link rel="canonical" href="https:\/\/blog\.test\/">/)

    const on = await s.get('/?topic=on-call')
    assert.deepEqual([...on.text.matchAll(/class="bl-card" href="\/posts\/([^"]+)"/g)].map((m) => m[1]), ['shared-alert-responsibility'])
    assert.match(on.text, /<a class="chip is-on" href="\/\?topic=on-call" aria-current="page">/)
    assert.equal((await s.get('/?topic=nope')).status, 404)
  } finally {
    await s.close()
  }
})

test('a post: title, meta, the article, a table of contents, more posts; JSON-LD with no way out of its script', async () => {
  const s = await serve(fakeEngine())
  try {
    const r = await s.get('/posts/how-to-add-human-approval')
    assert.equal(r.status, 200)
    assert.match(r.text, /<title>How to add human approval to an AI agent · M91 Blog<\/title>/)
    assert.match(r.text, /<h1 class="h1">How to add human approval to an AI agent<\/h1>/)
    assert.match(r.text, /<time datetime="2026-11-14">14 Nov 2026<\/time>/)
    assert.match(r.text, /<nav class="toc" aria-label="On this page">/)
    assert.match(r.text, /<aside class="tldr"/)
    assert.match(r.text, /More from the blog/)
    assert.deepEqual([...r.text.matchAll(/class="bl-card" href="\/posts\/([^"]+)"/g)].map((m) => m[1]), ['older-post', 'shared-alert-responsibility'], 'the same topic first')
    const ld = r.text.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)[1]
    assert.equal(JSON.parse(ld)['@type'], 'BlogPosting')
    assert.match(r.text, /<meta property="og:type" content="article">/)
  } finally {
    await s.close()
  }
})

test('not found: a made-up slug never reaches the engine; a trailing slash redirects; only GET and HEAD', async () => {
  const engine = fakeEngine()
  const s = await serve(engine)
  try {
    assert.equal((await s.get('/posts/no-such-post')).status, 404)
    assert.equal((await s.get('/posts/..%2F..%2Fetc')).status, 404)
    assert.equal((await s.get('/nope')).status, 404)
    assert.ok(!engine.calls.some((c) => c.includes('no-such-post')), 'unknown slugs are answered from the list')
    const slash = await s.get('/posts/older-post/')
    assert.equal(slash.status, 301)
    assert.equal(slash.headers.get('location'), '/posts/older-post')
    assert.equal((await s.get('/', { method: 'POST' })).status, 405)
    const head = await s.get('/posts/older-post', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.text, '')
  } finally {
    await s.close()
  }
})

test('posts.json for the M91 site, RSS, sitemap, robots, favicon and the stylesheet', async () => {
  const s = await serve(fakeEngine())
  try {
    const j = await s.get('/posts.json')
    assert.equal(j.headers.get('access-control-allow-origin'), '*')
    const body = JSON.parse(j.text)
    assert.equal(body.posts[0].url, 'https://blog.test/posts/how-to-add-human-approval')
    assert.deepEqual(Object.keys(body.posts[0]).sort(), ['date', 'description', 'reading_minutes', 'slug', 'title', 'topic', 'url'])
    const rss = await s.get('/rss.xml')
    assert.match(rss.text, /<rss version="2\.0">/)
    assert.match(rss.text, /<title>An &lt;older&gt; post<\/title>/)
    const map = await s.get('/sitemap.xml')
    assert.match(map.text, /<loc>https:\/\/blog\.test\/posts\/shared-alert-responsibility<\/loc>/)
    assert.match((await s.get('/robots.txt')).text, /Sitemap: https:\/\/blog\.test\/sitemap\.xml/)
    assert.match((await s.get('/favicon.svg')).text, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 120 120"/)
    const page = await s.get('/')
    const css = page.text.match(/<link rel="stylesheet" href="([^"]+)">/)[1]
    const sheet = await s.get(css)
    assert.equal(sheet.status, 200)
    assert.equal(sheet.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.match(sheet.text, /--lime: #DFF56B/)
  } finally {
    await s.close()
  }
})

test('the engine: one read per minute, the last copy while it is down, a 503 page when there is no copy yet', async () => {
  let t = 0
  const engine = fakeEngine()
  const s = await serve(engine, { clock: () => t })
  try {
    await s.get('/')
    await s.get('/')
    assert.equal(engine.calls.filter((c) => c === '/api/public/posts').length, 1, 'cached')
    engine.state.down = true
    t += 61000
    const stale = await s.get('/')
    assert.equal(stale.status, 200, 'the last copy')
    assert.match(stale.text, /How M91 Handles Shared Alert Responsibility/)
    engine.state.down = false
    engine.state.posts = POSTS.slice(1)
    t += 61000
    const fresh = await s.get('/')
    assert.ok(!fresh.text.includes('how-to-add-human-approval'), 'a post the engine no longer lists is gone')
    assert.equal((await s.get('/posts/how-to-add-human-approval')).status, 404)
  } finally {
    await s.close()
  }
  const cold = await serve(fakeEngine({ down: true }))
  try {
    const r = await cold.get('/')
    assert.equal(r.status, 503)
    assert.equal(r.headers.get('retry-after'), '30')
    assert.match(r.text, /The blog is waking up/)
  } finally {
    await cold.close()
  }
})

test('an empty blog says the first posts are on their way', async () => {
  const s = await serve(fakeEngine({ posts: [] }))
  try {
    const r = await s.get('/')
    assert.equal(r.status, 200)
    assert.match(r.text, /The first posts are on their way\./)
  } finally {
    await s.close()
  }
})
