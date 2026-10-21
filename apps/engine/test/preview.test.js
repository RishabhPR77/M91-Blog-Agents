// Phase 10 D1: the page preview. buildPreview writes the waiting post (with its guide) alone and builds the blog
// under /preview/<brief_id>/; the engine serves it there (noindex, framed only by the dashboard). A fake blog
// build stands in for Astro: no AI, no Mem0 service, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { buildPreview, readPreview, previewBase, PreviewError } from '../src/publisher/preview.js'
import { bodyHash } from '../src/publisher/blocks.js'
import { bodyMarkdown } from '../src/designer/parts.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier } from './helpers.js'
import { brief, draftAnswer, GOOD_MD, CTA } from './writer/fixtures.js'
import { plainPlan } from './fixtures/plain-plan.js'
import { buildGuide } from '../src/experience/build.js'
import { parseParts } from '../src/designer/parts.js'

const B = '261021-0937-JHTR'
const TRIGGER = 'fake-trigger-key-0123456789'

/** A fake blog build: records its options and writes the pages the checks expect, with the content it was given. */
function fakeBuild() {
  const calls = []
  const build = async (opts) => {
    calls.push(opts)
    const [file] = readdirSync(opts.extraEnv.BLOG_CONTENT_DIR)
    const post = JSON.parse(readFileSync(join(opts.extraEnv.BLOG_CONTENT_DIR, file), 'utf8'))
    mkdirSync(join(opts.outDir, 'posts', post.slug), { recursive: true })
    mkdirSync(join(opts.outDir, '_astro'), { recursive: true })
    writeFileSync(join(opts.outDir, 'index.html'), `<html><head><meta name="robots" content="noindex, nofollow"></head><body>home</body></html>`)
    writeFileSync(join(opts.outDir, 'posts', post.slug, 'index.html'), `<html><body data-guide="${post.guide ? 'yes' : 'no'}">${post.title}</body></html>`)
    writeFileSync(join(opts.outDir, '_astro', 'app.js'), 'console.log(1)')
    return { ms: 12, dist: opts.outDir }
  }
  build.calls = calls
  return build
}

async function seeded({ status = 'awaiting_human', guide = true, interactive } = {}) {
  const store = memoryStore()
  const d = { ...draftAnswer(), brief_id: B, version: 2, brief_version: 1 }
  await store.createRecord({ type: 'brief', briefId: B, payload: brief({ brief_id: B }), status: 'awaiting_human', version: 1 })
  await store.createRecord({ type: 'draft', briefId: B, payload: d, status, version: 2, meta: { brief_version: 1, ...(interactive !== undefined && { interactive }) } })
  if (guide) {
    const parsed = parseParts(bodyMarkdown(GOOD_MD))
    const built = buildGuide(plainPlan(GOOD_MD, d.title), { title: d.title, parsed })
    assert.ok(built.guide, built.problems.join('; '))
    await store.createRecord({ type: 'guide_doc', briefId: B, version: 2, status: 'ok', payload: { brief_id: B, version: 2, brief_version: 1, guide: built.guide, body_sha256: bodyHash(parsed.markdown), created_at: '2026-10-21T10:00:00+05:30' }, meta: { brief_version: 1 } })
  }
  return store
}

const config = (env = {}) => fakeConfig({ M91_CTA_URL: CTA, ...env })
const noFetch = async () => ({ status: 404 })

test('buildPreview: the waiting post alone, with its guide and noindex, built under /preview/<brief_id>/; a manifest is kept', async () => {
  const restore = setSink(() => {})
  const root = mkdtempSync(join(tmpdir(), 'm91-preview-'))
  const store = await seeded()
  const build = fakeBuild()
  const m = await buildPreview({ briefId: B, store, config: config(), root, build, fetch: noFetch })
  restore()
  assert.equal(build.calls.length, 1)
  assert.equal(build.calls[0].extraEnv.BLOG_PREVIEW_BASE, previewBase(B))
  assert.equal(previewBase(B), `/preview/${B}/`)
  assert.equal(build.calls[0].outDir, join(root, B, 'dist'))
  const post = JSON.parse(readFileSync(join(root, B, 'content', `${m.slug}.json`), 'utf8'))
  assert.equal(post.noindex, true, 'a preview is never indexed')
  assert.ok(post.guide && post.guide.chapters.length > 1)
  assert.deepEqual({ ...m, built_at: 'x' }, { brief_id: B, version: 2, status: 'awaiting_human', slug: m.slug, url: `/preview/${B}/posts/${m.slug}/`, guide: true, note: m.note, built_at: 'x', ms: 12, warnings: ['kept the old M91 docs link https://m91.msg91.com/llms.txt: https://m91-api.msg91.com/llms.txt answered 404'] }, 'the link fixes of the Publisher run too')
  assert.match(m.note, /^guide: \d+ chapters/)
  assert.deepEqual(readPreview(B, root), m)
  assert.equal(readPreview('../etc', root), null)
  rmSync(root, { recursive: true, force: true })
})

