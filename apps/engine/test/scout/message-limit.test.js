import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitMessage, buildMessage, MESSAGE_MAX } from '../../src/scout/prompts.js'
import { runScout } from '../../src/scout/index.js'
import { fakeConfig, memoryStore, fakeNotifier } from '../helpers.js'
import { fakeAi, fakeChecker, LLMS, DOC_INTRO } from './fixtures.js'

test('fitMessage: a message that fits is unchanged', () => {
  const sections = { today: '2026-10-17', facts: 'can: x' }
  assert.deepEqual(fitMessage(sections), { message: buildMessage(sections), trimmed: [] })
})

test('fitMessage: oversize docs are cut to the limit, other sections kept whole', () => {
  const sections = { today: '2026-10-17', docs: 'd'.repeat(80000), alreadyCovered: '- covered' }
  const { message, trimmed } = fitMessage(sections)
  assert.ok(message.length <= MESSAGE_MAX)
  assert.equal(message.length, MESSAGE_MAX)
  assert.deepEqual(trimmed, ['docs'])
  assert.match(message, /--- ALREADY COVERED ---\n- covered/)
  assert.match(message, /\[… cut to fit the message size limit\]$/)
})

test('fitMessage: cuts several sections in order when one is not enough; throws if nothing cuttable remains', () => {
  const { message, trimmed } = fitMessage({ today: 't', docs: 'd'.repeat(30), skillRepo: 's'.repeat(60000) }, 1000)
  assert.ok(message.length <= 1000)
  assert.deepEqual(trimmed, ['docs', 'skillRepo'])
  assert.throws(() => fitMessage({ today: 't', questions: 'q'.repeat(2000) }, 1000), /nothing more can be cut/)
})

test('Scout: every message sent stays within 50,000 characters, even with DOCS_MAX_CHARS at its 48,000 maximum', async () => {
  const big = 'M91 docs text. '.repeat(10000)
  const web = async (url) => {
    const res = (text) => ({ ok: true, status: 200, headers: { get: () => 'text/markdown' }, text: async () => text })
    if (url === LLMS) return res(`- [Intro](${DOC_INTRO})\n${big}`)
    if (url === DOC_INTRO) return res(big)
    return { ok: false, status: 404, headers: { get: () => '' }, text: async () => '' }
  }
  const config = fakeConfig({ DOCS_MAX_CHARS: '48000', M91_DOCS_URL: LLMS })
  const ai = fakeAi()
  await runScout({ mode: 'research', runId: 'R' }, { config, store: memoryStore(), notifier: fakeNotifier(), aiSend: ai, fetch: web, urlChecker: fakeChecker() })
  const facts = ai.requests.find((q) => q.call === 'facts')
  assert.ok(facts.message.length > 48000)
  for (const q of ai.requests) assert.ok(q.message.length <= MESSAGE_MAX, `${q.call}: ${q.message.length}`)
})
