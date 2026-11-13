// SOURCE TEXT: the Writer and the Reviewer read the same text of the pages a brief cites, so the Writer no longer
// guesses what a page says (a headline, who did the work, how an API behaves) and every review checks every page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { citedPages, citedSourceText, keepRelevant, SOURCE_TEXT_MAX } from '../../src/writer/sources.js'
import { buildWriterMessage } from '../../src/writer/inputs.js'
import { WRITER_BASE } from '../../src/writer/prompts.js'
import { buildReviewerPrompt } from '../../src/reviewer/prompts.js'
import { fakeConfig } from '../helpers.js'

const config = fakeConfig({ M91_CTA_URL: 'https://m91.msg91.com/signup' })
const NEWS = 'https://news.example.com/agent-payment'
const ISSUE = 'https://github.com/example/agents/issues/1'
const brief = {
  news: { is_news_based: true, outlet: 'Example News', claim_in_own_words: 'An invoice agent proposed a payment nobody approved.', source_url: NEWS, published_date: '2026-11-12' },
  story: { use: false },
  sources: [{ url: ISSUE, what_it_supports: 'developers ask how to pause an agent' }, { url: 'https://m91.msg91.com/llms.txt', what_it_supports: 'M91 rings until answered' }, { url: NEWS, what_it_supports: 'the payment demo' }],
  outline: [{ heading: 'Which actions need approval?', source_urls: [ISSUE, 'https://m91.msg91.com/'] }]
}
const page = (title, body) => ({ ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => `<!doctype html><html><head><title>${title}</title><meta property="og:title" content="${title}"></head><body><nav>Menu</nav><article>${body}</article></body></html>` })

test('the pages a brief cites, each once, news first; M91 docs, the site and the CTA are left out', () => {
  const pages = citedPages(brief, { config })
  assert.deepEqual(pages.map((p) => p.url), [NEWS, ISSUE])
  assert.deepEqual(pages[0].uses, ['news: An invoice agent proposed a payment nobody approved.', 'the payment demo'])
  assert.deepEqual(pages[1].uses, ['developers ask how to pause an agent', 'section: Which actions need approval?'])
})

test("each page with its real title and text; a page that does not load is marked, with one warning", async () => {
  const fetch = async (url) => (url === NEWS
    ? page('Researcher shows invoice agent paying a fake supplier', '<p>Security researcher Sergey Chubarov showed an invoice-review agent proposing a payment.</p><p>The vendor said a fix is planned.</p>')
    : { ok: false, status: 403, headers: { get: () => 'text/html' }, text: async () => '' })
  const warnings = []
  const r = await citedSourceText(brief, { config, fetch, warnings })
  assert.equal(r.loaded, 1)
  assert.deepEqual(r.failed, [ISSUE])
  assert.match(r.text, /=== SOURCE: https:\/\/news\.example\.com\/agent-payment ===\nthe brief uses it for: news: .* \| the payment demo\ntitle: Researcher shows invoice agent paying a fake supplier\n/)
  assert.match(r.text, /Security researcher Sergey Chubarov showed an invoice-review agent proposing a payment\./)
  assert.ok(!r.text.includes('Menu'), 'page navigation is left out')
  assert.match(r.text, /=== SOURCE: https:\/\/github\.com\/example\/agents\/issues\/1 ===\nthe brief uses it for: .*\n\(could not be loaded: HTTP 403\. Use only what BRIEF says about this source, with no added detail\.\)/)
  assert.deepEqual(warnings, [`source pages: 1 of 2 could not be loaded (${ISSUE}); the Writer keeps to the brief for those`])
})

