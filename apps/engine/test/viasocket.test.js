import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createViaSocketClient, classifyHttpError, AiError, TruncatedError } from '../src/viasocket.js'
import { fakeConfig, fakeFetch } from './helpers.js'

const decode = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString())
const noSleep = async () => {}

test('embed token: HS256 with exactly org_id, project_id, unique_identifier; valid signature', async () => {
  const config = fakeConfig()
  const token = await createViaSocketClient({ config, fetch: fakeFetch(() => ({})) }).token()
  const [h, p, s] = token.split('.')
  assert.deepEqual(decode(h), { alg: 'HS256', typ: 'JWT' })
  assert.deepEqual(decode(p), { org_id: 'org-test', project_id: 'proj-test', unique_identifier: 'm91-blog-engine' })
  const expected = createHmac('sha256', 'fake-embed-secret-for-tests').update(`${h}.${p}`).digest('base64url')
  assert.equal(s, expected)
})

test('authorization header is the bare token (no Bearer)', async () => {
  const fetch = fakeFetch(() => ({ body: { success: true, data: [] } }))
  const client = createViaSocketClient({ config: fakeConfig(), fetch })
  const res = await client.checkAuth()
  assert.equal(res.status, 200)
  const auth = fetch.calls[0].init.headers.authorization
  assert.ok(!auth.startsWith('Bearer'))
  assert.equal(auth.split('.').length, 3)
  assert.equal(fetch.calls[0].url, 'https://flow-api.viasocket.com/embed/authentications')
})

test('sync json_schema: sends service+model+prompt+fresh thread, returns object content', async () => {
  const fetch = fakeFetch(() => ({ body: { success: true, data: { thread_id: 't', message_id: 'm1', content: { ok: true }, finish_reason: 'completed' } } }))
  const client = createViaSocketClient({ config: fakeConfig(), fetch, sleepFn: noSleep })
  const out = await client.aiSend({ agent: 'scout', prompt: 'P', message: 'M', jsonSchema: { type: 'object' }, briefId: '261017-1405-ABCD', version: 2 })
  const body = fetch.calls[0].body
  assert.equal(body.service, 'openai')
  assert.equal(body.model, 'gpt-5-mini')
  assert.equal(body.prompt, 'P')
  assert.equal(body.delivery, 'sync')
  assert.equal(body.response_type, 'json_schema')
  assert.deepEqual(body.json_schema, { name: 'scout', strict: true, schema: { type: 'object' } })
  assert.match(body.thread_id, /^scout-261017-1405-ABCD-v2-[a-z0-9]{6}$/)
  assert.deepEqual(out.content, { ok: true })
  assert.equal(out.messageId, 'm1')
  assert.equal(out.finishReason, 'completed')
  assert.equal(typeof out.ms, 'number')
})

test('rtlayer: 202 then polls history until the assistant message with the same message_id', async () => {
  let polls = 0
  const fetch = fakeFetch((url) => {
    if (url.endsWith('/embed/ai/message')) return { status: 202, body: { success: true, data: { thread_id: 'th', message_id: 'mid-1', channel: 'c' } } }
    polls++
    const messages = [{ role: 'user', content: 'M', message_id: 'mid-1' }]
    if (polls >= 3) messages.push({ role: 'assistant', content: '{"title":"x"}', message_id: 'mid-1', model: 'gemini-2.5-flash' })
    return { body: { success: true, data: { messages } } }
  })
  const client = createViaSocketClient({ config: fakeConfig(), fetch, sleepFn: noSleep })
  const out = await client.aiSend({ agent: 'writer', message: 'M', jsonSchema: { type: 'object' }, threadId: 'th' })
  assert.equal(fetch.calls[0].body.delivery, 'rtlayer')
  assert.equal(fetch.calls[0].body.service, 'gemini')
  assert.match(fetch.calls[1].url, /\/embed\/ai\/threads\/th\/history\?page=1$/)
  assert.equal(polls, 3)
  assert.deepEqual(out.content, { title: 'x' })
  assert.equal(out.model, 'gemini-2.5-flash')
})

test('rtlayer: times out with a typed error', async () => {
  let clock = 0
  const fetch = fakeFetch((url) => url.endsWith('/message')
    ? { status: 202, body: { success: true, data: { thread_id: 'th', message_id: 'm' } } }
    : { body: { success: true, data: { messages: [] } } })
  const client = createViaSocketClient({ config: fakeConfig(), fetch, now: () => clock, sleepFn: async (ms) => { clock += ms } })
  await assert.rejects(client.aiSend({ agent: 'reviewer', message: 'M', timeoutMs: 9000, pollMs: 3000 }), (e) => e instanceof AiError && e.kind === 'timeout')
})

