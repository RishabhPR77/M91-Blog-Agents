// Published guides (msg91.com/guide): the parser, the sync (M91 posts only, MSG91 posts ignored, one Mem0 add per new
// guide), the guides run mode and the sync before a full run (before the weekly editor decides), the knowledge map,
// the Strategist's links, the API, and the new SEO checks and prompt lines. A local test server stands
// in for msg91.com: no real network, no AI, no Mem0.
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFeed, parseListing, parseGuidePage, canonicalGuideUrl, m91Mentions, syncGuides, listGuides, guidesSummary, SEEN_FILE } from '../src/guides/sync.js'
import { knowledgeMap } from '../src/knowledge.js'
import { buildInputs } from '../src/strategist/inputs.js'
import { PLAN as STRATEGIST_PROMPT } from '../src/strategist/prompts.js'
import { runContentChecks, urlKey, FAQ_MIN, M91_LINKS_MAX } from '../src/checks/content.js'
import { WRITER_BASE } from '../src/writer/prompts.js'
import { createRunManager } from '../src/runs.js'
import { createServer } from '../src/server.js'
import { stubAgents } from '../src/agents/stubs.js'
import { resetEvents, replay } from '../src/events.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer } from './helpers.js'
import { seededStore, NOW as SNOW } from './strategist/fixtures.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})

// ---------- a stand-in for msg91.com/guide ----------

const page = ({ title, description = '', keywords = '', date = '2026-10-20T13:07:21.032Z', body }) => `<!DOCTYPE html><html><head><title>${title}</title>
<meta name="keywords" content="${keywords}"/></head><body><nav><a href="/guide">All</a></nav>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","name":"${title}",${description ? `"description":"${description}",` : ''}"author":{"@type":"Person","name":"Ragini"},"dateModified":"${date}","headline":"${title}"}</script>
<p>All articlesENOctober 20, 2026${title}4 min read${description}</p>
${body}
<h3>Keep reading</h3><h3>Some other post</h3><p>Another post's summary.</p></body></html>`

