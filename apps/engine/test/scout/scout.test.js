import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runScout, ScoutError } from '../../src/scout/index.js'
import { SCHEMA_RETRY_NOTE } from '../../src/scout/prompts.js'
import { runPipeline, defaultAgents } from '../../src/orchestrator.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { createNotifier } from '../../src/notify.js'
import { AiError } from '../../src/viasocket.js'
import { fakeConfig, memoryStore, fakeNotifier, fakeFetch, mockReviewer } from '../helpers.js'
import { fakeAi, fakeWeb, fakeChecker, VALID, INVALID, truncated, fatal, LLMS } from './fixtures.js'

const NOW = Date.parse('2026-10-17T08:35:00Z') // 14:05 IST
const RUN = '261017-1405-ABCD'

function setup({ env = {}, answers = {}, store, web = fakeWeb(), checker = fakeChecker(), notifier } = {}) {
  const config = fakeConfig({ M91_DOCS_URL: LLMS, ...env })
  store ??= memoryStore({ dryRun: config.runtime.dryRun })
  const ai = fakeAi(answers)
  notifier ??= fakeNotifier()
  const deps = { config, store, notifier, aiSend: ai, fetch: web, urlChecker: checker, now: () => NOW }
  return { config, store, ai, notifier, web, checker, deps, run: (params = { mode: 'research', runId: RUN }) => runScout(params, deps) }
}
const recordsOf = (store, type) => [...store.records.values()].filter((r) => r.type === type)
const callLogs = (store) => recordsOf(store, 'run_log').map((r) => r.payload)

