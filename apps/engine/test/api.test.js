import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, publicSettings } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { resetEvents } from '../src/events.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, fakeEnv, memoryStore, fakeNotifier, mockReviewer } from './helpers.js'

beforeEach(() => resetEvents())
const TRIGGER = 'fake-trigger-key-0123456789'

/** A gate the stub Scout waits on, so a run stays "in progress" until released. */
function gate() {
  let open
  const p = new Promise((r) => { open = r })
  return { wait: () => p, open: () => open() }
}

async function withApi({ env = {}, agents = {}, keepAliveMs } = {}, fn) {
  const restoreLog = setSink(() => {})
  const config = fakeConfig(env)
  const store = memoryStore()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer(), ...agents }) })
  const server = createServer({ triggerKey: TRIGGER, manager, store, config, keepAliveMs })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text, headers: res.headers }
  }
  try {
    await fn({ base, call, config, store, manager })
  } finally {
    await new Promise((r) => server.close(r))
    restoreLog()
  }
}

test('GET /api/health needs no auth', async () => {
  await withApi({ env: { DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'fake-dashboard-pass' } }, async ({ call }) => {
    const r = await call('GET', '/api/health')
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.run_in_progress, false)
    assert.ok(r.json.version)
  })
})

test('POST /api/runs: 202 with run_id, 409 while running, then cancel and 409 when not running', async () => {
  const g = gate()
  await withApi({ agents: { scout: async () => { await g.wait(); return stubAgents.scout() } } }, async ({ call, manager }) => {
    const a = await call('POST', '/api/runs', { mode: 'full', dry_run: true })
    assert.equal(a.status, 202)
    assert.match(a.json.run_id, /^R-\d{6}-\d{4}-[A-Z0-9]{4}$/)
    const b = await call('POST', '/api/runs', { mode: 'full' })
    assert.equal(b.status, 409)
    assert.equal(b.json.error.code, 'run_in_progress')
    assert.equal((await call('GET', '/api/health')).json.run_in_progress, true)
    const c = await call('POST', `/api/runs/${a.json.run_id}/cancel`)
    assert.equal(c.status, 202)
    g.open()
    await manager.wait(a.json.run_id)
    assert.equal((await call('POST', `/api/runs/${a.json.run_id}/cancel`)).status, 409)
  })
})

test('POST /api/runs validation: bad JSON, bad mode type, unknown and not-built modes, bad params', async () => {
  await withApi({}, async ({ call }) => {
    const bad = await call('POST', '/api/runs', '{not json')
    assert.equal(bad.status, 400)
    assert.equal(bad.json.error.code, 'bad_json')
    assert.equal((await call('POST', '/api/runs', { mode: 5 })).json.error.code, 'bad_mode')
    assert.equal((await call('POST', '/api/runs', { mode: 'everything' })).json.error.code, 'bad_mode')
    const nb = await call('POST', '/api/runs', { mode: 'reviewer' })
    assert.equal(nb.status, 501)
    assert.equal(nb.json.error.code, 'not_built')
    const noBrief = await call('POST', '/api/runs', { mode: 'writer' })
    assert.equal(noBrief.status, 400)
    assert.equal(noBrief.json.error.code, 'bad_params')
    const unknown = await call('POST', '/api/runs', { mode: 'writer', params: { brief_id: '261018-0700-ZZZZ' } })
    assert.equal(unknown.status, 400)
    assert.equal(unknown.json.error.code, 'unknown_brief')
    assert.equal((await call('POST', '/api/runs', { mode: 'full', dry_run: 'yes' })).json.error.code, 'bad_params')
    assert.equal((await call('POST', '/api/runs', { mode: 'scout', params: { scout: { max_calls: 999 } } })).json.error.code, 'bad_params')
    assert.equal((await call('POST', '/api/runs/not-a-run/cancel')).json.error.code, 'bad_run_id')
  })
})

test('GET /api/runs and /api/runs/:run_id (with produced records); 404 for an unknown run', async () => {
  await withApi({}, async ({ call, manager }) => {
    const { json } = await call('POST', '/api/runs', { mode: 'full', dry_run: false })
    await manager.wait(json.run_id)
    const list = await call('GET', '/api/runs?limit=5')
    assert.equal(list.status, 200)
    assert.equal(list.json.runs[0].run_id, json.run_id)
    assert.equal(list.json.runs[0].status, 'succeeded')
    assert.deepEqual(list.json.runs[0].steps.map((s) => s.name), ['scout', 'strategist', 'writer', 'reviewer'])
    const one = await call('GET', `/api/runs/${json.run_id}`)
    assert.equal(one.status, 200)
    assert.equal(one.json.run.run_id, json.run_id)
    assert.ok(Array.isArray(one.json.records))
    assert.equal((await call('GET', '/api/runs/R-261018-0700-ZZZZ')).status, 404)
  })
})

