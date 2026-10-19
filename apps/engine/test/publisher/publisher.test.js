// The Publisher (Phase 7, Part C): post JSON, export, build checks, Embarko client, live checks and the
// publish / unpublish / set_index / rebuild_blog flows. No AI, no network: builds, deploys and fetch are fakes.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { slugify, chooseSlug, stripTitleAndTldr, readingTime, tagsOf, sourcesOf, relatedSlugs, noindexFor, buildPost, PostBuildError } from '../../src/publisher/post.js'
import { postsToExport, writePosts } from '../../src/publisher/export.js'
import { buildEnv, checkBuild, BlogBuildError } from '../../src/publisher/build.js'
import { deploy, EmbarkoError } from '../../src/publisher/embarko.js'
import { verifyLive, verifyGone, VerifyError } from '../../src/publisher/verify.js'
import { createPublisher, publishPreflight, fillPostUrl, PublishError } from '../../src/publisher/index.js'
import { createRunManager } from '../../src/runs.js'
import { defaultAgents } from '../../src/orchestrator.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { istIso } from '../../src/util/time.js'
import { replay, resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { memoryStore, fakeNotifier, mockReviewer } from '../helpers.js'
import { NOW, BRIEF_ID, CTA, config as baseConfig, brief, draftAnswer, fakeAi, okChecker, GOOD_MD } from '../writer/fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const BASE = 'https://m91-blog.embarko.app'
const TOKEN = 'emb_faketokenfortests_0123456789'
const config = (env = {}) => baseConfig({ BLOG_BASE_URL: BASE, EMBARKO_DEPLOY_TOKEN: TOKEN, ...env })
const now = () => NOW
const tmp = (name) => mkdtempSync(join(tmpdir(), `m91-pub-${name}-`))
const rec = (slug, over = {}) => ({ id: `id-${slug}`, type: 'published_post', status: 'published', briefId: `B-${slug}`, metadata: { slug }, ...over, payload: { slug, brief_id: `B-${slug}`, topic_group: 1, first_published_at: '2026-10-01T10:00:00+05:30', post: { slug, published_at: '2026-10-01T10:00:00+05:30' }, ...over.payload } })

// ---------- post JSON ----------

test('slugify: lowercase hyphenated, accents dropped, at most 60 characters, no trailing hyphen', () => {
  assert.equal(slugify('  How Agent Approval Works — with a Phone Call!  '), 'how-agent-approval-works-with-a-phone-call')
  assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu')
  const long = slugify('a'.repeat(30) + ' ' + 'b'.repeat(40))
  assert.ok(long.length <= 60 && !long.endsWith('-'))
})

test('chooseSlug: brief slug first, collisions get -2/-3, a republish keeps its slug, unpublished posts free the slug', () => {
  const b = { slug: 'Agent Approval' }
  assert.equal(chooseSlug({ briefId: 'B1', brief: b, published: [] }), 'agent-approval')
  assert.equal(chooseSlug({ briefId: 'B1', brief: {}, draft: { seo: { slug_suggestion: 'From SEO' } } }), 'from-seo')
  const taken = [rec('agent-approval'), rec('agent-approval-2')]
  assert.equal(chooseSlug({ briefId: 'B1', brief: b, published: taken }), 'agent-approval-3')
  assert.equal(chooseSlug({ briefId: 'B1', brief: b, published: [rec('agent-approval', { status: 'unpublished' })] }), 'agent-approval')
  assert.equal(chooseSlug({ briefId: 'B-old-slug', brief: { slug: 'new title' }, published: [rec('old-slug')] }), 'old-slug')
  const long = chooseSlug({ briefId: 'B1', brief: { slug: 'x'.repeat(60) }, published: [rec('x'.repeat(60))] })
  assert.equal(long, 'x'.repeat(58) + '-2')
})

test('stripTitleAndTldr: removes the H1 and the TL;DR block when found; keeps a missing part with a warning', () => {
  const r = stripTitleAndTldr(GOOD_MD)
  assert.deepEqual(r.warnings, [])
  assert.ok(!r.markdown.includes('# How agent approval works'))
  assert.ok(!r.markdown.includes('TL;DR'))
  assert.match(r.markdown, /^Agent approval means/)
  const none = stripTitleAndTldr('Intro first.\n\n## A heading\n\nText.')
  assert.equal(none.markdown, 'Intro first.\n\n## A heading\n\nText.')
  assert.equal(none.warnings.length, 2)
  const noBullets = stripTitleAndTldr('# T\n\n**TL;DR**\n\nJust prose.')
  assert.match(noBullets.markdown, /TL;DR/)
  assert.match(noBullets.warnings[0], /no bullet list/)
})

test('readingTime, tagsOf, sourcesOf, relatedSlugs', () => {
  assert.equal(readingTime('word '.repeat(10)), 1)
  assert.equal(readingTime('word '.repeat(401)), 3)
  assert.deepEqual(tagsOf({ keyword: 'Agent Approval', supporting_keywords: ['agent approval', 'a', 'b', 'c', 'd', 'e', 'f'] }), ['agent approval', 'a', 'b', 'c', 'd', 'e'])
  const md = `See [the issue](https://github.com/x/y/issues/1), [again](https://github.com/x/y/issues/1/), [our post](${BASE}/posts/older/), [rel](/posts/other/) and [Try M91](${CTA}).`
  assert.deepEqual(sourcesOf(md, { baseUrl: BASE, ctaUrl: CTA }), [{ url: 'https://github.com/x/y/issues/1', title: 'the issue' }])
  const published = [rec('older', { payload: { topic_group: 2 } }), rec('other', { payload: { topic_group: 2 } }), rec('same-1'), rec('same-2'), rec('gone', { status: 'unpublished' })]
  assert.deepEqual(relatedSlugs(md, { slug: 'me', topicGroup: 1, baseUrl: BASE, published }), ['older', 'other', 'same-1'])
})

test('noindexFor: override wins, a republish keeps its value, first N ever-published posts are noindex (unpublished test posts excluded)', () => {
  const ever = (n, over = {}) => Array.from({ length: n }, (_, i) => rec(`p${i}`, over))
  assert.equal(noindexFor({ existing: null, published: ever(9), firstN: 10 }), true)
  assert.equal(noindexFor({ existing: null, published: ever(10), firstN: 10 }), false)
  assert.equal(noindexFor({ existing: null, published: ever(10, { status: 'unpublished', metadata: { test: true } }), firstN: 10 }), true)
  assert.equal(noindexFor({ existing: null, published: ever(10, { status: 'unpublished' }), firstN: 10 }), false, 'real unpublished posts still count')
  assert.equal(noindexFor({ existing: rec('x', { payload: { noindex: true } }), published: ever(20), firstN: 10 }), true)
  assert.equal(noindexFor({ existing: rec('x', { payload: { noindex: true, noindex_override: false } }), published: [], firstN: 10 }), false)
})

test('buildPost: a valid format-v1 post; a republish keeps slug, published_at and noindex; an invalid draft throws', () => {
  const cfg = config()
  const draft = { version: 2, payload: draftAnswer() }
  const { post, warnings } = buildPost({ draft, briefId: BRIEF_ID, brief: brief(), published: [], config: cfg, now, istIso })
  assert.deepEqual(warnings, [])
  assert.equal(post.slug, 'how-agent-approval-works')
  assert.equal(post.canonical_url, `${BASE}/posts/how-agent-approval-works/`)
  assert.equal(post.seo.og_image, `${BASE}/og/how-agent-approval-works.png`)
  assert.equal(post.noindex, true)
  assert.equal(post.version, 2)
  assert.deepEqual(post.tags, ['agent approval', 'human approval', 'phone alert', 'approval step'])
  assert.ok(!post.sources.some((s) => s.url === CTA))
  const existing = rec('how-agent-approval-works', { briefId: BRIEF_ID, payload: { brief_id: BRIEF_ID, noindex: false, post: { ...post, published_at: '2026-10-02T09:00:00+05:30' } } })
  const again = buildPost({ draft, briefId: BRIEF_ID, brief: brief({ slug: 'renamed' }), published: [existing], config: cfg, now, istIso })
  assert.equal(again.post.slug, 'how-agent-approval-works')
  assert.equal(again.post.published_at, '2026-10-02T09:00:00+05:30')
  assert.equal(again.post.noindex, false)
  assert.equal(again.existing, existing)
  assert.throws(() => buildPost({ draft: { version: 1, payload: draftAnswer({ title: '' }) }, briefId: BRIEF_ID, brief: brief(), config: cfg, now, istIso }), PostBuildError)
})

// ---------- export and build checks ----------

test('export: only published/publishing posts, DRY_RUN extra and drop, and the folder is cleared first', () => {
  const posts = postsToExport([rec('a'), rec('b', { status: 'publishing' }), rec('c', { status: 'unpublished' }), rec('d', { status: 'publish_failed' })], { extra: [{ slug: 'e' }], drop: ['a'] })
  assert.deepEqual(posts.map((p) => p.slug), ['b', 'e'])
  const dir = tmp('export')
  writeFileSync(join(dir, 'old.json'), '{}')
  writeFileSync(join(dir, '.gitkeep'), '')
  assert.deepEqual(writePosts(posts, dir), ['b.json', 'e.json'])
  assert.deepEqual(readdirSync(dir).sort(), ['.gitkeep', 'b.json', 'e.json'])
  rmSync(dir, { recursive: true, force: true })
})

test('buildEnv: no .env value reaches the blog build', () => {
  const env = buildEnv({ PATH: '/bin', MEM0_API_KEY: 'm0-secret', EMBARKO_DEPLOY_TOKEN: TOKEN, SLACK_POST_WEBHOOK_URL: 'x' })
  assert.deepEqual(env, { PATH: '/bin', NODE_ENV: 'production', ASTRO_TELEMETRY_DISABLED: '1' })
})

test('checkBuild: passes a clean build; fails on a missing post page, a .env file, a secret pattern or a secret value', () => {
  const make = (files) => {
    const dir = tmp('dist')
    for (const [p, c] of Object.entries({ 'index.html': '<h1>Blog</h1>', 'posts/a/index.html': '<h1>A</h1>', ...files })) {
      mkdirSync(dirname(join(dir, p)), { recursive: true })
      writeFileSync(join(dir, p), c)
    }
    return dir
  }
  assert.deepEqual(checkBuild(make({}), { slug: 'a' }), { files: 2 })
  assert.throws(() => checkBuild(make({}), { slug: 'b' }), /no page for the post b/)
  assert.throws(() => checkBuild(make({ '.env': 'X=1' })), BlogBuildError)
  assert.throws(() => checkBuild(make({ 'x.js': 'const k = "m0-abcdefghijklmno"' })), /secret-looking/)
  assert.throws(() => checkBuild(make({ 'posts/a/index.html': `<p>${TOKEN}</p>` }), { secretValues: [TOKEN] }), /posts\/a\/index.html contains a secret-looking string/)
})

// ---------- Embarko client ----------

function embarkoFetch(script) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {} })
    const step = script[Math.min(calls.length - 1, script.length - 1)]
    if (step instanceof Error) throw step
    return { ok: step.status >= 200 && step.status < 300, status: step.status, text: async () => JSON.stringify(step.body ?? {}) }
  }
  fn.calls = calls
  return fn
}
const site = () => {
  const dir = tmp('site')
  writeFileSync(join(dir, 'index.html'), '<h1>Blog</h1>')
  return dir
}
const deployArgs = (fetch, events) => ({ dir: site(), appName: 'm91-blog', agentName: 'm91-blog-engine', token: TOKEN, apiBase: 'https://ship.example.test', fetch, sleepFn: async () => {}, onEvent: (e) => events.push(e) })