test('research: full run with all checks, records, ranking, Slack summary', async () => {
  const s = setup()
  const r = await s.run()

  // Calls: facts, 5 question groups, stories, tutorials, clusters, style.
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['facts', 'questions-1', 'questions-2', 'questions-3', 'questions-4', 'questions-5', 'stories', 'tutorials', 'clusters', 'style'])
  assert.equal(r.calls_used, 10)
  assert.equal(r.mode, 'research')
  assert.equal(r.reused, false)

  // Prompt = SCOUT_BASE + task, today filled; fresh thread per call; deliveries per brief.
  const facts = s.ai.requests[0]
  assert.match(facts.prompt, /^You are the Scout for M91's blog research\./)
  assert.match(facts.prompt, /Today's date \(India\): 2026-10-17\n\nTask: build a compact fact sheet/)
  assert.match(facts.message, /--- M91 DOCS ---\n=== SOURCE: https:\/\/m91\.msg91\.com\/llms\.txt ===/)
  assert.equal(facts.delivery, 'sync')
  assert.equal(s.ai.requests[1].delivery, 'rtlayer')
  assert.equal(s.ai.requests.find((q) => q.call === 'clusters').delivery, 'sync')
  assert.equal(s.ai.requests.find((q) => q.call === 'style').delivery, 'rtlayer')
  assert.match(s.ai.requests[1].threadId, /^scout-261017-1405-ABCD-questions-1-[a-z0-9]{4}$/)
  assert.equal(new Set(s.ai.requests.map((q) => q.threadId)).size, 10)
  assert.match(s.ai.requests[1].prompt, /1\. Human approval for AI agents/)
  assert.match(s.ai.requests[1].prompt, /Return up to 8 distinct questions/)
  assert.ok(!/--- M91 DOCS ---/.test(s.ai.requests[1].message), 'questions get only the sections they need')

  // Facts: off-bundle URL dropped, http → https.
  const f = recordsOf(s.store, 'm91_facts')[0]
  assert.equal(f.status, 'current')
  assert.deepEqual(f.payload.can.map((x) => x.source_url), ['https://m91.msg91.com/docs/intro.md', 'https://m91.msg91.com/docs/api.md'])

  // Questions: the dead-link one dropped in every group.
  assert.equal(r.counts.questions, 5)
  assert.ok(r.counts.dropped_dead_links >= 5)

  // Stories: old one dropped, undated kept but not rapid, rapid computed in code.
  const stories = recordsOf(s.store, 'story_lead')
  assert.deepEqual(stories.map((x) => x.payload.title), ['Agent refunded the wrong customers', 'Undated story'])
  assert.deepEqual(stories.map((x) => x.payload.within_rapid_response_window), [true, false])
  assert.equal(r.rapid_response_story_ids.length, 1)

  // Tutorials: the one citing a non-doc URL is dropped.
  const tutorials = recordsOf(s.store, 'tutorial_lead')
  assert.equal(tutorials.length, 1)
  assert.equal(tutorials[0].payload.target, 'Claude Code')

  // Cluster: freshness recomputed from date_seen (2026-10-15 → this_week), ranked.
  const cl = recordsOf(s.store, 'question_cluster')
  assert.equal(cl.length, 1)
  assert.equal(cl[0].payload.freshness, 'this_week')
  assert.equal(cl[0].payload.rank_score, 2 * 5 + 3 + 2)
  assert.match(cl[0].payload.cluster_id, /^C-\d{6}-\d{4}-[A-Z0-9]{4}$/)
  assert.equal(r.top_clusters[0].main_question, 'How do I make my agent ask before deleting data?')

  // Style notes saved for the top cluster's group.
  const tone = recordsOf(s.store, 'tone_profile')[0]
  assert.equal(tone.payload.kind, 'style_notes')
  assert.equal(tone.topicGroup, 1)
  assert.equal(r.style_profile_id, tone.payload.profile_id)

  // A log entry per call (+ summary) in the result, with the brief's fields; no run_log records (Phase 9 A2).
  const logs = r.calls
  assert.equal(logs.length, 11)
  assert.equal(callLogs(s.store).length, 0)
  // The research time is noted on today's facts record (the next run's reuse check reads it there).
  assert.ok(recordsOf(s.store, 'm91_facts')[0].payload.research_at)
  for (const k of ['run_id', 'agent', 'call', 'model', 'delivery', 'ms', 'items_returned', 'items_kept', 'items_dropped', 'retries', 'error']) assert.ok(k in logs[0], k)

  // Slack summary in the brief's format.
  assert.equal(s.notifier.sent.slack.length, 1)
  assert.match(s.notifier.sent.slack[0], /^🔎 Scout finished \(run 261017-1405-ABCD, fresh research\)/)
  assert.match(s.notifier.sent.slack[0], /Top topics:\n1\. How do I make my agent ask before deleting data\? \(group 1, fit 5\/5, demand high\)/)
})

test('low-credit settings: only the chosen question groups are searched, within a 6-call budget', async () => {
  const s = setup({ env: { SCOUT_QUESTION_GROUPS: '1', SCOUT_QUESTIONS_PER_GROUP: '3', SCOUT_MAX_CALLS: '6' } })
  const r = await s.run()
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['facts', 'questions-1', 'stories', 'tutorials', 'clusters', 'style'])
  assert.equal(r.calls_used, 6)
  assert.match(s.ai.requests[1].prompt, /Return up to 3 distinct questions/)
})

test('llms.txt failure fails the run', async () => {
  const s = setup({ web: fakeWeb({ llmsStatus: 500 }) })
  await assert.rejects(s.run(), ScoutError)
  assert.equal(s.ai.requests.length, 0)
})

test('facts call failure fails the run; token errors are not retried', async () => {
  const s = setup({ answers: { facts: fatal('token') } })
  await assert.rejects(s.run(), /facts call failed/)
  assert.equal(s.ai.requests.length, 1)
  assert.equal(callLogs(s.store)[0].error, 'fake token error')
})

test('a fatal config/token error in a later call also fails the run', async () => {
  const s = setup({ answers: { 'questions-2': fatal('config') } })
  await assert.rejects(s.run(), ScoutError)
})

test('402 plan credits exhausted fails the run (no retry, no further calls)', async () => {
  const s = setup({ answers: { clusters: fatal('billing') } })
  await assert.rejects(s.run(), /clusters: fake billing error/)
  assert.equal(s.ai.requests.at(-1).call, 'clusters')
})

test('one question group failing only adds a warning', async () => {
  const s = setup({ answers: { 'questions-3': new AiError('server down', { kind: 'server', retryable: true }) } })
  const r = await s.run()
  assert.equal(r.counts.questions, 4)
  assert.ok(r.warnings.some((w) => /questions-3 failed/.test(w)))
})

