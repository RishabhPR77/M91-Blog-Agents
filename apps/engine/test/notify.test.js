import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkText, createNotifier, SLACK_PART_MAX } from '../src/notify.js'
import { fakeConfig, fakeFetch } from './helpers.js'

test('short text is one unnumbered part', () => {
  assert.deepEqual(chunkText('hello'), ['hello'])
})

test('long text splits by paragraph into numbered parts ≤ 2,800 chars, in order', () => {
  const paras = Array.from({ length: 12 }, (_, i) => `P${i} ` + 'x'.repeat(600))
  const parts = chunkText(paras.join('\n\n'))
  assert.ok(parts.length > 1)
  parts.forEach((p, i) => {
    assert.ok(p.length <= SLACK_PART_MAX, `part ${i} is ${p.length}`)
    assert.ok(p.startsWith(`(${i + 1}/${parts.length}) `))
  })
  // Paragraphs are never cut and order is kept.
  const joined = parts.map((p) => p.replace(/^\(\d+\/\d+\) /, '')).join('\n\n')
  assert.equal(joined, paras.join('\n\n'))
})

test('one huge paragraph is still split under the limit', () => {
  const parts = chunkText('y'.repeat(9000))
  assert.ok(parts.length >= 4)
  for (const p of parts) assert.ok(p.length <= SLACK_PART_MAX)
  assert.equal(parts.map((p) => p.replace(/^\(\d+\/\d+\) /, '')).join(''), 'y'.repeat(9000))
})

test('slack posts { key, text } per part to the Slack webhook', async () => {
  const fetch = fakeFetch(() => ({ body: { ok: true } }))
  const n = createNotifier({ config: fakeConfig(), fetch })
  const res = await n.slack(['a'.repeat(2000), 'b'.repeat(2000)].join('\n\n'))
  assert.equal(res.parts, 2)
  assert.equal(fetch.calls.length, 2)
  assert.equal(fetch.calls[0].url, 'https://flow.sokt.io/func/scriFAKESLACK')
  assert.deepEqual(Object.keys(fetch.calls[0].body).sort(), ['key', 'text'])
  assert.equal(fetch.calls[0].body.key, 'fake-shared-key-123')
  assert.match(fetch.calls[0].body.text, /^\(1\/2\) a/)
  assert.match(fetch.calls[1].body.text, /^\(2\/2\) b/)
})

test('m91Alert posts title/description/severity, default LOW', async () => {
  const fetch = fakeFetch(() => ({ body: { ok: true } }))
  await createNotifier({ config: fakeConfig(), fetch }).m91Alert({ title: 'T', description: 'D' })
  assert.equal(fetch.calls[0].url, 'https://flow.sokt.io/func/scriFAKEM91')
  assert.deepEqual(fetch.calls[0].body, { key: 'fake-shared-key-123', title: 'T', description: 'D', severity: 'LOW' })
})

test('a flow body reporting a failed step is an error', async () => {
  const fetch = fakeFetch(() => ({ body: { ok: false, reason: 'bad key' } }))
  await assert.rejects(createNotifier({ config: fakeConfig(), fetch }).slack('x'), /failed step/)
})

test('a real send with no webhook URL fails clearly, naming the key', async () => {
  const fetch = fakeFetch(() => ({ body: {} }))
  const n = createNotifier({ config: fakeConfig({ SLACK_POST_WEBHOOK_URL: '', M91_ALERT_WEBHOOK_URL: '' }), fetch })
  await assert.rejects(n.slack('x'), /SLACK_POST_WEBHOOK_URL/)
  await assert.rejects(n.m91Alert({ title: 'T' }), /M91_ALERT_WEBHOOK_URL/)
  assert.equal(fetch.calls.length, 0)
})

test('DRY_RUN sends nothing', async () => {
  const fetch = fakeFetch(() => ({ body: {} }))
  const n = createNotifier({ config: fakeConfig({ DRY_RUN: 'true' }), fetch })
  assert.deepEqual(await n.slack('hello'), { dryRun: true, parts: 1 })
  assert.deepEqual(await n.m91Alert({ title: 'T' }), { dryRun: true })
  assert.equal(fetch.calls.length, 0)
})