test('Embarko: 200 live in one call; headers carry app, agent and bearer token; the token is never in events', async () => {
  const events = []
  const fetch = embarkoFetch([{ status: 200, body: { status: 'live', app: { name: 'm91-blog', kind: 'static' }, links: { app: BASE } } }])
  const r = await deploy(deployArgs(fetch, events))
  assert.deepEqual(r, { status: 'live', app: 'm91-blog', kind: 'static', claimed: null, url: BASE, polls: 0 })
  assert.equal(fetch.calls[0].url, 'https://ship.example.test/apps')
  assert.equal(fetch.calls[0].headers['X-App-Name'], 'm91-blog')
  assert.equal(fetch.calls[0].headers['X-Agent-Name'], 'm91-blog-engine')
  assert.equal(fetch.calls[0].headers.Authorization, `Bearer ${TOKEN}`)
  assert.ok(!JSON.stringify(events).includes(TOKEN.slice(4)))
})

test('Embarko: 202 then status polls until live', async () => {
  const events = []
  const fetch = embarkoFetch([{ status: 202, body: { status: 'building' } }, { status: 200, body: { status: 'building' } }, { status: 200, body: { status: 'publishing' } }, { status: 200, body: { status: 'live', app: { name: 'm91-blog' } } }])
  const r = await deploy(deployArgs(fetch, events))
  assert.equal(r.polls, 3)
  assert.equal(fetch.calls[1].url, 'https://ship.example.test/apps/m91-blog/status')
  assert.equal(fetch.calls[1].headers.Authorization, `Bearer ${TOKEN}`, 'status checks send the token (claimed apps)')
})

