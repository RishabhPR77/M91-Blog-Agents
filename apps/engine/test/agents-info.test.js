// The Agents page's data: every agent in pipeline order, its model and settings from the config, and its instructions
// built by the engine's own prompt builders (the same text the agents get), with run-time values shown as ‹…›.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentsInfo, pipelineInfo, fillForDisplay } from '../src/agentsinfo.js'
import { buildReviewerPrompt } from '../src/reviewer/prompts.js'
import { createServer } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, memoryStore, fakeNotifier } from './helpers.js'

test('every agent in pipeline order, with model, settings and its instructions word for word', () => {
  const config = fakeConfig({ WRITER_POLISH: 'true', WRITER_FACT_CHECK: 'true', TARGET_WORDS_MIN: '1800', TARGET_WORDS_MAX: '2500' })
  const agents = agentsInfo(config)
  assert.deepEqual(agents.map((a) => a.id), ['editor', 'scout', 'strategist', 'writer', 'factcheck', 'reviewer', 'designer', 'promo'])
  for (const a of agents) {
    assert.ok(a.role && a.gets && a.gives, a.id)
    assert.ok(a.settings.length > 0, a.id)
    assert.ok(a.prompts.length > 0 && a.prompts.every((p) => p.text.length > 200), a.id)
    // Every placeholder is filled from the config or marked ‹…› (Promo's {{POST_URL}} is a token its model writes out).
    if (a.id !== 'promo') assert.ok(!a.prompts.some((p) => /\{\{\w+\}\}/.test(p.text)), `${a.id} has an unfilled placeholder`)
  }
  const by = Object.fromEntries(agents.map((a) => [a.id, a]))
  assert.equal(by.reviewer.prompts[0].text, buildReviewerPrompt(config), 'the exact text the Reviewer gets')
  assert.equal(by.factcheck.model.model, config.reviewer.model, "the fact check runs on the Reviewer's model")
  assert.match(by.writer.prompts[0].text, /=== WHAT THE REVIEWER CHECKS ===/)
  assert.match(by.writer.prompts[0].text, /Length: aim for about 1800–2150 words of prose/)
  assert.deepEqual(by.writer.settings.find((s) => s.label === 'Fact check before the review'), { label: 'Fact check before the review', value: 'on' })
  assert.equal(by.scout.prompts.length, 12)
  assert.match(by.scout.prompts[1].text, /today is ‹today›/)
  assert.equal(fillForDisplay('{{a}} and {{run_value}}', { a: 1 }), '1 and ‹run value›')
  assert.equal(agentsInfo(fakeConfig({ WRITER_FACT_CHECK: 'false' })).find((a) => a.id === 'factcheck').enabled, false)
  const p = pipelineInfo(config)
  assert.ok(p.order.includes('Fact check') && p.order.indexOf('Fact check') < p.order.indexOf('Reviewer'))
})

test('GET /api/agents serves them; no secret appears', async () => {
  const restore = setSink(() => {})
  const store = memoryStore()
  const config = fakeConfig()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => stubAgents })
  const server = createServer({ triggerKey: 'fake-trigger-key-0123456789', manager, store, config })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/agents`)
    assert.equal(res.status, 200)
    const text = await res.text()
    const body = JSON.parse(text)
    assert.equal(body.agents.length, 8)
    assert.ok(body.pipeline.settings.length > 0)
    for (const secret of ['fake-embed-secret-for-tests', 'm0-fakekeyfortests123', 'scriFAKESLACK', 'fake-shared-key-123', 'fake-trigger-key-0123456789']) assert.ok(!text.includes(secret), `no ${secret.slice(0, 4)}…`)
  } finally {
    await new Promise((ok) => server.close(ok))
    restore()
  }
})
