import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retry, backoffDelay } from '../src/util/retry.js'
import { log, mask, maskString, registerSecrets, setSink, setLevel } from '../src/util/log.js'
import { newBriefId, newThreadId, BRIEF_ID_RE, THREAD_ID_RE } from '../src/util/ids.js'
import { istDate, istIso, istParts } from '../src/util/time.js'

// --- retry ---
test('retry: retries retryable errors, then returns', async () => {
  let n = 0
  const delays = []
  const out = await retry(async () => {
    if (++n < 3) throw Object.assign(new Error('x'), { retryable: true })
    return 'ok'
  }, { sleepFn: async (d) => delays.push(d), random: () => 1 })
  assert.equal(out, 'ok')
  assert.equal(n, 3)
  assert.deepEqual(delays, [500, 1000])
})

test('retry: non-retryable errors are thrown at once', async () => {
  let n = 0
  await assert.rejects(retry(async () => { n++; throw new Error('fatal') }, { sleepFn: async () => {} }), /fatal/)
  assert.equal(n, 1)
})

test('retry: gives up after `retries` retries', async () => {
  let n = 0
  await assert.rejects(retry(async () => { n++; throw Object.assign(new Error('x'), { retryable: true }) }, { retries: 3, sleepFn: async () => {} }))
  assert.equal(n, 4)
})

test('backoff: exponential, capped, jittered', () => {
  assert.equal(backoffDelay(1, { random: () => 1 }), 500)
  assert.equal(backoffDelay(4, { random: () => 1 }), 4000)
  assert.equal(backoffDelay(10, { random: () => 1 }), 8000)
  assert.equal(backoffDelay(3, { random: () => 0 }), 0)
})

// --- masking ---
test('mask: registered secret values are masked to first 4 chars + …', () => {
  registerSecrets(['abcd1234secretvalue'])
  assert.equal(maskString('key=abcd1234secretvalue!'), 'key=abcd…!')
})

test('mask: JWTs, Bearer/Token values, m0- keys and webhook script ids', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJvcmdfaWQiOiJ4In0.c2lnbmF0dXJlc2lnbmF0dXJl'
  assert.ok(!maskString(`auth ${jwt}`).includes('eyJvcmdf'))
  assert.ok(!maskString('Authorization: Token m0-abcdefghijklmnop').includes('ijklmnop'))
  assert.ok(!maskString('https://flow.sokt.io/func/scriABCDEF123').includes('ABCDEF123'))
})

test('mask: fields named like secrets are masked, others kept', () => {
  const out = mask({ apiKey: 'zzzz-very-secret', token: 'tttt-value', trigger_key: 'kkkk-value', model: 'gpt-5-mini', nested: { secret: 'ssss-value' }, ok: true })
  assert.equal(out.apiKey, 'zzzz…')
  assert.equal(out.token, 'tttt…')
  assert.equal(out.trigger_key, 'kkkk…')
  assert.equal(out.nested.secret, 'ssss…')
  assert.equal(out.model, 'gpt-5-mini')
})

test('log: writes JSON lines with masking and respects level', () => {
  const lines = []
  const restore = setSink((level, line) => lines.push(line))
  registerSecrets(['qwerty-secret-999'])
  setLevel('info')
  log.debug('hidden')
  log.info('sent with qwerty-secret-999', { error: new Error('failed for qwerty-secret-999') })
  restore()
  assert.equal(lines.length, 1)
  const entry = JSON.parse(lines[0])
  assert.equal(entry.level, 'info')
  assert.ok(!lines[0].includes('qwerty-secret-999'))
  assert.match(entry.msg, /qwer…/)
})

// --- ids / time ---
test('brief_id: YYMMDD-HHMM-XXXX in IST from the allowed alphabet', () => {
  // 2026-10-17 08:35 UTC = 14:05 IST
  const id = newBriefId(new Date('2026-10-17T08:35:00Z'), () => 0)
  assert.equal(id, '261017-1405-AAAA')
  for (let i = 0; i < 200; i++) assert.match(newBriefId(), BRIEF_ID_RE)
  // 20:00 UTC is already the next day in IST
  assert.match(newBriefId(new Date('2026-10-17T20:00:00Z')), /^261018-0130-/)
})

test('thread id: <agent>-<brief_id>-v<version>-<short random>, valid for viaSocket', () => {
  const id = newThreadId('writer', '261017-1405-ABCD', 3)
  assert.match(id, /^writer-261017-1405-ABCD-v3-[a-z0-9]{6}$/)
  assert.match(id, THREAD_ID_RE)
  assert.notEqual(newThreadId('writer', 'b', 1), newThreadId('writer', 'b', 1))
})

test('IST helpers', () => {
  const d = new Date('2026-12-31T19:00:00Z')
  assert.equal(istDate(d), '2027-01-01')
  assert.equal(istIso(d), '2027-01-01T00:30:00+05:30')
  assert.equal(istParts(d).hour, 0)
})