test('Embarko: 401, 409 app_name_taken and 422 are never retried, with clear messages and no token', async () => {
  for (const [status, body, code, re] of [
    [401, { error: 'bad token' }, 'unauthorized', /deploy token is missing or wrong/],
    [409, { code: 'app_name_taken', error: 'taken' }, 'app_name_taken', /choose another BLOG_APP_NAME/],
    [422, { code: 'no_manifest_at_root' }, 'no_manifest_at_root', /no index.html at the top/]
  ]) {
    const fetch = embarkoFetch([{ status, body }])
    const err = await deploy(deployArgs(fetch, [])).catch((e) => e)
    assert.ok(err instanceof EmbarkoError)
    assert.equal(err.code, code)
    assert.match(err.message, re)
    assert.equal(fetch.calls.length, 1, `${status} is not retried`)
    assert.ok(!JSON.stringify({ ...err, message: err.message }).includes(TOKEN.slice(4)))
  }
})

test('Embarko: a lost reply checks the status, then retries once; a failed deploy status throws', async () => {
  const lost = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
  const fetch = embarkoFetch([lost, { status: 404, body: { code: 'app_not_found' } }, { status: 200, body: { status: 'live' } }])
  assert.equal((await deploy(deployArgs(fetch, []))).status, 'live')
  assert.deepEqual(fetch.calls.map((c) => c.method), ['POST', 'GET', 'POST'])
  const accepted = embarkoFetch([{ status: 502, body: {} }, { status: 200, body: { status: 'building' } }, { status: 200, body: { status: 'live' } }])
  assert.equal((await deploy(deployArgs(accepted, []))).status, 'live')
  assert.deepEqual(accepted.calls.map((c) => c.method), ['POST', 'GET', 'GET'], 'accepted after all: no second upload')
  const twice = embarkoFetch([lost, lost, lost])
  await assert.rejects(deploy(deployArgs(twice, [])), /fetch failed/)
  assert.equal(twice.calls.filter((c) => c.method === 'POST').length, 2, 'one retry only')
  const failed = embarkoFetch([{ status: 202, body: { status: 'building' } }, { status: 200, body: { status: 'failed', error: 'bad build' } }])
  await assert.rejects(deploy(deployArgs(failed, [])), (e) => e.code === 'deploy_failed' && /bad build/.test(e.message))
  await assert.rejects(deploy({ ...deployArgs(failed, []), token: '' }), (e) => e.code === 'no_token')
})

