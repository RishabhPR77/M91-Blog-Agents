// viaSocket AI memory as the record store (MEMORY_BACKEND=viasocket): the store's contract (the same as the Mem0
// store's), its calls to the memory service, the backend switch, the guard (no stop: calls and cost), and one run on it.
// A fake memory service stands in for memory-api.viasocket.com: no network, nothing real is read or written.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVsMemoryStore, typeOfId, titleOf, parseTitle, fromBody, ID_PREFIX } from '../src/vsmemory.js'
import { createStore, toRecord } from '../src/store.js'
import { usageStatus } from '../src/util/mem0usage.js'
import { createRunManager } from '../src/runs.js'
import { stubAgents } from '../src/agents/stubs.js'
import { resetEvents } from '../src/events.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, fakeNotifier, mockReviewer } from './helpers.js'

beforeEach(() => resetEvents())
const quiet = () => setSink(() => {})
const ME = 'users/179349'
const cfg = (over = {}) => fakeConfig({ MEMORY_BACKEND: 'viasocket', ENGINE_DATA_DIR: mkdtempSync(join(tmpdir(), 'm91-vsmem-')), DRY_RUN: 'false', ...over })

/** The memory service in memory: notes by space and path, the calls the guide documents. */
function fakeMemoryService() {
  const notes = new Map() // `${space}|${path}` → note
  const calls = []
  const err = (status, message) => Object.assign(new Error(message), { status })
  const parse = (path) => {
    const [p, q = ''] = path.split('?')
    return { p, q: Object.fromEntries(new URLSearchParams(q)) }
  }
  async function call(method, path, body) {
    const { p, q } = parse(path)
    calls.push({ method, path: p, query: q, body })
    if (method === 'GET' && body !== undefined) throw err(400, 'a GET carries no body')
    if (method === 'PUT' && p === '/notes') {
      const key = `${body.space}|${body.path}`
      const old = notes.get(key)
      const note = { space: body.space, path: body.path, title: body.title ?? null, kind: body.kind ?? 'note', version: (old?.version ?? 0) + 1, body: body.body, updated_at: new Date().toISOString() }
      notes.set(key, note)
      return { created: !old, note, indexed: 'indexed' }
    }
    if (method === 'GET' && p === '/index') {
      const prefix = q.path ? `${q.path}/` : ''
      const all = [...notes.values()].filter((n) => n.space === q.space && n.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path))
      const off = Number(q.offset ?? 0)
      const lim = Number(q.limit ?? 100)
      return { spaces: [q.space], path: q.path ?? null, folders: [], notes: all.slice(off, off + lim).map(({ body: _b, ...n }) => n) }
    }
    if (method === 'GET' && p === '/open') {
      const n = notes.get(`${q.space}|${q.path}`)
      if (!n) throw err(404, 'nothing at that path')
      return { note: n }
    }
    if (method === 'DELETE' && p === '/notes') {
      if (!notes.delete(`${body.space}|${body.path}`)) throw err(404, 'nothing at that path')
      return { deleted: 1 }
    }
    if (method === 'POST' && p === '/search') {
      const words = String(body.query).toLowerCase().split(/\W+/).filter((w) => w.length > 3)
      const hits = [...notes.values()].filter((n) => n.path.startsWith(`${body.path}/`) && words.some((w) => n.body.toLowerCase().includes(w)))
      return { prompt: null, rules: [], results: hits.map(({ body: _b, ...n }) => ({ ...n, excerpt: '', distance: 0.2, score: 0.8 })), connections: [], lessons: [] }
    }
    throw err(404, `no route ${method} ${p}`)
  }
  const factory = () => ({ user: () => ({ memory: { token: async () => ({ token: 'tok', url: 'https://memory-api.viasocket.com', me: ME, spaces: { [ME]: 'write' }, expiresIn: 60 }), call } }) })
  return { factory, notes, calls }
}

