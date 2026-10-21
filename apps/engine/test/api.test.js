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
    // Every mode is built since Phase 7; publish without a deploy token is refused before the run starts.
    const nb = await call('POST', '/api/runs', { mode: 'publish', params: { brief_id: '261018-0700-ZZZZ' } })
    assert.equal(nb.status, 409)
    assert.equal(nb.json.error.code, 'no_token')
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
    assert.deepEqual(list.json.runs[0].steps.map((s) => s.name), ['scout', 'strategist', 'writer', 'designer', 'reviewer'])
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

test('reviewer and promo modes: bad params are clear 400s; runs start with 202; records listed by type', async () => {
  const B = '261018-1400-ABCD'
  await withApi({}, async ({ call, store, manager }) => {
    const e = async (body) => (await call('POST', '/api/runs', body)).json.error
    assert.equal((await e({ mode: 'reviewer' })).code, 'bad_params')
    assert.match((await e({ mode: 'reviewer', params: { brief_id: B, version: 0 } })).message, /params\.version must be a whole number/)
    assert.match((await e({ mode: 'reviewer', params: { brief_id: B, route: 'yes' } })).message, /params\.route must be true or false/)
    assert.equal((await e({ mode: 'reviewer', params: { brief_id: B } })).code, 'unknown_draft')
    assert.equal((await e({ mode: 'promo', params: { brief_id: B } })).code, 'no_approved_draft')
    await store.createRecord({ type: 'brief', briefId: B, payload: { brief_id: B, brief_version: 1, titles: ['T'] }, status: 'drafted', version: 1 })
    await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'T', version: 1, brief_version: 1, post_markdown: '# T' }, status: 'drafted', version: 1, meta: { brief_version: 1 } })
    const rv = await call('POST', '/api/runs', { mode: 'reviewer', params: { brief_id: B } })
    assert.equal(rv.status, 202)
    const done = await manager.wait(rv.json.run_id)
    assert.equal(done.status, 'succeeded')
    assert.match(done.run.result_summary, /^review of 261018-1400-ABCD latest draft: Score 90\/100 · pass/)
    assert.deepEqual(done.run.steps.map((s) => s.name), ['reviewer'])
    assert.equal((await e({ mode: 'promo', params: { brief_id: B } })).code, 'no_approved_draft', 'a passing review alone does not approve')
    await store.createRecord({ type: 'review', briefId: B, payload: { pass: true, total: 90 }, status: 'pass', version: 1 })
    const draft = (await store.getRecords({ type: 'draft' }))[0]
    await store.updateRecord(draft.id, undefined, { status: 'approved' })
    const pr = await call('POST', '/api/runs', { mode: 'promo', params: { brief_id: B } })
    assert.equal(pr.status, 202)
    const pdone = await manager.wait(pr.json.run_id)
    assert.equal(pdone.status, 'succeeded')
    assert.match(pdone.run.result_summary, /^promo pack ok for 261018-1400-ABCD latest draft$/)
    assert.equal((await call('GET', `/api/records?type=review&brief_id=${B}`)).json.records.length, 1)
    const promoList = await call('GET', `/api/records?type=promo_pack&brief_id=${B}`)
    assert.equal(promoList.status, 200)
  })
})