test('zero clusters, stories and tutorials fails the run', async () => {
  const s = setup({ answers: { questions: { questions: [] }, stories: { stories: [] }, tutorials: { tutorials: [] } } })
  await assert.rejects(s.run(), /0 open clusters, 0 open story leads and 0 open tutorial leads/)
})

test('schema retry: once with the note, then the call fails with a warning', async () => {
  const s = setup({ answers: { 'questions-1': (n) => (n === 1 ? INVALID.scout_questions : VALID.scout_questions), 'questions-2': INVALID.scout_questions } })
  const r = await s.run()
  const q1 = s.ai.requests.filter((q) => q.call === 'questions-1')
  assert.equal(q1.length, 2)
  assert.ok(q1[1].prompt.endsWith(SCHEMA_RETRY_NOTE))
  assert.equal(s.ai.requests.filter((q) => q.call === 'questions-2').length, 2)
  assert.ok(r.warnings.some((w) => /questions-2 failed: answer did not match scout_questions/.test(w)))
})

test('truncated answer: retried once asking for fewer items', async () => {
  const s = setup({ answers: { 'questions-2': (n) => (n === 1 ? truncated() : VALID.scout_questions) } })
  await s.run()
  const q2 = s.ai.requests.filter((q) => q.call === 'questions-2')
  assert.equal(q2.length, 2)
  assert.match(q2[1].prompt, /Return up to 4 distinct questions/)
  assert.match(q2[1].prompt, /Return at most 4 questions\.$/)
})

test('budget: never more than SCOUT_MAX_CALLS calls, retries included', async () => {
  const s = setup({ answers: { questions: INVALID.scout_questions } })
  await s.run().catch(() => {})
  assert.ok(s.ai.requests.length <= 14, `${s.ai.requests.length} calls`)
  s.ai.requests.forEach((q, i) => assert.ok(q.retries <= 14 - (i + 1), `retries allowed on call ${i + 1}: ${q.retries}`))

  const small = setup({ env: { SCOUT_MAX_CALLS: '4' } })
  const err = await small.run().catch((e) => e)
  assert.ok(small.ai.requests.length <= 4)
  assert.ok(err instanceof ScoutError)
})

async function seedReusable(store, { hoursAgo = 2, openClusters = 5, dryRun = false } = {}) {
  for (let i = 0; i < openClusters; i++) {
    await store.createRecord({ type: 'question_cluster', payload: { cluster_id: `C-${i}`, main_question: `Q${i}`, topic_group: 2, m91_fit: { score: 3 }, demand: { level: 'low' }, freshness: 'ongoing' }, status: 'open', topicGroup: 2 })
  }
  // The last research time lives on the facts record (Phase 9); a DRY_RUN research never sets it.
  await store.createRecord({ type: 'm91_facts', payload: { ...VALID.scout_m91_facts, sources: ['https://m91.msg91.com/llms.txt'], research_at: dryRun ? null : new Date(NOW - hoursAgo * 3600000).toISOString() }, status: 'current', date: '2026-10-17' })
}

test('reuse: recent run + enough open clusters → no question, tutorial or cluster calls; today\'s facts reused', async () => {
  const store = memoryStore()
  await seedReusable(store)
  const s = setup({ store })
  const r = await s.run()
  assert.equal(r.reused, true)
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['stories', 'style'])
  assert.equal(recordsOf(store, 'question_cluster').length, 5)
  assert.match(s.notifier.sent.slack[0], /reused research/)
})

test('reuse: not when the last run is too old or too few clusters are open', async () => {
  const old = memoryStore()
  await seedReusable(old, { hoursAgo: 30 })
  assert.equal((await setup({ store: old }).run()).reused, false)
  const few = memoryStore()
  await seedReusable(few, { openClusters: 2 })
  assert.equal((await setup({ store: few }).run()).reused, false)
})

