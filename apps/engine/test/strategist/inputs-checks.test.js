import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInputs, buildStrategistMessage, blockedGroup, leastUsedGroups, InputsError } from '../../src/strategist/inputs.js'
import { autoFix, findProblems, validateBrief, wordOverlap } from '../../src/strategist/checks.js'
import { STANDING_CLAIMS, DEFAULT_CTA_TEXT } from '../../src/strategist/prompts.js'
import { strategist_brief } from '../../src/strategist/schemas.js'
import { slugify, newBriefId, BRIEF_ID_RE } from '../../src/util/ids.js'
import { memoryStore } from '../helpers.js'
import { NOW, TODAY, CTA, LLMS, API_DOC, ISSUE, STORY_URL, REPO, SCRIPT, config, seededStore, validBrief } from './fixtures.js'

const now = () => NOW
async function setup(cfgEnv, storeOpts) {
  const cfg = config(cfgEnv)
  const store = await seededStore(storeOpts)
  const inputs = await buildInputs({ config: cfg, store, now })
  return { cfg, store, inputs }
}
const problemsOf = async (brief, ctx) => findProblems(brief, { config: ctx.cfg, inputs: ctx.inputs, store: ctx.store })

// ---------- inputs ----------

test('inputs: counts, rapid stories recomputed, leads indexed, allowed URLs', async () => {
  const { inputs } = await setup()
  assert.equal(inputs.today, TODAY)
  assert.deepEqual(inputs.rapidStories.map((s) => s.story_id), ['S-1'])
  assert.deepEqual(inputs.otherStories.map((s) => s.story_id), ['S-2'])
  assert.deepEqual(inputs.clusters.map((c) => c.cluster_id), ['C-1', 'C-2'])
  assert.equal(inputs.tutorials.length, 1)
  assert.deepEqual(inputs.styleNotes.map((s) => s.profile_id), ['P-1'])
  assert.deepEqual([...inputs.leadIndex.keys()].sort(), ['C-1', 'C-2', 'S-1', 'S-2', 'T-1'])
  for (const u of [LLMS, API_DOC, ISSUE, STORY_URL, REPO, SCRIPT]) assert.ok(inputs.allowedUrls.has(u.toLowerCase()), u)
  assert.equal(inputs.blockedGroup, null)
  assert.deepEqual(inputs.lessons, [])
})

test('inputs: clusters capped at 8 and stories at 10; used leads left out', async () => {
  const store = await seededStore()
  for (let i = 0; i < 12; i++) await store.createRecord({ type: 'question_cluster', status: 'open', payload: { cluster_id: `C-x${i}`, main_question: `q${i}`, topic_group: 3, rank_score: i, source_urls: [] } })
  for (let i = 0; i < 14; i++) await store.createRecord({ type: 'story_lead', status: 'open', payload: { story_id: `S-x${i}`, source_url: `https://a.com/${i}`, published_date: '2026-09-01', topic_group: 3 } })
  await store.createRecord({ type: 'question_cluster', status: 'used', payload: { cluster_id: 'C-used', main_question: 'u', source_urls: [] } })
  const inputs = await buildInputs({ config: config(), store, now })
  assert.equal(inputs.clusters.length, 8)
  assert.ok(inputs.otherStories.length <= 10)
  assert.ok(!inputs.leadIndex.has('C-used'))
})

test('inputs: lessons only when present, limited by LESSONS_LIMIT', async () => {
  const store = await seededStore()
  for (let i = 0; i < 7; i++) await store.createRecord({ type: 'lesson', payload: `lesson ${i}` })
  const inputs = await buildInputs({ config: config({ LESSONS_LIMIT: '5' }), store, now })
  assert.equal(inputs.lessons.length, 5)
})

test('inputs: no facts for today → clear error asking for the Scout', async () => {
  await assert.rejects(buildInputs({ config: config(), store: memoryStore(), now }), (e) => e instanceof InputsError && /Run the Scout first/.test(e.message))
})

