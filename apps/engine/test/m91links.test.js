// No M91 docs links in posts: the rule, the automatic fix (Writer and export), the hard check, the allowed URLs,
// the Writer's warnings and the re-export of approved posts. Fakes and a memory store only.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { docsLinkRule, stripDocsLinks, docsLinksIn, isDocsFix, M91_SITE_URL } from '../src/util/m91links.js'
import { runContentChecks, urlKey } from '../src/checks/content.js'
import { allowedUrlSet } from '../src/writer/inputs.js'
import { runWriter } from '../src/writer/index.js'
import { buildMarkdownExport } from '../src/export/markdown.js'
import { reexportApproved } from '../src/export/index.js'
import { resetEvents } from '../src/events.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, fakeNotifier, memoryStore } from './helpers.js'
import { NOW, BRIEF_ID, CTA, ISSUE, LLMS, REPO, SCRIPT, config, brief, seededStore, draftAnswer, fakeAi, okChecker } from './writer/fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const cfg = config()
const SITE = 'https://m91.msg91.com/'

test('the rule: docs hosts, docs pages on the main site and the skill repo are docs; the home page, the CTA and outside pages are not', () => {
  const { isDocs, siteUrl } = docsLinkRule(cfg)
  assert.equal(siteUrl, SITE)
  assert.equal(M91_SITE_URL, SITE)
  for (const u of ['https://m91-api.msg91.com/llms.txt', 'https://m91-api.msg91.com/api/public/quickstart.md', 'https://m91-api.msg91.com/', 'http://m91-api.msg91.com/x',
    LLMS, 'https://m91.msg91.com/api/public/api.md', 'https://m91.msg91.com/docs.html', 'https://m91.msg91.com/quickstart', 'https://m91.msg91.com/pricing',
    REPO, SCRIPT, 'https://github.com/msg91/M91-Skill/tree/main']) assert.equal(isDocs(u), true, u)
  for (const u of [SITE, 'https://m91.msg91.com', CTA, `${CTA}/`, ISSUE, 'https://github.com/MSG91/other-repo', 'https://github.com/MSG91/m91-skill-fork', 'https://example.com/llms.txt', 'mailto:x@y.z', 'not a url']) assert.equal(isDocs(u), false, u)
  // A CTA that is itself a docs page is not let through.
  assert.equal(docsLinkRule(fakeConfig({ M91_CTA_URL: 'https://m91.msg91.com/quickstart' })).isDocs('https://m91.msg91.com/quickstart'), true)
})

test('stripDocsLinks: docs links → the main site (text kept); bare URLs too; code untouched; Source lines and Sources items go', () => {
  const md = [
    '# T', '',
    `M91 rings the phone, as [the M91 docs](${LLMS}) say. See [the quickstart](https://m91-api.msg91.com/api/public/quickstart.md) and ${LLMS}.`,
    `Read [a real report](${ISSUE}). Call \`https://m91-api.msg91.com/api/v1/alerts\` from your code.`, '',
    '```bash', 'curl -X POST https://m91-api.msg91.com/api/v1/alerts', '```', '',
    `Source: [M91 Quickstart](https://m91-api.msg91.com/api/public/quickstart.md)`, '',
    '## Sources', '',
    `1. [M91 docs](${LLMS})`, `2. [A real report](${ISSUE})`, `3. [The same report](${ISSUE}/)`, `4. [Skill](${REPO})`, '',
    '## What to do next', '', `[Try M91](${CTA})`
  ].join('\n')
  const r = stripDocsLinks(md, cfg)
  assert.ok(r.markdown.includes(`as [the M91 docs](${SITE}) say. See [the quickstart](${SITE}) and ${SITE}.`), r.markdown)
  assert.ok(r.markdown.includes('`https://m91-api.msg91.com/api/v1/alerts`'), 'inline code is kept')
  assert.ok(r.markdown.includes('```bash\ncurl -X POST https://m91-api.msg91.com/api/v1/alerts\n```'), 'fenced code is kept')
  assert.ok(!r.markdown.includes('Source: '))
  assert.ok(r.markdown.includes(`## Sources\n\n2. [A real report](${ISSUE})\n\n## What to do next`), r.markdown)
  assert.ok(r.markdown.includes(`[Try M91](${CTA})`), 'the CTA stays')
  assert.deepEqual(r.fixes, [`docs links: rewrote 3 M91 docs links to ${SITE}`, 'docs links: removed 1 docs "Source:" line under code', 'docs links: dropped 3 docs or duplicate Sources items'])
  assert.ok(r.fixes.every(isDocsFix))
  assert.deepEqual(docsLinksIn(r.markdown, cfg), [])
  assert.deepEqual(docsLinksIn(md, cfg).slice(0, 2), [LLMS, 'https://m91-api.msg91.com/api/public/quickstart.md'])
  assert.deepEqual(stripDocsLinks(`Plain [report](${ISSUE}).`, cfg), { markdown: `Plain [report](${ISSUE}).`, fixes: [] })
})

