// One post, one journey: the greens of the pipeline run and of the approve run on one bar (/api/journeys).
// Fakes only: no AI, no Mem0 service, no network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRunManager } from '../src/runs.js'
import { stubAgents } from '../src/agents/stubs.js'
import { resetEvents } from '../src/events.js'
import { setSink } from '../src/util/log.js'
import { createServer } from '../src/server.js'
import { buildJourney } from '../src/journey.js'
import { memoryStore, fakeNotifier, mockReviewer } from './helpers.js'
import { BRIEF_ID, config, brief, draftAnswer } from './writer/fixtures.js'

beforeEach(() => resetEvents())

const step = (name, status = 'succeeded') => ({ name, status, started_at: '2026-10-29T10:00:00+05:30', finished_at: '2026-10-29T10:01:00+05:30', summary: `${name} ok` })
const pipelineRun = { run_id: 'R-261029-1000-AAAA', mode: 'full', status: 'waiting_for_approval', started_at: '2026-10-29T10:00:00+05:30', brief_id: BRIEF_ID, steps: ['scout', 'strategist', 'writer', 'reviewer'].map((n) => step(n)), result_summary: 'waiting for you' }

async function seed() {
  const store = memoryStore()
  await store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: { ...brief(), keyword: 'agent approval' }, status: 'awaiting_human', version: 1 })
  await store.createRecord({ type: 'draft', briefId: BRIEF_ID, payload: { ...draftAnswer(), brief_id: BRIEF_ID, version: 1, brief_version: 1, word_count: 1450, checks: { hard_passed: true, results: [] } }, status: 'awaiting_human', version: 1, meta: { brief_version: 1, review_total: 88 } })
  await store.createRecord({ type: 'review', briefId: BRIEF_ID, payload: { brief_id: BRIEF_ID, version: 1, brief_version: 1, pass: true, total: 88, feedback: [] }, status: 'pass', version: 1, meta: { brief_version: 1 } })
  await store.createRecord({ type: 'run', briefId: pipelineRun.run_id, payload: pipelineRun, status: pipelineRun.status })
  return store
}

const states = (j) => Object.fromEntries(j.stages.map((s) => [s.id, s.state]))

test('buildJourney: a draft waiting for you; a running run marks the first open stage current; a failed run marks it failed', () => {
  const b = { payload: { titles: ['T'], keyword: 'k' }, version: 1 }
  const d = { payload: { title: 'T', version: 1, brief_version: 1, word_count: 1200 }, status: 'awaiting_human', metadata: { brief_version: 1 } }
  const r = { payload: { version: 1, brief_version: 1, pass: true, total: 90 } }
  const waiting = buildJourney({ briefs: [b], drafts: [d], reviews: [r], runs: [pipelineRun] })
  assert.deepEqual(states(waiting), { topic: 'done', research: 'done', plan: 'done', draft: 'done', review: 'done', you: 'waiting', export: 'todo', published: 'todo' })
  assert.equal(waiting.stages.find((s) => s.id === 'review').detail, '90/100 · pass')
  assert.equal(waiting.stages.find((s) => s.id === 'research').run_id, pipelineRun.run_id)
  const running = buildJourney({ briefs: [b], runs: [{ ...pipelineRun, status: 'running', steps: [step('scout'), step('strategist'), step('writer', 'running')] }] })
  assert.equal(states(running).draft, 'current')
  assert.equal(running.active_run_id, pipelineRun.run_id)
  const failed = buildJourney({ runs: [{ ...pipelineRun, status: 'failed', steps: [step('scout', 'failed')], result_summary: 'Scout failed: timeout' }] })
  assert.equal(states(failed).research, 'failed')
  assert.equal(failed.stages.find((s) => s.id === 'research').detail, 'Scout failed: timeout')
  assert.equal(states(buildJourney({ target: 'none' })).published, 'off')
})

test('API: approve (with publish) adds its greens to the same post page; /api/journeys lists the post with its runs', async () => {
  const restore = setSink(() => {})
  const store = await seed()
  const cfg = config({ PUBLISH_TARGET: 'none' })
  const m = createRunManager({ config: cfg, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager: m, store, config: cfg })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const before = await (await fetch(`${base}/api/journeys/${BRIEF_ID}`)).json()
    assert.equal(states(before).you, 'waiting')
    assert.equal(before.stages.find((s) => s.id === 'plan').detail, 'Brief v1 · agent approval')
    const res = await fetch(`${base}/api/approvals/${BRIEF_ID}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publish: true }) })
    assert.equal(res.status, 202)
    const { run_id } = await res.json()
    const done = await m.wait(run_id)
    assert.equal(done.status, 'succeeded', done.error)
    const after = await (await fetch(`${base}/api/journeys/${BRIEF_ID}`)).json()
    assert.deepEqual(states(after), { topic: 'done', research: 'done', plan: 'done', draft: 'done', review: 'done', you: 'done', export: 'done', published: 'off' })
    assert.equal(after.stages.find((s) => s.id === 'export').run_id, run_id)
    assert.deepEqual(after.runs.map((r) => r.run_id), [run_id, pipelineRun.run_id], 'both runs, newest first')
    const list = (await (await fetch(`${base}/api/journeys`)).json()).posts
    assert.equal(list.length, 1)
    assert.equal(list[0].brief_id, BRIEF_ID)
    assert.equal(list[0].runs, 2)
    assert.equal((await fetch(`${base}/api/journeys/261029-1000-NXNE`)).status, 404)
    assert.equal((await fetch(`${base}/api/journeys/bad`)).status, 400)
  } finally {
    await new Promise((r) => server.close(r))
    restore()
  }
})
