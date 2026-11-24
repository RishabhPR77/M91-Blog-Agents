// The public posts for the M91 blog (2026-11-23): every approved post, no login, only what a reader sees.
// Fakes only: an in-memory store, no network, no Mem0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { listPublicPosts, listEnginePosts, publicPost, readingMinutes, PUBLIC_SLUG_RE } from '../src/publicposts.js'
import { fakeConfig, memoryStore, fakeNotifier } from './helpers.js'

const BODY = (title) => `# ${title}\n\nA ringing phone gets an answer.\n\n## TL;DR\n\n- One\n- Two\n\n## What happens at night?\n\n${'Words to read here. '.repeat(120)}\n`

async function seed(store) {
  const post = async ({ briefId, slug, title, status, approvedAt, exportedAt, date, markdown }) => {
    await store.createRecord({ type: 'draft', briefId, payload: { brief_id: briefId, version: 1, title, post_markdown: 'DRAFT TEXT' }, status, version: 1, meta: { brief_version: 1, review_total: 91, ...(approvedAt && { approved_at: approvedAt, approved_by: 'auto' }) } })
    await store.createRecord({
      type: 'markdown_export', briefId,
      payload: { brief_id: briefId, version: 1, slug, filename: `${slug}.md`, title, markdown: markdown ?? BODY(title), exported_at: exportedAt, front_matter: { title, slug, description: `About ${title}`, topic: 'AI agents', tags: ['approvals', 'on-call'], brief_id: briefId, review_score: 91, date } },
      status: 'final', version: 1, meta: { slug }
    })
  }
  await post({ briefId: '261101-0900-AAAA', slug: 'older-post', title: 'An older post', status: 'approved', approvedAt: '2026-11-01T09:40:00+05:30', exportedAt: '2026-11-20T10:00:00+05:30', date: '2026-11-20' })
  await post({ briefId: '261114-1535-Y49U', slug: 'how-to-add-human-approval', title: 'How to add human approval', status: 'approved', approvedAt: '2026-11-14T15:55:00+05:30', exportedAt: '2026-11-14T15:56:00+05:30', date: '2026-11-14' })
  await post({ briefId: '261115-0900-WAIT', slug: 'still-waiting', title: 'Still waiting for you', status: 'awaiting_human', exportedAt: '2026-11-15T09:30:00+05:30', date: '2026-11-15' })
  await post({ briefId: '261116-0900-BADS', slug: 'Bad Slug!', title: 'A bad slug', status: 'approved', approvedAt: '2026-11-16T09:40:00+05:30', exportedAt: '2026-11-16T09:41:00+05:30', date: '2026-11-16' })
  return store
}

async function serve(store, env = {}) {
  const config = fakeConfig({ DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'right-password-123', ...env })
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, close: () => new Promise((ok) => server.close(ok)) }
}

test('only approved posts, newest approval first, dated by the first approval (not a later re-export)', async () => {
  const posts = await listPublicPosts(await seed(memoryStore()))
  assert.deepEqual(posts.map((p) => p.slug), ['how-to-add-human-approval', 'older-post'])
  assert.equal(posts[1].date, '2026-11-01', 'the approval day, not the re-export day')
  assert.equal(posts[1].updated_at, '2026-11-20T10:00:00+05:30')
  assert.deepEqual(Object.keys(posts[0]).sort(), ['cover', 'date', 'description', 'markdown', 'reading_minutes', 'slug', 'tags', 'title', 'topic', 'updated_at'])
  assert.ok(!JSON.stringify(posts).includes('DRAFT TEXT'))
  assert.ok(!JSON.stringify(posts).includes('261114-1535-Y49U'), 'no brief id')
  assert.ok(!JSON.stringify(posts).includes('review_score'))
})

test('a post: the Markdown without front matter, a reading time, and nothing for an incomplete export', () => {
  const rec = { payload: { slug: 'x-y', title: 'X', markdown: '---\ntitle: "X"\n---\n# X\n\nHello there.', exported_at: '2026-11-14T10:00:00+05:30', front_matter: {} } }
  assert.equal(publicPost(rec).markdown, '# X\n\nHello there.\n')
  assert.equal(publicPost(rec).date, '2026-11-14')
  assert.equal(publicPost({ payload: { slug: 'x', title: '', markdown: 'text' } }), null)
  assert.equal(publicPost({ payload: { slug: 'x', title: 'X', markdown: '   ' } }), null)
  assert.equal(readingMinutes('word '.repeat(460)), 2)
  assert.equal(readingMinutes('```\n' + 'code '.repeat(5000) + '\n```\nshort'), 1)
  assert.ok(PUBLIC_SLUG_RE.test('how-to-add-human-approval'))
  assert.ok(!PUBLIC_SLUG_RE.test('../etc/passwd') && !PUBLIC_SLUG_RE.test('-x') && !PUBLIC_SLUG_RE.test('A'))
})