test('ids and titles: the type comes back from the id; the title filters lists without opening notes', () => {
  assert.equal(typeOfId('vm_question_cluster_1a2b3c'), 'question_cluster')
  assert.equal(typeOfId('vm_draft_abc'), 'draft')
  assert.equal(typeOfId('dryrun-1'), null)
  assert.equal(typeOfId('7c1e-mem0-id'), null)
  const t = titleOf({ type: 'draft', briefId: '261029-1000-ABCD', status: 'approved', version: 2 })
  assert.equal(t, 'draft|261029-1000-ABCD|approved|2')
  assert.deepEqual(parseTitle(t), { type: 'draft', briefId: '261029-1000-ABCD', status: 'approved', version: 2 })
  assert.deepEqual(parseTitle('roadmap|||'), { type: 'roadmap', briefId: null, status: null, version: null })
  assert.equal(parseTitle('a note someone wrote'), null)
  assert.equal(fromBody('not json'), null)
  assert.equal(fromBody({ id: 'x', metadata: { type: 'brief', version: '3', pass: 'true' } }).version, 3, 'metadata types restored')
})

test('the store: create, get, update (same path, metadata merged), list with filters, getOne, delete — exact notes at <root>/<type>/<id>', async () => {
  const svc = fakeMemoryService()
  const store = createVsMemoryStore({ config: cfg(), viasocketFactory: svc.factory })
  assert.equal(store.backend, 'viasocket')
  const a = await store.createRecord({ type: 'draft', briefId: '261029-1000-ABCD', status: 'drafted', version: 1, payload: { title: 'One' }, meta: { brief_version: 1 } })
  const b = await store.createRecord({ type: 'draft', briefId: '261029-1000-ABCD', status: 'drafted', version: 2, payload: { title: 'Two' } })
  const c = await store.createRecord({ type: 'draft', briefId: '261029-1100-WXYZ', status: 'approved', version: 1, payload: { title: 'Other' } })
  await store.createRecord({ type: 'brief', briefId: '261029-1000-ABCD', status: 'new', version: 1, payload: { titles: ['T'] } })
  assert.ok(a.id.startsWith(`${ID_PREFIX}draft_`))
  const put = svc.calls.find((x) => x.method === 'PUT')
  assert.deepEqual([put.body.space, put.body.path, put.body.title, put.body.kind], [ME, `m91-blog/draft/${a.id}`, 'draft|261029-1000-ABCD|drafted|1', 'note'])
  assert.deepEqual(JSON.parse(put.body.body).payload, { title: 'One' })
  assert.deepEqual((await store.getRecord(a.id)).payload, { title: 'One' })
  assert.equal(await store.getRecord('vm_draft_missing'), null)
  assert.equal(await store.getRecord('not-ours'), null)
  // Lists: the type's folder; title filters skip notes that cannot match, so only those are opened.
  svc.calls.length = 0
  const mine = await store.getRecords({ type: 'draft', brief_id: '261029-1000-ABCD' })
  assert.deepEqual(mine.map((r) => r.payload.title).sort(), ['One', 'Two'])
  assert.equal(svc.calls.filter((x) => x.path === '/open').length, 2, 'the other brief\'s draft was not opened')
  assert.deepEqual(svc.calls.find((x) => x.path === '/index').query, { space: ME, path: 'm91-blog/draft', limit: '500', offset: '0' })
  assert.deepEqual((await store.getRecords({ type: 'draft', status: 'approved' })).map((r) => r.id), [c.id])
  assert.equal((await store.getOne('draft', '261029-1000-ABCD')).version, 2)
  assert.equal((await store.getRecords({})).length, 4, 'every type')
  // Update: the same path, metadata merged, the record's fields follow it.
  const u = await store.updateRecord(a.id, { title: 'One, revised' }, { status: 'superseded' })
  assert.deepEqual([u.status, u.version, u.briefId, u.metadata.brief_version, u.payload.title], ['superseded', 1, '261029-1000-ABCD', 1, 'One, revised'])
  assert.equal(svc.notes.get(`${ME}|m91-blog/draft/${a.id}`).version, 2, 'a new version of the same note')
  assert.equal(svc.notes.get(`${ME}|m91-blog/draft/${a.id}`).title, 'draft|261029-1000-ABCD|superseded|1')
  const keep = await store.updateRecord(b.id, undefined, { status: 'approved' }, { known: b })
  assert.deepEqual(keep.payload, { title: 'Two' }, 'payload kept when only metadata changes')
  await store.deleteRecord(c.id)
  await store.deleteRecord(c.id) // already gone: no error
  assert.equal(await store.getRecord(c.id), null)
})