const APPROVAL = 'what-happens-when-your-software-needs-a-human-approval-'
const FLOW = 'how-the-m91-alert-flow-moves-an-alert'
const OLD_M91 = 'test-your-m91-alert-link'
const WOO = 'msg91-woocommerce-checkout-plugin'
const SITE = {
  '/guide/feed.xml': `<?xml version="1.0"?><rss><channel>
<item><title>What Happens When Your Software Needs a Human Approval?</title><link>https://msg91.com/guide/${APPROVAL}</link><pubDate>Tue, 20 Oct 2026 13:01:02 GMT</pubDate><category>General</category><description><![CDATA[M91 is a Walkover alerting app that reaches the right person when automation needs a human.]]></description></item>
<item><title>How the M91 Alert Flow Moves an Alert From Software to a Person</title><link>https://msg91.com/guide/${FLOW}</link><pubDate>Fri, 23 Oct 2026 08:56:20 GMT</pubDate><description>Explore how M91 sends a titled alert.</description></item>
<item><title>MSG91 WooCommerce Checkout Plugin</title><link>https://msg91.com/guide/${WOO}</link><pubDate>Sat, 10 Oct 2026 10:00:00 GMT</pubDate><description>Faster login with MSG91 OTP.</description></item>
</channel></rss>`,
  '/guide': `<html><body><a href="/guide/${APPROVAL}">a</a><a href="https://msg91.com/en/guide/${FLOW}/">b</a><a href="/guide/${WOO}">c</a><a href="/guide/${OLD_M91}">d</a><a href="/guide/hello-vs-blip">e</a><a href="/guide/feed.xml">rss</a><a href="https://other.example.com/guide/x">x</a></body></html>`,
  [`/guide/${APPROVAL}`]: page({ title: 'What Happens When Your Software Needs a Human Approval?', description: 'M91 reaches the right person.', keywords: 'M91,HITL,human approval', body: '<h2>What Is M91?</h2><p>M91 is an alerting app from Walkover that reaches a real person.</p><h2>Frequently Asked Questions</h2><h3>What is M91?</h3><p>M91 rings phones until someone answers.</p>' }),
  [`/guide/${FLOW}`]: page({ title: 'How the M91 Alert Flow Moves an Alert From Software to a Person', body: '<h3>What happens after software sends an M91 alert?</h3><p>Software sends a titled request to M91, and M91 raises the alert.</p>' }),
  [`/guide/${OLD_M91}`]: page({ title: 'Step-by-Step: How to Test Your Alert Link Without Waking Anyone', body: '<h2>What Is an M91 Alert Link?</h2><p>M91 gives every channel a send link. M91 rings phones. Test M91 first.</p>' }),
  '/guide/hello-vs-blip': page({ title: 'Hello vs Blip', body: '<h2>Hello</h2><p>MSG91 Hello is a customer service platform. MSG91 has many products.</p>' }),
  [`/guide/${WOO}`]: page({ title: 'MSG91 WooCommerce Checkout Plugin', body: '<p>MSG91 checkout.</p>' })
}
const hits = []
const server = http.createServer((req, res) => {
  const path = req.url.replace(/^\/en\//, '/').replace(/\/$/, '') || '/'
  hits.push(path)
  const body = SITE[path]
  res.writeHead(body ? 200 : 404, { 'content-type': path.endsWith('.xml') ? 'application/rss+xml' : 'text/html' })
  res.end(body ?? 'not found')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`
after(() => server.close())

const guideEnv = (over = {}) => ({ GUIDES_FEED_URL: `${BASE}/guide/feed.xml`, GUIDES_LIST_URL: `${BASE}/guide`, ENGINE_DATA_DIR: mkdtempSync(join(tmpdir(), 'm91-guides-')), ...over })
const U = (slug) => `https://msg91.com/guide/${slug}`

// ---------- parsing ----------

test('parsing: the feed, the listing (canonical links, no feed.xml, no other site), a page (title, date, headings, keywords, words; no "Keep reading" list)', () => {
  const feed = parseFeed(SITE['/guide/feed.xml'])
  assert.deepEqual(feed.map((i) => i.url), [U(APPROVAL), U(FLOW), U(WOO)])
  assert.equal(feed[0].published_at, '2026-10-20T13:01:02.000Z')
  assert.deepEqual(feed[0].categories, ['General'])
  assert.equal(feed[0].description, 'M91 is a Walkover alerting app that reaches the right person when automation needs a human.')
  assert.deepEqual(parseListing(SITE['/guide']), [U(APPROVAL), U(FLOW), U(WOO), U(OLD_M91), U('hello-vs-blip')])
  const p = parseGuidePage(SITE[`/guide/${APPROVAL}`])
  assert.equal(p.title, 'What Happens When Your Software Needs a Human Approval?')
  assert.equal(p.published_at, '2026-10-20T13:07:21.032Z')
  assert.deepEqual(p.keywords, ['M91', 'HITL', 'human approval'])
  assert.deepEqual(p.headings, ['What Is M91?', 'Frequently Asked Questions', 'What is M91?'])
  assert.equal(p.summary, 'M91 reaches the right person.')
  assert.ok(!p.headings.includes('Some other post') && !p.headings.includes('Keep reading'))
  assert.ok(p.words > 10 && p.m91 >= 3)
  // The page header line is not taken for the summary when there is no description.
  assert.equal(parseGuidePage(SITE[`/guide/${FLOW}`]).summary, 'Software sends a titled request to M91, and M91 raises the alert.')
  assert.equal(m91Mentions('MSG91 and M91, M91. Not MSG91 or M910.'), 2)
  assert.equal(canonicalGuideUrl('https://msg91.com/en/guide/abc/?x=1'), U('abc'))
  assert.equal(canonicalGuideUrl('/guide/feed.xml'), null)
  assert.equal(canonicalGuideUrl('https://evil.example.com/guide/abc'), null)
  assert.equal(canonicalGuideUrl('https://msg91.com/guide'), null)
})

// ---------- the sync ----------

const fetchToLocal = async (url, init) => fetch(String(url).replace('https://msg91.com', BASE), init)

test('sync: only M91 guides are saved (one add each); MSG91 posts are dropped from the feed without a page fetch; a second sync adds nothing', async () => {
  const store = memoryStore()
  const config = fakeConfig(guideEnv())
  hits.length = 0
  const out = await syncGuides({ store, config, fetchImpl: fetchToLocal, now: () => Date.parse('2026-10-28T06:00:00Z') })
  assert.deepEqual(out.added.map((g) => g.url).sort(), [U(APPROVAL), U(FLOW), U(OLD_M91)].sort())
  assert.equal(out.not_m91, 2, 'the WooCommerce post (from its feed text) and Hello vs Blip (from its page)')
  assert.ok(!hits.includes(`/guide/${WOO}`), 'an MSG91 post in the feed is never fetched')
  assert.equal(store.writes.create, 3)
  const guides = await listGuides(store)
  assert.equal(guides[0].title, 'How the M91 Alert Flow Moves an Alert From Software to a Person', 'newest first')
  const approval = guides.find((g) => g.url === U(APPROVAL))
  assert.equal(approval.description, 'M91 is a Walkover alerting app that reaches the right person when automation needs a human.', 'the feed text wins')
  assert.deepEqual(approval.keywords, ['M91', 'HITL', 'human approval'])
  assert.equal(approval.source, 'msg91.com/guide')
  assert.ok(approval.headings.includes('What Is M91?'))
  // The non-M91 decision is remembered locally: the next sync fetches only the feed and the list.
  const seen = JSON.parse(readFileSync(join(config.runtime.dataDir, SEEN_FILE), 'utf8'))
  assert.equal(seen[U('hello-vs-blip')].m91, false)
  hits.length = 0
  const again = await syncGuides({ store, config, fetchImpl: fetchToLocal })
  assert.deepEqual([again.added.length, again.known, again.checked], [0, 3, 0])
  assert.deepEqual(hits.sort(), ['/guide', '/guide/feed.xml'])
  assert.equal(store.writes.create, 3)
  assert.match(guidesSummary(out), /^published guides: 3 known, 3 new \(/)
  assert.equal(guidesSummary(again), 'published guides: 3 known, none new')
})

test('sync: at most GUIDES_MAX_PAGES pages per sync (the rest wait); a site that cannot be read is a warning, not an error', async () => {
  const store = memoryStore()
  const out = await syncGuides({ store, config: fakeConfig(guideEnv({ GUIDES_MAX_PAGES: '1' })), fetchImpl: fetchToLocal })
  assert.equal(out.checked, 1)
  assert.equal(out.added.length, 1)
  assert.ok(out.pending >= 2)
  assert.match(guidesSummary(out), /left to check next time/)
  const down = await syncGuides({ store: memoryStore(), config: fakeConfig(guideEnv()), fetchImpl: async () => { throw new TypeError('fetch failed') } })
  assert.deepEqual([down.added.length, down.known], [0, 0])
  assert.equal(down.warnings.length, 2)
  assert.match(down.warnings[0], /the guide feed could not be read/)
})

test('run mode "guides": 0 AI calls, the guides saved, one summary line', async () => {
  const restore = quiet()
  const store = memoryStore()
  const config = fakeConfig(guideEnv({ GUIDES_FEED_URL: `${BASE}/guide/feed.xml`, DRY_RUN: 'false' }))
  // The feed's links point at msg91.com; the page fetches go to the local stand-in.
  const realFetch = globalThis.fetch
  globalThis.fetch = (url, init) => realFetch(String(url).replace('https://msg91.com', BASE), init)
  try {
    const m = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
    const { run_id } = await m.startRun({ mode: 'guides' })
    const r = await m.wait(run_id)
    assert.equal(r.status, 'succeeded', JSON.stringify(r))
    assert.match(r.run.result_summary, /^published guides: 3 known, 3 new/)
    assert.equal((await listGuides(store)).length, 3)
  } finally {
    globalThis.fetch = realFetch
    restore()
  }
})

test('a full run reads the guides first, before the weekly editor decides (so it never repeats a live guide)', async () => {
  const restore = quiet()
  const store = memoryStore()
  const config = fakeConfig(guideEnv({ DRY_RUN: 'false', GUIDES_SYNC_ON_RUN: 'true' }))
  const realFetch = globalThis.fetch
  globalThis.fetch = (url, init) => realFetch(String(url).replace('https://msg91.com', BASE), init)
  try {
    let guidesSeen = null
    const editor = async (ctx) => { guidesSeen = (await listGuides(store)).length; return stubAgents.editor(ctx) }
    const m = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, editor, reviewer: mockReviewer() }) })
    const { run_id } = await m.startRun({ mode: 'full' })
    const r = await m.wait(run_id)
    assert.equal(r.status, 'succeeded', r.run?.result_summary)
    const events = replay(run_id)
    const gi = events.findIndex((e) => e.type === 'step.output' && /^published guides: 3 known, 3 new/.test(e.message))
    const ei = events.findIndex((e) => e.type === 'step.started' && e.step === 'editor')
    assert.ok(gi >= 0 && ei > gi, 'the guides are synced before the editor runs')
    assert.equal(guidesSeen, 3)
  } finally {
    globalThis.fetch = realFetch
    restore()
  }
})