test('error classification', () => {
  assert.equal(classifyHttpError(400, { message: 'model or service does not exist!' }).kind, 'config')
  assert.equal(classifyHttpError(422, { message: 'Validation error' }).kind, 'config')
  assert.equal(classifyHttpError(401, { message: 'unauthorized user' }).kind, 'token')
  assert.equal(classifyHttpError(498, { message: 'invalid token' }).kind, 'token')
  const billing = classifyHttpError(402, { message: 'Plan credits are exhausted. Upgrade the plan to continue.' })
  assert.equal(billing.kind, 'billing')
  assert.equal(billing.retryable, false)
  for (const s of [429, 500, 502]) assert.equal(classifyHttpError(s, {}).retryable, true)
  assert.equal(classifyHttpError(400, { message: 'thread_id bad' }).retryable, false)
})

test('400 model error and 401 are not retried', async () => {
  for (const [status, message] of [[400, 'model or service does not exist!'], [401, 'unauthorized user']]) {
    const fetch = fakeFetch(() => ({ status, body: { success: false, message } }))
    const client = createViaSocketClient({ config: fakeConfig(), fetch, sleepFn: noSleep })
    await assert.rejects(client.aiSend({ agent: 'scout', message: 'M' }), AiError)
    assert.equal(fetch.calls.length, 1)
  }
})

test('sync 502 (gateway timeout): no re-send; the answer is read from the thread history', async () => {
  let sends = 0
  const fetch = fakeFetch((url) => {
    if (url.endsWith('/embed/ai/message')) { sends++; return { status: 502, body: {} } }
    return { body: { success: true, data: { messages: [{ role: 'user', content: 'M', message_id: 'x' }, { role: 'assistant', content: '{"ok":true}', message_id: 'x' }] } } }
  })
  const out = await createViaSocketClient({ config: fakeConfig(), fetch, sleepFn: noSleep }).aiSend({ agent: 'scout', message: 'M', jsonSchema: { type: 'object' }, threadId: 'th-1' })
  assert.equal(sends, 1)
  assert.deepEqual(out.content, { ok: true })
  assert.match(fetch.calls[1].url, /\/embed\/ai\/threads\/th-1\/history\?page=1$/)
})

test('rtlayer 502 on send is still retried (nothing was accepted yet)', async () => {
  const fetch = fakeFetch((url, init, n) => {
    if (url.endsWith('/message')) return n === 1 ? { status: 502, body: {} } : { status: 202, body: { success: true, data: { thread_id: 'th', message_id: 'm' } } }
    return { body: { success: true, data: { messages: [{ role: 'assistant', content: 'done', message_id: 'm' }] } } }
  })
  const out = await createViaSocketClient({ config: fakeConfig(), fetch, sleepFn: noSleep }).aiSend({ agent: 'writer', message: 'M', threadId: 'th' })
  assert.equal(out.content, 'done')
  assert.equal(fetch.calls.filter((c) => c.url.endsWith('/message')).length, 2)
})

test('429/500 are retried up to 3 times, then succeed or give up', async () => {
  const flaky = fakeFetch((url, init, n) => (n < 3 ? { status: 500, body: {} } : { body: { success: true, data: { content: 'hi', finish_reason: 'completed' } } }))
  const out = await createViaSocketClient({ config: fakeConfig(), fetch: flaky, sleepFn: noSleep }).aiSend({ agent: 'scout', message: 'M' })
  assert.equal(out.content, 'hi')
  assert.equal(flaky.calls.length, 3)

  const down = fakeFetch(() => ({ status: 429, body: {} }))
  await assert.rejects(createViaSocketClient({ config: fakeConfig(), fetch: down, sleepFn: noSleep }).aiSend({ agent: 'scout', message: 'M' }), (e) => e.kind === 'rate_limit')
  assert.equal(down.calls.length, 4)
})

test('finish_reason "truncated" throws TruncatedError carrying the result', async () => {
  const fetch = fakeFetch(() => ({ body: { success: true, data: { content: 'partial', finish_reason: 'truncated' } } }))
  await assert.rejects(
    createViaSocketClient({ config: fakeConfig(), fetch, sleepFn: noSleep }).aiSend({ agent: 'scout', message: 'M' }),
    (e) => e instanceof TruncatedError && e.kind === 'truncated' && e.result.content === 'partial'
  )
})