test('approval API: list, detail, approve / revise / reject (202), and the 400 / 404 / 409 cases', async () => {
  const B = '261018-1400-ABCD'
  const g = gate()
  await withApi({ agents: { scout: async () => { await g.wait(); return stubAgents.scout() } } }, async ({ call, store, manager }) => {
    await store.createRecord({ type: 'brief', briefId: B, payload: { brief_id: B, brief_version: 1, titles: ['T'], lead: { kind: 'cluster', id: 'C-9' } }, status: 'awaiting_human', version: 1 })
    const v1 = await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'Old T', version: 1, brief_version: 1, post_markdown: '# Old T', human_feedback: { text: 'Shorter.', quotes: [], at: 't0' } }, status: 'changes_requested', version: 1, meta: { brief_version: 1 } })
    await store.createRecord({ type: 'review', briefId: B, payload: { version: 1, brief_version: 1, total: 86, pass: true, gates: [], areas: [], feedback: [], summary: 'ok' }, status: 'pass', version: 1, meta: { brief_version: 1 } })
    await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'T', version: 2, brief_version: 1, post_markdown: '# T\n\nA ringing phone gets attention fast.', checks: { hard_passed: true, results: [{ id: 'cta_exact', passed: true, severity: 'hard', value: 1, detail: 'ok' }] } }, status: 'awaiting_human', version: 2, meta: { brief_version: 1, awaiting_since: '2026-10-19T10:00:00+05:30', review_total: 91 } })
    await store.createRecord({ type: 'review', briefId: B, payload: { version: 2, brief_version: 1, total: 91, pass: true, gates: [{ id: 'checks_hard_passed', passed: true }], areas: [], feedback: [], summary: 'Good.' }, status: 'pass', version: 2, meta: { brief_version: 1 } })

    const list = await call('GET', '/api/approvals')
    assert.deepEqual(list.json.approvals.map(({ record_id, ...x }) => x), [{ brief_id: B, version: 2, brief_version: 1, title: 'T', total: 91, waiting_since: '2026-10-19T10:00:00+05:30' }])
    const detail = (await call('GET', `/api/approvals/${B}`)).json
    assert.equal(detail.draft.version, 2)
    assert.equal(detail.draft.status, 'awaiting_human')
    assert.equal(detail.review.total, 91)
    assert.equal(detail.review.summary, 'Good.')
    assert.deepEqual(detail.checks.map((c) => c.id), ['cta_exact'])
    assert.deepEqual(detail.earlier, [{ version: 1, brief_version: 1, status: 'changes_requested', title: 'Old T', score: 86, total: 86, human_feedback: { text: 'Shorter.', quotes: [], at: 't0' }, record_id: v1.id }])
    assert.equal((await call('GET', '/api/approvals/not-a-brief')).status, 400)
    assert.equal((await call('GET', '/api/approvals/261018-1400-ZZZZ')).status, 404)

    // Bad revise bodies → 400 before any run starts.
    const short = await call('POST', `/api/approvals/${B}/revise`, { feedback: 'no' })
    assert.equal(short.status, 400)
    const noQuote = await call('POST', `/api/approvals/${B}/revise`, { feedback: 'Make it shorter.', quotes: ['Not a sentence in this draft.'] })
    assert.deepEqual([noQuote.status, noQuote.json.error.code], [400, 'quote_not_found'])

    // Another run in progress → 409.
    const full = await call('POST', '/api/runs', { mode: 'full' })
    const busy = await call('POST', `/api/approvals/${B}/approve`, {})
    assert.deepEqual([busy.status, busy.json.error.code], [409, 'run_in_progress'])
    g.open()
    await manager.wait(full.json.run_id)

    const ok = await call('POST', `/api/approvals/${B}/approve`, {})
    assert.equal(ok.status, 202)
    const done = await manager.wait(ok.json.run_id)
    assert.equal(done.status, 'succeeded')
    assert.equal(done.run.result_summary, 'approved by you (v2, score 91); Markdown export: t.md')
    // No longer awaiting_human → 409 for approve and reject; a counter prompt reopens the approved draft (202).
    for (const [action, body] of [['approve', {}], ['reject', { reason: 'x' }]]) {
      const r = await call('POST', `/api/approvals/${B}/${action}`, body)
      assert.deepEqual([r.status, r.json.error.code], [409, 'not_awaiting_human'], action)
    }
    const reopen = await call('POST', `/api/approvals/${B}/revise`, { feedback: 'Make it shorter.' })
    assert.equal(reopen.status, 202)
    await manager.wait(reopen.json.run_id)
    assert.equal(store.records.get(v1.id).status, 'changes_requested')
  })
})

test('approval API: approve refuses an unreviewed version (409), force_unreviewed (400 / 202, shown in the run), review action (202), hard checks (409)', async () => {
  const A = '261018-1500-AAAA'
  const F = '261018-1500-FFFF'
  const H = '261018-1500-HHHH'
  await withApi({}, async ({ call, store, manager }) => {
    for (const [b, hard] of [[A, true], [F, true], [H, false]]) {
      await store.createRecord({ type: 'brief', briefId: b, payload: { brief_id: b, brief_version: 1, titles: ['T'] }, status: 'awaiting_human', version: 1 })
      await store.createRecord({ type: 'draft', briefId: b, payload: { title: 'T', version: 1, brief_version: 1, post_markdown: '# T\n\nA ringing phone gets attention fast.', checks: { hard_passed: hard, results: [] } }, status: 'awaiting_human', version: 1, meta: { brief_version: 1, awaiting_since: '2026-10-19T10:00:00+05:30', review_total: null } })
    }
    const refused = await call('POST', `/api/approvals/${A}/approve`, {})
    assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.message], [409, 'not_reviewed', 'This version was not checked by the Reviewer. Review it first, or approve with force_unreviewed.'])
    const badForce = await call('POST', `/api/approvals/${A}/approve`, { force_unreviewed: 'yes' })
    assert.deepEqual([badForce.status, badForce.json.error.code], [400, 'bad_params'])

    // Review first (1 Reviewer call), then approve without force.
    const review = await call('POST', `/api/approvals/${A}/review`, {})
    assert.equal(review.status, 202)
    const reviewed = await manager.wait(review.json.run_id)
    assert.equal(reviewed.run.mode, 'approval_review')
    assert.equal(reviewed.run.result_summary, 'review of v1: pass (score 90); still awaiting your approval')
    assert.equal((await call('GET', '/api/approvals')).json.approvals.find((x) => x.brief_id === A).total, 90)
    const approved = await call('POST', `/api/approvals/${A}/approve`, {})
    assert.equal(approved.status, 202)
    assert.equal((await manager.wait(approved.json.run_id)).run.approved_unreviewed, false)

    // The explicit override, visible in the run record.
    const forced = await call('POST', `/api/approvals/${F}/approve`, { force_unreviewed: true })
    assert.equal(forced.status, 202)
    await manager.wait(forced.json.run_id)
    const run = (await call('GET', `/api/runs/${forced.json.run_id}`)).json.run
    assert.equal(run.approved_unreviewed, true)
    assert.equal(run.result_summary, 'approved by you (v1, not reviewed); Markdown export: t.md')

    // Hard checks failed: never approvable, not even with force_unreviewed.
    const hard = await call('POST', `/api/approvals/${H}/approve`, { force_unreviewed: true })
    assert.deepEqual([hard.status, hard.json.error.code], [409, 'hard_checks_failed'])
  })
})

