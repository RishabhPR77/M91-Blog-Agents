// Snippet extraction and [[SNIPPET:Sn]] replacement (Phase 5 brief, A1). No network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractSnippets, replaceSnippetTokens, tokeniseSnippets, snippetLanguage, normaliseCode, sourceLabel, snippetSection } from '../../src/writer/snippets.js'

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

test('replacement: a token line becomes the exact block (no source line: posts never link the docs); unknown ids and inline tokens are errors; tokenise reverses it', () => {
  const { snippets } = extractSnippets(SOURCE)
  const md = 'Intro.\n\nThis sends a test alert.\n\n[[SNIPPET:S1]]\n\nThen [[SNIPPET:S2]] inline.\n\n  [[SNIPPET:S9]]  \n'
  const r = replaceSnippetTokens(md, snippets)
  assert.deepEqual(r.used, ['S1'])
  assert.deepEqual(r.errors, ['[[SNIPPET:S2]] must be alone on its own line', 'unknown snippet id S9 (CODE SNIPPETS has S1, S2, S3, S4)'])
  assert.ok(r.markdown.includes('```bash\ncurl -X POST "$SEND_LINK" \\\n  -d \'{"title":"Test"}\'\n```\n\nThen'))
  assert.ok(!r.markdown.includes('Source:'))
  assert.equal(tokeniseSnippets(r.markdown, snippets), md)
  // A draft written before the rule (block + docs source line) still tokenises.
  const legacy = r.markdown.replace('```\n\nThen', '```\n\nSource: [M91 Quickstart](https://m91.msg91.com/api/public/quickstart.md)\n\nThen')
  assert.equal(tokeniseSnippets(legacy, snippets), md)
  assert.equal(sourceLabel({ source_url: 'https://github.com/MSG91/m91-skill/blob/main/scripts/m91.sh' }), 'github.com: scripts/m91.sh')
})

const SCRIPT_URL = 'https://github.com/MSG91/m91-skill/blob/main/scripts/m91.sh'
const SCRIPT = [
  '#!/usr/bin/env bash',
  '#',
  '# Raise and close M91 alerts.',
  '#',
  '#   ./m91.sh check',
  '#   ./m91.sh send --title "..." [--severity HIGH]',
  '#                 [--custom-id x] [--auto-close]',
  '#',
  '# Usage: m91.sh close --custom-id x',
  'set -uo pipefail',
  'echo done'
].join('\n')

test('usage snippets from # comments: calls of the script (with continuation lines) and "Usage:" lines, marker removed', () => {
  const { snippets } = extractSnippets(`=== SOURCE: ${SCRIPT_URL} ===\n${SCRIPT}`)
  assert.deepEqual(snippets.map((s) => [s.id, s.kind]), [['S1', 'file'], ['S2', 'usage_from_comment'], ['S3', 'usage_from_comment'], ['S4', 'usage_from_comment']])
  assert.equal(snippets[1].code, './m91.sh check')
  assert.equal(snippets[2].code, './m91.sh send --title "..." [--severity HIGH]\n              [--custom-id x] [--auto-close]')
  assert.equal(snippets[3].code, 'm91.sh close --custom-id x')
  assert.ok(snippets.every((s) => s.source_url === SCRIPT_URL))
  assert.match(snippets[1].context, /usage from a comment in m91\.sh \(line 5\)/)
})

test('usage snippets from // comments (a JS file), including an "Example:" section', () => {
  const js = ['// Send one alert.', '// Example:', '//   node alert.js --title "Deploy?"', '//   node alert.js --close x', '//', 'const a = 1'].join('\n')
  const { snippets } = extractSnippets(`=== SOURCE: https://github.com/MSG91/m91-skill/blob/main/scripts/alert.js ===\n${js}`)
  assert.deepEqual(snippets.filter((s) => s.kind === 'usage_from_comment').map((s) => s.code), ['node alert.js --title "Deploy?"', 'node alert.js --close x'])
  assert.equal(snippets[0].language, 'js')
})

