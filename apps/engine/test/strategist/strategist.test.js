import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runStrategist, StrategistError } from '../../src/strategist/index.js'
import { setLeadStatus } from '../../src/strategist/save.js'
import { runPipeline, defaultAgents } from '../../src/orchestrator.js'
import { stubAgents } from '../../src/agents/stubs.js'
import { createNotifier } from '../../src/notify.js'
import { AiError, TruncatedError } from '../../src/viasocket.js'
import { fakeNotifier, fakeFetch, memoryStore, mockReviewer } from '../helpers.js'
import { NOW, config, seededStore, validBrief, fakeAi } from './fixtures.js'
import { STANDING_CLAIMS } from '../../src/strategist/prompts.js'

const now = () => NOW
const recordsOf = (store, type) => [...store.records.values()].filter((r) => r.type === type)
const statusOf = (store, type, idField, id) => recordsOf(store, type).find((r) => r.payload?.[idField] === id)?.status

async function setup({ env, answers, store, notifier } = {}) {
  const cfg = config(env)
  if (!store) {
    store = await seededStore()
    store.setDryRun(cfg.runtime.dryRun)
  }
  const ai = fakeAi(answers)
  notifier ??= fakeNotifier()
  const run = (params = { mode: 'plan', runId: '261017-1405-ABCD' }) => runStrategist(params, { config: cfg, store, notifier, aiSend: ai, now })
  return { cfg, store, ai, notifier, run }
}

test('plan: one call, brief saved with code fields, lead marked used, Slack summary', async () => {
  const s = await setup()
  const r = await s.run()
  assert.equal(s.ai.requests.length, 1)
  const q = s.ai.requests[0]
  assert.match(q.threadId, /^strategist-261017-1405-ABCD-plan-[a-z0-9]{4}$/)
  assert.match(q.prompt, /^You are the Strategist for M91's blog\./)
  assert.match(q.prompt, /You have no web access\./)
  assert.match(q.prompt, /Do not pick clusters marked update_candidate\./)
  assert.match(q.prompt, /Never pick topic group none \(no group is blocked\)/)
  assert.match(q.prompt, /TODAY \(India\): 2026-10-17/)
  assert.equal(q.jsonSchema.name, 'strategist_brief')
  assert.equal(q.agent, 'strategist')

  assert.equal(r.mode, 'plan')
  assert.equal(r.brief_id, '261017-1405-ABCD')
  assert.equal(r.brief_version, 1)
  assert.equal(r.repairs_used, 0)
  assert.deepEqual(r.lead, { kind: 'cluster', id: 'C-1' })
  const saved = recordsOf(s.store, 'brief')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].status, 'new')
  assert.equal(saved[0].version, 1)
  const p = saved[0].payload
  assert.equal(p.slug, 'how-to-make-your-ai-agent-wait-for-a-human-yes')
  assert.deepEqual(p.word_target, { min: 700, max: 1500 })
  assert.deepEqual(p.reading_level, { intro_max_grade: 6, post_max_grade: 8 })
  assert.deepEqual(p.internal_links, [])
  assert.equal(p.run_id, '261017-1405-ABCD')
  for (const c of STANDING_CLAIMS) assert.ok(p.claims_to_avoid.includes(c))
  assert.equal(statusOf(s.store, 'question_cluster', 'cluster_id', 'C-1'), 'used')
  assert.equal(recordsOf(s.store, 'question_cluster').find((c) => c.payload.cluster_id === 'C-1').payload.used_by, '261017-1405-ABCD')
  assert.match(s.notifier.sent.slack[0], /^🧭 Brief ready: \*How to make your AI agent wait for a human yes\*\nType: question · Group: 1 · Format: guide · Intent: learn/)
  const log = recordsOf(s.store, 'run_log')[0].payload
  assert.equal(log.agent, 'strategist')
  assert.equal(log.call, 'plan')
  assert.equal(log.result, 'ok')
})