test('blocked_group and least_used_groups', () => {
  assert.equal(blockedGroup([{ topic_group: 2 }, { topic_group: 2 }, { topic_group: 1 }]), 2)
  assert.equal(blockedGroup([{ topic_group: 2 }, { topic_group: 1 }, { topic_group: 2 }]), null)
  assert.equal(blockedGroup([{ topic_group: 2 }]), null)
  assert.deepEqual(leastUsedGroups([{ topic_group: 1 }, { topic_group: 2 }, { topic_group: 2 }, { topic_group: 3 }, { topic_group: 4 }]), [5])
  assert.deepEqual(leastUsedGroups([]), [1, 2, 3, 4, 5])
})

test('message: sections in order, ids present, under 50,000 chars', async () => {
  const { inputs } = await setup()
  const { message } = buildStrategistMessage(inputs, '--- TAIL ---')
  const order = ['TODAY', 'PINNED TOPICS DUE', 'RAPID-RESPONSE STORIES', 'OTHER STORIES', 'QUESTION CLUSTERS', 'TUTORIAL LEADS', 'STYLE NOTES', 'M91 FACTS', 'RECENT BRIEFS', 'PUBLISHED POSTS', 'ALREADY COVERED', 'LESSONS', 'COMPETITORS']
  let at = -1
  for (const s of order) {
    const i = message.indexOf(`--- ${s} ---`)
    assert.ok(i > at, s)
    at = i
  }
  assert.match(message, /"cluster_id":"C-1"/)
  assert.match(message, /--- PINNED TOPICS DUE ---\nnone/)
  assert.ok(message.endsWith('--- TAIL ---'))
  const big = { ...inputs, alreadyCovered: Array.from({ length: 60 }, () => '- ' + 'x'.repeat(1500)) }
  assert.ok(buildStrategistMessage(big).message.length <= 50000)
})

// ---------- schema ----------

test('schema: valid brief passes; strict objects; string (rtlayer) parsed', () => {
  assert.deepEqual(validateBrief(validBrief()).errors, [])
  assert.deepEqual(validateBrief(JSON.stringify(validBrief())).errors, [])
  assert.ok(validateBrief({ ...validBrief(), extra: 1 }).errors.length)
  assert.ok(validateBrief({ ...validBrief(), format: 'listicle' }).errors.length)
  const walk = (s) => {
    if (s?.type === 'object' && s.properties) {
      assert.equal(s.additionalProperties, false)
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort())
    }
    for (const v of Object.values(s ?? {})) if (v && typeof v === 'object') walk(v)
  }
  walk(strategist_brief.schema)
})

// ---------- 10.1 auto fixes ----------

test('auto-fix: https for docs hosts, standing claims, flags, CTA, tone, cleared blocks, trims, dupes', async () => {
  const { cfg, inputs } = await setup()
  const raw = validBrief({
    titles: ['  How to make your AI agent wait for a human yes ', 'How to make your AI agent wait for a human yes', 'Third'],
    m91_facts_to_use: [{ fact: 'Rings every phone in a channel at full volume until someone answers.', source_url: 'http://m91.msg91.com/llms.txt' }],
    claims_to_avoid: [STANDING_CLAIMS[0]],
    topic_group: 5,
    review_flags: ['rapid-response'],
    cta: { text: '', url: 'https://evil.example.com' },
    tone: { source: 'style_notes', profile_id: 'P-unknown', guidance: ['x'] },
    story: { use: false, story_id: 'S-1', attribution_line: 'x', source_url: STORY_URL, how_to_use: 'x' },
    supporting_keywords: ['a', 'A', 'b', 'c']
  })
  const { brief, fixes } = autoFix(raw, { config: cfg, inputs })
  assert.equal(brief.m91_facts_to_use[0].source_url, LLMS)
  assert.deepEqual(brief.claims_to_avoid.filter((c) => STANDING_CLAIMS.includes(c)).length, 2)
  assert.deepEqual(brief.review_flags, ['comparison'])
  assert.equal(brief.cta.url, CTA)
  assert.equal(brief.cta.text, DEFAULT_CTA_TEXT)
  assert.deepEqual(brief.tone, { source: 'default', profile_id: 'friendly-teacher', guidance: ['x'] })
  assert.deepEqual(brief.story, { use: false, story_id: '', attribution_line: '', source_url: '', how_to_use: '' })
  assert.deepEqual(brief.titles, ['How to make your AI agent wait for a human yes', 'Third'])
  assert.deepEqual(brief.supporting_keywords, ['a', 'b', 'c'])
  assert.ok(fixes.length >= 8)
  assert.equal(raw.cta.url, 'https://evil.example.com', 'input not mutated')
})

