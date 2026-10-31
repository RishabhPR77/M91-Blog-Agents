// Hosted on Embarko: the admin ID + password login, every page and /api route behind it, the config rules for hosted mode
// (login forced, data under DATA_DIR), and the password hash. Fakes only: no network, no Mem0, no real password.
import { test, beforeEach, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, PUBLIC_PAGE_RE } from '../src/server.js'
import { createRunManager } from '../src/runs.js'
import { ConfigError, loadConfig } from '../src/config.js'
import { hashPassword, verifyPassword, parseHash, isValidHash, sameText, MIN_PASSWORD_LENGTH, SCRYPT } from '../src/util/adminhash.js'
import { resetEvents } from '../src/events.js'
import { stubAgents } from '../src/agents/stubs.js'
import { setSink } from '../src/util/log.js'
import { fakeConfig, fakeEnv, memoryStore, fakeNotifier, mockReviewer } from './helpers.js'

beforeEach(() => resetEvents())
const TRIGGER = 'fake-trigger-key-0123456789'
const PASSWORD = 'correct horse battery staple'
// A cheaper cost than production (N=32768, r=8, p=3) keeps the tests quick; the format and checks are the same.
const FAST = { N: 16384, r: 8, p: 1, keylen: 32 }
let HASH
before(async () => { HASH = await hashPassword(PASSWORD, { params: FAST }) })

const hostedEnv = (over = {}) => ({ APP_NAME: 'm91-engine', DATA_DIR: '/data-fake', ENGINE_DATA_DIR: '', EXPORT_DIR: '', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: HASH, ...over })

// ---------- the password hash ----------

test('hash: round trip, wrong password, salted, format, cost limits, a short password is refused', async () => {
  const h1 = await hashPassword(PASSWORD, { params: FAST })
  const h2 = await hashPassword(PASSWORD, { params: FAST })
  assert.match(h1, /^scrypt:16384:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/)
  assert.ok(!/[$=]/.test(h1), 'safe in any environment-variable form')
  assert.notEqual(h1, h2, 'a new salt every time')
  assert.equal(await verifyPassword(PASSWORD, h1), true)
  assert.equal(await verifyPassword(PASSWORD, h2), true)
  assert.equal(await verifyPassword('correct horse battery stapl', h1), false)
  assert.equal(await verifyPassword('', h1), false)
  assert.equal(await verifyPassword(PASSWORD, 'not a hash'), false)
  assert.equal(await verifyPassword(undefined, h1), false)
  assert.ok(!h1.includes(PASSWORD))
  assert.deepEqual([SCRYPT.N, SCRYPT.r, SCRYPT.p], [32768, 8, 3])
  assert.equal(parseHash(h1).N, 16384)
  assert.equal(isValidHash(h1), true)
  assert.equal(isValidHash('scrypt:16384:8:1:short:short'), false)
  assert.equal(isValidHash(h1.replace(':16384:', ':1000:')), false, 'cost too low')
  assert.equal(isValidHash(h1.replace(':16384:', ':16385:')), false, 'N must be a power of two')
  assert.equal(isValidHash(h1.replace(':16384:', ':1048576:')), false, 'cost too high')
  await assert.rejects(hashPassword('short'), new RegExp(`at least ${MIN_PASSWORD_LENGTH} characters`))
  assert.equal(sameText('admin', 'admin'), true)
  assert.equal(sameText('admin', 'Admin'), false)
  assert.equal(sameText(undefined, 'admin'), false)
})

// ---------- the config rules ----------

const problemsOf = (env) => {
  try {
    loadConfig(fakeEnv(env))
    return []
  } catch (error) {
    assert.ok(error instanceof ConfigError)
    return error.problems
  }
}