// ---------- live checks ----------

const page = (status, html = '') => ({ status, text: async () => html })

test('verifyLive: retries until the page shows the title (and the home page lists an indexed post); times out with VerifyError', async () => {
  let n = 0
  const fetch = async (url) => {
    if (url.startsWith(`${BASE}/?`)) return page(200, '<a href="/posts/a/">A</a>')
    return ++n < 3 ? page(404) : page(200, '<h1>Tom &amp; Jerry</h1>')
  }
  const r = await verifyLive({ url: `${BASE}/posts/a/`, title: 'Tom & Jerry', slug: 'a', noindex: false, homeUrl: `${BASE}/`, fetch, timeoutMs: 60000, sleepFn: async () => {} })
  assert.equal(r.attempts, 3)
  await assert.rejects(verifyLive({ url: `${BASE}/posts/a/`, title: 'T', slug: 'a', noindex: true, fetch: async () => page(200, '<h1>T</h1>'), timeoutMs: 1000, sleepFn: async () => {} }), (e) => e instanceof VerifyError && /no noindex meta/.test(e.message))
  assert.equal((await verifyGone({ url: `${BASE}/posts/a/`, title: 'T', fetch: async () => page(404), timeoutMs: 1000 })).attempts, 1)
})

// ---------- flows ----------

