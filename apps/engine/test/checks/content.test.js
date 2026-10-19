import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runContentChecks, parseMarkdown, urlKey, hardProblems } from '../../src/checks/content.js'
import { countSyllables, fleschKincaidGrade, sentenceStats } from '../../src/checks/readability.js'
import { findPhrases, BANNED_PHRASES, FIRST_PERSON_PHRASES } from '../../src/checks/phrases.js'
import { extractSnippets } from '../../src/writer/snippets.js'
import { fakeConfig } from '../helpers.js'

const GOOD = readFileSync(new URL('../fixtures/good-post.md', import.meta.url), 'utf8')
const CTA = 'https://m91.msg91.com/signup'
const ISSUE = 'https://github.com/example/agents/issues/1'
const LLMS = 'https://m91.msg91.com/llms.txt'

// Short word targets so the fixture post is in range.
const config = fakeConfig({ M91_CTA_URL: CTA, TARGET_WORDS_MIN: '180', TARGET_WORDS_MAX: '500' })

const brief = (over = {}) => ({
  post_type: 'question',
  keyword: 'agent approval',
  outline: [
    { heading: 'What is agent approval?' }, { heading: 'Why does the phone need to ring?' },
    { heading: 'What happens after someone answers?' }, { heading: 'How do I start?' }
  ],
  story: { use: false }, news: { is_news_based: false }, tutorial: { use: false, steps: [], gaps: [] },
  internal_links: [], interactive_ideas: [{ block_type: 'phone_ring_sim', why: 'x' }],
  ...over
})
const draft = (md = GOOD, over = {}) => ({
  title: 'How agent approval works with a phone call',
  post_markdown: md,
  tldr: ['a', 'b', 'c'],
  seo: { title_tag: 'Agent approval with a phone call', meta_description: 'How agent approval pauses a risky step until a person answers a phone call.', slug_suggestion: 'agent-approval-phone-call', image_ideas: [] },
  ...over
})
const allowed = new Set([CTA, ISSUE, LLMS].map(urlKey))
const run = (md, { b = brief(), d, statuses, snippets, snippetErrors, snippetRangeErrors, inserts, schemaErrors } = {}) =>
  runContentChecks({ draft: d ?? draft(md), brief: b, config, allowedUrls: allowed, snippets, snippetErrors, snippetRangeErrors, inserts, linkStatuses: statuses, schemaErrors })
const get = (r, id) => r.results.find((x) => x.id === id)

test('the good fixture passes every hard check and the main soft checks', () => {
  const r = run(GOOD, { statuses: new Map([[urlKey(ISSUE), 'ok'], [urlKey(LLMS), 'ok'], [urlKey(CTA), 'blocked']]) })
  assert.deepEqual(hardProblems(r.results), [])
  assert.equal(r.hard_passed, true)
  for (const id of ['outline_match', 'words_target', 'reading_post', 'sentence_length', 'paragraph_length', 'answer_first', 'links_count', 'keyword_first_100', 'keyword_title_h1_slug', 'keyword_count', 'exclamations', 'legal_framing', 'claims_soft', 'block_code_lang', 'inline_code_known', 'block_approval_sequence', 'block_choices_bold']) {
    assert.equal(get(r, id)?.passed, true, `${id}: ${JSON.stringify(get(r, id))}`)
  }
  assert.ok(r.word_count >= 180 && r.word_count <= 500, `words ${r.word_count}`)
  assert.ok(r.reading.post_grade <= 8, `grade ${r.reading.post_grade}`)
})

