// TEST-ONLY command test:await (put an existing draft at awaiting_human) and the rereview_after_human run param.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setAwaitingForTest, TestCommandError } from '../src/testcommands.js'
import { findCandidates } from '../src/cleanup.js'
import { configForRun, createRunManager, MODES } from '../src/runs.js'
import { createServer } from '../src/server.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier, mockReviewer } from './helpers.js'

const B = '261019-1055-BZ89'
const on = () => fakeConfig({ ALLOW_TEST_COMMANDS: 'true' })

async function seeded({ draftStatus = 'failed_review', briefStatus = 'failed' } = {}) {
  const store = memoryStore()
  const brief = await store.createRecord({ type: 'brief', briefId: B, payload: { brief_id: B, brief_version: 1, titles: ['T'] }, status: briefStatus, version: 1 })
  const v1 = await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'T', version: 1, brief_version: 1 }, status: 'awaiting_human', version: 1, meta: { brief_version: 1 } })
  const v2 = await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'T', version: 2, brief_version: 1 }, status: draftStatus, version: 2, meta: { brief_version: 1 } })
  await store.createRecord({ type: 'review', briefId: B, payload: { version: 2, brief_version: 1, total: 78, pass: false }, status: 'fail', version: 2, meta: { brief_version: 1 } })
  return { store, brief, v1, v2 }
}

test('test:await refuses when ALLOW_TEST_COMMANDS is false (the default)', async () => {
  const { store, v2 } = await seeded()
  assert.equal(fakeConfig().testing.allowTestCommands, false)
  await assert.rejects(setAwaitingForTest(store, fakeConfig(), { briefId: B }), (e) => e instanceof TestCommandError && /ALLOW_TEST_COMMANDS=true/.test(e.message))
  assert.equal(store.records.get(v2.id).status, 'failed_review', 'nothing changed')
})

test('test:await sets the newest draft to awaiting_human, marks draft and brief as test data, supersedes another waiting draft', async () => {
  const { store, brief, v1, v2 } = await seeded()
  const r = await setAwaitingForTest(store, on(), { briefId: B })
  assert.deepEqual([r.version, r.previous_status, r.total], [2, 'failed_review', 78])
  const d = store.records.get(v2.id)
  assert.equal(d.status, 'awaiting_human')
  assert.equal(d.metadata.test, true)
  assert.equal(d.metadata.review_total, 78)
  assert.ok(d.metadata.awaiting_since)
  assert.equal(store.records.get(brief.id).status, 'awaiting_human')
  assert.equal(store.records.get(brief.id).metadata.test, true)
  assert.equal(store.records.get(v1.id).status, 'superseded', 'only one waiting draft per brief')
  const listed = findCandidates([...store.records.values()]).map((c) => c.id)
  assert.ok(listed.includes(v2.id) && listed.includes(brief.id), 'cleanup lists the test-marked records')
})

test('test:await picks a given version; unknown drafts and published posts are refused', async () => {
  const { store, v1 } = await seeded()
  assert.equal((await setAwaitingForTest(store, on(), { briefId: B, version: 1 })).version, 1)
  assert.equal(store.records.get(v1.id).status, 'awaiting_human')
  await assert.rejects(setAwaitingForTest(store, on(), { briefId: '261019-1055-ZZZZ' }), /no draft of brief/)
  await assert.rejects(setAwaitingForTest(store, on(), {}), /usage: npm run test:await/)
  for (const s of [await seeded({ draftStatus: 'published' }), await seeded({ briefStatus: 'published' })]) {
    await assert.rejects(setAwaitingForTest(s.store, on(), { briefId: B }), /is published: test commands never touch published posts/)
  }
  const withPost = await seeded()
  await withPost.store.createRecord({ type: 'published_post', briefId: B, payload: { url: 'https://m91-blog.embarko.app/x' }, status: 'published' })
  await assert.rejects(setAwaitingForTest(withPost.store, on(), { briefId: B }), /is published/)
})

test('test:await is never available through the API (no run mode, no route)', async () => {
  const restore = setSink(() => {})
  assert.ok(!MODES.some((m) => /test/.test(m)))
  const config = fakeConfig({ ALLOW_TEST_COMMANDS: 'true' })
  const store = memoryStore()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const mode = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'test_await', params: { brief_id: B } }) })
    assert.equal(mode.status, 400)
    assert.equal((await mode.json()).error.code, 'bad_mode')
    // The approval routes pass optional one-run params through (validated before any run starts).
    const bad = await fetch(`${base}/api/approvals/${B}/revise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feedback: 'Shorter please.', params: { rereview_after_human: 'no' } }) })
    assert.deepEqual([bad.status, (await bad.json()).error.code], [400, 'bad_params'])
    for (const path of ['/api/test/await', '/api/test-await', `/api/approvals/${B}/test-await`]) {
      const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      assert.equal(r.status, 404, path)
    }
  } finally {
    await new Promise((r) => server.close(r))
    restore()
  }
})

test('run param rereview_after_human: one run only; must be true or false', () => {
  const cfg = fakeConfig()
  assert.equal(configForRun(cfg, { params: { rereview_after_human: false } }).approval.rereviewAfterHuman, false)
  assert.equal(cfg.approval.rereviewAfterHuman, true)
  assert.throws(() => configForRun(cfg, { params: { rereview_after_human: 'no' } }), /rereview_after_human must be true or false/)
})
