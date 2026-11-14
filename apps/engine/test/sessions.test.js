// Signed sessions: a login survives a restart or a deploy (a new server with the same settings accepts the cookie),
// a changed password or a tampered or expired token does not, and logout revokes the token.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../src/server.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig } from './helpers.js'

const KEY = 'fake-trigger-key-0123456789'
async function serve(env, opts = {}) {
  const server = createServer({ triggerKey: KEY, config: fakeConfig({ DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'right-password-123', ...env }), ...opts })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, close: () => new Promise((ok) => server.close(ok)) }
}
const login = async (base) => {
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'right-password-123' }) })
  assert.equal(res.status, 200)
  return res.headers.get('set-cookie').split(';')[0]
}
// The health check gives the version only to a logged-in session: 200 when logged in, 401 when not.
const runs = (base, cookie) => fetch(`${base}/api/health`, { headers: { cookie } }).then((r) => r.json()).then((h) => (h.version ? 200 : 401))

test('a login survives a restart; a changed password, a tampered token, an expired token or a logout do not', async () => {
  const restore = setSink(() => {})
  const a = await serve({})
  const cookie = await login(a.base)
  assert.equal(await runs(a.base, cookie), 200)
  await a.close()
  // The deploy: a new server, the same settings.
  const b = await serve({})
  try {
    assert.equal(await runs(b.base, cookie), 200, 'still logged in after the restart')
    const [name, value] = cookie.split('=')
    const parts = value.split('.')
    assert.equal(await runs(b.base, `${name}=${Number(parts[0]) + 1000}.${parts[1]}.${parts[2]}`), 401, 'a longer expiry is not accepted')
    assert.equal(await runs(b.base, `${name}=${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`), 401, 'a tampered signature')
    await fetch(`${b.base}/api/logout`, { method: 'POST', headers: { cookie } })
    assert.equal(await runs(b.base, cookie), 401, 'logged out')
  } finally {
    await b.close()
  }
  const c = await serve({ DASHBOARD_PASSWORD: 'a-new-password-456' })
  try {
    assert.equal(await runs(c.base, cookie), 401, 'a changed password ends every session')
  } finally {
    await c.close()
  }
  let t = Date.now()
  const d = await serve({}, { now: () => t, sessionMs: 1000 })
  try {
    const short = await login(d.base)
    t += 5000
    assert.equal(await runs(d.base, short), 401, 'expired')
  } finally {
    await d.close()
    restore()
  }
})