test('repair flow: bad then good → saved with repairs_used 1; repair message lists the problems', async () => {
  const s = await setup({ answers: { plan: validBrief({ titles: ['Implementing approvals', 'b title', 'c title'] }) } })
  const r = await s.run()
  assert.equal(r.repairs_used, 1)
  assert.deepEqual(s.ai.requests.map((q) => q.call), ['plan', 'repair'])
  const rep = s.ai.requests[1]
  assert.notEqual(rep.threadId, s.ai.requests[0].threadId)
  assert.equal(rep.prompt, s.ai.requests[0].prompt, 'full PLAN prompt again')
  assert.match(rep.message, /--- YOUR PREVIOUS BRIEF ---\n\{.*"Implementing approvals"/)
  assert.match(rep.message, /--- PROBLEMS FOUND BY THE CHECKER ---\n- titles\[0\] is generic/)
  assert.match(rep.message, /--- WHAT TO DO ---\nReturn a corrected brief/)
  assert.equal(recordsOf(s.store, 'brief').length, 1)
})

test('repair flow: bad twice → plan fails, nothing saved, no lead used', async () => {
  const bad = validBrief({ lead: { kind: 'cluster', id: 'C-404' } })
  const s = await setup({ answers: { plan: bad, repair: bad } })
  await assert.rejects(s.run(), (e) => e instanceof StrategistError && /after 1 repair/.test(e.message) && /C-404/.test(e.message))
  assert.equal(recordsOf(s.store, 'brief').length, 0)
  assert.equal(statusOf(s.store, 'question_cluster', 'cluster_id', 'C-1'), 'open')
  assert.equal(recordsOf(s.store, 'run_log').length, 2)
})

test('schema-invalid answer and truncation are repaired (truncation counts as a repair)', async () => {
  const inv = await setup({ answers: { plan: { nope: true } } })
  assert.equal((await inv.run()).repairs_used, 1)
  const tr = await setup({ answers: { plan: new TruncatedError({ content: '' }) } })
  const r = await tr.run()
  assert.equal(r.repairs_used, 1)
  assert.match(tr.ai.requests[1].message, /shorter points \(at most 3 per section\)/)
})

test('config/token/billing errors fail at once, no retry', async () => {
  const s = await setup({ answers: { plan: new AiError('bad model', { kind: 'config' }) } })
  await assert.rejects(s.run(), /plan call failed \(config\)/)
  assert.equal(s.ai.requests.length, 1)
})

test('no open leads → clear failure', async () => {
  const cfg = config()
  const store = await seededStore()
  for (const r of store.records.values()) if (['question_cluster', 'story_lead', 'tutorial_lead'].includes(r.type)) r.status = 'used'
  await assert.rejects(runStrategist({ mode: 'plan' }, { config: cfg, store, aiSend: fakeAi(), now }), /No open leads/)
})

test('story-based post marks the story and the cluster it drew questions from as used', async () => {
  const brief = validBrief({
    post_type: 'story', lead: { kind: 'story', id: 'S-2' }, topic_group: 4,
    story: { use: true, story_id: 'S-2', attribution_line: 'described on Example Blog', source_url: 'https://blog.example.com/old', how_to_use: 'as an example' }
  })
  const s = await setup({ answers: { plan: brief } })
  await s.run()
  assert.equal(statusOf(s.store, 'story_lead', 'story_id', 'S-2'), 'used')
  assert.equal(statusOf(s.store, 'question_cluster', 'cluster_id', 'C-1'), 'used')
})

test('saving: brief first, then leads; a failing lead update is retried once', async () => {
  const s = await setup()
  const order = []
  const create = s.store.createRecord.bind(s.store)
  const update = s.store.updateRecord.bind(s.store)
  s.store.createRecord = async (args) => { if (args.type === 'brief') order.push('brief'); return create(args) }
  let fails = 1
  s.store.updateRecord = async (...a) => { order.push('lead'); if (fails-- > 0) throw new Error('flaky'); return update(...a) }
  const r = await s.run()
  assert.deepEqual(order, ['brief', 'lead', 'lead'])
  assert.equal(r.warnings.length, 0)

  let calls = 0
  const w = await setLeadStatus({ updateRecord: async () => { calls++; throw new Error('down') } }, { id: 'x', type: 'question_cluster', payload: {} }, 'used', 'B')
  assert.equal(calls, 2)
  assert.match(w, /could not set question_cluster x to used/)
})

test('re-brief, same lead (angle fix): new version saved, old superseded, lead untouched', async () => {
  const s = await setup()
  await s.run()
  const r = await s.run({ mode: 'rebrief', briefId: '261017-1405-ABCD', briefVersion: 1, feedback: [{ area: 'angle', problem: 'the angle repeats what every article says', fix: 'show the timeout case', send_to: 'strategist' }] })
  assert.equal(r.brief_version, 2)
  const q = s.ai.requests.at(-1)
  assert.equal(q.call, 'rebrief')
  assert.match(q.message, /--- CURRENT BRIEF \(version 1\) ---/)
  assert.match(q.message, /--- REVIEWER FEEDBACK \(send_to: strategist\) ---\n- angle: the angle repeats what every article says — show the timeout case/)
  const versions = recordsOf(s.store, 'brief').sort((a, b) => a.version - b.version)
  assert.deepEqual(versions.map((v) => [v.version, v.status]), [[1, 'superseded'], [2, 'new']])
  assert.equal(statusOf(s.store, 'question_cluster', 'cluster_id', 'C-1'), 'used')
})

test('re-brief, changed lead: new lead used; old lead back to open, or discarded for duplicate feedback', async () => {
  const newLead = validBrief({ post_type: 'tutorial', lead: { kind: 'tutorial', id: 'T-1' }, format: 'tutorial',
    titles: ['Make Claude Code ring you before it deploys', 'b title', 'c title'],
    tutorial: { use: true, tutorial_id: 'T-1', target: 'Claude Code', reader_outcome: 'x', steps: [{ step: 'Install the skill', source_url: 'https://github.com/MSG91/m91-skill' }], gaps: ['Retry policy is not documented'] } })

  const weak = await setup({ answers: { rebrief: newLead } })
  await weak.run()
  await weak.run({ mode: 'rebrief', briefId: '261017-1405-ABCD', briefVersion: 1, feedback: [{ area: 'angle', problem: 'not useful', send_to: 'strategist' }] })
  assert.equal(statusOf(weak.store, 'tutorial_lead', 'tutorial_id', 'T-1'), 'used')
  assert.equal(statusOf(weak.store, 'question_cluster', 'cluster_id', 'C-1'), 'open')

  const dup = await setup({ answers: { rebrief: newLead } })
  await dup.run()
  await dup.run({ mode: 'rebrief', briefId: '261017-1405-ABCD', briefVersion: 1, feedback: [{ area: 'topic', problem: 'duplicate topic', send_to: 'strategist' }] })
  assert.equal(statusOf(dup.store, 'question_cluster', 'cluster_id', 'C-1'), 'discarded')
})

test('DRY_RUN: nothing saved except run_log; no Slack request', async () => {
  const fetch = fakeFetch(() => ({ body: { ok: true } }))
  const cfg = config({ DRY_RUN: 'true' })
  const s = await setup({ env: { DRY_RUN: 'true' }, notifier: createNotifier({ config: cfg, fetch }) })
  const before = s.store.writes.create + s.store.writes.update
  const r = await s.run()
  assert.equal(r.title, 'How to make your AI agent wait for a human yes')
  assert.equal(recordsOf(s.store, 'brief').length, 0)
  assert.equal(statusOf(s.store, 'question_cluster', 'cluster_id', 'C-1'), 'open')
  const after = s.store.writes.create + s.store.writes.update
  assert.equal(after - before, recordsOf(s.store, 'run_log').length)
  assert.equal(fetch.calls.length, 0)
})

test('DRY_RUN pipeline: the Strategist plans from the Scout\'s in-memory records (nothing in Mem0)', async () => {
  const cfg = config({ DRY_RUN: 'true' })
  const store = memoryStore({ dryRun: true })
  const scoutResult = {
    mode: 'research',
    top_clusters: [{ cluster_id: 'C-1' }],
    dry_run_records: {
      m91_facts: [{ id: 'dryrun-f', type: 'm91_facts', status: 'current', date: '2026-10-17', payload: { can: [{ fact: 'Rings every phone in a channel at full volume until someone answers.', source_url: 'https://m91.msg91.com/llms.txt' }], cannot: [], integrations: [] } }],
      question_cluster: [{ id: 'dryrun-c', type: 'question_cluster', status: 'open', date: '2026-10-17', payload: { cluster_id: 'C-1', main_question: 'How do I make an AI agent wait for a human to approve a risky action?', topic_group: 1, source_urls: [{ url: 'https://github.com/example/agents/issues/1' }] } }],
      story_lead: [], tutorial_lead: [], tone_profile: []
    }
  }
  const brief = validBrief({ tone: { source: 'default', profile_id: 'friendly-teacher', guidance: ['x'] }, outline: validBrief().outline.map((s) => ({ ...s, source_urls: s.source_urls.filter((u) => !u.includes('api.md')) })) })
  const r = await runStrategist({ mode: 'plan', runId: 'R', scoutResult }, { config: cfg, store, aiSend: fakeAi({ plan: brief }), now })
  assert.deepEqual(r.lead, { kind: 'cluster', id: 'C-1' })
  assert.equal(r.repairs_used, 0)
  assert.equal(recordsOf(store, 'brief').length, 0)
})

test('orchestrator: Scout stub → real Strategist → Writer stub; approval marks the brief approved', async () => {
  const cfg = config({ DRY_RUN: 'true' })
  const store = await seededStore()
  const notifier = fakeNotifier()
  const agents = { ...defaultAgents({ config: cfg, store, notifier, agentDeps: { aiSend: fakeAi(), now } }), scout: stubAgents.scout, writer: stubAgents.writer, reviewer: mockReviewer() }
  const r = await runPipeline({ config: cfg, store, notifier, agents, now, briefId: '261017-1405-ABCD' })
  assert.equal(r.state, 'approved')
  assert.deepEqual(r.steps.map((x) => x.agent).slice(0, 4), ['scout', 'strategist', 'writer', 'reviewer'])
  const brief = recordsOf(store, 'brief')
  assert.equal(brief.length, 1)
  assert.equal(brief[0].status, 'approved')
  assert.ok(recordsOf(store, 'run_log').some((l) => l.payload.agent === 'strategist' && l.payload.call === 'plan'))
})

test('orchestrator: reviewer send_to strategist → re-brief version 2', async () => {
  const cfg = config({ DRY_RUN: 'true' })
  const store = await seededStore()
  let n = 0
  const agents = {
    ...defaultAgents({ config: cfg, store, notifier: fakeNotifier(), agentDeps: { aiSend: fakeAi(), now } }),
    scout: stubAgents.scout,
    writer: stubAgents.writer,
    reviewer: async () => ({ model: 'stub', output: n++ === 0 ? { pass: false, total: 60, feedback: [{ area: 'angle', quote: '', problem: 'weak angle', fix: 'sharper angle', severity: 'must', send_to: 'strategist', claims: [] }] } : { pass: true, total: 90, feedback: [] } })
  }
  const r = await runPipeline({ config: cfg, store, notifier: fakeNotifier(), agents, now, briefId: '261017-1405-ABCD' })
  assert.equal(r.state, 'approved')
  const versions = recordsOf(store, 'brief').map((b) => [b.version, b.status]).sort()
  assert.deepEqual(versions, [[1, 'superseded'], [2, 'approved']])
})
