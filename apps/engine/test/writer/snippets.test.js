// Snippet extraction and [[SNIPPET:Sn]] replacement (Phase 5 brief, A1). No network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractSnippets, replaceSnippetTokens, tokeniseSnippets, snippetLanguage, normaliseCode, sourceLabel } from '../../src/writer/snippets.js'

const DOCS = 'https://m91.msg91.com/api/public/quickstart.md'
const API = 'https://m91.msg91.com/api/public/api.md'
const SOURCE = [
  `=== SOURCE: ${DOCS} ===`,
  '# M91 Quickstart',
  'Send one alert.',
  'Run this command:',
  '```sh',
  'curl -X POST "$SEND_LINK" \\',
  '  -d \'{"title":"Test"}\'',
  '```',
  'The answer looks like this:',
  '~~~',
  '{ "status": "ok" }',
  '~~~',
  '',
  'Older docs indent their code:',
  '',
  '    npm run alert',
  '    npm run alert -- --low',
  '',
  '- A list item',
  '',
  '    continued list text, not code',
  `=== SOURCE: ${API} ===`,
  'Same command again:',
  '```bash',
  'curl -X POST "$SEND_LINK" \\',
  '  -d \'{"title":"Test"}\'',
  '```',
  '=== SOURCE: https://github.com/MSG91/m91-skill/blob/main/scripts/m91.sh ===',
  '#!/bin/sh',
  'echo ring'
].join('\n')

test('extraction: fenced (``` and ~~~), indented, and whole code files; ids, languages, source URL, context; duplicates once', () => {
  const { snippets, text } = extractSnippets(SOURCE)
  assert.deepEqual(snippets.map((s) => [s.id, s.language, s.source_url]), [
    ['S1', 'bash', DOCS],
    ['S2', 'json', DOCS],
    ['S3', 'bash', DOCS],
    ['S4', 'bash', 'https://github.com/MSG91/m91-skill/blob/main/scripts/m91.sh']
  ])
  assert.equal(snippets[0].code, 'curl -X POST "$SEND_LINK" \\\n  -d \'{"title":"Test"}\'')
  assert.equal(snippets[0].context, 'Send one alert. Run this command:')
  assert.equal(snippets[0].source_title, 'M91 Quickstart')
  assert.equal(snippets[2].code, 'npm run alert\nnpm run alert -- --low')
  assert.equal(snippets[3].code, '#!/bin/sh\necho ring')
  // The same command on the API page is S1 again, not a new snippet; list text indented after a bullet is not code.
  assert.equal(snippets.filter((s) => s.code.startsWith('curl')).length, 1)
  assert.match(text, /Run this command:\n\[\[SNIPPET:S1\]\]\nThe answer looks like this:\n\[\[SNIPPET:S2\]\]/)
  assert.match(text, /Same command again:\n\[\[SNIPPET:S1\]\]/)
  assert.match(text, /continued list text, not code/)
  assert.deepEqual(extractSnippets('').snippets, [])
})

test('language: fence tag first, then a guess', () => {
  assert.equal(snippetLanguage('shell', 'x'), 'bash')
  assert.equal(snippetLanguage('javascript', 'x'), 'js')
  assert.equal(snippetLanguage('py', 'x'), 'python')
  assert.equal(snippetLanguage('', '{"a":1}'), 'json')
  assert.equal(snippetLanguage('', 'npx skills add x'), 'bash')
  assert.equal(snippetLanguage('', 'from m91 import ring'), 'python')
  assert.equal(snippetLanguage('', 'const a = await ring()'), 'js')
  assert.equal(snippetLanguage('', 'just words'), 'text')
  assert.equal(normaliseCode('\n   a  \n     b\n\n'), 'a\n  b')
})

test('replacement: a token line becomes the exact block plus a source line; unknown ids and inline tokens are errors; tokenise reverses it', () => {
  const { snippets } = extractSnippets(SOURCE)
  const md = 'Intro.\n\nThis sends a test alert.\n\n[[SNIPPET:S1]]\n\nThen [[SNIPPET:S2]] inline.\n\n  [[SNIPPET:S9]]  \n'
  const r = replaceSnippetTokens(md, snippets)
  assert.deepEqual(r.used, ['S1'])
  assert.deepEqual(r.errors, ['[[SNIPPET:S2]] must be alone on its own line', 'unknown snippet id S9 (CODE SNIPPETS has S1, S2, S3, S4)'])
  assert.ok(r.markdown.includes('```bash\ncurl -X POST "$SEND_LINK" \\\n  -d \'{"title":"Test"}\'\n```\n\nSource: [M91 Quickstart](https://m91.msg91.com/api/public/quickstart.md)'))
  assert.equal(tokeniseSnippets(r.markdown, snippets), md)
  assert.equal(sourceLabel({ source_url: 'https://github.com/MSG91/m91-skill/blob/main/scripts/m91.sh' }), 'github.com: scripts/m91.sh')
})