test('auto-fix: rapid_response gets its flag', async () => {
  const { cfg, inputs } = await setup()
  assert.deepEqual(autoFix(validBrief({ post_type: 'rapid_response', topic_group: 2 }), { config: cfg, inputs }).brief.review_flags, ['rapid-response'])
})

// ---------- 10.2 problems ----------

test('a fully valid brief has zero problems', async () => {
  const ctx = await setup()
  const { brief } = autoFix(validBrief(), { config: ctx.cfg, inputs: ctx.inputs })
  assert.deepEqual(await problemsOf(brief, ctx), [])
})

const cases = [
  ['titles count', { titles: ['a b c d', 'e f g h'] }, /exactly 3/],
  ['title too long', { titles: ['x'.repeat(71), 'b title', 'c title'] }, /titles\[0\] is 71 characters/],
  ['generic title', { titles: ['Implementing approvals', 'b title', 'c title'] }, /generic/],
  ['generic title 2', { titles: ['a title', 'The Ultimate Guide to alerts', 'c title'] }, /generic/],
  ['unknown lead', { lead: { kind: 'cluster', id: 'C-404' } }, /does not exist in the inputs/],
  ['kind/type mismatch', { post_type: 'tutorial', lead: { kind: 'cluster', id: 'C-1' } }, /needs a lead of kind 'tutorial'/],
  ['update candidate', { lead: { kind: 'cluster', id: 'C-2' }, topic_group: 2 }, /update_candidate/],
  ['invented fact', { m91_facts_to_use: [{ fact: 'M91 has 10 million users worldwide.', source_url: LLMS }] }, /does not match any M91 fact/],
  ['fact url not in facts', { m91_facts_to_use: [{ fact: 'Rings every phone in a channel at full volume until someone answers.', source_url: ISSUE }] }, /not a source in the m91_facts record/],
  ['invented url', { sources: [{ url: 'https://made-up.example.com/x', what_it_supports: 'x' }] }, /made-up\.example\.com.*not in the inputs/],
  ['sources empty', { sources: [] }, /sources is empty/],
  ['too few sections', { outline: validBrief().outline.slice(0, 3) }, /outline has 3 sections/],
  ['too few question headings', { outline: validBrief().outline.map((s) => ({ ...s, heading: s.heading.replace('?', '') })) }, /headings are questions/],
  ['empty answer_first', { outline: validBrief().outline.map((s, i) => (i === 0 ? { ...s, answer_first: '' } : s)) }, /answer_first is empty/],
  ['empty keyword', { keyword: '' }, /keyword is empty/],
  ['keyword too long', { keyword: 'How can HumanInTheLoop middleware reliably require human approval' }, /keyword "How can HumanInTheLoop middleware reliably require human approval" has 8 words; at most 6 \(KEYWORD_MAX_WORDS\)/],
  ['too few supporting keywords', { supporting_keywords: ['a', 'b'] }, /supporting_keywords has 2/],
  ['story mismatch', { story: { use: true, story_id: 'S-1', attribution_line: 'from the news', source_url: STORY_URL, how_to_use: 'x' } }, /attribution_line must be copied exactly/],
  ['tutorial off', { post_type: 'tutorial', lead: { kind: 'tutorial', id: 'T-1' } }, /tutorial.use is false/]
]
for (const [name, over, re] of cases) {
  test(`problem: ${name}`, async () => {
    const ctx = await setup()
    const { brief } = autoFix(validBrief(over), { config: ctx.cfg, inputs: ctx.inputs })
    const problems = await problemsOf(brief, ctx)
    assert.ok(problems.some((p) => re.test(p)), `expected ${re} in:\n${problems.join('\n')}`)
  })
}

test('problem: blocked topic group', async () => {
  const ctx = await setup()
  ctx.inputs.blockedGroup = 1
  assert.ok((await problemsOf(validBrief(), ctx)).some((p) => /topic_group 1 is blocked/.test(p)))
})