/** A blog folder with site.ts, a fake build that renders every exported post, and fetch serving that build. */
function fakeBlog({ siteUrl = BASE } = {}) {
  const blogDir = tmp('blog')
  mkdirSync(join(blogDir, 'src', 'config'), { recursive: true })
  writeFileSync(join(blogDir, 'src', 'config', 'site.ts'), `export const SITE_URL = '${siteUrl}'\n`)
  const contentDir = join(blogDir, 'src', 'content', 'posts')
  const dist = join(blogDir, 'dist')
  const builds = []
  const build = async () => {
    rmSync(dist, { recursive: true, force: true })
    const posts = existsSync(contentDir) ? readdirSync(contentDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(contentDir, f), 'utf8'))) : []
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, 'index.html'), posts.filter((p) => !p.noindex).map((p) => `<a href="/posts/${p.slug}/">${p.title}</a>`).join(''))
    for (const p of posts) {
      mkdirSync(join(dist, 'posts', p.slug), { recursive: true })
      writeFileSync(join(dist, 'posts', p.slug, 'index.html'), `${p.noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}<h1>${p.title}</h1>`)
    }
    builds.push(posts.map((p) => p.slug))
    return { ms: 5, dist }
  }
  let live = null
  const deploys = []
  const deployFn = async (dir) => {
    deploys.push(dir)
    live = dir
    return { status: 'live', app: 'm91-blog', polls: 0 }
  }
  const fetch = async (url) => {
    const path = new URL(url).pathname
    const file = join(live ?? '/nonexistent', path, 'index.html')
    return existsSync(file) ? page(200, readFileSync(file, 'utf8')) : page(404)
  }
  return { blogDir, contentDir, build, deployFn, fetch, builds, deploys }
}

async function seeded({ draftStatus = 'approved', test: isTest = false } = {}) {
  const store = memoryStore()
  const b = await store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief(), status: 'approved', version: 1 })
  const draft = await store.createRecord({ type: 'draft', briefId: BRIEF_ID, payload: { ...draftAnswer(), brief_id: BRIEF_ID, version: 1, brief_version: 1, checks: { hard_passed: true, results: [] } }, status: draftStatus, version: 1, meta: { brief_version: 1, ...(isTest && { test: true }) } })
  const promo = await store.createRecord({ type: 'promo_pack', briefId: BRIEF_ID, payload: { version: 1, linkedin: 'Read it: {{POST_URL}}', x_thread: ['1', 'More: {{POST_URL}}'] }, status: 'ok', version: 1 })
  return { store, brief: b, draft, promo }
}