async function readStream(url, { onFirstChunk } = {}) {
  const res = await fetch(url)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let first = true
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value)
    if (first) { first = false; onFirstChunk?.() }
  }
  return { status: res.status, type: res.headers.get('content-type'), events: [...text.matchAll(/^data: (.+)$/gm)].map((m) => JSON.parse(m[1])), text }
}

test('SSE: a late subscriber gets the replay, then live events, and the stream ends after run.finished', async () => {
  const g = gate()
  await withApi({ agents: { scout: async () => { await g.wait(); return stubAgents.scout() } } }, async ({ base, call }) => {
    const { json } = await call('POST', '/api/runs', { mode: 'full' })
    await new Promise((r) => setTimeout(r, 20)) // run.started and step.started happen before we connect
    const s = await readStream(`${base}/api/runs/${json.run_id}/events`, { onFirstChunk: () => g.open() })
    assert.equal(s.status, 200)
    assert.match(s.type, /text\/event-stream/)
    const types = s.events.map((e) => e.type)
    assert.equal(types[0], 'run.started', 'replay first')
    assert.ok(types.includes('step.finished'), 'live events after the replay')
    assert.equal(types.at(-1), 'run.finished', 'ends after the terminal event')
    const seqs = s.events.map((e) => e.seq)
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b))
    assert.equal(new Set(seqs).size, seqs.length, 'no duplicates between replay and live')
    // A finished run replays and closes at once.
    const again = await readStream(`${base}/api/runs/${json.run_id}/events`)
    assert.equal(again.events.at(-1).type, 'run.finished')
    assert.equal((await fetch(`${base}/api/runs/R-261018-0700-ZZZZ/events`)).status, 404)
  })
})

test('SSE keep-alive comments are sent while a run is quiet', async () => {
  const g = gate()
  await withApi({ keepAliveMs: 10, agents: { scout: async () => { await g.wait(); return stubAgents.scout() } } }, async ({ base, call }) => {
    const { json } = await call('POST', '/api/runs', { mode: 'full' })
    setTimeout(() => g.open(), 60)
    const s = await readStream(`${base}/api/runs/${json.run_id}/events`)
    assert.match(s.text, /: keep-alive/)
  })
})

test('GET /api/records (trimmed, filters) and /api/records/:id; bad type 400; unknown id 404', async () => {
  await withApi({}, async ({ call, store }) => {
    const rec = await store.createRecord({ type: 'question_cluster', status: 'open', payload: { cluster_id: 'C-1', main_question: 'How do agents ask a human?', source_urls: [] } })
    await store.createRecord({ type: 'brief', briefId: 'B-1', status: 'new', payload: { brief_id: 'B-1', titles: ['A title'] } })
    const list = await call('GET', '/api/records?type=question_cluster&status=open&limit=10')
    assert.equal(list.status, 200)
    assert.deepEqual(list.json.records.map((r) => [r.key_id, r.title]), [['C-1', 'How do agents ask a human?']])
    assert.ok(!('payload' in list.json.records[0]), 'payload trimmed')
    assert.equal((await call('GET', '/api/records?brief_id=B-1')).json.records[0].title, 'A title')
    assert.equal((await call('GET', '/api/records?type=secrets')).status, 400)
    const one = await call('GET', `/api/records/${rec.id}`)
    assert.equal(one.json.record.payload.cluster_id, 'C-1')
    assert.equal((await call('GET', '/api/records/mem-nope')).status, 404)
  })
})

test('GET /api/settings never returns a secret (fake secret values)', async () => {
  const secrets = { VIASOCKET_EMBED_SECRET: 'fake-embed-ZZ-secret-1', MEM0_API_KEY: 'm0-fakeZZsecretkey22', WEBHOOK_SHARED_KEY: 'fake-shared-ZZ-3', PIPELINE_TRIGGER_KEY: 'fake-trigger-ZZ-0123456789', DASHBOARD_PASSWORD: 'fake-dash-ZZ-pass', SLACK_POST_WEBHOOK_URL: 'https://flow.sokt.io/func/scriZZFAKE1', M91_ALERT_WEBHOOK_URL: 'https://flow.sokt.io/func/scriZZFAKE2' }
  await withApi({ env: secrets }, async ({ call }) => {
    const r = await call('GET', '/api/settings')
    assert.equal(r.status, 200)
    for (const v of Object.values(secrets)) assert.ok(!r.text.includes(v), `leaked ${v.slice(0, 4)}…`)
    assert.ok(!/sokt\.io|webhook|password|secret/i.test(r.text))
    assert.equal(r.json.models.strategist.model, 'gpt-5.6-luna')
    assert.equal(r.json.runtime.dry_run, false)
    assert.equal(r.json.schedule, undefined, 'no scheduler for now')
  })
  assert.ok(!JSON.stringify(publicSettings(fakeConfig(secrets))).includes('ZZ'))
})

