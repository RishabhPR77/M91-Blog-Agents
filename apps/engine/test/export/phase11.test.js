// Phase 11 (fallback plan): the Markdown export, PUBLISH_TARGET, the empty Docstar adapter and EXPERIENCE_ENABLED=false.
// Fakes only: no AI, no Mem0 service, no network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunManager } from '../../src/runs.js'
import { defaultAgents, runPipeline } from '../../src/orchestrator.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { resetEvents } from '../../src/events.js'
import { setSink } from '../../src/util/log.js'
import { createServer } from '../../src/server.js'
import { buildMarkdownExport, frontMatter, stripHtml } from '../../src/export/markdown.js'
import { previewExport, saveFinalExport, exportableDraft } from '../../src/export/index.js'
import { createDocstar, publishToDocstar, bodyOf, docstarBody } from '../../src/publisher/docstar.js'
import { memoryStore, fakeNotifier, fakeConfig, mockReviewer } from '../helpers.js'
import { NOW, BRIEF_ID, config, brief, draftAnswer, fakeAi, okChecker } from '../writer/fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const now = () => NOW
const recordsOf = (store, type) => [...store.records.values()].filter((r) => r.type === type)
const CTA = config().m91.ctaUrl

/** A brief with a v1 draft; reviewed: 'pass' | 'fail' | null. */
async function seed({ status = 'awaiting_human', reviewed = 'pass', draftOver = {} } = {}) {
  const store = memoryStore()
  await store.createRecord({ type: 'question_cluster', payload: { cluster_id: 'C-1', main_question: 'How does agent approval work?' }, status: 'used' })
  await store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief(), status: 'awaiting_human', version: 1 })
  const d = { ...draftAnswer(), brief_id: BRIEF_ID, version: 1, brief_version: 1, checks: { hard_passed: true, results: [] }, ...draftOver }
  const draft = await store.createRecord({ type: 'draft', briefId: BRIEF_ID, payload: d, status, version: 1, meta: { brief_version: 1, review_total: 88 } })
  if (reviewed) await store.createRecord({ type: 'review', briefId: BRIEF_ID, payload: { brief_id: BRIEF_ID, version: 1, brief_version: 1, pass: reviewed === 'pass', total: reviewed === 'pass' ? 88 : 70, feedback: [] }, status: reviewed, version: 1, meta: { brief_version: 1 } })
  return { store, draft }
}

function manager(store, env = {}) {
  const cfg = config(env)
  return createRunManager({
    config: cfg,
    storeFactory: () => store,
    notifierFactory: () => fakeNotifier(),
    agentsFactory: (rc, { store: st, notifier: nt }) => ({
      ...defaultAgents({ config: rc, store: st, notifier: nt, agentDeps: { aiSend: fakeAi({}), urlChecker: okChecker(), now } }),
      reviewer: mockReviewer(), promo: stubAgents.promo, designer: stubAgents.designer
    })
  })
}
const runWith = async (m, mode, params = {}) => {
  const { run_id } = await m.startRun({ mode, params: { brief_id: BRIEF_ID, ...params } })
  return { run_id, ...(await m.wait(run_id)) }
}

// ---------- the Markdown file ----------