function publisherFor(s, env = {}, blog = fakeBlog()) {
  const notifier = fakeNotifier()
  const cfg = config(env)
  const pub = createPublisher({ config: cfg, store: s.store, notifier, fetch: blog.fetch, now, sleepFn: blog.sleepFn ?? (async () => {}), build: blog.build, deployFn: blog.deployFn, blogDir: blog.blogDir, contentDir: blog.contentDir })
  return { pub, notifier, blog, cfg }
}

const posts = (store) => store.byType('published_post')

test('publish: post record published with url, draft and brief published, promo links filled, Slack line, 6 sub-steps', async () => {
  const restore = quiet()
  const s = await seeded()
  const { pub, notifier, blog } = publisherFor(s)
  const r = await pub.publish({ briefId: BRIEF_ID })
  restore()
  const url = `${BASE}/posts/how-agent-approval-works/`
  assert.equal(r.summary, `published how-agent-approval-works (noindex) → ${url}`)
  const [p] = posts(s.store)
  assert.equal(p.status, 'published')
  assert.equal(p.payload.url, url)
  assert.ok(p.payload.deployed_at && p.payload.first_published_at)
  assert.deepEqual(p.payload.deploy, { status: 'live', app: 'm91-blog' })
  assert.equal(p.payload.post.noindex, true)
  assert.equal(s.store.records.get(s.draft.id).status, 'published')
  assert.equal(s.store.records.get(s.draft.id).metadata.url, url)
  assert.equal(s.store.records.get(s.brief.id).status, 'published')
  assert.deepEqual(s.store.records.get(s.promo.id).payload, { version: 1, linkedin: `Read it: ${url}`, x_thread: ['1', `More: ${url}`] })
  assert.deepEqual(notifier.sent.slack, [`🚀 Published: *How agent approval works with a phone call* → ${url} (noindex)`])
  assert.deepEqual(blog.builds, [['how-agent-approval-works']])
  assert.equal(blog.deploys.length, 1)
  assert.ok(existsSync(join(blog.contentDir, 'how-agent-approval-works.json')))
})

test('republish keeps slug, published_at and first_published_at; a failed republish keeps the post live with last_error', async () => {
  const restore = quiet()
  const s = await seeded()
  const blog = fakeBlog()
  const first = publisherFor(s, {}, blog)
  await first.pub.publish({ briefId: BRIEF_ID })
  const before = structuredClone(posts(s.store)[0].payload)
  const again = await first.pub.publish({ briefId: BRIEF_ID })
  assert.match(again.summary, /^published how-agent-approval-works/)
  const after = posts(s.store)
  assert.equal(after.length, 1)
  assert.equal(after[0].payload.post.published_at, before.post.published_at)
  assert.equal(after[0].payload.first_published_at, before.first_published_at)
  const broken = publisherFor(s, {}, { ...blog, deployFn: async () => { throw new EmbarkoError('http_503', 'Embarko answered HTTP 503') } })
  await assert.rejects(broken.pub.publish({ briefId: BRIEF_ID }), /HTTP 503/)
  restore()
  assert.equal(posts(s.store)[0].status, 'published')
  assert.equal(posts(s.store)[0].payload.last_error, 'Embarko answered HTTP 503')
})

test('a failed first publish: publish_failed, Slack ❌ line and a LOW M91 alert; the draft stays approved', async () => {
  const restore = quiet()
  const s = await seeded()
  const blog = fakeBlog()
  // A fake clock: every sleep moves Date.now forward, so the 120 s verify window passes at once.
  const realNow = Date.now
  let offset = 0
  Date.now = () => realNow() + offset
  const { pub, notifier } = publisherFor(s, {}, { ...blog, fetch: async () => page(503), sleepFn: async (ms) => { offset += ms } })
  try {
    await assert.rejects(pub.publish({ briefId: BRIEF_ID }), VerifyError)
  } finally {
    Date.now = realNow
    restore()
  }
  assert.equal(posts(s.store)[0].status, 'publish_failed')
  assert.match(posts(s.store)[0].payload.last_error, /not confirmed within 120 s/)
  assert.equal(s.store.records.get(s.draft.id).status, 'approved')
  assert.match(notifier.sent.slack[0], /^❌ Publish failed: How agent approval works with a phone call: /)
  assert.deepEqual({ ...notifier.sent.m91[0], description: undefined }, { title: 'Blog publish failed', description: undefined, severity: 'LOW' })
})