test('config, hosted: the login is forced on (DASHBOARD_AUTH is ignored), the admin settings are required', () => {
  const c = fakeConfig(hostedEnv({ DASHBOARD_AUTH: 'false' }))
  assert.equal(c.dashboard.hosted, true)
  assert.equal(c.dashboard.auth, true)
  assert.deepEqual(c.dashboard.admin, { username: 'admin', passwordHash: HASH })
  assert.equal(c.dashboard.password, undefined, 'DASHBOARD_PASSWORD is not used when hosted')
  for (const missing of [{ ADMIN_USERNAME: '' }, { ADMIN_PASSWORD_HASH: '' }, { ADMIN_USERNAME: '', ADMIN_PASSWORD_HASH: '' }]) {
    assert.ok(problemsOf(hostedEnv(missing)).some((p) => /^ADMIN_USERNAME and ADMIN_PASSWORD_HASH:/.test(p)), JSON.stringify(missing))
  }
  assert.ok(problemsOf(hostedEnv({ ADMIN_PASSWORD_HASH: 'plain-password-here' })).some((p) => /^ADMIN_PASSWORD_HASH: not a hash/.test(p)))
  assert.ok(problemsOf(hostedEnv({ ADMIN_USERNAME: 'ab' })).some((p) => /^ADMIN_USERNAME: at least 3/.test(p)))
  // The error names keys only, never a value.
  assert.ok(!problemsOf(hostedEnv({ ADMIN_PASSWORD_HASH: 'plain-password-here' })).join('\n').includes('plain-password-here'))
})

test('config, hosted: data, exports and the usage counter go under DATA_DIR unless set explicitly', () => {
  const c = fakeConfig(hostedEnv())
  assert.equal(c.runtime.dataDir, join('/data-fake', 'engine'))
  assert.equal(c.publish.exportDir, join('/data-fake', 'exports'))
  const own = fakeConfig(hostedEnv({ ENGINE_DATA_DIR: '/mine/data', EXPORT_DIR: '/mine/exports' }))
  assert.deepEqual([own.runtime.dataDir, own.publish.exportDir], ['/mine/data', '/mine/exports'])
})

test('config, local: unchanged — no admin login unless both settings exist, DASHBOARD_PASSWORD still works', () => {
  const local = fakeConfig({ DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'fake-dashboard-pass' })
  assert.equal(local.dashboard.hosted, false)
  assert.equal(local.dashboard.admin, null)
  assert.equal(local.dashboard.password, 'fake-dashboard-pass')
  assert.ok(problemsOf({ DASHBOARD_AUTH: 'true' }).some((p) => /DASHBOARD_PASSWORD: missing/.test(p)))
  assert.ok(problemsOf({ ADMIN_USERNAME: 'admin' }).some((p) => /set both or neither/.test(p)))
  const both = fakeConfig({ DASHBOARD_AUTH: 'true', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: HASH })
  assert.equal(both.dashboard.admin.username, 'admin')
  assert.equal(fakeConfig().dashboard.auth, false)
  assert.equal(fakeConfig().runtime.dataDir, fakeEnv().ENGINE_DATA_DIR)
  assert.equal(fakeConfig({ APP_NAME: 'x' }).dashboard.hosted, false, 'both APP_NAME and DATA_DIR mean hosted')
})

test('config: the hash is a masked secret', () => {
  assert.ok(fakeConfig(hostedEnv()).secretValues.includes(HASH))
})

// ---------- the server ----------

