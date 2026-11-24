// The Write page (2026-11-24): posts you write for the M91 blog and their images. Fakes only: an in-memory store, a temp
// data folder, no network, no Mem0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { cleanFields, firstHeading, slugify, cleanCover, saveBlogPost, BlogError } from '../src/blogposts.js'
import { imageKind, saveImage, readImage, MAX_IMAGE_BYTES } from '../src/blogimages.js'
import { listPublicPosts } from '../src/publicposts.js'
import { judgeRecords } from '../src/memory.js'
import { fakeConfig, memoryStore, fakeNotifier } from './helpers.js'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const MD = '---\ntitle: "From the front matter"\n---\n# Who answers at 2 AM?\n\nA phone that rings until someone answers.\n\n![A phone](/images/0123456789abcdef0123.png)\n'

const tempConfig = (over = {}) => fakeConfig({ ENGINE_DATA_DIR: mkdtempSync(join(tmpdir(), 'm91-write-')), DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'right-password-123', ...over })

async function serve({ store = memoryStore(), config = tempConfig(), clock } = {}) {
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config, ...(clock && { now: clock }) })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'right-password-123' }) })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const call = async (method, path, body, { raw = false, type = 'application/json', auth = true } = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': type, ...(auth && { cookie }) }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: r.status, json, headers: r.headers, text }
  }
  return { call, base, store, config, close: () => new Promise((ok) => server.close(ok)) }
}

// ---------- the fields ----------

test('fields: the title falls back to the "# Title", the slug to the title; front matter is dropped; limits', () => {
  const f = cleanFields({ markdown: MD, tags: 'on-call, approvals, on-call', topic: '  On-call ' })
  assert.equal(f.title, 'Who answers at 2 AM?')
  assert.equal(f.slug, 'who-answers-at-2-am')
  assert.deepEqual(f.tags, ['on-call', 'approvals'])
  assert.equal(f.topic, 'On-call')
  assert.ok(!f.markdown.includes('front matter'))
  assert.equal(cleanFields({ markdown: 'text', title: 'Given' }).slug, 'given')
  assert.equal(firstHeading('intro\n# **Bold** title #\n'), 'Bold title')
  assert.equal(slugify('Ça va? 100% — yes!'), 'ca-va-100-yes')
  const bad = (body, code) => assert.throws(() => cleanFields(body), (e) => e instanceof BlogError && e.code === code)
  bad({ markdown: '  ' }, 'no_markdown')
  bad({ markdown: 'no heading here' }, 'no_title')
  bad({ markdown: '# T', slug: 'Bad Slug' }, 'bad_slug')
  bad({ markdown: '# T', slug: '-x' }, 'bad_slug')
  bad({ markdown: 'x'.repeat(100001), title: 'T' }, 'too_long')
  bad({ markdown: '# T', tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }, 'bad_tags')
  bad({ markdown: '# T', cover: 'javascript:alert(1)' }, 'bad_cover')
  assert.equal(cleanCover('/images/0123456789abcdef0123.webp'), '/images/0123456789abcdef0123.webp')
  assert.equal(cleanCover('/images/../../etc/passwd'), null)
  assert.equal(cleanCover('http://example.com/a.png'), null, 'https only')
})

test('save: new, edit, publish keeps its first date, a slug in use is refused (yours or an approved post)', async () => {
  const store = memoryStore()
  let t = Date.parse('2026-11-24T06:00:00Z')
  const now = () => t
  const a = await saveBlogPost(store, { body: { markdown: MD }, now })
  assert.equal(a.status, 'draft')
  assert.equal(a.published_at, null)
  t += 60000
  const b = await saveBlogPost(store, { id: a.id, body: { markdown: MD, description: 'Short.', publish: true }, now })
  assert.equal(b.status, 'published')
  assert.equal(b.published_at, '2026-11-24T11:31:00+05:30')
  assert.equal(b.created_at, a.created_at)
  t += 60000
  const c = await saveBlogPost(store, { id: a.id, body: { markdown: `${MD}\nMore.` }, now })
  assert.equal(c.status, 'published', 'an edit keeps it published')
  assert.equal(c.published_at, b.published_at)
  await assert.rejects(saveBlogPost(store, { body: { markdown: MD }, now }), (e) => e.code === 'slug_taken' && e.status === 409)
  await assert.rejects(saveBlogPost(store, { body: { markdown: '# Engine post' }, takenSlugs: ['engine-post'], now }), (e) => e.code === 'slug_taken')
  await assert.rejects(saveBlogPost(store, { id: 'nope', body: { markdown: '# X' }, now }), (e) => e.status === 404)
})

// ---------- images ----------

test('images: PNG, JPEG, GIF and WebP by their first bytes; SVG and other files refused; named by content', () => {
  const config = tempConfig()
  assert.equal(imageKind(PNG), 'png')
  assert.equal(imageKind(JPG), 'jpg')
  assert.equal(imageKind(WEBP), 'webp')
  assert.equal(imageKind(Buffer.from('GIF89a......')), 'gif')
  assert.equal(imageKind(SVG), null)
  const one = saveImage(config, PNG)
  assert.match(one.name, /^[a-f0-9]{20}\.png$/)
  assert.equal(one.url, `/images/${one.name}`)
  assert.deepEqual(saveImage(config, PNG), one, 'the same image twice is one file')
  assert.equal(readdirSync(join(config.runtime.dataDir, 'blog-images')).length, 1)
  assert.deepEqual(readImage(config, one.name), { body: PNG, type: 'image/png' })
  assert.equal(readImage(config, '../work.json'), null)
  assert.equal(readImage(config, 'ffffffffffffffffffff.png'), null)
  assert.throws(() => saveImage(config, SVG), (e) => e.code === 'not_an_image' && e.status === 415)
  assert.throws(() => saveImage(config, Buffer.alloc(0)), (e) => e.code === 'no_image')
  assert.throws(() => saveImage(config, Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)])), (e) => e.code === 'image_too_large')
})