test('dedupe in research: an open cluster with the same question is merged, not duplicated; stored stories skipped', async () => {
  const store = memoryStore()
  await store.createRecord({ type: 'question_cluster', payload: { cluster_id: 'C-old', main_question: 'How do I make my agent ask before deleting data?', related_questions: [], source_urls: [], freshness: 'ongoing', m91_fit: { score: 5 }, demand: { level: 'high' } }, status: 'open', topicGroup: 1 })
  await store.createRecord({ type: 'story_lead', payload: { source_url: 'https://news.example.com/s1', published_date: '2026-10-14' }, status: 'open' })
  const r = await setup({ store }).run()
  assert.equal(r.counts.clusters_merged, 1)
  assert.equal(r.counts.clusters_new, 0)
  assert.equal(recordsOf(store, 'question_cluster').length, 1)
  assert.equal(recordsOf(store, 'question_cluster')[0].payload.source_urls.length, 1)
  assert.equal(recordsOf(store, 'story_lead').length, 2) // the seeded one + the undated one
})

test('DRY_RUN: AI is called, nothing but run_log is saved, no Slack request', async () => {
  const fetch = fakeFetch(() => ({ body: { ok: true } }))
  const config = fakeConfig({ DRY_RUN: 'true', M91_DOCS_URL: LLMS })
  const s = setup({ env: { DRY_RUN: 'true' }, notifier: createNotifier({ config, fetch }) })
  const r = await s.run()
  assert.equal(s.ai.requests.length, 10)
  assert.ok([...s.store.records.values()].every((x) => x.type === 'run_log'))
  assert.ok(callLogs(s.store).every((l) => l.dry_run === true))
  assert.equal(fetch.calls.length, 0)
  assert.equal(r.counts.clusters_new, 1)
})

test('sources mode: verdicts counted, dead URLs dropped, source_pack saved under the brief', async () => {
  const s = setup({ checker: fakeChecker({}) })
  const r = await s.run({ mode: 'sources', briefId: 'B-1', version: 2, claims: ['M91 rings a phone for approval', 'M91 was founded on the Moon'], reviewerNote: 'check these' })
  assert.equal(r.mode, 'sources')
  assert.equal(r.claims_supported, 1)
  assert.equal(r.claims_unverified, 1)
  assert.equal(r.claims_contradicted, 0)
  const pack = recordsOf(s.store, 'source_pack')[0]
  assert.equal(pack.briefId, 'B-1')
  assert.equal(pack.version, 2)
  assert.equal(r.record_id, pack.id)
  assert.match(s.ai.requests[0].message, /--- CLAIMS ---\n1\. M91 rings a phone for approval\n2\. M91 was founded on the Moon\nReviewer note: check these/)
  assert.equal(s.ai.requests[0].delivery, 'rtlayer')

  const dead = setup({ checker: fakeChecker({ 'https://m91.msg91.com/docs/intro.md': 'dead' }) })
  const r2 = await dead.run({ mode: 'sources', briefId: 'B-1', claims: ['M91 rings a phone for approval'] })
  assert.equal(r2.claims_supported, 0)
})

test('orchestrator: the real Scout reads this week’s questions, then researches the editor’s pick for the Strategist', async () => {
  const config = fakeConfig({ DRY_RUN: 'true', M91_DOCS_URL: LLMS })
  const store = memoryStore({ dryRun: true })
  const notifier = fakeNotifier()
  const ai = fakeAi({ 'questions-week': { questions: [] }, 'questions-slot': { main_question: 'When should an AI agent call a human?', related_questions: [], demand: { level: 'medium', reason: 'asked a few times' } }, 'sources-slot': { sources: [] } })
  // The editor and the real Strategist have their own tests; here the stubs stand in for them.
  const real = defaultAgents({ config, store, notifier, scoutDeps: { aiSend: ai, fetch: fakeWeb(), urlChecker: fakeChecker(), now: () => NOW } })
  const modes = []
  let leads = null
  const agents = { ...real, scout: async (ctx) => { modes.push(ctx.scoutMode); return real.scout(ctx) }, editor: stubAgents.editor, strategist: async (ctx) => { leads = ctx.leads; return stubAgents.strategist(ctx) }, writer: stubAgents.writer, designer: stubAgents.designer, reviewer: mockReviewer() }
  const r = await runPipeline({ config, store, notifier, agents, now: () => NOW, briefId: RUN })
  assert.equal(r.state, 'awaiting_human')
  assert.deepEqual(r.steps.map((x) => x.agent).slice(0, 4), ['scout', 'editor', 'scout', 'strategist'])
  assert.deepEqual(modes, ['week', 'slot'])
  // DRY_RUN saves nothing, so the focused research builds the facts again (a real run reuses today's).
  assert.deepEqual(ai.requests.map((q) => q.call), ['facts', 'questions-week', 'facts', 'questions-slot', 'sources-slot'])
  assert.equal(leads.mode, 'slot')
  assert.equal(leads.target.pick_id, 'W-stub')
  assert.equal(callLogs(store).length, 0, 'no run_log records for successful calls')
})

