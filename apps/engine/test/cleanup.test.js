// Draft numbering per brief version and the test-data clean-up (Phase 5 brief, A3). No network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextDraftVersion, draftsOf, saveDraft } from '../src/writer/save.js'
import { findCandidates, outOfOrder, PROTECTED_TYPES } from '../src/cleanup.js'
import { cleanupCommand } from '../src/cli.js'
import { setSink } from '../src/util/log.js'
import { memoryStore } from './helpers.js'

const B = '261018-1400-ABCD'
const quiet = () => setSink(() => {})
const draft = (store, version, briefVersion = 1, over = {}) => store.createRecord({ type: 'draft', briefId: B, payload: { title: 't', version, brief_version: briefVersion }, status: 'drafted', version, meta: { brief_version: briefVersion }, ...over })

test('next draft version: max valid version + 1 within the brief version; a new brief version starts at 1; invalid versions ignored with a warning', async () => {
  const warnings = []
  const restore = setSink((level, line) => { if (level === 'warn') warnings.push(line) })
  const store = memoryStore()
  assert.equal(await nextDraftVersion(store, B, 1), 1)
  await draft(store, 1)
  await draft(store, 2)
  await draft(store, 'v3?')
  await draft(store, 0)
  assert.equal(await nextDraftVersion(store, B, 1), 3)
  assert.equal(await nextDraftVersion(store, B, 2), 1, 'brief v2 starts again')
  await draft(store, 1, 2)
  assert.equal(await nextDraftVersion(store, B, 2), 2)
  // Drafts saved before Phase 5 have brief_version only in the payload.
  await store.createRecord({ type: 'draft', briefId: B, payload: { title: 'old', version: 5, brief_version: 3 }, status: 'drafted', version: 5 })
  assert.equal(await nextDraftVersion(store, B, 3), 6)
  restore()
  assert.ok(warnings.some((w) => /invalid version ignored/.test(w) && /v3\?/.test(w)), JSON.stringify(warnings))
  // Newest first: brief version, then version.
  assert.deepEqual((await draftsOf(store, B)).filter((d) => Number.isInteger(d.version) && d.version > 0).map((d) => [d.metadata.brief_version ?? d.payload.brief_version, d.version]), [[3, 5], [2, 1], [1, 2], [1, 1]])
})

test('saveDraft: brief_version in metadata; earlier drafts (older brief versions too) are superseded', async () => {
  const restore = quiet()
  const store = memoryStore()
  const a = await draft(store, 1, 1)
  const b = await draft(store, 2, 1)
  const { record } = await saveDraft(store, { briefId: B, version: 1, briefVersion: 2, topicGroup: 1, payload: { title: 'new brief' }, hardPassed: true })
  restore()
  assert.equal(record.metadata.brief_version, 2)
  assert.equal(store.records.get(a.id).status, 'superseded')
  assert.equal(store.records.get(b.id).status, 'superseded')
  assert.equal(store.records.get(record.id).status, 'drafted')
})

test('cleanup candidates: invalid and out-of-order versions, dry runs, smoke-test tags; protected types never listed', async () => {
  const store = memoryStore()
  const ok1 = await draft(store, 1)
  const ok2 = await draft(store, 2)
  const v11 = await draft(store, 11)
  const bad = await draft(store, 'x')
  const dup = await draft(store, 2)
  const brief1 = await store.createRecord({ type: 'brief', briefId: B, payload: { brief_version: 1 }, status: 'new', version: 1 })
  const brief3 = await store.createRecord({ type: 'brief', briefId: B, payload: { brief_version: 3 }, status: 'new', version: 3 })
  const runLog = await store.createRecord({ type: 'run_log', briefId: B, payload: { x: 1 } })
  store.records.get(runLog.id).metadata.dry_run = true
  const smoke = await store.createRecord({ type: 'review', briefId: B, payload: {}, meta: { test: true } })
  for (const type of PROTECTED_TYPES) await store.createRecord({ type, payload: 'keep', meta: { test: true } })
  const list = findCandidates(await store.getRecords({}))
  const byId = new Map(list.map((c) => [c.id, c.reasons.join('; ')]))
  assert.ok(!byId.has(ok1.id) && !byId.has(ok2.id) && !byId.has(brief1.id))
  assert.match(byId.get(v11.id), /draft b1 v11 after v2 \(gap\)/)
  assert.match(byId.get(bad.id), /not a positive integer/)
  assert.match(byId.get(dup.id), /draft b1 v2 repeated/)
  assert.match(byId.get(brief3.id), /brief v3 after v1 \(gap\)/)
  assert.match(byId.get(runLog.id), /dry_run: true/)
  assert.match(byId.get(smoke.id), /smoke test/)
  assert.ok(list.every((c) => !PROTECTED_TYPES.includes(c.type)))
  assert.equal(outOfOrder([], () => 1, 'x').size, 0)
})

test('cleanup command: --delete removes only the given ids (any type); --delete-listed asks for "yes" and never touches protected types', async () => {
  const out = []
  const io = { print: (s) => out.push(s), table: () => {} }
  const store = memoryStore()
  const keep = await draft(store, 1)
  const lesson = await store.createRecord({ type: 'lesson', payload: 'a lesson', meta: { test: true } })
  const junk = await draft(store, 'x')
  const tagged = await store.createRecord({ type: 'review', briefId: B, payload: {}, meta: { test: true } })

  await cleanupCommand({ _: ['cleanup'], 'delete-listed': true }, { store, ...io, confirm: async () => 'no' })
  assert.equal(store.records.size, 4)
  assert.match(out.at(-1), /Nothing deleted/)

  await cleanupCommand({ _: ['cleanup'], 'delete-listed': true }, { store, ...io, confirm: async () => 'yes' })
  assert.ok(!store.records.has(junk.id) && !store.records.has(tagged.id))
  assert.ok(store.records.has(keep.id) && store.records.has(lesson.id), 'valid draft and the protected lesson stay')
  assert.match(out.at(-1), /Deleted 2 record/)

  await cleanupCommand({ _: ['cleanup', keep.id], delete: lesson.id }, { store, ...io })
  assert.equal(store.records.size, 0, 'explicit ids are deleted, protected or not')
  await assert.rejects(cleanupCommand({ _: ['cleanup'] }, { store, ...io }), /usage: npm run cleanup/)
})

test('lessons command: --list shows lessons; --delete only deletes a lesson memory', async () => {
  const { lessonsCommand } = await import('../src/cli.js')
  const out = []
  const rows = []
  const store = memoryStore()
  await store.addLesson('Explain webhook the first time.', { source: 'reviewer', brief_id: B })
  const other = await draft(store, 1)
  await lessonsCommand({ _: ['lessons'], list: true }, { store, print: (s) => out.push(s), table: (t) => rows.push(...t) })
  assert.equal(rows[0].lesson, 'Explain webhook the first time.')
  assert.equal(rows[0].source, 'reviewer')
  const id = rows[0].id
  await assert.rejects(lessonsCommand({ _: ['lessons'], delete: other.id }, { store, print: () => {} }), /not a lesson memory/)
  await lessonsCommand({ _: ['lessons'], delete: id }, { store, print: (s) => out.push(s) })
  assert.ok(!store.records.has(id) && store.records.has(other.id))
})