test('hard check no_docs_links: a docs link fails it; the main site and links in code pass', () => {
  const run = (md) => runContentChecks({ draft: { title: 'T', post_markdown: md, tldr: [] }, brief: {}, config: cfg, allowedUrls: new Set([SITE, LLMS, CTA].map(urlKey)) }).results.find((x) => x.id === 'no_docs_links')
  const bad = run(`# T\n\nSee [the docs](${LLMS}).`)
  assert.deepEqual([bad.passed, bad.severity, bad.value], [false, 'hard', 1])
  assert.match(bad.detail, /links to M91's docs \(use https:\/\/m91\.msg91\.com\/\): https:\/\/m91\.msg91\.com\/llms\.txt/)
  assert.equal(run(`# T\n\nSee [M91](${SITE}).\n\n\`\`\`\n${LLMS}\n\`\`\``).passed, true)
})

test('allowed URLs: docs URLs are out, the main site and the CTA are in; outside sources stay', () => {
  const b = { sources: [{ url: ISSUE }, { url: 'https://m91-api.msg91.com/api/public/api.md' }], m91_facts_to_use: [{ source_url: LLMS }], tutorial: { steps: [{ source_url: SCRIPT }] } }
  const { list } = allowedUrlSet(b, { ctaUrl: CTA, snippets: [{ source_url: REPO }], config: cfg })
  assert.deepEqual(list, [ISSUE, CTA, SITE])
  assert.ok(allowedUrlSet(b, { ctaUrl: CTA }).list.includes(LLMS), 'without config (old callers): unchanged')
})

test('Writer: the docs link in the answer becomes the main site before the checks, and the change is in the warnings', async () => {
  const restore = quiet()
  const store = await seededStore()
  const ai = fakeAi()
  const r = await runWriter({ mode: 'new', briefId: BRIEF_ID, runId: 'R-1' }, { config: cfg, store, notifier: fakeNotifier(), aiSend: ai, urlChecker: okChecker(), now: () => NOW })
  restore()
  const saved = [...store.records.values()].find((x) => x.type === 'draft').payload
  assert.ok(!saved.post_markdown.includes(LLMS))
  assert.ok(saved.post_markdown.includes(`[M91 docs](${SITE})`))
  assert.ok(r.warnings.includes(`docs links: rewrote 1 M91 docs link to ${SITE}`), JSON.stringify(r.warnings))
  assert.equal(saved.checks.results.find((x) => x.id === 'no_docs_links').passed, true)
  assert.ok(!/llms\.txt/.test(ai.requests[0].message.split('--- ALLOWED URLS ---\n')[1].split('\n--- ')[0]), 'the Writer may not link the docs')
  assert.match(ai.requests[0].prompt, /link the word "M91" to https:\/\/m91\.msg91\.com\/, once or twice in the post/)
})

const approvedStore = async ({ md = draftAnswer().post_markdown } = {}) => {
  const store = memoryStore()
  await store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief(), status: 'approved', version: 1 })
  await store.createRecord({ type: 'draft', briefId: BRIEF_ID, payload: { ...draftAnswer({ post_markdown: md }), brief_id: BRIEF_ID, version: 1, brief_version: 1 }, status: 'superseded', version: 1, meta: { brief_version: 1 } })
  await store.createRecord({ type: 'draft', briefId: BRIEF_ID, payload: { ...draftAnswer({ post_markdown: md }), brief_id: BRIEF_ID, version: 2, brief_version: 1 }, status: 'approved', version: 2, meta: { brief_version: 1 } })
  return store
}

test('the export: docs links → the main site, the Sources list has neither docs links nor the main site, warnings say so', async () => {
  const store = await approvedStore()
  const draft = [...store.records.values()].find((x) => x.type === 'draft' && x.status === 'approved')
  const out = buildMarkdownExport({ draft, brief: brief(), briefId: BRIEF_ID, config: cfg, now: () => NOW })
  assert.ok(!out.markdown.includes(LLMS))
  assert.deepEqual(out.docs_links, [])
  assert.ok(out.warnings.includes(`docs links: rewrote 1 M91 docs link to ${SITE}`), JSON.stringify(out.warnings))
  const sources = out.body.split('## Sources\n\n')[1].split('\n\n')[0].trim()
  assert.equal(sources, `1. [one framework handles it](${ISSUE})`)
})

test('reexportApproved: the newest approved draft of each brief is exported again (record + file), 0 AI calls', async () => {
  const store = await approvedStore()
  const dir = mkdtempSync(join(tmpdir(), 'm91-reexport-'))
  const r = await reexportApproved({ store, config: cfg, now: () => NOW, dir })
  assert.equal(r.failed.length, 0)
  assert.deepEqual(r.exported.map((x) => [x.brief_id, x.version, x.replaced]), [[BRIEF_ID, 2, false]])
  const file = readFileSync(r.exported[0].path, 'utf8')
  assert.ok(!file.includes(LLMS) && file.includes(`[M91 docs](${SITE})`))
  const again = await reexportApproved({ store, config: cfg, now: () => NOW, dir })
  assert.equal(again.exported[0].replaced, true, 'one record per brief, replaced')
  assert.equal([...store.records.values()].filter((x) => x.type === 'markdown_export').length, 1)
  assert.deepEqual(await reexportApproved({ store: memoryStore(), config: cfg, dir }), { exported: [], failed: [] })
})

test('run mode export with all_approved: one run re-exports every approved post (npm run export -- --all-approved)', async () => {
  const restore = quiet()
  const { createRunManager } = await import('../src/runs.js')
  const { stubAgents } = await import('../src/agents/stubs.js')
  const store = await approvedStore()
  const dir = mkdtempSync(join(tmpdir(), 'm91-reexport-run-'))
  const m = createRunManager({ config: config({ EXPORT_DIR: dir, DRY_RUN: 'false' }), storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const { run_id } = await m.startRun({ mode: 'export', params: { all_approved: true } })
  const done = await m.wait(run_id)
  restore()
  assert.equal(done.status, 'succeeded', JSON.stringify(done))
  assert.match(done.run.result_summary, /^Re-exported 1 approved post$/)
  assert.ok(done.run.warnings.some((w) => /docs links: rewrote 1 M91 docs link/.test(w)), JSON.stringify(done.run.warnings))
  await assert.rejects(m.startRun({ mode: 'export', params: { all_approved: 'yes' } }), /all_approved must be true/)
})