/** memoryStore that logs every write: [kind, type, id]. */
function writeLogged() {
  const store = memoryStore()
  const log = []
  const create = store.createRecord.bind(store)
  const update = store.updateRecord.bind(store)
  store.createRecord = async (a) => { const r = await create(a); log.push(['create', a.type, r.id]); return r }
  store.updateRecord = async (id, p, m) => { log.push(['update', store.records.get(id)?.type, id]); return update(id, p, m) }
  return { store, log }
}

test('Phase 9 A2: one write per cluster — a new cluster is created with its rank (no update); a merge is one update', async () => {
  const fresh = writeLogged()
  await setup({ store: fresh.store }).run()
  const cl = recordsOf(fresh.store, 'question_cluster')[0]
  assert.equal(cl.payload.rank_score, 2 * 5 + 3 + 2, 'ranked at creation')
  assert.deepEqual(fresh.log.filter((w) => w[1] === 'question_cluster').map((w) => w[0]), ['create'])
  assert.equal(fresh.log.filter((w) => w[1] === 'run_log').length, 0)

  const merged = writeLogged()
  await merged.store.createRecord({ type: 'question_cluster', payload: { cluster_id: 'C-old', main_question: 'How do I make my agent ask before deleting data?', related_questions: [], source_urls: [], freshness: 'ongoing', m91_fit: { score: 5 }, demand: { level: 'high' } }, status: 'open', topicGroup: 1 })
  merged.log.length = 0
  const r = await setup({ store: merged.store }).run()
  assert.equal(r.counts.clusters_merged, 1)
  assert.deepEqual(merged.log.filter((w) => w[1] === 'question_cluster').map((w) => w[0]), ['update'])
  const c = recordsOf(merged.store, 'question_cluster')[0].payload
  assert.equal(c.source_urls.length, 1, 'the merge')
  assert.ok(typeof c.rank_score === 'number', 'and the rank, in the same write')
})

test('Phase 9 B3: the stories call asks for at most 5, waits SCOUT_STORIES_TIMEOUT_MS, keeps the first 5', async () => {
  const many = { stories: Array.from({ length: 7 }, (_, i) => ({ ...VALID.scout_stories.stories[0], title: `Story ${i}`, source_url: `https://news.example.com/many-${i}` })) }
  const s = setup({ env: { SCOUT_STORIES_TIMEOUT_MS: '480000' }, answers: { stories: many } })
  const r = await s.run()
  const q = s.ai.requests.find((x) => x.call === 'stories')
  assert.match(q.prompt, /Return at most 5 stories, the most relevant first\./)
  assert.equal(q.timeoutMs, 480000)
  assert.ok(s.ai.requests.filter((x) => x.call.startsWith('questions')).every((x) => x.timeoutMs === 420000), 'question groups: SCOUT_QUESTIONS_TIMEOUT_MS')
  assert.ok(s.ai.requests.filter((x) => x.call !== 'stories' && !x.call.startsWith('questions')).every((x) => x.timeoutMs === undefined), 'other calls keep AI_RTLAYER_TIMEOUT_MS')
  assert.ok(r.warnings.some((w) => /stories: 7 returned, kept the first 5/.test(w)))
  assert.ok(r.counts.stories <= 5)
})

test('Phase 9 B3: a stories timeout is a warning; the run goes on', async () => {
  const s = setup({ answers: { stories: new AiError('No answer in thread history after 480 s', { kind: 'timeout' }) } })
  const r = await s.run()
  assert.equal(r.counts.stories, 0)
  assert.ok(r.warnings.some((w) => /stories failed: No answer in thread history after 480 s/.test(w)))
  assert.ok(r.counts.clusters_new + r.counts.clusters_merged > 0, 'clusters still made')
})