test('GET /api/public/posts needs no login (the rest of the API still does), can be cached and read from any site', async () => {
  const restore = setSink(() => {})
  const s = await serve(await seed(memoryStore()))
  try {
    const list = await fetch(`${s.base}/api/public/posts`)
    assert.equal(list.status, 200)
    assert.equal(list.headers.get('access-control-allow-origin'), '*')
    assert.equal(list.headers.get('cache-control'), 'public, max-age=60')
    assert.equal(list.headers.get('x-robots-tag'), 'noindex')
    const body = await list.json()
    assert.equal(body.total, 2)
    assert.deepEqual(body.posts.map((p) => p.slug), ['how-to-add-human-approval', 'older-post'])
    assert.ok(body.posts.every((p) => !('markdown' in p)), 'the list has no post bodies')
    assert.equal((await (await fetch(`${s.base}/api/public/posts?limit=1`)).json()).posts.length, 1)

    const one = await fetch(`${s.base}/api/public/posts/how-to-add-human-approval`)
    assert.equal(one.status, 200)
    const { post } = await one.json()
    assert.equal(post.title, 'How to add human approval')
    assert.match(post.markdown, /^# How to add human approval\n/)

    for (const slug of ['still-waiting', 'nope', '..%2F..%2Fapi%2Fsettings', 'Bad%20Slug!']) {
      const r = await fetch(`${s.base}/api/public/posts/${slug}`)
      assert.equal(r.status, 404, slug)
    }
    assert.equal((await fetch(`${s.base}/api/public/posts`, { method: 'POST' })).status, 401, 'nothing but reading')
    assert.equal((await fetch(`${s.base}/api/exports`)).status, 401, 'the rest of the API still needs the login')
    assert.equal((await fetch(`${s.base}/api/records?type=draft`)).status, 401)
  } finally {
    await s.close()
    restore()
  }
})

test('a new approval shows within the 30 s cache', async () => {
  const restore = setSink(() => {})
  let t = Date.parse('2026-11-23T10:00:00Z')
  const store = await seed(memoryStore())
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', store, now: () => t, config: fakeConfig({ DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'right-password-123' }) })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await (await fetch(`${base}/api/public/posts`)).json()).total, 2)
    const [waiting] = await store.getRecords({ type: 'draft', status: 'awaiting_human' })
    await store.updateRecord(waiting.id, undefined, { status: 'approved', approved_at: '2026-11-23T15:00:00+05:30' })
    assert.equal((await (await fetch(`${base}/api/public/posts`)).json()).total, 2, 'cached')
    t += 31000
    const after = await (await fetch(`${base}/api/public/posts`)).json()
    assert.equal(after.total, 3)
    assert.equal(after.posts[0].slug, 'still-waiting')
  } finally {
    await new Promise((ok) => server.close(ok))
    restore()
  }
})

// ---------- the website OK (2026-11-24) ----------

test('a newly approved post waits for your OK; on and off on the dashboard; older exports count as on', async () => {
  const restore = setSink(() => {})
  const store = await seed(memoryStore())
  // A post approved after the OK existed: its export says "waiting".
  await store.createRecord({ type: 'draft', briefId: '261124-0900-NEWP', payload: { brief_id: '261124-0900-NEWP', version: 1 }, status: 'approved', version: 1, meta: { approved_at: '2026-11-24T09:40:00+05:30' } })
  await store.createRecord({ type: 'markdown_export', briefId: '261124-0900-NEWP', status: 'final', version: 1, meta: { slug: 'brand-new', website: 'waiting' },
    payload: { brief_id: '261124-0900-NEWP', slug: 'brand-new', title: 'Brand new', markdown: BODY('Brand new'), exported_at: '2026-11-24T09:41:00+05:30', front_matter: { title: 'Brand new', slug: 'brand-new', date: '2026-11-24' } } })
  assert.deepEqual((await listPublicPosts(store)).map((p) => p.slug), ['how-to-add-human-approval', 'older-post'], 'waiting: not public; the older exports: public')
  const engine = await listEnginePosts(store)
  assert.deepEqual(engine.map((e) => [e.post.slug, e.website]), [['brand-new', 'waiting'], ['how-to-add-human-approval', 'on'], ['older-post', 'on']])

  const s = await serve(store)
  try {
    const cookie = (await fetch(`${s.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'right-password-123' }) })).headers.get('set-cookie').split(';')[0]
    const call = (method, path, body, auth = true) => fetch(`${s.base}${path}`, { method, headers: { 'content-type': 'application/json', ...(auth && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) })
    assert.equal((await call('POST', '/api/blog/engine-posts/261124-0900-NEWP/website', { on: true }, false)).status, 401, 'needs the login')
    const list = await (await call('GET', '/api/blog/posts')).json()
    assert.equal(list.website_waiting, 1)
    assert.deepEqual(list.engine_posts.find((p) => p.slug === 'brand-new'), { slug: 'brand-new', title: 'Brand new', description: '', date: '2026-11-24', topic: null, reading_minutes: 2, brief_id: '261124-0900-NEWP', website: 'waiting' })

    const on = await call('POST', '/api/blog/engine-posts/261124-0900-NEWP/website', { on: true })
    assert.deepEqual(await on.json(), { brief_id: '261124-0900-NEWP', website: 'on' })
    assert.deepEqual((await (await fetch(`${s.base}/api/public/posts`)).json()).posts.map((p) => p.slug), ['brand-new', 'how-to-add-human-approval', 'older-post'], 'on the website at once')

    await call('POST', '/api/blog/engine-posts/261101-0900-AAAA/website', { on: false })
    assert.deepEqual((await (await fetch(`${s.base}/api/public/posts`)).json()).posts.map((p) => p.slug), ['brand-new', 'how-to-add-human-approval'], 'kept off')
    assert.equal((await fetch(`${s.base}/api/public/posts/older-post`)).status, 404)
    assert.equal((await (await call('GET', '/api/blog/posts')).json()).website_waiting, 0)

    assert.equal((await call('POST', '/api/blog/engine-posts/261130-0900-ABCD/website', { on: true })).status, 404, 'not approved: nothing to put on')
    assert.equal((await call('POST', '/api/blog/engine-posts/261124-0900-NEWP/website', { on: 'yes' })).status, 400)
    assert.equal((await call('POST', '/api/blog/engine-posts/nope/website', { on: true })).status, 400)
  } finally {
    await s.close()
    restore()
  }
})
