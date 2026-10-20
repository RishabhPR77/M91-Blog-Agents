// The M91 docs moved to m91-api.msg91.com (2026-10-20); old drafts still cite m91.msg91.com. Both hosts are
// M91 docs hosts by default: the Scout fetches from both, the Writer fixes and fetches both, and the Reviewer
// and the content checks accept links on both (from the brief's allowed URLs). No network, no AI, no Mem0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../src/config.js'
import { filterDocLinks, buildDocsBundle } from '../src/scout/docs.js'
import { normaliseUrl } from '../src/scout/checks.js'
import { autoFixDraft } from '../src/writer/index.js'
import { allowedUrlSet, fetchSourcePages } from '../src/writer/inputs.js'
import { fakeConfig, fakeEnv } from './helpers.js'

const NEW = 'https://m91-api.msg91.com'
const OLD = 'https://m91.msg91.com'
const page = (text, type = 'text/markdown') => new Response(text, { status: 200, headers: { 'content-type': type } })

test('defaults: M91_DOCS_URL is on m91-api.msg91.com, M91_DOCS_HOSTS lists both hosts', () => {
  const c = loadConfig(fakeEnv())
  assert.equal(c.m91.docsUrl, `${NEW}/llms.txt`)
  assert.deepEqual(c.scout.docsHosts, ['m91-api.msg91.com', 'm91.msg91.com'])
})

test('Scout: doc links and the bundle accept both hosts; other hosts are skipped', async () => {
  const hosts = fakeConfig().scout.docsHosts
  assert.deepEqual(filterDocLinks([`${NEW}/api/public/quickstart.md`, `${OLD}/docs/a.md`, 'https://evil.example.com/x'], hosts), [`${NEW}/api/public/quickstart.md`, `${OLD}/docs/a.md`])
  assert.equal(normaliseUrl('http://m91-api.msg91.com/api/public/api.md', hosts), `${NEW}/api/public/api.md`)
  const calls = []
  const fetch = async (url) => {
    calls.push(url)
    if (url === `${NEW}/llms.txt`) return page(`# M91\n- [Quickstart](${NEW}/api/public/quickstart.md)\n- [Old](${OLD}/docs/old.md)\n- [Elsewhere](https://evil.example.com/x)`, 'text/plain')
    return page(`page ${url}`)
  }
  const b = await buildDocsBundle({ docsUrl: `${NEW}/llms.txt`, hosts, maxPages: 15, maxChars: 150000, fetch })
  assert.deepEqual(b.sources, [`${NEW}/llms.txt`, `${NEW}/api/public/quickstart.md`, `${OLD}/docs/old.md`])
  assert.ok(!calls.includes('https://evil.example.com/x'))
})

test('Writer: http → https on both hosts; cited pages on both hosts are fetched; other hosts are not', async () => {
  const config = fakeConfig({ M91_CTA_URL: `${OLD}/signup` })
  const draft = { post_markdown: `# T\n\nSee [a](http://m91-api.msg91.com/api/public/fields.md) and [b](http://m91.msg91.com/docs/a.md).\n\n## What to do next\n\n[Try M91](${OLD}/signup)` }
  autoFixDraft(draft, { config, brief: { cta: { url: `${OLD}/signup` } } })
  assert.ok(draft.post_markdown.includes(`(${NEW}/api/public/fields.md)`) && draft.post_markdown.includes(`(${OLD}/docs/a.md)`))
  assert.ok(!draft.post_markdown.includes('http://'))
  const fetched = []
  const fetch = async (url) => { fetched.push(url); return page(`text of ${url}`) }
  const r = await fetchSourcePages([`${NEW}/api/public/fields.md`, `${OLD}/docs/a.md`, 'https://evil.example.com/x'], { config, fetch })
  assert.deepEqual(fetched, [`${NEW}/api/public/fields.md`, `${OLD}/docs/a.md`])
  assert.deepEqual(r.urls, [`${NEW}/api/public/fields.md`, `${OLD}/docs/a.md`])
})

test('Writer and Reviewer allowed URLs: sources on both hosts are allowed (the Reviewer uses the same set)', () => {
  const brief = { sources: [{ url: `${NEW}/api/public/api.md` }, { url: `${OLD}/docs/a.md` }], m91_facts_to_use: [{ source_url: `${NEW}/llms.txt` }] }
  const { list } = allowedUrlSet(brief, { ctaUrl: `${OLD}/signup` })
  assert.deepEqual(list, [`${NEW}/api/public/api.md`, `${OLD}/docs/a.md`, `${NEW}/llms.txt`, `${OLD}/signup`])
})