test('pinned: a due pinned topic must be picked; a future one is ignored', async () => {
  const store = await seededStore()
  await store.createRecord({ type: 'pinned_topic', status: 'open', payload: { pinned_id: 'PIN-1', topic: 'Opsgenie end of support', target_date: TODAY, priority: 'high', notes: '' } })
  await store.createRecord({ type: 'pinned_topic', status: 'open', payload: { pinned_id: 'PIN-2', topic: 'later', target_date: '2026-12-01', priority: 'normal', notes: '' } })
  const cfg = config()
  const inputs = await buildInputs({ config: cfg, store, now })
  assert.deepEqual(inputs.pinnedDue.map((p) => p.pinned_id), ['PIN-1'])
  const problems = await findProblems(validBrief(), { config: cfg, inputs, store })
  assert.ok(problems.some((p) => /pinned topic is due \(PIN-1\)/.test(p)))
  const pinned = validBrief({ post_type: 'pinned', lead: { kind: 'pinned', id: 'PIN-1' } })
  assert.deepEqual(await findProblems(pinned, { config: cfg, inputs, store }), [])
})

test('rapid response: date recomputed from the story record; news must match', async () => {
  const ctx = await setup()
  const news = { is_news_based: true, outlet: 'Example News', published_date: '2026-10-15', claim_in_own_words: 'x', source_url: STORY_URL }
  const ok = validBrief({ post_type: 'rapid_response', lead: { kind: 'story', id: 'S-1' }, topic_group: 2, news, review_flags: ['rapid-response'], sources: [{ url: STORY_URL, what_it_supports: 'x' }] })
  assert.deepEqual(await problemsOf(ok, ctx), [])
  const old = { ...ok, lead: { kind: 'story', id: 'S-2' }, news: { ...news, source_url: 'https://blog.example.com/old' } }
  assert.ok((await problemsOf(old, ctx)).some((p) => /not within RAPID_RESPONSE_DAYS/.test(p)))
  const wrongUrl = { ...ok, news: { ...news, source_url: ISSUE } }
  assert.ok((await problemsOf(wrongUrl, ctx)).some((p) => /news.source_url must be/.test(p)))
  const empty = { ...ok, news: { ...news, outlet: '' } }
  assert.ok((await problemsOf(empty, ctx)).some((p) => /news must be filled/.test(p)))
})

