import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankScore, rankClusters } from '../../src/scout/rank.js'
import { classifyCluster, mergeClusterPayload, isDuplicateTutorial } from '../../src/scout/dedupe.js'
import { memoryStore } from '../helpers.js'

const c = (o) => ({ m91_fit: { score: 3 }, demand: { level: 'medium' }, freshness: 'ongoing', update_candidate: false, topic_group: 1, ...o })

test('rank formula: 2×fit + demand + freshness − update_candidate', () => {
  assert.equal(rankScore(c({ m91_fit: { score: 5 }, demand: { level: 'high' }, freshness: 'this_week' })), 15)
  assert.equal(rankScore(c({ m91_fit: { score: 1 }, demand: { level: 'low' }, freshness: 'ongoing' })), 4)
  assert.equal(rankScore(c({ update_candidate: true })), 2 * 3 + 2 + 1 - 1)
})

test('rank: sorted high first; ties go to the least-used topic group in the last 10 briefs', () => {
  const ranked = rankClusters([c({ main_question: 'a', topic_group: 1 }), c({ main_question: 'b', topic_group: 2 }), c({ main_question: 'top', m91_fit: { score: 5 } })], [1, 1, 3])
  assert.deepEqual(ranked.map((x) => x.main_question), ['top', 'b', 'a'])
  assert.equal(ranked[0].rank_score, 13)
})

test('dedupe: match to an approved brief → covered (update candidate)', async () => {
  const store = memoryStore({ similarity: () => 0.9 })
  await store.createRecord({ type: 'brief', briefId: '261001-0900-ABCD', payload: { topic: 'x' }, status: 'approved' })
  const d = await classifyCluster(store, { main_question: 'x?' }, 0.85)
  assert.equal(d.action, 'covered')
  assert.equal(d.coveredBy, '261001-0900-ABCD')
})

test('dedupe: match to an open cluster → merge; below threshold → new; active brief → new', async () => {
  const store = memoryStore({ similarity: () => 0.9 })
  await store.createRecord({ type: 'question_cluster', payload: { main_question: 'x' }, status: 'open' })
  assert.equal((await classifyCluster(store, { main_question: 'x?' }, 0.85)).action, 'merge')
  assert.equal((await classifyCluster(store, { main_question: 'x?' }, 0.95)).action, 'new')

  const s2 = memoryStore({ similarity: () => 0.99 })
  await s2.createRecord({ type: 'brief', briefId: 'b', payload: { topic: 'x' }, status: 'active' })
  assert.equal((await classifyCluster(s2, { main_question: 'x' }, 0.85)).action, 'new')
})

test('merge payload appends questions and URLs without duplicates', () => {
  const merged = mergeClusterPayload(
    { main_question: 'A', related_questions: ['B'], source_urls: [{ url: 'u1' }], freshness: 'ongoing' },
    { main_question: 'C', related_questions: ['B', 'A'], source_urls: [{ url: 'u1' }, { url: 'u2' }], freshness: 'this_week' },
    '2026-10-17'
  )
  assert.deepEqual(merged.related_questions, ['B', 'C'])
  assert.deepEqual(merged.source_urls.map((u) => u.url), ['u1', 'u2'])
  assert.equal(merged.freshness, 'this_week')
  assert.equal(merged.last_seen, '2026-10-17')
})

test('tutorial duplicate: same target and similar title', async () => {
  const store = memoryStore({ similarity: () => 0.9 })
  await store.createRecord({ type: 'tutorial_lead', payload: { title: 't', target: 'Claude Code' }, status: 'open' })
  assert.equal(await isDuplicateTutorial(store, { title: 't2', target: 'claude code' }, 0.85), true)
  assert.equal(await isDuplicateTutorial(store, { title: 't2', target: 'Cursor' }, 0.85), false)
})