test('a long page keeps its opening and the paragraphs about what the brief uses it for, in page order', () => {
  const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} talks about weather, sports and other unrelated things at length.`)
  const text = ['Headline about agents', 'Lede: an agent paid an invoice.', ...filler.slice(0, 30), 'The approval step was skipped because the agent had payment permissions.', ...filler.slice(30)].join('\n')
  const kept = keepRelevant(text, ['approval step skipped payment permissions'], 600)
  assert.ok(kept.length <= 600)
  assert.match(kept, /^Headline about agents\nLede: an agent paid an invoice\./)
  assert.match(kept, /…\nThe approval step was skipped because the agent had payment permissions\./)
})

test('the Writer gets SOURCE TEXT and is told to write what it says; long source text is cut before anything else', () => {
  const { message } = buildWriterMessage({ brief: '{}', tone: 't', allowedUrls: '- x', sourceText: '=== SOURCE: x ===\ntitle: T\nbody' })
  assert.match(message, /--- SOURCE TEXT ---\n=== SOURCE: x ===\ntitle: T\nbody$/)
  const big = buildWriterMessage({ brief: '{}', tone: 't', lessons: 'keep me', allowedUrls: '- x', sourceText: 's'.repeat(60000) })
  assert.ok(big.message.length <= 50000)
  assert.deepEqual(big.trimmed, ['source pages'])
  assert.ok(big.message.includes('keep me'), 'the lessons stay')
  assert.match(WRITER_BASE, /SOURCE TEXT holds the text of the outside pages BRIEF cites/)
  assert.match(WRITER_BASE, /must be stated in SOURCE TEXT for the page you link, or in BRIEF/)
  assert.match(WRITER_BASE, /If the inputs support less, write less/)
  assert.ok(SOURCE_TEXT_MAX < 25000)
})

test('the Reviewer checks every page in SOURCE TEXT and lists every "must" problem, not a sample', () => {
  const p = buildReviewerPrompt(config)
  assert.match(p, /Check EVERY outside claim in the post against it, in every review: all pages, not a sample\./)
  assert.match(p, /List EVERY "must" problem in the post, all of them in this review, never a sample/)
  assert.ok(!/List at most \d+ items, "must" items first/.test(p))
})

test('M91 DOCS TEXT: each cited docs page cut to its parts about the post; both agents get it', async () => {
  const { docsTextFor, briefHints } = await import('../../src/writer/sources.js')
  const { buildReviewerMessage } = await import('../../src/reviewer/inputs.js')
  const filler = Array.from({ length: 80 }, (_, i) => `Billing paragraph ${i} about invoices and plans.`).join('\n')
  const tokenised = `=== SOURCE: https://m91.msg91.com/docs/api.md ===\n# M91 API\n${filler}\nThe answered event fires once per response; the closed event fires when the alert closes.\n[[SNIPPET:S1]]\n=== SOURCE: https://m91.msg91.com/llms.txt ===\n# M91\nRings a phone until someone answers.`
  const hints = briefHints({ keyword: 'm91 callback events', outline: [{ heading: 'Which events does M91 send?' }] })
  const docs = docsTextFor(tokenised, hints, 1200)
  assert.ok(docs.length <= 1300)
  assert.match(docs, /^=== SOURCE: https:\/\/m91\.msg91\.com\/docs\/api\.md ===\n# M91 API\n/)
  assert.match(docs, /The answered event fires once per response; the closed event fires when the alert closes\./)
  assert.match(docs, /\n\n=== SOURCE: https:\/\/m91\.msg91\.com\/llms\.txt ===\n# M91\nRings a phone until someone answers\.$/)
  const w = buildWriterMessage({ brief: '{}', tone: 't', allowedUrls: '- x', docsText: docs })
  assert.match(w.message, /--- M91 DOCS TEXT ---\n=== SOURCE: https:\/\/m91\.msg91\.com\/docs\/api\.md ===/)
  const r = buildReviewerMessage({ post: 'p', brief: '{}', checks: '[]', facts: '{}', allowedUrls: '- x', docsText: docs, tone: 't' })
  assert.match(r.message, /--- M91 DOCS TEXT ---\n=== SOURCE: https:\/\/m91\.msg91\.com\/docs\/api\.md ===/)
  assert.match(WRITER_BASE, /Describe M91's API \(its events, callbacks, fields, limits, methods\) exactly as the docs say, keeping their qualifiers/)
  assert.match(buildReviewerPrompt(config), /no claim contradicts M91 FACTS or M91 DOCS TEXT/)
})