test('tutorial: steps must be a subset of the lead steps; every gap kept', async () => {
  const ctx = await setup()
  const tut = (steps, gaps) => validBrief({
    post_type: 'tutorial', lead: { kind: 'tutorial', id: 'T-1' }, format: 'tutorial',
    tutorial: { use: true, tutorial_id: 'T-1', target: 'Claude Code', reader_outcome: 'x', steps, gaps }
  })
  assert.deepEqual(await problemsOf(tut([{ step: 'Call m91.sh from the hook', source_url: SCRIPT }], ['Retry policy is not documented']), ctx), [])
  assert.ok((await problemsOf(tut([{ step: 'Add a retry loop', source_url: SCRIPT }], ['Retry policy is not documented']), ctx)).some((p) => /not one of the tutorial lead's steps/.test(p)))
  assert.ok((await problemsOf(tut([{ step: 'Install the skill', source_url: REPO }], []), ctx)).some((p) => /tutorial gap missing/.test(p)))
})

test('fact matching: exact passes, close paraphrase passes, invented fails', () => {
  const ref = 'Rings every phone in a channel at full volume until someone answers.'
  assert.equal(wordOverlap(ref, ref), 1)
  assert.ok(wordOverlap('M91 rings every phone in the channel at full volume until somebody answers', ref) >= 0.6)
  assert.ok(wordOverlap('M91 is used by ten thousand banks worldwide', ref) < 0.6)
})

test('URL allowlist: input URLs and M91_CTA_URL pass, invented fails', async () => {
  const ctx = await setup()
  const b = validBrief({ sources: [{ url: CTA, what_it_supports: 'signup' }, { url: SCRIPT, what_it_supports: 'x' }] })
  assert.deepEqual(await problemsOf(b, ctx), [])
})

test('duplicate check (DEDUPE_MODE=mem0): a similar past brief is a problem (ignored for the brief being revised)', async () => {
  const cfg = config({ DEDUPE_MODE: 'mem0' })
  const store = await seededStore({ similarity: (text, r) => (r.type === 'brief' ? 0.9 : 0) })
  await store.createRecord({ type: 'brief', briefId: 'B-OLD', status: 'approved', payload: { brief_id: 'B-OLD', titles: ['x'] } })
  const inputs = await buildInputs({ config: cfg, store, now })
  assert.ok((await findProblems(validBrief(), { config: cfg, inputs, store })).some((p) => /already covered by B-OLD/.test(p)))
  assert.deepEqual(await findProblems(validBrief(), { config: cfg, inputs, store, excludeBriefId: 'B-OLD' }), [])
})

// ---------- ids ----------

test('brief_id format and slug rules', () => {
  assert.match(newBriefId(new Date(NOW)), BRIEF_ID_RE)
  assert.equal(slugify('How to make your AI agent wait for a Human "yes"!'), 'how-to-make-your-ai-agent-wait-for-a-human-yes')
  const long = slugify('Stop your AI agents from refunding the wrong customers when nobody approves the payment in time')
  assert.ok(long.length <= 60)
  assert.ok(!long.endsWith('-'))
  assert.equal(long, 'stop-your-ai-agents-from-refunding-the-wrong-customers-when')
})

test('keyword length: a short keyword passes; KEYWORD_MAX_WORDS is respected; the prompt states the limit', async () => {
  const long = 'How can HumanInTheLoop middleware reliably require human approval'
  const ctx = await setup()
  const ok = await problemsOf(autoFix(validBrief(), { config: ctx.cfg, inputs: ctx.inputs }).brief, ctx)
  assert.ok(!ok.some((p) => /KEYWORD_MAX_WORDS/.test(p)), 'the 4-word fixture keyword passes')
  const loose = await setup({ KEYWORD_MAX_WORDS: '8' })
  const eight = await problemsOf(autoFix(validBrief({ keyword: long }), { config: loose.cfg, inputs: loose.inputs }).brief, loose)
  assert.ok(!eight.some((p) => /KEYWORD_MAX_WORDS/.test(p)), 'an 8-word keyword passes with KEYWORD_MAX_WORDS=8')
  const { buildPlanPrompt } = await import('../../src/strategist/prompts.js')
  assert.match(buildPlanPrompt(ctx.cfg, ctx.inputs), /a short phrase people type into a search box, at most 6 words \(for example "ai agent human approval"\), never a whole question or sentence\./)
})

test('auto-fix: http → https on both M91 docs hosts (m91-api.msg91.com and m91.msg91.com)', async () => {
  const { cfg, inputs } = await setup()
  assert.deepEqual(cfg.scout.docsHosts, ['m91-api.msg91.com', 'm91.msg91.com'])
  const raw = validBrief({
    m91_facts_to_use: [
      { fact: 'Rings every phone in a channel at full volume until someone answers.', source_url: 'http://m91-api.msg91.com/llms.txt' },
      { fact: 'Rings every phone in a channel at full volume until someone answers.', source_url: 'http://m91.msg91.com/llms.txt' }
    ]
  })
  const { brief } = autoFix(raw, { config: cfg, inputs })
  assert.deepEqual(brief.m91_facts_to_use.map((f) => f.source_url), ['https://m91-api.msg91.com/llms.txt', 'https://m91.msg91.com/llms.txt'])
})

test('duplicate check (local, Phase 9 A3): a past brief with a similar title is a problem; no Mem0 search', async () => {
  const cfg = config()
  const store = await seededStore()
  store.searchSimilar = async () => { throw new Error('Mem0 search called in local mode') }
  const b = validBrief()
  await store.createRecord({ type: 'brief', briefId: 'B-OLD', status: 'approved', payload: { brief_id: 'B-OLD', titles: [b.titles[0]], keyword: b.keyword } })
  const inputs = await buildInputs({ config: cfg, store, now })
  assert.ok((await findProblems(b, { config: cfg, inputs, store })).some((p) => /already covered by B-OLD/.test(p)))
  assert.deepEqual(await findProblems(b, { config: cfg, inputs, store, excludeBriefId: 'B-OLD' }), [])
})
