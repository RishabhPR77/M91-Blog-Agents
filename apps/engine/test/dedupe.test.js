// Phase 9 A3: local duplicate checks (trigram similarity) on real-looking titles; no Mem0 search.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { similarity, findSimilar, dedupeSettings, titleOf } from '../src/dedupe.js'
import { classifyCluster, isDuplicateTutorial } from '../src/scout/dedupe.js'
import { fakeConfig, memoryStore } from './helpers.js'

const THRESHOLD = dedupeSettings(fakeConfig()).threshold

// Scores seen while tuning (2026-10-20): duplicates 0.70–1.00, different topics 0.03–0.62.
const DUPLICATES = [
  ['How do I make my agent ask before deleting data?', 'How can I make my AI agent ask before it deletes data?'],
  ['How to Gate Destructive AI Agent Actions — agent approval', 'Gating destructive actions of AI agents — agent approval'],
  ['Bind Every AI Agent Human Approval to One Tool Call', 'Bind each human approval to a single tool call'],
  ['How can HumanInTheLoop middleware reliably require human approval?', 'How do I make human-in-the-loop middleware reliably require approval?'],
  ['Send a One-Person Approval Alert', 'Send an approval alert to one person']
]
const DIFFERENT = [
  ['How do I make my agent ask before deleting data?', 'How M91 Rings Through Silent Mode'],
  ['Bind Every AI Agent Human Approval to One Tool Call', 'Moving off Opsgenie: on-call alerts after the shutdown'],
  ['What is worth waking someone up for at night?', 'How to Gate Destructive AI Agent Actions'],
  ['Send a One-Person Approval Alert', 'Escalate to the next person when nobody answers'],
  ['Approve a risky agent step from your phone', 'Approve a refund over $500 from Slack'],
  ['How to set up M91 with Claude Code', 'How to set up M91 with Cursor']
]

test('defaults: DEDUPE_MODE=local, DEDUPE_SIMILARITY_LOCAL=0.65; mem0 mode keeps DEDUPE_SIMILARITY', () => {
  assert.deepEqual(dedupeSettings(fakeConfig()), { mode: 'local', threshold: 0.65 })
  assert.deepEqual(dedupeSettings(fakeConfig({ DEDUPE_MODE: 'mem0' })), { mode: 'mem0', threshold: 0.85 })
})

test('real-looking titles: every duplicate scores at or above the threshold, every different topic below it', () => {
  for (const [a, b] of DUPLICATES) assert.ok(similarity(a, b) >= THRESHOLD, `${similarity(a, b).toFixed(3)} ${a} | ${b}`)
  for (const [a, b] of DIFFERENT) assert.ok(similarity(a, b) < THRESHOLD, `${similarity(a, b).toFixed(3)} ${a} | ${b}`)
  assert.equal(similarity('', 'anything'), 0)
  assert.equal(similarity('Same Title!', 'same title'), 1)
})

/** memoryStore whose searchSimilar must never be called in local mode. */
function noSearchStore() {
  const store = memoryStore()
  store.searchSimilar = async () => { throw new Error('Mem0 search called in local mode') }
  return store
}

test('Scout clusters (local): an open cluster with a similar question → merge; an approved brief → covered; else new', async () => {
  const store = noSearchStore()
  await store.createRecord({ type: 'question_cluster', payload: { main_question: 'How do I make my agent ask before deleting data?' }, status: 'open' })
  await store.createRecord({ type: 'brief', briefId: 'B-OLD', payload: { titles: ['Send a One-Person Approval Alert'], keyword: 'approval alert' }, status: 'approved' })
  const merge = await classifyCluster(store, { main_question: 'How can I make my AI agent ask before it deletes data?' }, THRESHOLD)
  assert.equal(merge.action, 'merge')
  assert.ok(merge.match.score >= THRESHOLD)
  const covered = await classifyCluster(store, { main_question: 'Send an approval alert to one person' }, THRESHOLD)
  assert.deepEqual([covered.action, covered.coveredBy], ['covered', 'B-OLD'])
  assert.equal((await classifyCluster(store, { main_question: 'Moving off Opsgenie: on-call alerts after the shutdown' }, THRESHOLD)).action, 'new')
})

test('Scout tutorials (local): a similar title for the same target is a duplicate; another target is not', async () => {
  const store = noSearchStore()
  await store.createRecord({ type: 'tutorial_lead', payload: { title: 'Ring a phone from Claude Code before a risky command', target: 'Claude Code' }, status: 'open' })
  assert.equal(await isDuplicateTutorial(store, { title: 'Ring a phone from Claude Code before risky commands', target: 'claude code' }, THRESHOLD), true)
  assert.equal(await isDuplicateTutorial(store, { title: 'Ring a phone from Claude Code before risky commands', target: 'Cursor' }, THRESHOLD), false)
})

test('findSimilar (local) compares by each type\'s title text and reads each list through the store', async () => {
  const store = noSearchStore()
  const calls = []
  const get = store.getRecords.bind(store)
  store.getRecords = async (f) => { calls.push(f.type); return get(f) }
  await store.createRecord({ type: 'draft', briefId: 'B', payload: { title: 'Bind Every AI Agent Human Approval to One Tool Call' }, status: 'approved' })
  const [top] = await findSimilar(store, 'Bind each human approval to a single tool call', { types: ['brief', 'draft'] })
  assert.equal(top.type, 'draft')
  assert.ok(top.score > 0.6)
  assert.deepEqual(calls, ['brief', 'draft'])
  assert.equal(titleOf({ type: 'brief', payload: { titles: ['T'], keyword: 'k' } }), 'T — k')
})