test('Phase 6: settings list built and decision modes and the approval settings (no secrets)', async () => {
  await withApi({ env: { MAX_HUMAN_REVISIONS: '4', REREVIEW_AFTER_HUMAN: 'false' } }, async ({ call }) => {
    const s = (await call('GET', '/api/settings')).json
    assert.ok(s.built_modes.includes('full') && s.built_modes.includes('approval_review'))
    assert.ok(['publish', 'unpublish', 'set_index', 'rebuild_blog'].every((m) => s.built_modes.includes(m)))
    assert.deepEqual(s.decision_modes, ['approve', 'human_revise', 'reject_topic', 'approval_review'])
    assert.deepEqual(s.approval, { max_human_revisions: 4, rereview_after_human: false, m91_notify_on_awaiting: false })
  })
})

test('Phase 6: approval detail has reviewed, hard_passed, and per earlier version total (= score) and record_id', async () => {
  const B = '261018-1600-RRRR'
  await withApi({}, async ({ call, store }) => {
    await store.createRecord({ type: 'brief', briefId: B, payload: { brief_id: B, brief_version: 1, titles: ['T'] }, status: 'awaiting_human', version: 1 })
    const v1 = await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'Old', version: 1, brief_version: 1, post_markdown: '# Old' }, status: 'changes_requested', version: 1, meta: { brief_version: 1 } })
    await store.createRecord({ type: 'review', briefId: B, payload: { version: 1, brief_version: 1, total: 81, pass: true }, status: 'pass', version: 1, meta: { brief_version: 1 } })
    await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'T', version: 2, brief_version: 1, post_markdown: '# T', checks: { hard_passed: false, results: [] } }, status: 'awaiting_human', version: 2, meta: { brief_version: 1 } })
    const d = (await call('GET', `/api/approvals/${B}`)).json
    assert.equal(d.draft.reviewed, false)
    assert.equal(d.draft.hard_passed, false)
    assert.deepEqual(d.earlier.map(({ version, score, total, record_id }) => ({ version, score, total, record_id })), [{ version: 1, score: 81, total: 81, record_id: v1.id }])
    await store.createRecord({ type: 'review', briefId: B, payload: { version: 2, brief_version: 1, total: 90, pass: true }, status: 'pass', version: 2, meta: { brief_version: 1 } })
    assert.equal((await call('GET', `/api/approvals/${B}`)).json.draft.reviewed, true)
  })
})

test('Phase 6: lessons are listed with their text as title and can be deleted; other records 404', async () => {
  await withApi({}, async ({ call, store }) => {
    const lesson = await store.createRecord({ type: 'lesson', payload: 'Explain jargon in plain words the first time it appears.', status: null })
    const brief = await store.createRecord({ type: 'brief', briefId: 'B-2', payload: { brief_id: 'B-2', titles: ['x'] } })
    const list = (await call('GET', '/api/records?type=lesson')).json.records
    assert.equal(list[0].title, 'Explain jargon in plain words the first time it appears.')
    assert.equal((await call('GET', '/api/records?type=source_pack')).status, 200)
    assert.equal((await call('DELETE', `/api/lessons/${brief.id}`)).status, 404)
    assert.equal((await call('DELETE', '/api/lessons/mem-nope')).status, 404)
    const del = await call('DELETE', `/api/lessons/${lesson.id}`)
    assert.deepEqual([del.status, del.json.deleted], [200, lesson.id])
    assert.equal((await call('GET', '/api/records?type=lesson')).json.records.length, 0)
    assert.ok(store.records.has(brief.id))
  })
})

