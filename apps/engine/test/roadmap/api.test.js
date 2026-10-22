// Phase 12 Task 7 (engine side): the roadmap API, the slot on the approval screen and the settings. Memory
// store, a real server on a random port: no AI, no Mem0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../../src/server.js'
import { createRunManager } from '../../src/runs.js'
import { saveRoadmap } from '../../src/roadmap/model.js'
import { saveKnowledge } from '../../src/roadmap/knowledge.js'
import { setSink } from '../../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier } from '../helpers.js'
import { goodRoadmap } from './fixtures.js'

async function withApi({ store = memoryStore(), running = false, env = {} } = {}, fn) {
  const restore = setSink(() => {})
  const config = fakeConfig({ ROADMAP_ENABLED: 'true', RAPID_RESPONSE_ENABLED: 'false', ...env })
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier() })
  if (running) manager.isRunning = () => true
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config, dashboardDir: null })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json }
  }
  try {
    await fn({ call, store })
  } finally {
    await new Promise((r) => server.close(r))
    restore()
  }
}

test('GET /api/roadmap: none yet; a draft says "Approve the roadmap first"; approve → next up is s0-1', async () => {
  await withApi({}, async ({ call, store }) => {
    let r = await call('GET', '/api/roadmap')
    assert.deepEqual(r.json, { roadmap: null, record_id: null, next: { kind: 'none', reason: 'there is no roadmap yet: generate it' }, problems: [] })
    await saveRoadmap(store, goodRoadmap())
    r = await call('GET', '/api/roadmap')
    assert.equal(r.json.roadmap.status, 'draft')
    assert.deepEqual(r.json.next, { kind: 'none', reason: 'Approve the roadmap first' })
    assert.deepEqual(r.json.problems, [])
    const ok = await call('POST', '/api/roadmap/approve', {})
    assert.equal(ok.status, 200)
    assert.equal(ok.json.roadmap.status, 'approved')
    r = await call('GET', '/api/roadmap')
    assert.deepEqual(r.json.next, { kind: 'slot', slot_id: 's0-1', title_idea: 'What M91 is and why software needs a human', stage: { number: 0, name: 'Starter', level: 'beginner', goal: r.json.next.stage.goal } })
  })
})

test('slot changes: edit, move, skip, accept/reject; invalid ones 400, unknown 404, during a run 409', async () => {
  const store = memoryStore()
  const rm = goodRoadmap()
  rm.stages[3].slots.push({ slot_id: 's3-4', title_idea: 'Approvals for database changes', question: 'Can a person approve a database change?', teaches: ['schema change'], needs: [], status: 'proposed', brief_id: '' })
  await saveRoadmap(store, rm)
  await withApi({ store }, async ({ call }) => {
    const e = await call('POST', '/api/roadmap/slots/s1-2', { title_idea: 'Why a ringing phone works' })
    assert.equal(e.status, 200)
    assert.equal(e.json.roadmap.stages[1].slots[1].title_idea, 'Why a ringing phone works')
    const bad = await call('POST', '/api/roadmap/slots/s1-2', { question: 'No question mark' })
    assert.deepEqual([bad.status, bad.json.error.code], [400, 'roadmap_invalid'])
    assert.equal((await call('POST', '/api/roadmap/slots/s1-3/move', { direction: 'up' })).json.roadmap.stages[1].slots[1].slot_id, 's1-3')
    assert.equal((await call('POST', '/api/roadmap/slots/s1-3/skip', { skipped: 'yes' })).status, 400)
    assert.equal((await call('POST', '/api/roadmap/slots/s2-3/skip', { skipped: true })).json.roadmap.stages[2].slots[2].status, 'skipped')
    assert.equal((await call('POST', '/api/roadmap/slots/s3-4/accept')).json.roadmap.stages[3].slots[3].status, 'planned')
    assert.equal((await call('POST', '/api/roadmap/slots/s3-4/reject')).json.error.code, 'not_proposed')
    assert.equal((await call('POST', '/api/roadmap/slots/s9-9', { title_idea: 'x' })).status, 404)
  })
  await withApi({ store, running: true }, async ({ call }) => {
    assert.equal((await call('POST', '/api/roadmap/approve', {})).status, 409)
  })
})

test('the approval screen gets the slot, its stage and the posts it builds on; settings show the roadmap and the Planner', async () => {
  const store = memoryStore()
  const B = '261022-1300-ABCD'
  const rm = { ...goodRoadmap(), status: 'approved' }
  Object.assign(rm.stages[0].slots[0], { status: 'approved', brief_id: '261022-1000-ABCD' })
  Object.assign(rm.stages[0].slots[1], { status: 'in_review', brief_id: B })
  await saveRoadmap(store, rm)
  await saveKnowledge(store, { brief_id: '261022-1000-ABCD', title: 'What M91 is, in plain words', slot_id: 's0-1', stage: 0, concepts: ['M91'], terms_defined: [], summary: 'x', approved_at: '2026-10-22T10:00:00+05:30' })
  await store.createRecord({ type: 'brief', briefId: B, payload: { brief_id: B, brief_version: 1, titles: ['How M91 works'], slot_id: 's0-2', why_today: 'Builds on "What M91 is".', terms_to_define: ['channel'] }, status: 'awaiting_human', version: 1 })
  await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'How M91 works', version: 1, brief_version: 1, post_markdown: '# How M91 works' }, status: 'awaiting_human', version: 1, meta: { brief_version: 1 } })
  await withApi({ store }, async ({ call }) => {
    const d = (await call('GET', `/api/approvals/${B}`)).json
    assert.deepEqual(d.slot, {
      slot_id: 's0-2', title_idea: 'How M91 works in 5 minutes', question: 'How does M91 work?', teaches: ['alert', 'channel', 'callback'], status: 'in_review',
      stage: { number: 0, name: 'Starter', level: 'beginner' },
      builds_on: [{ slot_id: 's0-1', title: 'What M91 is, in plain words', status: 'approved', brief_id: '261022-1000-ABCD' }],
      why_today: 'Builds on "What M91 is".', terms_to_define: ['channel']
    })
    const s = (await call('GET', '/api/settings')).json
    assert.deepEqual(s.roadmap, { enabled: true, rapid_response_enabled: false })
    assert.deepEqual(s.models.planner, { service: 'openai', model: 'gpt-5.6-luna', delivery: 'sync' })
    assert.ok(s.built_modes.includes('roadmap'))
  })
  await withApi({ store, env: { ROADMAP_ENABLED: 'false' } }, async ({ call }) => {
    assert.equal((await call('GET', `/api/approvals/${B}`)).json.slot, null)
  })
})