test('DRY_RUN publish: builds locally, no deploy, no Mem0 writes, nothing sent', async () => {
  const restore = quiet()
  const s = await seeded()
  s.store.setDryRun(true)
  const writes = { ...s.store.writes }
  const { pub, notifier, blog } = publisherFor(s, { DRY_RUN: 'true', EMBARKO_DEPLOY_TOKEN: '' })
  const r = await pub.publish({ briefId: BRIEF_ID })
  restore()
  assert.match(r.summary, /^DRY_RUN: how-agent-approval-works built locally/)
  assert.deepEqual(blog.builds, [['how-agent-approval-works']])
  assert.equal(blog.deploys.length, 0)
  assert.deepEqual(s.store.writes, writes)
  assert.deepEqual(notifier.sent, { slack: [], m91: [] })
})

test('unpublish and set_index: rebuild without the post / with the new flag; draft and brief back to approved', async () => {
  const restore = quiet()
  const s = await seeded()
  const { pub, notifier, blog } = publisherFor(s)
  await pub.publish({ briefId: BRIEF_ID })
  const slug = 'how-agent-approval-works'
  const idx = await pub.setIndex({ slug, noindex: false })
  assert.equal(idx.summary, `${slug} is now shown in search`)
  assert.equal(posts(s.store)[0].payload.noindex_override, false)
  assert.equal(posts(s.store)[0].payload.post.noindex, false)
  const un = await pub.unpublish({ slug })
  restore()
  assert.equal(un.summary, `unpublished ${slug}`)
  assert.equal(posts(s.store)[0].status, 'unpublished')
  assert.ok(posts(s.store)[0].payload.unpublished_at)
  assert.equal(s.store.records.get(s.draft.id).status, 'approved')
  assert.equal(s.store.records.get(s.brief.id).status, 'approved')
  assert.deepEqual(blog.builds.at(-1), [])
  assert.equal(notifier.sent.slack.at(-1), '🗑️ Unpublished: *How agent approval works with a phone call*')
  await assert.rejects(pub.unpublish({ slug }), (e) => e.code === 'not_published')
  await assert.rejects(pub.setIndex({ slug: 'nope', noindex: true }), (e) => e.code === 'unknown_post' && e.status === 404)
})

test('rebuild_blog: rebuilds from Mem0 and checks the home page; preflight needs the token and matching URLs', async () => {
  const restore = quiet()
  const s = await seeded()
  const { pub, blog } = publisherFor(s)
  const r = await pub.rebuildBlog()
  restore()
  assert.equal(r.summary, 'blog rebuilt and deployed (1 files)')
  assert.equal(blog.deploys.length, 1)
  assert.throws(() => publishPreflight(config({ EMBARKO_DEPLOY_TOKEN: '' }), { blogDir: blog.blogDir }), (e) => e instanceof PublishError && e.code === 'no_token')
  assert.doesNotThrow(() => publishPreflight(config({ EMBARKO_DEPLOY_TOKEN: '', DRY_RUN: 'true' }), { blogDir: blog.blogDir }))
  assert.throws(() => publishPreflight(config({ BLOG_BASE_URL: 'https://other.embarko.app' }), { blogDir: blog.blogDir }), (e) => e.code === 'site_url_mismatch')
  assert.deepEqual(fillPostUrl({ a: ['x {{POST_URL}}'], n: 1 }, 'U'), { a: ['x U'], n: 1 })
})

// ---------- through the run manager ----------