test('line ranges: valid range inserts exactly those lines; out of range and reversed ranges are errors; tokenise reverses ranges', () => {
  const { snippets } = extractSnippets(`=== SOURCE: ${SCRIPT_URL} ===\n${SCRIPT}`)
  const md = 'Run the check.\n\n[[SNIPPET:S1:L5-L7]]\n\nThen:\n\n[[SNIPPET:S1:L10-L11]]\n\n[[SNIPPET:S1:L9-L12]]\n\n[[SNIPPET:S1:L7-L5]]\n\n[[SNIPPET:S1:L0-L2]]\n\n[[SNIPPET:S1:L3]]\n'
  const r = replaceSnippetTokens(md, snippets)
  assert.deepEqual(r.inserts.map((x) => [x.id, x.from, x.to]), [['S1', 5, 7], ['S1', 10, 11]])
  assert.equal(r.inserts[0].code, '#   ./m91.sh check\n#   ./m91.sh send --title "..." [--severity HIGH]\n#                 [--custom-id x] [--auto-close]')
  assert.ok(r.markdown.includes('```bash\nset -uo pipefail\necho done\n```'))
  assert.ok(!r.markdown.includes('Source:'))
  assert.equal(r.rangeErrors.length, 3)
  assert.match(r.rangeErrors[0], /S1:L9-L12 is not a valid line range \(S1 has lines 1-11/)
  assert.match(r.rangeErrors[1], /S1:L7-L5/)
  assert.match(r.rangeErrors[2], /S1:L0-L2/)
  assert.deepEqual(r.errors, ['[[SNIPPET:S1:L3]] is not a valid token: use [[SNIPPET:Sn]] or [[SNIPPET:Sn:La-Lb]]'])
  const back = tokeniseSnippets(r.markdown, snippets, r.inserts)
  assert.ok(back.includes('[[SNIPPET:S1:L5-L7]]') && back.includes('[[SNIPPET:S1:L10-L11]]'))
})

test('CODE SNIPPETS shows kinds and numbered lines', () => {
  const { snippets } = extractSnippets(`=== SOURCE: ${SCRIPT_URL} ===\n${SCRIPT}`)
  const text = snippetSection(snippets)
  assert.match(text, /^\[S1\] kind: file · language: bash · lines 1-11 · source: https:\/\/github\.com\/MSG91\/m91-skill\/blob\/main\/scripts\/m91\.sh\n/)
  assert.match(text, /```bash\n 1\| #!\/usr\/bin\/env bash\n 2\| #\n/)
  assert.match(text, /\[S3\] kind: usage_from_comment · language: bash · lines 1-2/)
})

test('a JSON line range never cuts the example into invalid JSON: the whole snippet goes in instead (S10:L1-L11 from fields.md)', async () => {
  const { rangeBreaksJson } = await import('../../src/writer/snippets.js')
  const code = [
    '{',
    '  "event": "answered",',
    '  "at": "2026-10-01T12:14:09.535Z",',
    '  "alert": { "id": "…", "customId": "deploy-4821", "title": "Deploy 4821 needs approval" },',
    '  "response": {',
    '    "label": "Approve", "effect": "SHARED",',
    '    "by": { "id": "…", "name": "Aryan" },',
    '    "at": "2026-10-01T12:13:58.000Z",',
    '    "note": "checked the migration, go ahead",',
    '    "attachments": []',
    '  },',
    '  "idempotencyKey": "<alertId>-<userId>-<generation>"',
    '}'
  ].join('\n')
  const s10 = { id: 'S10', kind: 'block', language: 'json', code, source_url: 'https://m91.msg91.com/api/public/fields.md', source_title: 'Fields' }
  const bashSnippet = { id: 'S11', kind: 'block', language: 'bash', code: 'a\nb\nc', source_url: 'https://example.com/x.md', source_title: 'X' }
  const r = replaceSnippetTokens('Here is the answered event:\n[[SNIPPET:S10:L1-L11]]\n\n[[SNIPPET:S10:L5-L11]]\n\n[[SNIPPET:S11:L1-L2]]', [s10, bashSnippet])
  // L1-L11 and L5-L11 would both be invalid JSON: whole snippet, recorded as widened, no range errors.
  assert.deepEqual(r.rangeErrors, [])
  assert.equal(r.widened.length, 2)
  assert.match(r.widened[0], /^S10:L1-L11 would cut the JSON example into invalid JSON: the whole snippet \(lines 1-13\) was inserted instead$/)
  assert.deepEqual(r.inserts.map((i) => [i.id, i.from, i.to]), [['S10', null, null], ['S10', null, null], ['S11', 1, 2]])
  for (const block of [...r.markdown.matchAll(/```json\n([\s\S]*?)```/g)]) assert.doesNotThrow(() => JSON.parse(block[1]))
  // Non-JSON ranges are untouched; a range that is valid JSON on its own stays a range.
  assert.equal(rangeBreaksJson(bashSnippet, 1, 2), false)
  const valid = { ...s10, code: '[\n  1,\n  2\n]' }
  assert.equal(rangeBreaksJson(valid, 1, 4), false)
  // A JSON snippet that is not valid JSON as a whole (e.g. with comments) cannot be checked: the range stays.
  const commented = { ...s10, code: '{\n  // note\n  "a": 1\n}' }
  assert.equal(rangeBreaksJson(commented, 1, 2), false)
  // Tokenising for a revision gives back the whole-snippet token.
  assert.match(tokeniseSnippets(r.markdown, [s10, bashSnippet], r.inserts), /^\[\[SNIPPET:S10\]\]$/m)
})
