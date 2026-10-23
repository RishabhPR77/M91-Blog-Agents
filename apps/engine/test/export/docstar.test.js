// The real Docstar transport (2026-10-23) against a fake fetch: create (collection root → page → body → SEO →
// publish), draft only, update (rename, body, SEO, publish), unpublish (back to draft), the body fallback, errors that
// keep the page id, and the key never leaking. No network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDocstar, publishToDocstar, docstarBody, DOCSTAR_TRANSPORT } from '../../src/publisher/docstar.js'
import { fakeConfig, memoryStore } from '../helpers.js'

const KEY = 'hm_secret_token_123'
const cfg = fakeConfig({ DOCSTAR_API_URL: 'https://api.docstar.example/', DOCSTAR_API_KEY: KEY, DOCSTAR_COLLECTION_ID: 'COL000000001', DOCSTAR_ORG_ID: '42' })

/** A fake Docstar: answers by "METHOD path"; records every call (method, path, body, auth header). */
function fakeDocstar(over = {}) {
  const calls = []
  const answers = {
    'GET /orgs/42/collections': { status: 200, body: [{ id: 'OTHER0000001', name: 'Other', 'pages.rootParentId': 'ROOTOTHER001' }, { id: 'COL000000001', name: 'Test Blog', 'pages.rootParentId': 'ROOT00000001' }] },
    'POST /orgs/42/pages/ROOT00000001': { status: 200, body: { page: { id: 'PAGE00000001', state: 1 }, publicUrl: null } },
    'POST /orgs/42/pages/PAGE00000001/ydoc': { status: 200, body: { success: true } },
    'PUT /orgs/42/pages/PAGE00000001': { status: 200, body: { id: 'PAGE00000001', state: 1 } },
    'PATCH /orgs/42/pages/PAGE00000001/meta': { status: 200, body: { ok: true } },
    'PATCH /orgs/42/pages/PAGE00000001/state': { status: 200, body: { id: 'PAGE00000001', state: 2, isPublished: true, publicUrl: 'https://m91.docstar.example/m91_blogs/how-agent-approval-works' } },
    ...over
  }
  const fetch = async (url, init) => {
    const path = url.replace('https://api.docstar.example', '')
    const key = `${init.method} ${path}`
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization })
    let a = answers[key]
    if (typeof a === 'function') a = a(calls)
    if (!a) return { ok: false, status: 404, text: async () => JSON.stringify({ message: `no route ${key}` }) }
    if (a instanceof Error) throw a
    return { ok: a.status < 400, status: a.status, text: async () => (a.body === undefined ? '' : JSON.stringify(a.body)) }
  }
  return { calls, fetch }
}

const exportRecord = (over = {}) => ({
  id: 'mem-export-1', type: 'markdown_export',
  payload: { brief_id: 'B1', slug: 'how-agent-approval-works', filename: 'how-agent-approval-works.md', title: 'How agent approval works', front_matter: { description: 'A pause before a risky step.', tags: ['agents', 'approval'] }, markdown: '---\ntitle: x\n---\n\n# How agent approval works\n\nA pause before a risky step.\n\n## TL;DR\n\n- One\n', ...over }
})

async function storeWith(rec) {
  const store = memoryStore()
  const made = await store.createRecord({ type: 'markdown_export', briefId: 'B1', payload: rec.payload, status: 'final' })
  return { store, rec: { ...rec, id: made.id, status: 'final' } }
}