// ---------- the API ----------

test('API: write, preview the list, publish, it is on the public list, unpublish, delete; every route needs the login', async () => {
  const restore = setSink(() => {})
  const s = await serve()
  try {
    for (const [method, path] of [['GET', '/api/blog/posts'], ['POST', '/api/blog/posts'], ['GET', '/api/blog/posts/x'], ['PUT', '/api/blog/posts/x'], ['DELETE', '/api/blog/posts/x'], ['POST', '/api/blog/posts/x/publish'], ['POST', '/api/blog/images']]) {
      assert.equal((await s.call(method, path, method === 'GET' ? undefined : {}, { auth: false })).status, 401, `${method} ${path}`)
    }
    const created = await s.call('POST', '/api/blog/posts', { markdown: MD, topic: 'On-call', description: 'Who gets woken up.' })
    assert.equal(created.status, 201)
    const id = created.json.post.id
    assert.equal((await s.call('GET', '/api/public/posts', undefined, { auth: false })).json.total, 0, 'a draft is not public')

    const list = await s.call('GET', '/api/blog/posts')
    assert.deepEqual(list.json.posts.map((p) => [p.title, p.status]), [['Who answers at 2 AM?', 'draft']])
    assert.ok(!('markdown' in list.json.posts[0]))
    assert.deepEqual(list.json.topics, ['On-call'])
    assert.equal(list.json.blog_url, 'https://m91-blog.embarko.app')
    assert.match((await s.call('GET', `/api/blog/posts/${id}`)).json.post.markdown, /^# Who answers at 2 AM\?/)

    assert.equal((await s.call('POST', `/api/blog/posts/${id}/publish`)).json.post.status, 'published')
    const pub = await s.call('GET', '/api/public/posts', undefined, { auth: false })
    assert.deepEqual(pub.json.posts.map((p) => p.slug), ['who-answers-at-2-am'], 'public at once (the cache is cleared)')
    const one = (await s.call('GET', '/api/public/posts/who-answers-at-2-am', undefined, { auth: false })).json.post
    assert.equal(one.description, 'Who gets woken up.')
    assert.ok(!('id' in one) && !('status' in one), 'no record id or status in public')

    const edited = await s.call('PUT', `/api/blog/posts/${id}`, { markdown: MD, title: 'A new title', slug: 'who-answers-at-2-am', cover: '/images/0123456789abcdef0123.png' })
    assert.equal(edited.json.post.title, 'A new title')
    assert.equal((await s.call('GET', '/api/public/posts/who-answers-at-2-am', undefined, { auth: false })).json.post.cover, '/images/0123456789abcdef0123.png')
    assert.equal((await s.call('PUT', `/api/blog/posts/${id}`, { markdown: '' })).json.error.code, 'no_markdown')

    assert.equal((await s.call('POST', `/api/blog/posts/${id}/unpublish`)).json.post.status, 'draft')
    assert.equal((await s.call('GET', '/api/public/posts', undefined, { auth: false })).json.total, 0)
    assert.equal((await s.call('DELETE', `/api/blog/posts/${id}`)).json.deleted, true)
    assert.equal((await s.call('GET', `/api/blog/posts/${id}`)).status, 404)
    assert.equal((await s.call('POST', '/api/blog/posts', { markdown: 'x'.repeat(600 * 1024), title: 'Huge' })).status, 413)
  } finally {
    await s.close()
    restore()
  }
})

test('API: an image upload is saved and served publicly with safe headers; a non-image is refused', async () => {
  const restore = setSink(() => {})
  const s = await serve()
  try {
    const up = await s.call('POST', '/api/blog/images', PNG, { raw: true, type: 'image/png' })
    assert.equal(up.status, 201)
    const url = up.json.image.url
    assert.match(url, /^\/images\/[a-f0-9]{20}\.png$/)
    const img = await fetch(`${s.base}/api/public${url}`)
    assert.equal(img.status, 200)
    assert.equal(img.headers.get('content-type'), 'image/png')
    assert.equal(img.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff')
    assert.match(img.headers.get('content-security-policy'), /sandbox/)
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG)
    assert.equal((await s.call('POST', '/api/blog/images', SVG, { raw: true, type: 'image/svg+xml' })).json.error.code, 'not_an_image')
    assert.equal((await fetch(`${s.base}/api/public/images/..%2Fwork.json`)).status, 404)
  } finally {
    await s.close()
    restore()
  }
})

test('the public list: your published posts next to the approved ones; a draft never; the memory page protects them', async () => {
  const store = memoryStore()
  const draft = await saveBlogPost(store, { body: { markdown: '# A draft of mine' } })
  const mine = await saveBlogPost(store, { body: { markdown: '# Published by me', publish: true } })
  assert.deepEqual((await listPublicPosts(store)).map((p) => p.slug), ['published-by-me'])
  const records = await store.getRecords({ type: 'blog_post' })
  const judged = judgeRecords(records)
  assert.equal(judged.get(mine.id).protection, 'never')
  assert.equal(judged.get(draft.id).protection, 'confirm')
})