test('the export: YAML front matter, H1, description, TL;DR, the body, sources, the CTA; Markdown only', async () => {
  const { store, draft } = await seed()
  const out = buildMarkdownExport({ draft, brief: brief(), review: { total: 88, pass: true }, briefId: BRIEF_ID, config: config(), now })
  const md = out.markdown
  assert.match(md, /^---\ntitle: ".+"\nslug: "[a-z0-9-]+"\ndescription: ".*"\n/)
  for (const key of ['keyword', 'tags', 'topic', 'brief_id', 'version', 'review_score', 'date']) assert.match(md, new RegExp(`\\n${key}: `), key)
  assert.match(md, /\nreview_score: 88\nreview_passed: true\ndate: "2026-10-18"\n---\n\n# /)
  assert.match(md, new RegExp(`\\nbrief_id: "${BRIEF_ID}"\\nversion: 1\\n`))
  // The title once (H1), the TL;DR as a list, the post's own TL;DR block not repeated.
  assert.equal((md.match(/^# /gm) ?? []).length, 1)
  assert.match(md, /\n## TL;DR\n\n- .+\n- .+\n- .+\n/)
  assert.ok(!/\*\*TL;DR\*\*/.test(md))
  // Plain Markdown: no HTML anywhere, fenced code and tables stay as Markdown.
  assert.ok(!/<\/?[a-z][^>]*>/i.test(md.replace(/```[\s\S]*?```/g, '')), 'no HTML')
  assert.equal(out.filename, `${out.slug}.md`)
  assert.ok(out.body.startsWith('# ') && !out.body.startsWith('---'))
  // The call to action links M91_CTA_URL; building the file saves nothing.
  assert.ok(md.includes(CTA))
  assert.equal(recordsOf(store, 'markdown_export').length, 0)
})

test('raw HTML in the body is removed (code untouched); an existing Sources section or CTA link is not repeated', () => {
  const s = stripHtml('Text <b>bold</b> and <div class="x">box</div>.\n\n```html\n<b>kept in code</b>\n```\n\nInline `<br>` stays.')
  assert.equal(s.removed, 4)
  assert.match(s.text, /^Text bold and box\./)
  assert.match(s.text, /<b>kept in code<\/b>/)
  assert.match(s.text, /Inline `<br>` stays\./)
  const draft = { version: 2, metadata: { brief_version: 1 }, payload: { title: 'A title', tldr: ['a', 'b', 'c'], seo: { meta_description: 'Desc.' }, post_markdown: `# A title\n\nBody with a [source](https://example.com/a) and <span>tag</span>.\n\n## Sources\n\n1. [x](https://example.com/a)\n\n[Try M91](${CTA})` } }
  const out = buildMarkdownExport({ draft, brief: { topic_group: 2, keyword: 'k' }, briefId: BRIEF_ID, config: config(), now })
  assert.equal((out.markdown.match(/^## Sources$/gm) ?? []).length, 1)
  assert.ok(!out.markdown.includes('## Try M91'), 'the body already links the CTA')
  assert.ok(out.warnings.some((w) => /removed 2 raw HTML tags/.test(w)))
  assert.match(out.markdown, /\ntopic: "Fintech"\n/)
  assert.match(frontMatter({ a: 'x "q"', b: [1, 'two'], c: null }), /^---\na: "x \\"q\\""\nb: \[1, "two"\]\nc: null\n---\n$/)
})

test('which draft: the newest reviewed one (or approved/published); none → 409 not_reviewed; unknown → 404', async () => {
  const a = await seed({ reviewed: null })
  await assert.rejects(exportableDraft(a.store, BRIEF_ID), (e) => e.code === 'not_reviewed' && e.status === 409)
  await assert.rejects(exportableDraft(a.store, '261018-1400-NONE'), (e) => e.code === 'unknown_brief' && e.status === 404)
  const b = await seed({ reviewed: null, status: 'approved' })
  assert.equal((await exportableDraft(b.store, BRIEF_ID)).draft.id, b.draft.id)
  const c = await seed()
  const p = await previewExport({ store: c.store, config: config(), briefId: BRIEF_ID, now })
  assert.equal(p.version, 1)
  assert.equal(recordsOf(c.store, 'markdown_export').length, 0, 'a preview saves nothing')
})

test('the final export: one markdown_export record per brief (a second save replaces it) and the file on disk', async () => {
  const { store } = await seed({ status: 'approved' })
  const dir = mkdtempSync(join(tmpdir(), 'm91-export-'))
  const first = await saveFinalExport({ store, config: config(), briefId: BRIEF_ID, now, dir })
  assert.ok(existsSync(first.path))
  assert.equal(readFileSync(first.path, 'utf8'), first.markdown)
  const second = await saveFinalExport({ store, config: config(), briefId: BRIEF_ID, now, dir })
  assert.equal(second.replaced, true)
  const recs = recordsOf(store, 'markdown_export')
  assert.equal(recs.length, 1)
  assert.equal(recs[0].status, 'final')
  assert.equal(recs[0].payload.filename, first.filename)
})

// ---------- approve, PUBLISH_TARGET ----------

test('approve with PUBLISH_TARGET=none: the export is saved, the Publisher step says publishing is off, 0 AI calls', async () => {
  const restore = quiet()
  const { store } = await seed()
  const r = await runWith(manager(store, { PUBLISH_TARGET: 'none', AUTO_PUBLISH: 'true' }), 'approve')
  restore()
  assert.equal(r.status, 'succeeded', r.error)
  assert.deepEqual(r.run.steps.map((x) => x.name), ['promo', 'export', 'publisher'])
  assert.match(r.run.steps[1].summary, /^Markdown export saved: [a-z0-9-]+\.md/)
  assert.equal(r.run.steps[2].summary, 'Publishing is off (PUBLISH_TARGET=none): the Markdown export is the output')
  assert.equal(recordsOf(store, 'markdown_export').length, 1)
  assert.equal(recordsOf(store, 'published_post').length, 0)
})

test('PUBLISH_TARGET decides the publish modes: none refuses all (409), docstar only publish/unpublish', async () => {
  const restore = quiet()
  const { store } = await seed({ status: 'approved' })
  const none = manager(store, { PUBLISH_TARGET: 'none' })
  for (const [mode, params] of [['publish', {}], ['unpublish', { slug: 'x' }], ['set_index', { slug: 'x', noindex: true }], ['rebuild_blog', {}]]) {
    await assert.rejects(none.startRun({ mode, params: { brief_id: BRIEF_ID, ...params } }), (e) => e.code === 'publishing_off' && e.status === 409, mode)
  }
  const ds = manager(store, { PUBLISH_TARGET: 'docstar' })
  await assert.rejects(ds.startRun({ mode: 'rebuild_blog', params: {} }), (e) => e.code === 'not_supported')
  await assert.rejects(ds.startRun({ mode: 'publish', params: { brief_id: BRIEF_ID } }), (e) => e.code === 'no_export', 'publish needs the final export first')
  // With the export saved, a Docstar publish runs and answers "not configured" (nothing sent).
  await saveFinalExport({ store, config: config(), briefId: BRIEF_ID, now })
  const r = await runWith(ds, 'publish')
  restore()
  assert.equal(r.status, 'succeeded')
  assert.match(r.run.result_summary, /^Docstar: Docstar is not configured: set DOCSTAR_API_URL, DOCSTAR_API_KEY, DOCSTAR_COLLECTION_ID, DOCSTAR_ORG_ID in \.env/)
})

test('export mode: preview (nothing saved) or --save (record + file); 0 AI calls', async () => {
  const restore = quiet()
  const { store } = await seed()
  const m = manager(store)
  const a = await runWith(m, 'export')
  assert.match(a.run.result_summary, /^Markdown export built \(not saved\): [a-z0-9-]+\.md$/)
  assert.equal(recordsOf(store, 'markdown_export').length, 0)
  const b = await runWith(m, 'export', { save: true })
  restore()
  assert.match(b.run.result_summary, /^Markdown export saved: .+\.md$/)
  assert.equal(recordsOf(store, 'markdown_export').length, 1)
  await assert.rejects(m.startRun({ mode: 'export', params: { brief_id: BRIEF_ID, save: 'yes' } }), (e) => e.code === 'bad_params')
})

// ---------- Docstar ----------

test('Docstar: "not configured" until the four keys are set (nothing sent)', async () => {
  const off = createDocstar({ config: fakeConfig() })
  assert.equal(off.configured, false)
  assert.deepEqual(off.missing, ['DOCSTAR_API_URL', 'DOCSTAR_API_KEY', 'DOCSTAR_COLLECTION_ID', 'DOCSTAR_ORG_ID'])
  for (const op of ['createPage', 'updatePage', 'unpublishPage']) assert.equal((await off[op]({})).status, 'not_configured', op)
  const on = createDocstar({ config: fakeConfig({ DOCSTAR_API_URL: 'https://docstar.example/api', DOCSTAR_API_KEY: 'hm_secret_token', DOCSTAR_COLLECTION_ID: 'col-1', DOCSTAR_ORG_ID: '123' }), fetch: async () => { throw new Error('no network in tests') } })
  assert.equal(on.configured, true)
})

test('Docstar with a fake transport: create, update and unpublish get the right input; the token never leaks', async () => {
  const calls = []
  const transport = {
    async createPage(ctx, input) { calls.push(['create', ctx, input]); return { ok: true, status: 'created', page_id: 'p1', url: 'https://docs.example/p1' } },
    async updatePage(ctx, input) { calls.push(['update', ctx, input]); return { ok: true, status: 'updated', page_id: input.page_id } },
    async unpublishPage(ctx, input) { calls.push(['unpublish', ctx, input]); throw new Error('failed with hm_secret_token') }
  }
  const cfg = fakeConfig({ DOCSTAR_API_URL: 'https://docstar.example/api', DOCSTAR_API_KEY: 'hm_secret_token', DOCSTAR_COLLECTION_ID: 'col-1', DOCSTAR_ORG_ID: '123' })
  const docstar = createDocstar({ config: cfg, transport })
  const { store } = await seed({ status: 'approved' })
  await saveFinalExport({ store, config: config(), briefId: BRIEF_ID, now })
  const rec = recordsOf(store, 'markdown_export')[0]
  const first = await publishToDocstar({ store, docstar, exportRecord: rec })
  assert.equal(first.status, 'published')
  assert.equal(calls[0][0], 'create')
  assert.deepEqual(calls[0][1].headers, { Authorization: 'Bearer hm_secret_token', 'Content-Type': 'application/json' })
  assert.equal(calls[0][1].collectionId, 'col-1')
  assert.ok(!calls[0][2].markdown.startsWith('---') && !calls[0][2].markdown.startsWith('# '), 'Docstar gets the file without its front matter and its H1 (the page name is the title)')
  assert.equal(calls[0][2].markdown, docstarBody(rec.payload.markdown))
  assert.ok(bodyOf(rec.payload.markdown).startsWith('# '))
  const saved = recordsOf(store, 'markdown_export')[0]
  assert.equal(saved.payload.docstar_page_id, 'p1')
  await publishToDocstar({ store, docstar, exportRecord: saved })
  assert.equal(calls[1][0], 'update')
  assert.equal(calls[1][2].page_id, 'p1')
  const u = await docstar.unpublishPage({ page_id: 'p1' })
  assert.equal(u.status, 'error')
  assert.ok(!u.error.includes('hm_secret_token') && u.error.includes('hm_s…'))
})

// ---------- EXPERIENCE_ENABLED=false ----------

test('EXPERIENCE_ENABLED=false: a full run has no Experience Designer step; "Change the design" and the designer mode answer 409', async () => {
  const restore = quiet()
  let designed = 0
  const agents = { ...stubAgents, reviewer: mockReviewer(), designer: async (...a) => { designed++; return stubAgents.designer(...a) } }
  const r = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true', EXPERIENCE_ENABLED: 'false' }), store: memoryStore(), notifier: fakeNotifier(), agents })
  assert.equal(r.state, 'awaiting_human')
  assert.equal(designed, 0)
  assert.ok(!r.steps.some((s) => s.agent === 'designer'))
  const on = await runPipeline({ config: fakeConfig({ DRY_RUN: 'true' }), store: memoryStore(), notifier: fakeNotifier(), agents })
  assert.ok(on.steps.some((s) => s.agent === 'designer'), 'with the switch on it runs as in Phase 10')
  const { store } = await seed()
  const m = manager(store, { EXPERIENCE_ENABLED: 'false' })
  await assert.rejects(m.startRun({ mode: 'human_revise', params: { brief_id: BRIEF_ID, feedback: 'Make the steps clearer.', target: 'design' } }), (e) => e.code === 'experience_off' && e.status === 409)
  await assert.rejects(m.startRun({ mode: 'designer', params: { brief_id: BRIEF_ID } }), (e) => e.code === 'experience_off' && e.status === 409)
  restore()
})

// ---------- API ----------

async function withApi(env, store, fn) {
  const restoreLog = setSink(() => {})
  const cfg = config(env)
  const m = createRunManager({ config: cfg, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager: m, store, config: cfg })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base, m)
  } finally {
    await new Promise((r) => server.close(r))
    restoreLog()
  }
}

test('API: the Markdown preview (JSON, .md, download), the exports list and file, settings; no page preview without the blog', async () => {
  const { store } = await seed()
  await withApi({ PUBLISH_TARGET: 'none', EXPERIENCE_ENABLED: 'false' }, store, async (base, m) => {
    const j = await (await fetch(`${base}/api/approvals/${BRIEF_ID}/markdown`)).json()
    assert.equal(j.version, 1)
    assert.match(j.markdown, /^---\ntitle: /)
    const md = await fetch(`${base}/api/approvals/${BRIEF_ID}/markdown?format=md&download=1`)
    assert.equal(md.headers.get('content-type'), 'text/markdown; charset=utf-8')
    assert.match(md.headers.get('content-disposition'), /^attachment; filename="[a-z0-9-]+\.md"$/)
    assert.equal(await md.text(), j.markdown)
    assert.equal((await fetch(`${base}/api/exports/${BRIEF_ID}`)).status, 404)
    assert.deepEqual(await (await fetch(`${base}/api/exports`)).json(), { exports: [] })
    await saveFinalExport({ store, config: config(), briefId: BRIEF_ID, now })
    const list = (await (await fetch(`${base}/api/exports`)).json()).exports
    assert.equal(list.length, 1)
    assert.equal(list[0].brief_id, BRIEF_ID)
    assert.ok(!('markdown' in list[0]), 'the list has no file text')
    const one = (await (await fetch(`${base}/api/exports/${BRIEF_ID}`)).json()).export
    assert.match(one.markdown, /^---\n/)
    const dl = await fetch(`${base}/api/exports/${BRIEF_ID}/download`)
    assert.match(dl.headers.get('content-disposition'), /^attachment;/)
    const pv = await fetch(`${base}/api/approvals/${BRIEF_ID}/preview`, { method: 'POST' })
    assert.equal(pv.status, 409)
    assert.equal((await pv.json()).error.code, 'preview_off')
    const s = await (await fetch(`${base}/api/settings`)).json()
    assert.deepEqual(s.publish, { target: 'none', docstar_configured: false, auto_publish: false })
    assert.equal(s.designer.enabled, false)
    assert.ok(s.built_modes.includes('export'))
  })
})

test('Docstar runs: params.draft must be true or false; unpublish needs a slug and finds the page by the export\'s slug', async () => {
  const restore = quiet()
  const { store } = await seed({ status: 'approved' })
  await saveFinalExport({ store, config: config(), briefId: BRIEF_ID, now })
  const ds = manager(store, { PUBLISH_TARGET: 'docstar' })
  await assert.rejects(ds.startRun({ mode: 'publish', params: { brief_id: BRIEF_ID, draft: 'yes' } }), (e) => e.code === 'bad_params' && /params\.draft/.test(e.message))
  await assert.rejects(ds.startRun({ mode: 'unpublish', params: {} }), (e) => e.code === 'bad_params' && /needs params\.slug/.test(e.message))
  // Not configured: the draft publish and the unpublish both run and send nothing.
  const d = await runWith(ds, 'publish', { draft: true })
  assert.equal(d.status, 'succeeded')
  assert.match(d.run.result_summary, /^Docstar: Docstar is not configured/)
  const slug = recordsOf(store, 'markdown_export')[0].payload.slug
  const u = await runWith(ds, 'unpublish', { slug, brief_id: undefined })
  restore()
  assert.equal(u.status, 'succeeded')
  assert.match(u.run.result_summary, /^Docstar: Docstar is not configured/)
})