function manager(s, env, blog = fakeBlog()) {
  const notifier = fakeNotifier()
  const cfg = config(env)
  const m = createRunManager({
    config: cfg,
    storeFactory: () => s.store,
    notifierFactory: () => notifier,
    publisherFactory: (rc, d) => createPublisher({ config: rc, ...d, fetch: blog.fetch, now, sleepFn: blog.sleepFn ?? (async () => {}), build: blog.build, deployFn: blog.deployFn, blogDir: blog.blogDir, contentDir: blog.contentDir }),
    agentsFactory: (rc, { store, notifier: nt }) => ({ ...defaultAgents({ config: rc, store, notifier: nt, agentDeps: { aiSend: fakeAi(), urlChecker: okChecker(), now } }), reviewer: mockReviewer(), promo: stubAgents.promo })
  })
  const run = async (mode, params = {}) => {
    const { run_id } = await m.startRun({ mode, params })
    return { run_id, ...(await m.wait(run_id)) }
  }
  return { run, notifier, blog }
}

test('AUTO_PUBLISH=true: approve publishes in the same run (publisher sub-steps as step.output events)', async () => {
  const restore = quiet()
  const s = await seeded({ draftStatus: 'awaiting_human' })
  await s.store.createRecord({ type: 'review', briefId: BRIEF_ID, payload: { brief_id: BRIEF_ID, version: 1, brief_version: 1, pass: true, total: 88, feedback: [] }, status: 'pass', version: 1, meta: { brief_version: 1 } })
  const { run } = manager(s, { AUTO_PUBLISH: 'true' })
  const r = await run('approve', { brief_id: BRIEF_ID })
  restore()
  assert.equal(r.status, 'succeeded')
  assert.match(r.run.result_summary, /; published → https:\/\/m91-blog\.embarko\.app\/posts\/how-agent-approval-works\/$/)
  const subs = replay(r.run_id).filter((e) => e.type === 'step.output' && e.step === 'publisher').map((e) => e.message.split(':')[0])
  assert.deepEqual(subs.slice(0, 6), ['1/6 build post', '2/6 export', '3/6 build blog', '4/6 deploy', '5/6 verify', '6/6 mark published'])
  assert.equal(posts(s.store)[0].status, 'published')
  assert.ok(!JSON.stringify(replay(r.run_id)).includes(TOKEN.slice(4)), 'no token in events')
})

test('AUTO_PUBLISH=true with a failing deploy: approve still succeeds, the post stays approved with a warning', async () => {
  const restore = quiet()
  const s = await seeded({ draftStatus: 'awaiting_human' })
  await s.store.createRecord({ type: 'review', briefId: BRIEF_ID, payload: { brief_id: BRIEF_ID, version: 1, brief_version: 1, pass: true, total: 88, feedback: [] }, status: 'pass', version: 1, meta: { brief_version: 1 } })
  const blog = fakeBlog()
  const { run } = manager(s, { AUTO_PUBLISH: 'true' }, { ...blog, deployFn: async () => { throw new EmbarkoError('unauthorized', 'the deploy token is missing or wrong (EMBARKO_DEPLOY_TOKEN)') } })
  const r = await run('approve', { brief_id: BRIEF_ID })
  restore()
  assert.equal(r.status, 'succeeded')
  assert.ok(r.run.warnings.some((w) => /publish failed \(the post stays approved\)/.test(w)))
  assert.equal(s.store.records.get(s.draft.id).status, 'approved')
  assert.equal(posts(s.store)[0].status, 'publish_failed')
})

test('publish modes as runs: publish, set_index, unpublish, rebuild_blog', async () => {
  const restore = quiet()
  const s = await seeded()
  const { run } = manager(s, {})
  const slug = 'how-agent-approval-works'
  assert.equal((await run('publish', { brief_id: BRIEF_ID })).status, 'succeeded')
  assert.equal((await run('set_index', { slug, noindex: false })).status, 'succeeded')
  assert.equal((await run('rebuild_blog')).status, 'succeeded')
  const un = await run('unpublish', { slug })
  restore()
  assert.equal(un.status, 'succeeded')
  assert.equal(un.run.result_summary, `unpublished ${slug}`)
})