test('create: collection root, page as draft, body, SEO, publish; the page id and public URL are saved', async () => {
  const { calls, fetch } = fakeDocstar()
  const docstar = createDocstar({ config: cfg, fetch })
  const { store, rec } = await storeWith(exportRecord())
  const r = await publishToDocstar({ store, docstar, exportRecord: rec })
  assert.equal(r.status, 'published')
  assert.match(r.summary, /^Docstar page created and published: https:\/\/m91\.docstar\.example\//)
  assert.deepEqual(calls.map((c) => c.key), [
    'GET /orgs/42/collections',
    'POST /orgs/42/pages/ROOT00000001',
    'POST /orgs/42/pages/PAGE00000001/ydoc',
    'PATCH /orgs/42/pages/PAGE00000001/meta',
    'PATCH /orgs/42/pages/PAGE00000001/state'
  ])
  assert.ok(calls.every((c) => c.auth === `Bearer ${KEY}`))
  assert.deepEqual(calls[1].body, { name: 'How agent approval works', urlName: 'how-agent-approval-works', state: 1 })
  assert.equal(calls[2].body.content, 'A pause before a risky step.\n\n## TL;DR\n\n- One\n', 'no front matter, no H1')
  assert.deepEqual(calls[3].body, { data: { title: 'How agent approval works', description: 'A pause before a risky step.', tags: ['agents', 'approval'] } })
  assert.deepEqual(calls[4].body, { state: 2 })
  const saved = (await store.getRecords({ type: 'markdown_export' }))[0]
  assert.equal(saved.payload.docstar_page_id, 'PAGE00000001')
  assert.equal(saved.payload.docstar_state, 'published')
  assert.match(saved.payload.docstar_url, /how-agent-approval-works$/)
  assert.equal(saved.status, 'published')
})

test('draft: the page is made and filled but not published (no state call); the export stays final', async () => {
  const { calls, fetch } = fakeDocstar()
  const { store, rec } = await storeWith(exportRecord())
  const r = await publishToDocstar({ store, docstar: createDocstar({ config: cfg, fetch }), exportRecord: rec, draft: true })
  assert.equal(r.status, 'draft')
  assert.equal(r.summary, 'Docstar page created as a draft (not public): PAGE00000001')
  assert.ok(!calls.some((c) => c.key.endsWith('/state')))
  const saved = (await store.getRecords({ type: 'markdown_export' }))[0]
  assert.equal(saved.payload.docstar_state, 'draft')
  assert.equal(saved.payload.docstar_page_id, 'PAGE00000001')
  assert.equal(saved.status, 'final')
})

test('update: a post that has a page is renamed (slug kept), rewritten, SEO set and published again', async () => {
  const { calls, fetch } = fakeDocstar()
  const { store, rec } = await storeWith(exportRecord({ docstar_page_id: 'PAGE00000001' }))
  const r = await publishToDocstar({ store, docstar: createDocstar({ config: cfg, fetch }), exportRecord: rec })
  assert.equal(r.status, 'published')
  assert.match(r.summary, /^Docstar page updated and published/)
  assert.deepEqual(calls.map((c) => c.key), ['PUT /orgs/42/pages/PAGE00000001', 'POST /orgs/42/pages/PAGE00000001/ydoc', 'PATCH /orgs/42/pages/PAGE00000001/meta', 'PATCH /orgs/42/pages/PAGE00000001/state'])
  assert.deepEqual(calls[0].body, { name: 'How agent approval works' }, 'no urlName: links keep working')
})

test('body: when the editor document does not exist yet, the Markdown goes into the page contents instead', async () => {
  const { calls, fetch } = fakeDocstar({ 'POST /orgs/42/pages/PAGE00000001/ydoc': { status: 200, body: { message: 'Document not found' } } })
  const r = await DOCSTAR_TRANSPORT.createPage({ apiUrl: 'https://api.docstar.example', orgId: '42', collectionId: 'COL000000001', headers: { Authorization: `Bearer ${KEY}` }, fetch }, { title: 'T', slug: 'tee', markdown: 'Body', seo_title: 'T', draft: true })
  assert.deepEqual(r.steps, ['create', 'contents', 'meta'])
  assert.deepEqual(calls.find((c) => c.key === 'PUT /orgs/42/pages/PAGE00000001').body, { contents: 'Body' })
  // What Docstar really answers for a new page: HTTP 404 "Document not found in store". Same fallback.
  const real = fakeDocstar({ 'POST /orgs/42/pages/PAGE00000001/ydoc': { status: 404, body: { message: 'Document not found in store' } } })
  const r2 = await DOCSTAR_TRANSPORT.createPage({ apiUrl: 'https://api.docstar.example', orgId: '42', collectionId: 'COL000000001', headers: { Authorization: `Bearer ${KEY}` }, fetch: real.fetch }, { title: 'T', slug: 'tee', markdown: 'Body', seo_title: 'T', draft: true })
  assert.deepEqual(r2.steps, ['create', 'contents', 'meta'])
  // Any other error still stops the publish.
  const other = fakeDocstar({ 'POST /orgs/42/pages/PAGE00000001/ydoc': { status: 500, body: { message: 'boom' } } })
  await assert.rejects(DOCSTAR_TRANSPORT.createPage({ apiUrl: 'https://api.docstar.example', orgId: '42', collectionId: 'COL000000001', headers: {}, fetch: other.fetch }, { title: 'T', slug: 'tee', markdown: 'Body', draft: true }), /HTTP 500 \(boom\)/)
})

test('unpublish: back to draft (state 1), nothing deleted; no page id → no_page', async () => {
  const { calls, fetch } = fakeDocstar({ 'PATCH /orgs/42/pages/PAGE00000001/state': { status: 200, body: { id: 'PAGE00000001', state: 1, isPublished: false } } })
  const docstar = createDocstar({ config: cfg, fetch })
  assert.deepEqual(await docstar.unpublishPage({ page_id: 'PAGE00000001' }), { ok: true, status: 'unpublished', page_id: 'PAGE00000001' })
  assert.deepEqual(calls.map((c) => [c.key, c.body]), [['PATCH /orgs/42/pages/PAGE00000001/state', { state: 1 }]])
  assert.equal((await docstar.unpublishPage({ page_id: null })).status, 'no_page')
  assert.ok(!calls.some((c) => c.key.startsWith('DELETE')))
})

test('errors: a failed publish after the page was made keeps the page id (next try updates, no duplicate); the key never shows', async () => {
  const { fetch } = fakeDocstar({ 'PATCH /orgs/42/pages/PAGE00000001/state': { status: 400, body: { message: `Parent page is not published (${KEY})` } } })
  const { store, rec } = await storeWith(exportRecord())
  const r = await publishToDocstar({ store, docstar: createDocstar({ config: cfg, fetch }), exportRecord: rec })
  assert.equal(r.status, 'error')
  assert.match(r.summary, /HTTP 400 \(Parent page is not published/)
  assert.match(r.summary, /page PAGE00000001 was kept as a draft and is updated on the next try/)
  assert.ok(!r.summary.includes(KEY) && r.summary.includes('hm_s…'))
  assert.ok(!r.summary.includes('42'), 'the org id is not repeated in errors either')
  const saved = (await store.getRecords({ type: 'markdown_export' }))[0]
  assert.equal(saved.payload.docstar_page_id, 'PAGE00000001')
  assert.equal(saved.status, 'final')
  // A wrong collection id: a clear message, nothing created.
  const bad = fakeDocstar({ 'GET /orgs/42/collections': { status: 200, body: [{ id: 'x', 'pages.rootParentId': 'R' }] } })
  const b = await createDocstar({ config: cfg, fetch: bad.fetch }).createPage({ title: 'T', slug: 'tee', markdown: 'x' })
  assert.equal(b.status, 'error')
  assert.match(b.error, /is not in this workspace \(is DOCSTAR_COLLECTION_ID right\?\)/)
  assert.equal(bad.calls.length, 1)
})

test('docstarBody: no front matter and no leading H1; the rest unchanged', () => {
  assert.equal(docstarBody('---\na: 1\n---\n\n# Title\n\nText.\n\n# Not the first\n'), 'Text.\n\n# Not the first\n')
  assert.equal(docstarBody('Text only.\n'), 'Text only.\n')
})
