// Phase 12 Task 1: reset:all. A fake Mem0 account (our agent's memories plus another agent's), temporary data and
// export folders. No network, no real Mem0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStore, clearStoreCache } from '../src/store.js'
import { planReset, runReset, countByType, KEEP_IN_DATA, ResetError } from '../src/reset.js'
import { resetCommand } from '../src/cli.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig } from './helpers.js'

const AGENT = 'blog-engine-test'

/** A fake Mem0 client: memories of several agents; deleteAll removes only the agent it is given. */
function fakeMem0() {
  const memories = new Map()
  const calls = []
  let n = 0
  const put = (agentId, type, extra = {}) => {
    const id = `m-${++n}`
    memories.set(id, { id, memory: '{}', agentId, metadata: type ? { type, ...extra } : {} })
  }
  return {
    memories, calls, put,
    async getAll({ filters, page }) {
      calls.push(['getAll', filters, page])
      const all = [...memories.values()].filter((m) => !filters.agent_id || m.agentId === filters.agent_id)
      return { results: all.slice((page - 1) * 100, page * 100), next: all.length > page * 100 ? 'more' : null }
    },
    async deleteAll(options) {
      calls.push(['deleteAll', options])
      for (const [id, m] of memories) if (m.agentId === options.agentId) memories.delete(id)
      return { message: 'Memories deletion queued for background execution', event_id: 'evt-del-1' }
    },
    async delete(id) { calls.push(['delete', id]); memories.delete(id) }
  }
}

function setup({ agentId = AGENT } = {}) {
  clearStoreCache()
  const root = mkdtempSync(join(tmpdir(), 'm91-reset-'))
  const data = join(root, 'data')
  const exportsDir = join(root, 'exports')
  mkdirSync(join(data, 'previews', '261021-0937-JHTR'), { recursive: true })
  mkdirSync(exportsDir, { recursive: true })
  writeFileSync(join(data, 'mem0-usage.json'), JSON.stringify({ month: '2026-10', requests: 847 }))
  writeFileSync(join(data, 'last-write.json'), '{}')
  writeFileSync(join(data, 'previews', '261021-0937-JHTR', 'preview.json'), '{}')
  writeFileSync(join(exportsDir, 'old-post.md'), '# Old')
  const config = fakeConfig({ MEM0_AGENT_ID: agentId, ENGINE_DATA_DIR: data, EXPORT_DIR: exportsDir })
  const mem0 = fakeMem0()
  for (let i = 0; i < 130; i++) mem0.put(AGENT, i < 3 ? 'brief' : i < 10 ? 'draft' : 'question_cluster')
  mem0.put(AGENT, null) // a memory without our metadata is counted too
  mem0.put('someone-else', 'brief')
  mem0.put('someone-else', 'draft')
  const fetch = async (url) => {
    mem0.calls.push(['event', String(url)])
    return { ok: true, status: 200, json: async () => ({ status: 'SUCCEEDED' }) }
  }
  const store = createStore({ config, clientFactory: async () => mem0, fetch, sleepFn: async () => {}, dryRun: false })
  return { root, data, exportsDir, config, mem0, store, done: () => rmSync(root, { recursive: true, force: true }) }
}

test('dry run: one paged list for our agent id only, counted by type, plus the local leftovers; nothing changes', async () => {
  const s = setup()
  const plan = await planReset({ store: s.store, config: s.config })
  assert.equal(plan.agent_id, AGENT)
  assert.equal(plan.total, 131)
  assert.deepEqual(plan.byType, { question_cluster: 120, draft: 7, brief: 3, '(no type)': 1 })
  assert.deepEqual(s.mem0.calls.map((c) => c[0]), ['getAll', 'getAll'], '131 memories → 2 pages of 100')
  assert.ok(s.mem0.calls.every((c) => c[1].agent_id === AGENT), 'only our agent id is listed')
  assert.equal(plan.local.exports.files, 1)
  assert.deepEqual(plan.local.data.entries.map((e) => e.name).sort(), ['last-write.json', 'previews'])
  assert.deepEqual(plan.local.data.kept, ['mem0-usage.json'])
  assert.equal(s.mem0.memories.size, 133)
  assert.ok(existsSync(join(s.exportsDir, 'old-post.md')))
  s.done()
})

