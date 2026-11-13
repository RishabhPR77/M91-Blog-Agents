// The Reviewer's message stays under viaSocket's 50,000 characters for a long post (R-261113-1028-TSMC: a 2,782-word
// tutorial gave 57,032 characters and stopped the run). POST is never cut.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReviewerSections, buildReviewerMessage } from '../../src/reviewer/inputs.js'
import { fakeConfig, memoryStore } from '../helpers.js'

const words = (n) => Array.from({ length: n }, (_, i) => `word${i % 50}`).join(' ')
const script = Array.from({ length: 700 }, (_, i) => `echo line ${i} ${'x'.repeat(50)}`).join('\n')

const brief = {
  brief_id: '261113-1028-BYZK', post_type: 'tutorial', keyword: 'pause ai agent', supporting_keywords: ['human approval'], titles: ['How to Pause an AI Agent for Human Approval', 'B', 'C'],
  why_today: 'x'.repeat(2000), questions: ['How do I pause an agent?'], angle: 'the pause and resume', claims_to_avoid: ['Do not claim M91 executes the action.'],
  outline: Array.from({ length: 9 }, (_, i) => ({ heading: `Heading ${i}?`, answer_first: 'Answer.', points: ['p'.repeat(900), 'q'.repeat(900)], source_urls: ['https://example.com/a'] })),
  interactive_ideas: Array.from({ length: 4 }, () => ({ idea: 'i'.repeat(800) })),
  tutorial: { use: true, steps: [{ step: 'Install it', source_url: 'https://github.com/MSG91/m91-skill' }], gaps: [] }
}

test('a long tutorial post fits: the snippet code is not sent again, the brief and checks shrink, POST stays whole', async () => {
  const config = fakeConfig()
  const post = `# How to Pause an AI Agent\n\n${words(2800)}`
  const draft = {
    title: 'How to Pause an AI Agent', post_markdown: post, tldr: ['a', 'b', 'c'], seo: {},
    checks: { results: Array.from({ length: 40 }, (_, i) => ({ id: `check_${i}`, passed: i > 3, severity: 'soft', value: i, detail: 'd'.repeat(150) })) }
  }
  const { sections } = await buildReviewerSections({
    store: memoryStore(), config, draft, brief, facts: { can: ['Rings a phone.'], cannot: [], integrations: [] },
    snippets: [{ id: 'S1', language: 'bash', source_url: 'https://github.com/MSG91/m91-skill/blob/main/scripts/m91.sh', code: script }]
  })
  assert.deepEqual(JSON.parse(sections.tutorial), { code_in_post_from: [{ id: 'S1', language: 'bash', source_url: 'https://github.com/MSG91/m91-skill/blob/main/scripts/m91.sh', lines: 700 }] })
  const { message, trimmed } = buildReviewerMessage(sections)
  assert.ok(message.length <= 50000, `${message.length} characters`)
  assert.ok(message.includes(post), 'the whole post')
  assert.ok(trimmed.includes('brief (the fields the Reviewer judges by)'))
  const sent = JSON.parse(message.split('--- BRIEF ---\n')[1].split('\n--- ')[0])
  assert.equal(sent.keyword, 'pause ai agent')
  assert.deepEqual(sent.claims_to_avoid, brief.claims_to_avoid)
  assert.deepEqual(sent.questions, brief.questions)
  assert.equal(sent.why_today, undefined)
})

test('a short post is sent as before: whole brief, every check', async () => {
  const config = fakeConfig()
  const draft = { title: 'T', post_markdown: '# T\n\nShort.', checks: { results: [{ id: 'words_target', passed: true, severity: 'hard', value: 1, detail: '' }] } }
  const { sections } = await buildReviewerSections({ store: memoryStore(), config, draft, brief: { ...brief, post_type: 'guide', tutorial: { use: false } }, facts: null })
  const { message, trimmed } = buildReviewerMessage(sections)
  assert.deepEqual(trimmed, [])
  assert.ok(message.includes(`--- BRIEF ---\n${JSON.stringify({ ...brief, post_type: 'guide', tutorial: { use: false } })}`))
  assert.ok(!message.includes('--- TUTORIAL ---'))
})

test('a compact CHECK RESULTS keeps the reading grades and the word count, passed or not', async () => {
  const config = fakeConfig()
  const results = [
    { id: 'reading_post', passed: true, severity: 'soft', value: 6.7, detail: 'target grade 8' },
    { id: 'reading_intro', passed: true, severity: 'hard', value: 5.9, detail: 'hard limit grade 9' },
    { id: 'words_target', passed: false, severity: 'soft', value: 2913, detail: 'target 1800–2500' },
    { id: 'sentence_hard', passed: false, severity: 'hard', value: 2, detail: 'two sentences over 25 words' },
    { id: 'cta_exact', passed: true, severity: 'hard', value: 1, detail: 'ok' }
  ]
  const { sections } = await buildReviewerSections({ store: memoryStore(), config, draft: { title: 'T', post_markdown: '# T', checks: { results } }, brief: { ...brief, post_type: 'guide', tutorial: { use: false } }, facts: null })
  const compact = JSON.parse(sections.checksCompact)
  assert.deepEqual(compact.measured.map((r) => [r.id, r.value]), [['reading_post', 6.7], ['reading_intro', 5.9], ['words_target', 2913], ['sentence_hard', 2]])
  assert.deepEqual(compact.failed, [])
  assert.equal(compact.passed_others, 1)
})
