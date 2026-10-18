import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, keysMatch } from '../src/server.js'

const KEY = 'fake-trigger-key-0123456789'

async function withServer(run, fn) {
  const server = createServer({ triggerKey: KEY, run })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base, server)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('keysMatch: constant-time compare, rejects wrong/missing/empty', () => {
  assert.equal(keysMatch(KEY, KEY), true)
  assert.equal(keysMatch('wrong', KEY), false)
  assert.equal(keysMatch(KEY + 'x', KEY), false)
  assert.equal(keysMatch(undefined, KEY), false)
  assert.equal(keysMatch('', ''), false)
})

test('GET /health needs no auth', async () => {
  await withServer(async () => {}, async (base) => {
    const res = await fetch(`${base}/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true, running: false })
  })
})

test('POST /run: wrong key 401, right key 202 and runs in background, busy 409', async () => {
  let release
  let runs = 0
  const run = () => { runs++; return new Promise((resolve) => { release = resolve }) }
  await withServer(run, async (base, server) => {
    assert.equal((await fetch(`${base}/run`, { method: 'POST', headers: { 'x-trigger-key': 'nope' } })).status, 401)
    assert.equal((await fetch(`${base}/run`, { method: 'POST' })).status, 401)
    assert.equal(runs, 0)

    const ok = await fetch(`${base}/run`, { method: 'POST', headers: { 'x-trigger-key': KEY } })
    assert.equal(ok.status, 202)
    await new Promise((r) => setImmediate(r))
    assert.equal(runs, 1)
    assert.equal(server.isRunning(), true)

    assert.equal((await fetch(`${base}/run`, { method: 'POST', headers: { 'x-trigger-key': KEY } })).status, 409)
    release({ briefId: 'b', state: 'approved' })
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(server.isRunning(), false)
  })
})

test('unknown routes 404, GET /run 405', async () => {
  await withServer(async () => {}, async (base) => {
    assert.equal((await fetch(`${base}/nope`)).status, 404)
    assert.equal((await fetch(`${base}/run`)).status, 405)
  })
})