const guideRec = (store, slug, title, extra = {}) => store.createRecord({ type: 'published_guide', status: 'live', payload: { url: U(slug), slug, title, summary: `${title} in short.`, published_at: '2026-10-20T13:00:00.000Z', keywords: ['M91', 'human approval'], headings: ['What Is M91?'], synced_at: '2026-10-28T06:00:00Z', ...extra } })

// ---------- what the agents get ----------

test('knowledge map: the guides join the approved posts, without duplicates', async () => {
  const store = memoryStore()
  await store.createRecord({ type: 'knowledge', status: 'current', payload: { brief_id: 'B-1', title: 'How the M91 Alert Flow Moves an Alert From Software to a Person', concepts: ['alert'], terms_defined: [], summary: 'x', link: null, export_slug: FLOW, approved_at: '2026-10-23T08:00:00Z' } })
  await guideRec(store, APPROVAL, 'What Happens When Your Software Needs a Human Approval?')
  await guideRec(store, FLOW, 'How the M91 Alert Flow Moves an Alert From Software to a Person')
  const map = await knowledgeMap(store)
  assert.deepEqual(map.map((k) => k.title), ['What Happens When Your Software Needs a Human Approval?', 'How the M91 Alert Flow Moves an Alert From Software to a Person'], 'oldest first, the engine\'s own post once')
  assert.deepEqual([map[0].link, map[0].source], [U(APPROVAL), 'published_guide'])
})