test('there is no schedule endpoint (runs are started by hand)', async () => {
  await withApi({}, async ({ call }) => {
    assert.equal((await call('POST', '/api/settings/schedule', { enabled: true })).status, 404)
  })
})

test('pinned topics: list, add (validated), cancel', async () => {
  await withApi({}, async ({ call }) => {
    assert.deepEqual((await call('GET', '/api/pinned')).json.pinned, [])
    assert.equal((await call('POST', '/api/pinned', { topic: '', target_date: '2026-10-20' })).json.error.code, 'bad_topic')
    assert.equal((await call('POST', '/api/pinned', { topic: 'x', target_date: '20/10/2026' })).json.error.code, 'bad_date')
    assert.equal((await call('POST', '/api/pinned', { topic: 'x', target_date: '2026-10-20', priority: 'urgent' })).json.error.code, 'bad_priority')
    const add = await call('POST', '/api/pinned', { topic: 'Opsgenie end of support', target_date: '2026-10-20', priority: 'high' })
    assert.equal(add.status, 201)
    const id = add.json.pinned.pinned_id
    assert.equal((await call('GET', '/api/pinned')).json.pinned[0].status, 'open')
    assert.equal((await call('DELETE', `/api/pinned/${id}`)).json.pinned.status, 'cancelled')
    assert.equal((await call('DELETE', `/api/pinned/${id}`)).status, 409)
    assert.equal((await call('DELETE', '/api/pinned/PIN-nope')).status, 404)
  })
})

test('auth on: 401 without a session, login (wrong / right), cookie flags, logout, rate limit', async () => {
  await withApi({ env: { DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'fake-dashboard-pass' } }, async ({ call }) => {
    assert.equal((await call('GET', '/api/runs')).status, 401)
    assert.equal((await call('POST', '/api/login', { password: 'nope' })).status, 401)
    const ok = await call('POST', '/api/login', { password: 'fake-dashboard-pass' })
    assert.equal(ok.status, 200)
    const cookie = ok.headers.get('set-cookie')
    assert.match(cookie, /m91_session=[0-9a-f]{64}/)
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Strict/)
    assert.match(cookie, /Max-Age=43200/)
    const session = cookie.split(';')[0]
    assert.equal((await call('GET', '/api/runs', undefined, { cookie: session })).status, 200)
    await call('POST', '/api/logout', undefined, { cookie: session })
    assert.equal((await call('GET', '/api/runs', undefined, { cookie: session })).status, 401)
    // 5 tries per minute: two used above, three more allowed, then 429.
    for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/api/login', { password: 'nope' })).status, 401)
    assert.equal((await call('POST', '/api/login', { password: 'fake-dashboard-pass' })).status, 429)
  })
})

test('auth off: /api works without login, and /api/login says it is not needed', async () => {
  await withApi({}, async ({ call }) => {
    assert.equal((await call('GET', '/api/runs')).status, 200)
    assert.equal((await call('POST', '/api/login', { password: 'x' })).json.error.code, 'auth_off')
  })
})

test('legacy POST /run with x-trigger-key goes through the run manager', async () => {
  await withApi({}, async ({ call, manager }) => {
    assert.equal((await call('POST', '/run', undefined, { 'x-trigger-key': 'wrong' })).status, 401)
    const r = await call('POST', '/run', undefined, { 'x-trigger-key': TRIGGER })
    assert.equal(r.status, 202)
    assert.match(r.json.run_id, /^R-/)
    await manager.wait(r.json.run_id)
  })
})

test('DASHBOARD_PASSWORD is required only when DASHBOARD_AUTH=true', () => {
  assert.doesNotThrow(() => fakeConfig({ DASHBOARD_AUTH: 'false' }))
  assert.throws(() => fakeConfig({ DASHBOARD_AUTH: 'true' }), /DASHBOARD_PASSWORD: missing/)
  assert.ok(!fakeEnv().DASHBOARD_PASSWORD)
})