async function withHosted({ env = {}, sessionMs, clock } = {}, fn) {
  const restoreLog = setSink(() => {})
  const dashboardDir = mkdtempSync(join(tmpdir(), 'm91-dash-'))
  mkdirSync(join(dashboardDir, 'assets'))
  writeFileSync(join(dashboardDir, 'index.html'), '<!doctype html><title>dash</title>')
  writeFileSync(join(dashboardDir, 'assets', 'app-abc123.js'), 'console.log(1)')
  writeFileSync(join(dashboardDir, 'favicon.svg'), '<svg/>')
  const config = fakeConfig(hostedEnv(env))
  const store = memoryStore()
  const manager = createRunManager({ config, storeFactory: () => store, notifierFactory: () => fakeNotifier(), agentsFactory: () => ({ ...stubAgents, reviewer: mockReviewer() }) })
  const server = createServer({ triggerKey: TRIGGER, manager, store, config, dashboardDir, ...(sessionMs && { sessionMs }), ...(clock && { now: clock }) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  let n = 0
  const call = async (method, path, body, headers = {}) => {
    // Each call comes from its own address (as Embarko's proxy reports it) unless the test names one.
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${(n++ % 200) + 1}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text, headers: res.headers }
  }
  const login = async (username = 'admin', password = PASSWORD, headers = {}) => call('POST', '/api/login', { username, password }, headers)
  try {
    await fn({ call, login, config, base })
  } finally {
    await new Promise((r) => server.close(r))
    restoreLog()
  }
}

test('login: a wrong ID and a wrong password both get the same 401 and message; the right pair gets a safe cookie', async () => {
  await withHosted({}, async ({ call, login }) => {
    const wrongId = await login('nobody', PASSWORD)
    const wrongPw = await login('admin', 'not the password')
    for (const r of [wrongId, wrongPw]) {
      assert.equal(r.status, 401)
      assert.deepEqual(r.json, { error: { code: 'bad_credentials', message: 'wrong ID or password' } })
      assert.equal(r.headers.get('set-cookie'), null)
    }
    assert.equal((await call('POST', '/api/login', { password: PASSWORD })).status, 401, 'the ID is required')
    assert.equal((await call('POST', '/api/login', { username: 'admin' })).status, 401)
    assert.equal((await call('POST', '/api/login', { username: ['admin'], password: [PASSWORD] })).status, 401)
    assert.equal((await login('admin', 'x'.repeat(5000))).status, 401, 'an absurdly long password is refused, not hashed')
    const ok = await login()
    assert.equal(ok.status, 200)
    const cookie = ok.headers.get('set-cookie')
    assert.match(cookie, /^m91_session=[0-9a-f]{64};/)
    for (const flag of [/HttpOnly/, /SameSite=Strict/, /Path=\//, /Max-Age=43200/, /Secure/]) assert.match(cookie, flag)
    assert.ok(!cookie.includes(PASSWORD) && !cookie.includes(HASH))
    assert.equal(ok.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains')
  })
})

test('login: Secure is set even without X-Forwarded-Proto when hosted (HTTPS only in production)', async () => {
  await withHosted({}, async ({ login }) => {
    assert.match((await login()).headers.get('set-cookie'), /; Secure$/)
  })
})

test('login: rate limit — 5 tries a minute from one address, then 429 with Retry-After, even for the right password', async () => {
  await withHosted({}, async ({ login }) => {
    const ip = { 'x-forwarded-for': '198.51.100.7' }
    for (let i = 0; i < 5; i++) assert.equal((await login('admin', 'wrong password!', ip)).status, 401)
    const blocked = await login('admin', PASSWORD, ip)
    assert.equal(blocked.status, 429)
    assert.equal(blocked.json.error.code, 'too_many_attempts')
    assert.equal(blocked.headers.get('retry-after'), '60')
    // Another address is not blocked by that one.
    assert.equal((await login('admin', PASSWORD, { 'x-forwarded-for': '198.51.100.8' })).status, 200)
  })
})

test('login: the address is the last X-Forwarded-For entry, so a made-up first entry does not dodge the limit', async () => {
  await withHosted({}, async ({ login }) => {
    for (let i = 0; i < 5; i++) assert.equal((await login('admin', 'wrong password!', { 'x-forwarded-for': `10.0.0.${i}, 198.51.100.9` })).status, 401)
    assert.equal((await login('admin', PASSWORD, { 'x-forwarded-for': '10.0.0.99, 198.51.100.9' })).status, 429)
  })
})

test('login: 20 failures from any addresses lock logins for everyone for a while; time lifts it', async () => {
  let t = Date.UTC(2026, 9, 23, 6, 0, 0)
  await withHosted({ clock: () => t }, async ({ login }) => {
    for (let i = 0; i < 20; i++) assert.equal((await login('admin', 'wrong password!')).status, 401, `try ${i + 1}`)
    const locked = await login('admin', PASSWORD)
    assert.equal(locked.status, 429)
    t += 11 * 60 * 1000
    assert.equal((await login('admin', PASSWORD)).status, 200, 'after 10 minutes the failures no longer count')
  })
})

test('session: expires after sessionMs, and a log out ends it at once', async () => {
  let t = Date.UTC(2026, 9, 23, 6, 0, 0)
  await withHosted({ clock: () => t, sessionMs: 60 * 60 * 1000 }, async ({ call, login }) => {
    const cookie = (await login()).headers.get('set-cookie').split(';')[0]
    assert.equal((await call('GET', '/api/runs', undefined, { cookie })).status, 200)
    t += 59 * 60 * 1000
    assert.equal((await call('GET', '/api/runs', undefined, { cookie })).status, 200)
    t += 2 * 60 * 1000
    const expired = await call('GET', '/api/runs', undefined, { cookie })
    assert.equal(expired.status, 401)
    assert.equal((await call('GET', '/', undefined, { cookie })).status, 302, 'pages need a session too')
    const second = (await login()).headers.get('set-cookie').split(';')[0]
    assert.equal((await call('GET', '/api/runs', undefined, { cookie: second })).status, 200)
    const out = await call('POST', '/api/logout', undefined, { cookie: second })
    assert.match(out.headers.get('set-cookie'), /Max-Age=0.*Secure|Secure/)
    assert.equal((await call('GET', '/api/runs', undefined, { cookie: second })).status, 401)
  })
})

test('a made-up or empty session cookie gets nothing', async () => {
  await withHosted({}, async ({ call }) => {
    for (const cookie of ['m91_session=', `m91_session=${'0'.repeat(64)}`, 'm91_session=admin', 'session=1']) {
      assert.equal((await call('GET', '/api/runs', undefined, { cookie })).status, 401, cookie)
    }
  })
})

// Every route: without a session nothing answers with data. A broad list, then a check on the code's shape.
const API_ROUTES = [
  ['GET', '/api/settings'], ['GET', '/api/runs'], ['GET', '/api/runs?limit=5'], ['GET', '/api/runs/R-261023-0600-ABCD'], ['GET', '/api/runs/R-261023-0600-ABCD/events'],
  ['GET', '/api/events'], ['GET', '/api/approvals'], ['GET', '/api/approvals/261023-0600-ABCD'], ['GET', '/api/records?type=draft'], ['GET', '/api/posts'],
  ['GET', '/api/pinned'], ['GET', '/api/lessons'], ['GET', '/api/exports'], ['GET', '/api/exports/261023-0600-ABCD'], ['GET', '/api/exports/261023-0600-ABCD/download'],
  ['GET', '/api/roadmap'], ['GET', '/api/timely'], ['GET', '/api/briefs'], ['GET', '/api/drafts/261023-0600-ABCD'],
  ['POST', '/api/runs'], ['POST', '/api/runs/R-261023-0600-ABCD/cancel'], ['POST', '/api/pinned'], ['DELETE', '/api/pinned/PIN-1'],
  ['POST', '/api/approvals/261023-0600-ABCD/approve'], ['POST', '/api/approvals/261023-0600-ABCD/reject'], ['POST', '/api/approvals/261023-0600-ABCD/counter'],
  ['POST', '/api/roadmap/approve'], ['POST', '/api/roadmap/slots/s0-1'], ['POST', '/api/roadmap/slots/s0-1/move'], ['POST', '/api/roadmap/slots/s0-1/skip'],
  ['POST', '/api/timely/check'], ['POST', '/api/index/refresh'], ['PUT', '/api/settings'], ['PATCH', '/api/runs'], ['DELETE', '/api/runs/R-261023-0600-ABCD']
]

test('every /api route needs the session except /api/health, the login and the logout', async () => {
  await withHosted({}, async ({ call, login }) => {
    const lone = []
    for (const [method, path] of API_ROUTES) {
      const r = await call(method, path, method === 'GET' ? undefined : {})
      // A Markdown download link (sent to Slack) goes to the login page first, then comes back to the download.
      if (path.endsWith('/download')) {
        assert.equal(r.status, 302, path)
        assert.equal(r.headers.get('location'), `/login?next=${encodeURIComponent(path)}`)
        continue
      }
      if (r.status !== 401) lone.push(`${method} ${path} -> ${r.status}`)
      assert.equal(r.json?.error?.code, 'unauthorized', `${method} ${path}`)
    }
    assert.deepEqual(lone, [])
    // With a session the same calls get past the guard (they may be 404 or 4xx for other reasons, never "unauthorized").
    const cookie = (await login()).headers.get('set-cookie').split(';')[0]
    // (The live event streams are left out here: with a session they stay open.)
    for (const [method, path] of API_ROUTES.filter(([, p]) => !p.endsWith('/events')).slice(0, 12)) {
      const r = await call(method, path, method === 'GET' ? undefined : {}, { cookie })
      assert.notEqual(r.json?.error?.code, 'unauthorized', `${method} ${path} with a session`)
    }
  })
})

test('the code: before the session check, api() answers only /api/health, /api/login and /api/logout', () => {
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  const start = src.indexOf('async function api(req, res, url)')
  const guard = src.indexOf("if (!authed(req)) return fail(res, 401, 'unauthorized'", start)
  assert.ok(start > 0 && guard > start)
  const before = src.slice(start, guard)
  const routes = [...before.matchAll(/(?:path === |startsWith\()'(\/api\/[^']*)'|seg\[1\] === '([^']+)'/g)].map((m) => m[1] ?? `seg:${m[2]}`)
  assert.deepEqual([...new Set(routes)].sort(), ['/api/health', '/api/login', '/api/logout'])
})

test('/api/health without a session says only that the engine is up and how to log in; with one, everything', async () => {
  await withHosted({}, async ({ call, login }) => {
    const open = await call('GET', '/api/health')
    assert.equal(open.status, 200)
    assert.deepEqual(open.json, { ok: true, login: 'admin' })
    const cookie = (await login()).headers.get('set-cookie').split(';')[0]
    const full = await call('GET', '/api/health', undefined, { cookie })
    assert.equal(full.json.ok, true)
    assert.equal(full.json.login, 'admin')
    assert.ok('version' in full.json && 'run_in_progress' in full.json)
    assert.deepEqual((await call('GET', '/health')).json, { ok: true }, '/health tells nothing more either')
  })
})

test('pages: every page goes to /login without a session; only the login page and the script and style files are open', async () => {
  await withHosted({}, async ({ call, login }) => {
    for (const path of ['/', '/approvals', '/approvals/261023-0600-ABCD', '/roadmap', '/settings', '/runs/R-1', '/exports', '/index.html', '/whatever', '/login/extra']) {
      const r = await call('GET', path)
      assert.equal(r.status, 302, path)
      assert.equal(r.headers.get('location'), `/login?next=${encodeURIComponent(path)}`)
      assert.ok(!r.text.includes('<title>dash</title>'), 'no page is sent')
    }
    assert.equal((await call('GET', '/?tab=x')).headers.get('location'), '/login?next=%2F%3Ftab%3Dx')
    const loginPage = await call('GET', '/login')
    assert.equal(loginPage.status, 200)
    assert.match(loginPage.text, /<title>dash<\/title>/)
    assert.equal((await call('GET', '/assets/app-abc123.js')).status, 200)
    assert.equal((await call('GET', '/favicon.svg')).status, 200)
    assert.equal((await call('POST', '/anything', {})).status, 401)
    assert.equal((await call('GET', '/preview/261023-0600-ABCD/')).status, 401, 'previews need the session')
    assert.equal((await call('POST', '/run', {})).status, 401, 'the trigger needs its key')
    assert.equal((await call('POST', '/run', {}, { 'x-trigger-key': 'wrong-key-0123456789' })).status, 401)
    // With a session the same pages are served.
    const cookie = (await login()).headers.get('set-cookie').split(';')[0]
    for (const path of ['/', '/approvals', '/roadmap']) {
      const r = await call('GET', path, undefined, { cookie })
      assert.equal(r.status, 200, path)
      assert.match(r.text, /<title>dash<\/title>/)
    }
  })
})

test('PUBLIC_PAGE_RE: the login page, assets and root icons only', () => {
  for (const ok of ['/login', '/login/', '/assets/app-abc.js', '/assets/a/b.css', '/favicon.svg', '/favicon.ico', '/icon.png']) assert.equal(PUBLIC_PAGE_RE.test(ok), true, ok)
  for (const no of ['/', '/api/health', '/loginx', '/login/x', '/assets', '/assets/', '/x/favicon.svg', '/data.json', '/.env', '/package.json', '/../etc/passwd', '/index.html']) assert.equal(PUBLIC_PAGE_RE.test(no), false, no)
})

test('hosted: the server answers on every interface (0.0.0.0) because the login is always on', () => {
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  assert.match(src, /config\.dashboard\?\.auth \|\| config\.dashboard\?\.hosted \? '0\.0\.0\.0' : '127\.0\.0\.1'/)
})