test('buildPreview: interactive off or no guide → the post as written; no draft → 404; a bad id → 400', async () => {
  const restore = setSink(() => {})
  const root = mkdtempSync(join(tmpdir(), 'm91-preview-'))
  const off = await buildPreview({ briefId: B, store: await seeded({ interactive: false }), config: config(), root, build: fakeBuild(), fetch: noFetch })
  assert.equal(off.guide, false)
  assert.equal(off.note, 'no guide (interactive off)')
  const none = await buildPreview({ briefId: B, store: await seeded({ guide: false }), config: config(), root, build: fakeBuild(), fetch: noFetch })
  assert.equal(none.guide, false)
  await assert.rejects(buildPreview({ briefId: B, store: memoryStore(), config: config(), root, build: fakeBuild() }), (e) => e instanceof PreviewError && e.status === 404)
  await assert.rejects(buildPreview({ briefId: 'nope', store: memoryStore(), config: config(), root, build: fakeBuild() }), (e) => e instanceof PreviewError && e.status === 400)
  restore()
  rmSync(root, { recursive: true, force: true })
})

async function withServer({ env = {}, store, build = fakeBuild(), running = false } = {}, fn) {
  const restore = setSink(() => {})
  const root = mkdtempSync(join(tmpdir(), 'm91-preview-'))
  const cfg = config(env)
  const manager = createRunManager({ config: cfg, storeFactory: () => store, notifierFactory: () => fakeNotifier() })
  if (running) manager.isRunning = () => true
  const server = createServer({ triggerKey: TRIGGER, manager, store, config: cfg, previewRoot: root, previewDeps: { build, fetch: noFetch }, dashboardDir: null })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, headers = {}) => {
    const res = await fetch(base + path, { method, headers })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text, headers: res.headers }
  }
  try {
    await fn({ call, root, build })
  } finally {
    await new Promise((r) => server.close(r))
    rmSync(root, { recursive: true, force: true })
    restore()
  }
}

test('API and serving: POST builds the preview (0 AI), the approval shows it, /preview/<id>/ serves it noindex and same-origin framable', async () => {
  await withServer({ store: await seeded() }, async ({ call }) => {
    assert.equal((await call('GET', `/api/approvals/${B}/preview`)).status, 404)
    assert.equal((await call('GET', `/api/approvals/${B}`)).json.preview, null)
    const built = await call('POST', `/api/approvals/${B}/preview`)
    assert.equal(built.status, 200, built.text)
    assert.equal(built.json.guide, true)
    assert.deepEqual((await call('GET', `/api/approvals/${B}`)).json.preview, built.json)
    const page = await call('GET', built.json.url)
    assert.equal(page.status, 200)
    assert.match(page.text, /data-guide="yes"/)
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow')
    assert.equal(page.headers.get('content-security-policy'), "frame-ancestors 'self'")
    assert.equal(page.headers.get('cache-control'), 'no-store')
    assert.match((await call('GET', `/preview/${B}/`)).text, /home/)
    assert.equal((await call('GET', `/preview/${B}/_astro/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal((await call('GET', `/preview/${B}/posts/nope/`)).status, 404)
    assert.equal((await call('GET', `/preview/${B}/..%2f..%2fpreview.json`)).status, 404, 'no way out of dist')
    assert.equal((await call('GET', `/preview/${B}/../../package.json`)).status, 404)
    assert.equal((await call('POST', '/api/approvals/bad/preview')).status, 400)
  })
})

test('API: 409 while a run is in progress; with DASHBOARD_AUTH=true the preview pages need the session', async () => {
  await withServer({ store: await seeded(), running: true }, async ({ call, build }) => {
    const r = await call('POST', `/api/approvals/${B}/preview`)
    assert.equal(r.status, 409)
    assert.equal(r.json.error.code, 'run_in_progress')
    assert.equal(build.calls.length, 0)
  })
  await withServer({ store: await seeded(), env: { DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'fake-dashboard-pass' } }, async ({ call }) => {
    assert.equal((await call('GET', `/preview/${B}/`)).status, 401)
    assert.equal((await call('POST', `/api/approvals/${B}/preview`)).status, 401)
  })
})