test('lists page through the index (500 a note per page) and ignore notes outside the folder', async () => {
  const svc = fakeMemoryService()
  const store = createVsMemoryStore({ config: cfg(), viasocketFactory: svc.factory })
  for (let i = 0; i < 3; i++) await store.createRecord({ type: 'lesson', payload: `lesson ${i}`, status: 'current' })
  // A note someone wrote by hand in the same space, outside our folder, and one in a sibling folder.
  svc.notes.set(`${ME}|facts/x`, { space: ME, path: 'facts/x', title: null, body: '{}' })
  svc.notes.set(`${ME}|m91-blog/lessonx/y`, { space: ME, path: 'm91-blog/lessonx/y', title: null, body: '{}' })
  assert.equal((await store.getRecords({ type: 'lesson' })).length, 3)
})

test('DRY_RUN: no writes except run records; lessons are records of type lesson', async () => {
  const svc = fakeMemoryService()
  const dry = createVsMemoryStore({ config: cfg({ DRY_RUN: 'true' }), viasocketFactory: svc.factory })
  const d = await dry.createRecord({ type: 'brief', payload: {}, status: 'new' })
  assert.ok(d.dryRun && d.id.startsWith('dryrun-'))
  await dry.createRecord({ type: 'run', payload: { run_id: 'R-1' }, status: 'running' })
  assert.deepEqual([...svc.notes.keys()].map((k) => k.split('|')[1].split('/')[1]), ['run'])
  const live = createVsMemoryStore({ config: cfg(), viasocketFactory: svc.factory })
  const l = await live.addLesson('Explain "webhook" in plain words.', { source: 'reviewer', brief_id: 'B-1' })
  assert.equal(l.status, 'SUCCEEDED')
  const lesson = (await live.getRecords({ type: 'lesson' }))[0]
  assert.deepEqual([lesson.payload, lesson.briefId, lesson.metadata.source], ['Explain "webhook" in plain words.', 'B-1', 'reviewer'])
})

test('search, the reset list (Mem0-shaped) and delete-all (our folder only)', async () => {
  const svc = fakeMemoryService()
  const store = createVsMemoryStore({ config: cfg(), viasocketFactory: svc.factory })
  await store.createRecord({ type: 'brief', briefId: 'B-1', payload: { titles: ['Approve refunds by phone'] }, status: 'new' })
  await store.createRecord({ type: 'brief', briefId: 'B-2', payload: { titles: ['Wake the on-call person'] }, status: 'new' })
  const hits = await store.searchSimilar('refunds approval', { type: 'brief' })
  assert.deepEqual(hits.map((h) => [h.briefId, h.score]), [['B-1', 0.8]])
  const raw = await store.listAgentMemories()
  assert.equal(raw.length, 2)
  assert.deepEqual(toRecord(raw[0]).type, 'brief', 'reads like a Mem0 memory')
  svc.notes.set(`${ME}|facts/keep`, { space: ME, path: 'facts/keep', body: '{}' })
  const r = await store.deleteAllForAgent()
  assert.equal(r.message, 'deleted 2 notes under m91-blog')
  assert.deepEqual([...svc.notes.keys()], [`${ME}|facts/keep`], 'only our folder')
  assert.equal(store.agentId, 'm91-blog-engine:m91-blog')
})

test('a network error or 5xx is tried again; a 4xx is not', async () => {
  const svc = fakeMemoryService()
  let fails = 2
  const flaky = () => {
    const base = svc.factory().user()
    return { user: () => ({ memory: { token: base.memory.token, call: async (m, p, b) => { if (p.startsWith('/open') && fails-- > 0) throw Object.assign(new Error('Request failed: network error'), { status: null }); return base.memory.call(m, p, b) } } }) }
  }
  const store = createVsMemoryStore({ config: cfg(), viasocketFactory: flaky, sleepFn: async () => {} })
  const rec = await store.createRecord({ type: 'brief', payload: { a: 1 }, status: 'new' })
  assert.deepEqual((await store.getRecord(rec.id)).payload, { a: 1 }, 'two network errors, then the answer')
  const bad = { user: () => ({ memory: { token: async () => ({ me: ME }), call: async () => { throw Object.assign(new Error('This token cannot read the memory space'), { status: 403 }) } } }) }
  const s2 = createVsMemoryStore({ config: cfg(), viasocketFactory: () => bad, sleepFn: async () => {} })
  await assert.rejects(s2.getRecords({ type: 'brief' }), /cannot read the memory space/)
})