test('Phase 9 B4: every dropped tutorial is named with its reason (warnings and the step output)', async () => {
  const s = setup()
  const { withRun, replay, resetEvents } = await import('../../src/events.js')
  resetEvents()
  const r = await withRun('R-B4', () => s.run({ mode: 'research', runId: 'R-B4' }))
  assert.ok(r.warnings.some((w) => w === 'tutorials: dropped "Unsupported tutorial": step 1 cites https://random.example.com/guide, which is not in today\'s docs or the skill repo'), JSON.stringify(r.warnings))
  const out = replay('R-B4').find((e) => e.type === 'step.output' && e.step === 'scout.tutorials')
  assert.match(out.message, /1 kept of 2 returned \(1 dropped\): "Unsupported tutorial" \(step 1 cites https:\/\/random\.example\.com\/guide/)
  assert.deepEqual(out.data.dropped_items.map((d) => d.title), ['Unsupported tutorial'])
})

test('Phase 9 B4: a step citing the same docs page on the other docs host maps to today\'s bundle URL (not dropped)', async () => {
  const moved = { tutorials: [{ ...VALID.scout_tutorials.tutorials[0], steps_outline: [{ step: 'Call the API', source_url: 'https://m91-api.msg91.com/docs/api.md' }], supporting_facts: [{ fact: 'Has an HTTP API', source_url: 'https://m91-api.msg91.com/docs/api.md' }] }] }
  const s = setup({ answers: { tutorials: moved } })
  const r = await s.run()
  assert.equal(r.counts.tutorials, 1, JSON.stringify(r.warnings))
  const t = [...s.store.records.values()].find((x) => x.type === 'tutorial_lead')
  assert.equal(t.payload.steps_outline[0].source_url, 'https://m91.msg91.com/docs/api.md', 'the bundle\'s own URL')
  assert.equal(t.payload.supporting_facts[0].source_url, 'https://m91.msg91.com/docs/api.md')
})

/** The Scout's fake AI, with each call taking `ms` and a count of calls in flight at once. */
function slowAi(ms = 20) {
  const ai = fakeAi()
  let inFlight = 0
  let max = 0
  const fn = async (opts) => {
    inFlight++
    max = Math.max(max, inFlight)
    await new Promise((r) => setTimeout(r, ms))
    inFlight--
    return ai(opts)
  }
  fn.requests = ai.requests
  fn.max = () => max
  return fn
}

test('the question groups, stories and tutorials run at the same time (at most SCOUT_CONCURRENCY); results keep their order', async () => {
  const parallel = setup()
  const slow = slowAi(30)
  parallel.deps.aiSend = slow
  const started = Date.now()
  const r = await parallel.run()
  const parallelMs = Date.now() - started
  assert.equal(slow.max(), 7, '5 question groups + stories + tutorials in flight together')
  // Facts before them; clusters (and style) after them, since they need the questions.
  const order = slow.requests.map((q) => q.call)
  assert.equal(order[0], 'facts')
  assert.ok(order.indexOf('clusters') > Math.max(...['questions-1', 'questions-5', 'stories', 'tutorials'].map((c) => order.indexOf(c))))
  const one = setup({ env: { SCOUT_CONCURRENCY: '1' } })
  const slowOne = slowAi(30)
  one.deps.aiSend = slowOne
  const t1 = Date.now()
  const r1 = await one.run()
  assert.equal(slowOne.max(), 1, 'SCOUT_CONCURRENCY=1: one after another')
  assert.ok(Date.now() - t1 > parallelMs + 100, 'running together is faster')
  // Same results either way.
  assert.deepEqual(r.counts, r1.counts)
  const titles = (s) => [...s.store.records.values()].filter((x) => x.type === 'question_cluster' || x.type === 'story_lead' || x.type === 'tutorial_lead').map((x) => x.payload.main_question ?? x.payload.title)
  assert.deepEqual(titles(parallel), titles(one))
})

test('a fatal error in one parallel call still fails the run (the others finish quietly)', async () => {
  const s = setup({ answers: { 'questions-2': fatal('token') } })
  await assert.rejects(s.run(), ScoutError)
})