test('real reset: nothing happens without "yes"; with "yes" one delete-all for our agent id, the other agent untouched, the usage file kept', async () => {
  const s = setup()
  const no = await runReset({ store: s.store, config: s.config, confirm: async () => false })
  assert.equal(no.done, false)
  assert.equal(s.mem0.memories.size, 133)
  assert.ok(existsSync(join(s.data, 'previews')))

  s.mem0.calls.length = 0
  const waits = []
  const r = await runReset({ store: s.store, config: s.config, confirm: async (plan) => plan.total === 131, sleepFn: async (ms) => { waits.push(ms) } })
  assert.equal(r.done, true)
  assert.equal(r.deleted, 131)
  assert.equal(r.left, 0)
  const del = s.mem0.calls.filter((c) => c[0] === 'deleteAll')
  assert.deepEqual(del, [['deleteAll', { agentId: AGENT }]], 'exactly one delete-all, with only our agent id')
  assert.ok(!s.mem0.calls.some((c) => c[0] === 'event'), 'the background event is not polled (each poll is a request)')
  assert.deepEqual(waits, [20000], 'one wait, then one check list')
  assert.equal(r.event_id, 'evt-del-1')
  assert.deepEqual(s.mem0.calls.map((c) => c[0]), ['getAll', 'getAll', 'deleteAll', 'getAll'], '2 list pages, 1 delete-all, 1 check list')
  assert.equal(s.mem0.calls.filter((c) => c[0] === 'delete').length, 0)
  assert.deepEqual([...s.mem0.memories.values()].map((m) => m.agentId), ['someone-else', 'someone-else'])
  assert.deepEqual(readdirSync(s.exportsDir), [])
  assert.deepEqual(readdirSync(s.data).sort(), ['last-write.json', 'mem0-usage.json'], 'the usage file is kept; the write marker is stamped again')
  assert.ok(readFileSync(join(s.data, 'mem0-usage.json'), 'utf8').length > 0, 'the usage file is still there')
  assert.ok(KEEP_IN_DATA.includes('mem0-usage.json'))
  s.done()
})

test('a wildcard or empty agent id is refused; a run in progress blocks the reset; a dry-run store is refused', async () => {
  const w = setup({ agentId: '*' })
  await assert.rejects(runReset({ store: w.store, config: w.config, confirm: async () => true }), /empty or a wildcard/)
  assert.equal(w.mem0.calls.filter((c) => c[0] === 'deleteAll').length, 0)
  w.done()
  const s = setup()
  writeFileSync(join(s.data, 'run.lock'), JSON.stringify({ pid: process.pid, run_id: 'R-261022-1000-ABCD' }))
  await assert.rejects(runReset({ store: s.store, config: s.config, confirm: async () => true }), (e) => e instanceof ResetError && /R-261022-1000-ABCD/.test(e.message))
  rmSync(join(s.data, 'run.lock'))
  const dry = createStore({ config: s.config, clientFactory: async () => s.mem0, dryRun: true })
  await assert.rejects(runReset({ store: dry, config: s.config, confirm: async () => true }), /DRY_RUN/)
  s.done()
})

test('countByType sorts by count; the CLI prints the counts and the Mem0 requests, and asks for "yes"', async () => {
  assert.deepEqual(countByType([{ metadata: { type: 'a' } }, { metadata: { type: 'b' } }, { metadata: { type: 'b' } }, {}]), { b: 2, '(no type)': 1, a: 1 })
  const restore = setSink(() => {})
  const s = setup()
  const out = []
  await resetCommand({ 'dry-run': true, _: ['reset'] }, { store: s.store, config: s.config, print: (l) => out.push(l) })
  assert.match(out[0], /^Mem0 memories under agent id "blog-engine-test": 131$/)
  assert.ok(out.includes('Dry run: nothing was deleted.'))
  assert.match(out.at(-1), /^Mem0 requests: 2 \(reads 2 · writes 0\)$/)
  const asked = []
  const out2 = []
  await resetCommand({ _: ['reset'] }, { store: s.store, config: s.config, print: (l) => out2.push(l), confirm: async (q) => { asked.push(q); return 'no' } })
  assert.match(asked[0], /Type "yes" to delete these 131 Mem0 memories/)
  assert.ok(out2.includes('Nothing deleted.'))
  assert.equal(s.mem0.memories.size, 133)
  const out3 = []
  await resetCommand({ _: ['reset'] }, { store: s.store, config: s.config, print: (l) => out3.push(l), confirm: async () => 'yes', sleepFn: async () => {} })
  restore()
  assert.ok(out3.some((l) => /^Deleted 131 Mem0 memories \(left: 0\)/.test(l)))
  assert.match(out3.at(-1), /^Mem0 requests: 4 \(reads 3 · writes 1\)$/)
  s.done()
})