test('Strategist: the guides are PUBLISHED POSTS (internal links) and ALREADY COVERED', async () => {
  const store = await seededStore()
  await guideRec(store, APPROVAL, 'What Happens When Your Software Needs a Human Approval?')
  const inputs = await buildInputs({ config: (await import('./strategist/fixtures.js')).config(), store, scoutResult: null, now: () => SNOW })
  assert.ok(inputs.publishedPosts.some((p) => p.url === U(APPROVAL) && p.title === 'What Happens When Your Software Needs a Human Approval?'))
  assert.ok(inputs.publishedUrls.has(urlKey(U(APPROVAL))))
  assert.ok(inputs.alreadyCovered.some((l) => l.includes('What Happens When Your Software Needs a Human Approval? — published guide')))
})

test('API: GET /api/guides lists the live guides; the roadmap endpoints are gone', async () => {
  const restore = quiet()
  const store = memoryStore()
  await guideRec(store, APPROVAL, 'What Happens When Your Software Needs a Human Approval?')
  const config = fakeConfig()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const srv = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const g = await (await fetch(`${base}/api/guides`)).json()
    assert.deepEqual(g.guides.map((x) => [x.title, x.url]), [['What Happens When Your Software Needs a Human Approval?', U(APPROVAL)]])
    assert.equal((await fetch(`${base}/api/roadmap`)).status, 404)
  } finally {
    await new Promise((r) => srv.close(r))
    restore()
  }
})

// ---------- posts like the hand-written guides ----------

test('settings: 1,200–2,000 words, up to 10 sections, 8–14 secondary keywords', async () => {
  const c = fakeConfig()
  assert.deepEqual([c.content.targetWordsMin, c.content.targetWordsMax, c.strategist.outlineMaxSections], [1200, 2000, 10])
  const { SUPPORTING_MIN, SUPPORTING_MAX } = await import('../src/strategist/checks.js')
  assert.deepEqual([SUPPORTING_MIN, SUPPORTING_MAX], [8, 14])
  assert.ok(c.guides.syncOnRun === false, 'off in unit tests (fakeEnv)')
  assert.equal(fakeConfig({ GUIDES_SYNC_ON_RUN: '' }).guides.syncOnRun, true, 'on by default')
})