// One failing variant per hard check.
const hardCases = [
  ['schema', (md) => md, { schemaErrors: ['/ must have required property tldr'] }],
  ['h1', (md) => md.replace('# How agent', '# Something else about'), {}],
  ['h1', (md) => md + '\n# A second H1\n', {}],
  ['tldr', (md) => md.replace('- Your software reads the answer and then acts.\n', ''), {}],
  ['sections_min', (md) => md.replace(/## Why does the phone need to ring\?/, 'Why does the phone need to ring?').replace(/## How do I start\?/, 'How do I start?'), {}],
  ['words_hard', (md) => md.split('## Why')[0] + '## What to do next\n\n[Try M91.](https://m91.msg91.com/signup)\n', {}],
  ['reading_post_hard', (md) => md.replace('Agent approval is a pause before a risky action. The agent waits for a person to decide.', 'Asynchronous authorization orchestration necessitates deterministic correlation of heterogeneous infrastructural confirmations, comprehensively guaranteeing unambiguous accountability characteristics throughout administrative organizational hierarchies. '.repeat(14)), {}],
  ['links_allowed', (md) => md.replace(ISSUE, 'https://made-up.example.com/page'), {}],
  ['links_alive', (md) => md, { statuses: new Map([[urlKey(ISSUE), 'dead']]) }],
  ['cta_exact', (md) => md.replace('(https://m91.msg91.com/signup)', '(https://m91.msg91.com/llms.txt)'), {}],
  ['cta_exact', (md) => md.replace('(https://m91.msg91.com/signup)', '(https://m91.msg91.com/signup/)'), {}],
  ['cta_exact', (md) => md + '\n## One more section\n\nNothing here.\n', {}],
  ['link_text', (md) => md.replace('[one framework handles it]', '[Source]'), {}],
  ['link_text', (md) => md.replace('[one framework handles it]', '[click here]'), {}],
  ['link_text', (md) => md.replace('[one framework handles it](https://github.com/example/agents/issues/1)', 'https://github.com/example/agents/issues/1'), {}],
  ['link_text', (md) => md.replace('[one framework handles it]', '[https://github.com/example/agents/issues/1]'), {}],
  ['raw_html', (md) => md.replace('Your software then decides what to do.', 'Your software then <b>decides</b> what to do.'), {}],
  ['raw_html', (md) => md.replace('Your software then decides what to do.', 'Your software then decides.<br/>'), {}],
  ['banned_phrases', (md) => md.replace('A pause keeps', 'Let\'s dive in: a pause keeps'), {}],
  ['first_person', (md) => md.replace('A ringing phone', "We've seen that a ringing phone"), {}],
  ['claims_hard', (md) => md.replace('M91 only carries the answer.', 'M91 executes the step for you.'), {}],
  ['seo_lengths', (md) => md, { d: draft(GOOD, { seo: { title_tag: 'x'.repeat(61), meta_description: 'ok', slug_suggestion: 'a', image_ideas: [] } }) }],
  ['story_attribution', (md) => md, { b: brief({ story: { use: true, attribution_line: 'reported by Example News' } }) }],
  ['news_attribution', (md) => md, { b: brief({ news: { is_news_based: true, outlet: 'Example News' } }) }]
]
for (const [id, mutate, opts] of hardCases) {
  test(`hard check fails: ${id}${opts.schemaErrors ? ' (schema errors)' : ''}`, () => {
    const r = run(mutate(GOOD), opts)
    const res = get(r, id)
    assert.ok(res, `${id} missing`)
    assert.equal(res.severity, 'hard')
    assert.equal(res.passed, false, JSON.stringify(res))
    assert.equal(r.hard_passed, false)
  })
}

test('story and news attribution pass when present', () => {
  const md = GOOD.replace('A ringing phone gets attention fast.', 'A ringing phone gets attention fast, as reported by Example News.')
  const r = run(md, { b: brief({ story: { use: true, attribution_line: 'reported by Example News' }, news: { is_news_based: true, outlet: 'Example News' } }) })
  assert.equal(get(r, 'story_attribution').passed, true)
  assert.equal(get(r, 'news_attribution').passed, true)
})

// Soft checks fail without blocking.
const softCases = [
  ['outline_match', (md) => md.replace('## How do I start?', '## Getting going').replace('## What happens after someone answers?', '## After the call')],
  ['words_target', (md) => md + '\n' + 'More plain words here. '.repeat(120)],
  ['reading_intro', (md) => md.replace('- Agent approval pauses a risky action until a person says yes or no.', '- Comprehensive organizational authorization infrastructure necessitates deterministic accountability.')],
  ['sentence_length', (md) => md.replace('An agent is a program that takes steps on its own.', 'An agent is a program that takes many different steps on its own without any person checking each one of those steps before they happen in the system.')],
  ['paragraph_length', (md) => md.replace('Some steps are risky, like sending money.', 'Some steps are risky. Like sending money. Or deleting data.')],
  ['answer_first', (md) => md.replace('A ringing phone gets attention fast. A chat message can wait unread for hours.', 'A ringing phone gets attention. It is loud. A chat can wait.')],
  ['links_count', (md) => md.replace('[one framework handles it](https://github.com/example/agents/issues/1)', 'one framework handles it')],
  ['claims_soft', (md) => md.replace('M91 only carries the answer.', 'M91 always reaches someone instantly.')],
  ['keyword_first_100', (md) => md.replace('Agent approval means your software', 'This means your software').replace('- Agent approval pauses', '- It pauses').replace('Agent approval is a pause', 'It is a pause')],
  ['keyword_count', (md) => md + '\nagent approval, agent approval, agent approval, agent approval, agent approval.\n'],
  ['exclamations', (md) => md.replace('Try it on one action today.', 'Try it on one action today!')],
  ['legal_framing', (md) => md.replace('Test it with your own phone first.', 'This is not legal advice. Test it first.')],
  ['block_approval_sequence', (md) => md.replace(/1\. Your software asks.*?4\. Your software continues\./s, 'Your software asks, the phone rings, a person decides.')],
  ['block_choices_bold', (md) => md.replace('**If you approve**', 'If you approve')]
]
for (const [id, mutate] of softCases) {
  test(`soft check fails without blocking: ${id}`, () => {
    const r = run(mutate(GOOD))
    const res = get(r, id)
    assert.ok(res, `${id} missing`)
    assert.equal(res.severity, 'soft')
    assert.equal(res.passed, false, JSON.stringify(res))
  })
}

test('keyword in title, H1 and slug (soft)', () => {
  const r = run(GOOD, { d: draft(GOOD, { seo: { ...draft().seo, slug_suggestion: 'phone-calls' } }) })
  assert.equal(get(r, 'keyword_title_h1_slug').passed, false)
})

test('internal links used (soft)', () => {
  const b = brief({ internal_links: [{ url: 'https://m91-blog.embarko.app/basics', anchor_text: 'basics', why: 'x' }] })
  assert.equal(get(run(GOOD, { b }), 'internal_links_used').passed, false)
})

test('ai_written_code (every post): snippet code passes, a changed parameter fails, whitespace-only differences pass; gaps mentioned', () => {
  const source = '=== SOURCE: https://github.com/MSG91/m91-skill ===\nInstall:\n```bash\n./scripts/m91.sh --title "Deploy?" --respond\n```\nRetry policy is not documented.'
  const { snippets } = extractSnippets(source)
  const tb = brief({ post_type: 'tutorial', tutorial: { use: true, steps: [], gaps: ['Retry policy is not documented'] }, interactive_ideas: [{ block_type: 'steps_checklist', why: 'x' }] })
  const withCode = (code) => GOOD.replace('## How do I start?\n', `## How do I start?\n\nRun the script.\n\n\`\`\`bash\n${code}\n\`\`\`\n\nThe docs do not cover the retry policy.\n`)
  assert.equal(get(run(withCode('./scripts/m91.sh --title "Deploy?" --respond'), { b: tb, snippets }), 'ai_written_code').passed, true)
  assert.equal(get(run(withCode('   ./scripts/m91.sh --title "Deploy?" --respond   '), { b: tb, snippets }), 'ai_written_code').passed, true)
  const changed = run(withCode('./scripts/m91.sh --title "Deploy?" --respond --timeout 30'), { b: tb, snippets })
  assert.equal(get(changed, 'ai_written_code').passed, false)
  assert.equal(changed.hard_passed, false)
  // Not a tutorial, no snippets: any code block is AI-written.
  const plain = run(withCode('npm install m91'))
  assert.equal(get(plain, 'ai_written_code').passed, false)
  assert.equal(get(plain, 'ai_written_code').severity, 'hard')
  assert.equal(get(run(GOOD), 'ai_written_code').passed, true, 'no code at all passes')
  assert.equal(get(run(withCode('./scripts/m91.sh --title "Deploy?" --respond'), { b: tb, snippets }), 'tutorial_gaps').passed, true)
  assert.equal(get(run(GOOD, { b: tb, snippets }), 'tutorial_gaps').passed, false)
  assert.equal(get(run(withCode('./scripts/m91.sh --title "Deploy?" --respond'), { b: tb, snippets }), 'block_steps_numbered').passed, true)
})

test('raw HTML inside a code block is fine; descriptive link text passes', () => {
  const { snippets } = extractSnippets('=== SOURCE: https://m91.msg91.com/llms.txt ===\n```text\n<b>bold</b>\n```')
  const md = GOOD.replace('## How do I start?\n', '## How do I start?\n\nThis shows the tag.\n\n```text\n<b>bold</b>\n```\n')
  const r = run(md, { snippets })
  assert.equal(get(r, 'raw_html').passed, true)
  assert.equal(get(r, 'link_text').passed, true)
  assert.equal(get(run(GOOD.replace('[one framework handles it]', "[Help Net Security's report]")), 'link_text').passed, true)
})

test('snippet_unknown is hard; inline_code_known is soft and accepts words from the brief or snippets', () => {
  const r = run(GOOD, { snippetErrors: ['unknown snippet id S9 (CODE SNIPPETS has S1)'] })
  assert.equal(get(r, 'snippet_unknown').passed, false)
  assert.equal(r.hard_passed, false)
  const { snippets } = extractSnippets('=== SOURCE: https://m91.msg91.com/api/public/api.md ===\n```json\n{ "customId": "x" }\n```')
  const inl = (word) => GOOD.replace('Your software then decides what to do.', `Your software then reads \`${word}\` and decides.`)
  assert.equal(get(run(inl('customId'), { snippets }), 'inline_code_known').passed, true)
  assert.equal(get(run(inl('agent approval')), 'inline_code_known').passed, true, 'brief keyword')
  const unknown = run(inl('retryPolicy'), { snippets })
  assert.equal(get(unknown, 'inline_code_known').passed, false)
  assert.equal(get(unknown, 'inline_code_known').severity, 'soft')
  assert.equal(unknown.hard_passed, true)
})

test('block-friendly: code language tags, comparison table, troubleshooting H3s, FAQ H3s', () => {
  const noLang = GOOD.replace('## How do I start?\n', '## How do I start?\n\n```\necho hi\n```\n')
  assert.equal(get(run(noLang), 'block_code_lang').passed, false)
  const cmp = brief({ format: 'comparison' })
  assert.equal(get(run(GOOD, { b: cmp }), 'block_comparison_table').passed, false)
  const withTable = GOOD.replace('## How do I start?\n', '## How do I start?\n\n| Tool | Rings phone |\n| --- | --- |\n| M91 | Yes |\n')
  assert.equal(get(run(withTable, { b: cmp }), 'block_comparison_table').passed, true)
  const ts = GOOD.replace('## How do I start?\n', '## How do I start?\n\n### The alert never arrives\nLikely cause: wrong link.\nFix: copy the link again.\n')
  assert.equal(get(run(ts), 'block_troubleshooting_h3').passed, true)
  const tsBad = GOOD.replace('## How do I start?\n', '## How do I start?\n\nLikely cause: wrong link.\nFix: copy the link again.\n')
  assert.equal(get(run(tsBad), 'block_troubleshooting_h3').passed, false)
  const faq = GOOD.replace('## What to do next', '## FAQ\n\n### Does it work at night?\nYes.\n\n### Pricing\nSee the site.\n\n## What to do next')
  assert.equal(get(run(faq), 'block_faq_h3').passed, false)
  const faqGood = GOOD.replace('## What to do next', '## FAQ\n\n### Does it work at night?\nYes.\n\n## What to do next')
  assert.equal(get(run(faqGood), 'block_faq_h3').passed, true)
})

test('parsing: code, URLs and headings are left out of prose metrics', () => {
  const p = parseMarkdown('# T\n\nOne two three.\n\n```bash\nfour five six seven\n```\n\n## H\n\nSee [docs](https://a.com/x) now.')
  assert.equal(p.code.length, 1)
  assert.deepEqual(p.links, [{ text: 'docs', url: 'https://a.com/x' }])
  assert.ok(!p.prose.includes('four'))
  assert.ok(!p.prose.includes('https'))
  assert.ok(!/\bT\b|\bH\b/.test(p.prose.replace(/See|docs|now|One|two|three/g, '')))
})

test('readability: syllables of known words, grades of known paragraphs, sentence stats', () => {
  const known = { cat: 1, the: 1, phone: 1, make: 1, table: 2, simple: 2, approve: 2, computer: 3, software: 2, decision: 3, human: 2 }
  for (const [w, n] of Object.entries(known)) assert.equal(countSyllables(w), n, w)
  assert.equal(fleschKincaidGrade('The phone rings. A person picks it up. They say yes or no. The software waits for the answer.'), -0.1)
  assert.equal(fleschKincaidGrade('Asynchronous approval orchestration requires deterministic correlation identifiers propagated across heterogeneous infrastructure components.'), 33.3)
  assert.equal(fleschKincaidGrade(''), null)
  assert.deepEqual(sentenceStats('One two three. Four five.'), { count: 2, average: 2.5, over: 0 })
})

test('phrase lists match whole phrases, case-insensitive, with either apostrophe', () => {
  assert.deepEqual(findPhrases('Let’s Dive In now', BANNED_PHRASES), ["let's dive in"])
  assert.deepEqual(findPhrases('This leveraged nothing', BANNED_PHRASES), [])
  assert.deepEqual(findPhrases('At M91, we built it', FIRST_PERSON_PHRASES), ['at M91, we'])
})

test('snippet_range_invalid is hard; ai_written_code accepts an inserted line range and nothing else', () => {
  const r = run(GOOD, { snippetRangeErrors: ['S1:L9-L12 is not a valid line range'] })
  assert.equal(get(r, 'snippet_range_invalid').passed, false)
  assert.equal(get(r, 'snippet_range_invalid').severity, 'hard')
  const { snippets } = extractSnippets('=== SOURCE: https://m91.msg91.com/llms.txt ===\n```bash\nstep one\nstep two\nstep three\n```')
  const withCode = (code) => GOOD.replace('## How do I start?\n', `## How do I start?\n\nThis runs it.\n\n\`\`\`bash\n${code}\n\`\`\`\n`)
  assert.equal(get(run(withCode('step two\nstep three'), { snippets, inserts: [{ id: 'S1', from: 2, to: 3, code: 'step two\nstep three' }] }), 'ai_written_code').passed, true)
  assert.equal(get(run(withCode('step two\nstep three'), { snippets }), 'ai_written_code').passed, false, 'a range that was not inserted')
  assert.equal(get(run(withCode('step two\nstep 3'), { snippets, inserts: [{ id: 'S1', from: 2, to: 3, code: 'step two\nstep three' }] }), 'ai_written_code').passed, false)
})
