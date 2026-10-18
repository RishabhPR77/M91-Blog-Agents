import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractLinks, filterDocLinks, htmlToText, buildDocsBundle, fetchSkillReadme, parseRepo, DocsError } from '../../src/scout/docs.js'
import { fakeWeb, LLMS, DOC_INTRO, DOC_API, REPO } from './fixtures.js'

test('extractLinks: markdown and bare links, in order, unique', () => {
  const links = extractLinks('See [A](https://a.com/1) and https://b.com/2. Again [A](https://a.com/1)')
  assert.deepEqual(links, ['https://a.com/1', 'https://b.com/2'])
})

test('filterDocLinks: host allowlist, https forced, fragments dropped', () => {
  const out = filterDocLinks(['http://m91.msg91.com/a#x', 'https://evil.com/b', 'https://M91.msg91.com/c', 'https://m91.msg91.com/a'], ['m91.msg91.com'])
  assert.deepEqual(out, ['https://m91.msg91.com/a', 'https://m91.msg91.com/c'])
})

test('htmlToText strips tags and scripts, decodes entities', () => {
  assert.equal(htmlToText('<h1>A &amp; B</h1><script>x()</script><p>C&#39;s</p>'), "A & B\nC's")
})

test('bundle: llms.txt first, allowed pages only, https, source headers, HTML converted', async () => {
  const web = fakeWeb()
  const b = await buildDocsBundle({ docsUrl: LLMS, hosts: ['m91.msg91.com'], maxPages: 15, maxChars: 150000, fetch: web })
  assert.deepEqual(b.sources, [LLMS, DOC_INTRO, DOC_API])
  assert.ok(!web.calls.includes('https://elsewhere.example.com/x'))
  assert.match(b.bundle, /^=== SOURCE: https:\/\/m91\.msg91\.com\/llms\.txt ===/)
  assert.match(b.bundle, /=== SOURCE: https:\/\/m91\.msg91\.com\/docs\/api\.md ===\nAPI\nPOST \/call/)
  assert.equal(b.pagesFetched, 3)
})

test('bundle: page cap and character cap', async () => {
  const pages = await buildDocsBundle({ docsUrl: LLMS, hosts: ['m91.msg91.com'], maxPages: 2, maxChars: 150000, fetch: fakeWeb() })
  assert.equal(pages.pagesFetched, 2)
  const chars = await buildDocsBundle({ docsUrl: LLMS, hosts: ['m91.msg91.com'], maxPages: 15, maxChars: 60, fetch: fakeWeb() })
  assert.ok(chars.chars <= 60)
  assert.ok(chars.warnings.some((w) => /DOCS_MAX_CHARS/.test(w)))
})

test('bundle: llms.txt failure is a DocsError', async () => {
  await assert.rejects(buildDocsBundle({ docsUrl: LLMS, hosts: ['m91.msg91.com'], maxPages: 15, maxChars: 1000, fetch: fakeWeb({ llmsStatus: 500 }) }), DocsError)
})

test('skill README via the GitHub API, prefixed with the repo source line; failure is a warning', async () => {
  assert.deepEqual(parseRepo(REPO), { owner: 'MSG91', repo: 'm91-skill' })
  const ok = await fetchSkillReadme({ repoUrl: REPO, fetch: fakeWeb() })
  assert.match(ok.text, /^=== SOURCE: https:\/\/github\.com\/MSG91\/m91-skill ===\n# m91-skill/)
  const bad = await fetchSkillReadme({ repoUrl: REPO, fetch: fakeWeb({ readmeStatus: 404 }) })
  assert.equal(bad.text, null)
  assert.match(bad.warning, /404/)
})