test('prompts: the Strategist plans secondary keywords, an FAQ, a checklist and links to earlier guides; the Writer writes them', () => {
  assert.match(STRATEGIST_PROMPT, /"supporting_keywords": 8 to 14 secondary keywords/)
  assert.match(STRATEGIST_PROMPT, /The last section before "What to do next" is "Frequently Asked Questions": its "points" are 6 to 10 real questions/)
  assert.match(STRATEGIST_PROMPT, /add a "<topic> checklist" section near the end/)
  assert.match(STRATEGIST_PROMPT, /"internal_links": 1 to 3 links to PUBLISHED POSTS a reader of this post should read before or after/)
  assert.match(WRITER_BASE, /a "## Frequently Asked Questions" section: 6 to 10 "### <question>\?" headings/)
  assert.match(WRITER_BASE, /"## <topic> checklist" section near the end: 5–8 "- \[ \] " items/)
  assert.match(WRITER_BASE, /Problems and fixes go in a Markdown table/)
  assert.match(WRITER_BASE, /Use EVERY supporting keyword at least once/)
  assert.match(WRITER_BASE, /New to M91\? Start with \[<title>\]\(<url>\)/)
  assert.match(WRITER_BASE, /Link the word "M91" to https:\/\/m91\.msg91\.com\/ at its first mention in the opening and in each H2 section \(at most 8 in the post\); never on every mention, never in headings\./)
})

const SITE_URL = 'https://m91.msg91.com/'
const md = ({ faq = 6, m91 = 2, keywords = ['human approval', 'phone alerts'] } = {}) => [
  '# Agent approval with a phone call', '',
  `Agent approval means a person decides. [M91](${SITE_URL}) rings a phone.`, '',
  '**TL;DR**', '- One.', '- Two.', '- Three.', '',
  '## What is agent approval?', '', `A pause before a risky step uses ${keywords.join(' and ')}.`, ...Array.from({ length: Math.max(0, m91 - 1) }, () => `See [M91](${SITE_URL}).`), '',
  '## Frequently Asked Questions', '', ...Array.from({ length: faq }, (_, i) => [`### Question number ${i + 1}?`, '', 'A short answer.', '']).flat(),
  '## What to do next', '', '[Try M91](https://m91.msg91.com/signup)'
].join('\n')
const run = (text, brief = { keyword: 'agent approval', supporting_keywords: ['human approval', 'phone alerts', 'HITL (human-in-the-loop)'] }) =>
  runContentChecks({ draft: { title: 'Agent approval with a phone call', post_markdown: text, tldr: ['One.', 'Two.', 'Three.'] }, brief, config: fakeConfig({ M91_CTA_URL: 'https://m91.msg91.com/signup' }), allowedUrls: new Set([SITE_URL, 'https://m91.msg91.com/signup'].map(urlKey)) }).results
const get = (r, id) => r.find((x) => x.id === id)

test('checks (soft): every secondary keyword used, an FAQ of 6–10 questions, "M91" linked 1–8 times', () => {
  let r = run(md())
  assert.equal(get(r, 'secondary_keywords').passed, false)
  assert.equal(get(r, 'secondary_keywords').detail, 'not used: HITL (human-in-the-loop)')
  assert.equal(get(r, 'secondary_keywords').severity, 'soft')
  r = run(md({ keywords: ['human approval', 'phone alerts', 'HITL'] }))
  assert.equal(get(r, 'secondary_keywords').passed, true, 'the part before the brackets counts')
  assert.equal(get(r, 'faq_count').passed, true)
  assert.equal(get(run(md({ faq: FAQ_MIN - 1 })), 'faq_count').passed, false)
  assert.equal(get(run(md({ faq: 11 })), 'faq_count').passed, false)
  assert.equal(get(run(md().replace('## Frequently Asked Questions', '## More')), 'faq_count').detail, 'no "Frequently Asked Questions" section')
  assert.deepEqual([get(r, 'm91_links').passed, get(r, 'm91_links').value], [true, 2])
  assert.equal(get(run(md({ m91: M91_LINKS_MAX + 1 })), 'm91_links').passed, false)
  assert.equal(get(run(md().replaceAll(`[M91](${SITE_URL})`, 'M91')), 'm91_links').detail, 'M91 is never linked to https://m91.msg91.com/')
  for (const id of ['secondary_keywords', 'faq_count', 'm91_links']) assert.equal(get(r, id).severity, 'soft', id)
})