test('Phase 7: settings show the blog settings and deploy_token_set (never the token); GET /api/posts lists published posts', async () => {
  await withApi({ env: { EMBARKO_DEPLOY_TOKEN: 'emb_faketoken_0123456789abcdef', AUTO_PUBLISH: 'true' } }, async ({ call, store }) => {
    const res = await call('GET', '/api/settings')
    assert.ok(!res.text.includes('emb_faketoken'))
    assert.deepEqual(res.json.blog, { auto_publish: true, app_name: 'm91-blog', base_url: 'https://m91-blog.embarko.app', noindex_first_n_posts: 10, deploy_token_set: true })
    assert.deepEqual(res.json.publish_modes, ['publish', 'unpublish', 'set_index', 'rebuild_blog'])
    await store.createRecord({ type: 'published_post', briefId: 'B1', status: 'published', version: 2, payload: { slug: 'a', title: 'A', url: 'https://m91-blog.embarko.app/posts/a/', brief_id: 'B1', version: 2, topic_group: 1, noindex: true, post: { markdown: 'long text' } } })
    const posts = await call('GET', '/api/posts')
    assert.equal(posts.status, 200)
    assert.equal(posts.json.posts.length, 1)
    assert.deepEqual({ slug: posts.json.posts[0].slug, status: posts.json.posts[0].status, noindex: posts.json.posts[0].noindex, url: posts.json.posts[0].url }, { slug: 'a', status: 'published', noindex: true, url: 'https://m91-blog.embarko.app/posts/a/' })
    assert.ok(!posts.text.includes('long text'), 'no post body in the list')
  })
  await withApi({ env: { EMBARKO_DEPLOY_TOKEN: '' } }, async ({ call }) => {
    assert.equal((await call('GET', '/api/settings')).json.blog.deploy_token_set, false)
  })
})

test('interactive guide API: the switch on the newest draft, the Experience Designer result on the approval, revisions_used, blocks on posts, settings', async () => {
  const B = '261020-0900-QBLK'
  await withApi({ env: { INTERACTIVE_DEFAULT: 'true' } }, async ({ call, store }) => {
    await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'T', version: 1, brief_version: 1, post_markdown: '# T' }, status: 'approved', version: 1, meta: { brief_version: 1 } })
    let d = (await call('GET', `/api/approvals/${B}`)).json
    assert.deepEqual(d.interactive, { on: true, default: true, set: false, guide_doc: null })
    assert.equal(d.revisions_used, 0)

    assert.equal((await call('POST', `/api/drafts/${B}/interactive`, { on: 'no' })).json.error.code, 'bad_params')
    assert.equal((await call('POST', '/api/drafts/bad/interactive', { on: true })).status, 400)
    assert.equal((await call('POST', '/api/drafts/261020-0900-ZZZZ/interactive', { on: true })).status, 404)
    const off = await call('POST', `/api/drafts/${B}/interactive`, { on: false })
    assert.equal(off.status, 200)
    assert.deepEqual(off.json, { brief_id: B, version: 1, on: false, saved: true })
    d = (await call('GET', `/api/approvals/${B}`)).json
    assert.equal(d.interactive.on, false)
    assert.equal(d.interactive.set, true)

    const guide = { chapters: [{ components: [{ type: 'prose' }, { type: 'approve_demo' }] }, { components: [{ type: 'prose' }, { type: 'faq' }, { type: 'steps_checklist' }] }] }
    await store.createRecord({ type: 'guide_doc', briefId: B, version: 1, status: 'ok', payload: { brief_id: B, version: 1, brief_version: 1, guide, dropped: [{}], coverage: { passed: true }, summary: '2 chapters · 3 components · 1 dropped · checks passed', created_at: '2026-10-21T09:00:00+05:30' }, meta: { brief_version: 1 } })
    d = (await call('GET', `/api/approvals/${B}`)).json
    assert.equal(d.interactive.guide_doc.chapters, 2)
    assert.equal(d.interactive.guide_doc.components, 3)
    assert.equal(d.interactive.guide_doc.dropped, 1)
    assert.equal(d.interactive.guide_doc.coverage_passed, true)
    assert.match(d.interactive.guide_doc.summary, /^2 chapters/)

    await store.createRecord({ type: 'published_post', briefId: B, status: 'published', payload: { slug: 't', title: 'T', brief_id: B, version: 1, post: { slug: 't', blocks: [{}, {}] } } })
    assert.equal((await call('GET', '/api/posts')).json.posts[0].blocks, 2)

    const s = (await call('GET', '/api/settings')).json
    assert.deepEqual(s.designer, { enabled: true, max_components: 10, max_repairs: 1, interactive_default: true, max_designer_revisions: 2, promo_enabled: false })
    assert.ok(s.models.designer)
  })
})