test('through the real viasocket-apps package: the token from the API base, the calls to the memory URL, no body on GET', async () => {
  const svc = fakeMemoryService()
  const seen = []
  const transport = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method ?? 'GET', auth: init.headers?.authorization ?? init.headers?.Authorization ?? null, body: init.body })
    if (String(url).startsWith('https://flow-api.viasocket.com/embed/ai/memory-token')) return new Response(JSON.stringify({ success: true, message: 'Memory token issued', data: { token: 'mem-token-1', url: 'https://memory-api.viasocket.com', mcp_url: 'x', expires_in: 3600, me: ME, spaces: { [ME]: 'write' } } }), { status: 200 })
    const u = new URL(String(url))
    try {
      const data = await svc.factory().user().memory.call(init.method ?? 'GET', `${u.pathname}${u.search}`, init.body ? JSON.parse(init.body) : undefined)
      return new Response(JSON.stringify(data), { status: 200 })
    } catch (e) {
      return new Response(JSON.stringify({ status: 'error', success: false, message: e.message, data: null }), { status: e.status ?? 500 })
    }
  }
  const store = createVsMemoryStore({ config: cfg(), memoryFetch: transport })
  const rec = await store.createRecord({ type: 'roadmap', payload: { stages: [] }, status: 'draft' })
  assert.deepEqual((await store.getRecords({ type: 'roadmap' })).map((r) => r.id), [rec.id])
  assert.equal(await store.getRecord('vm_roadmap_none'), null, 'a 404 is "none"')
  const token = seen.find((s) => s.url.includes('/embed/ai/memory-token'))
  assert.match(token.url, /^https:\/\/flow-api\.viasocket\.com\/embed\/ai\/memory-token\?expires_in=60$/)
  assert.ok(token.auth && !/^Bearer /.test(token.auth), 'the embed token, bare')
  const mem = seen.filter((s) => s.url.startsWith('https://memory-api.viasocket.com/'))
  assert.ok(mem.length >= 3 && mem.every((s) => s.auth === 'Bearer mem-token-1'))
  assert.ok(mem.filter((s) => s.method === 'GET').every((s) => s.body === undefined))
  assert.equal(seen.filter((s) => s.url.includes('/embed/ai/memory-token')).length, 2, 'once for the space (60 s), once for the calls; then reused')
})

test('the backend switch, the settings, and the guard (no stop with viaSocket: calls and cost)', async () => {
  const c = cfg()
  assert.deepEqual([c.memory.backend, c.memory.root], ['viasocket', 'm91-blog'])
  assert.equal(fakeConfig({ MEMORY_BACKEND: '' }).memory.backend, 'viasocket', 'the default')
  assert.doesNotThrow(() => fakeConfig({ MEMORY_BACKEND: 'viasocket', MEM0_API_KEY: '' }), 'no Mem0 key needed')
  assert.throws(() => fakeConfig({ MEMORY_BACKEND: 'mem0', MEM0_API_KEY: '' }), /MEM0_API_KEY: missing/)
  const svc = fakeMemoryService()
  const store = createStore({ config: c, viasocketFactory: svc.factory })
  const rec = await store.createRecord({ type: 'brief', payload: {}, status: 'new', briefId: 'B-9' })
  assert.ok(rec.id.startsWith('local:') || rec.id.startsWith(ID_PREFIX), 'the work store wraps it')
  const old = createStore({ config: fakeConfig(), clientFactory: async () => ({}) })
  assert.ok(old.backend === 'mem0' || old.base?.backend === 'mem0' || typeof old.localRecords === 'function')
  const u = usageStatus(c)
  assert.deepEqual([u.backend, u.level, u.limited], ['viasocket', 'ok', null])
  assert.ok(typeof u.cost_usd === 'number')
})

test('a full run on viaSocket memory: the run record and the brief are saved there; nothing goes to Mem0', async () => {
  const restore = quiet()
  const svc = fakeMemoryService()
  const config = cfg({ WORK_STORE: 'mem0' })
  const m = createRunManager({ config, storeFactory: (rc) => createStore({ config: rc, viasocketFactory: svc.factory }), notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
  try {
    const { run_id } = await m.startRun({ mode: 'full' })
    const r = await m.wait(run_id)
    assert.equal(r.status, 'succeeded', r.run?.result_summary)
    const folders = new Set([...svc.notes.keys()].map((k) => k.split('|')[1].split('/')[1]))
    assert.ok(folders.has('run'), [...folders].join(','))
    assert.ok([...svc.notes.keys()].every((k) => k.startsWith(`${ME}|m91-blog/`)))
  } finally {
    restore()
  }
})
