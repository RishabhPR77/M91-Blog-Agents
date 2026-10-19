// The engine serves the built dashboard (Phase 6, section 9): content types, cache rules, SPA fallback,
// security headers, no path traversal, a text page when nothing is built; /health, POST /run and /api unchanged.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, DASHBOARD_HEADERS, NOT_BUILT_TEXT, resolveInside } from '../src/server.js'

const KEY = 'fake-trigger-key-0123456789'
const INDEX = '<!doctype html><html><head><script type="module" src="/assets/index-AbC123.js"></script></head><body><div id="root"></div></body></html>'
let root
let dist

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'm91-dash-'))
  dist = join(root, 'dist')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await writeFile(join(dist, 'index.html'), INDEX)
  await writeFile(join(dist, 'assets', 'index-AbC123.js'), 'console.log("app")')
  await writeFile(join(dist, 'assets', 'index-DeF456.css'), 'body{color:red}')
  await writeFile(join(root, 'secret.txt'), 'outside the dist folder')
})
after(async () => {
  await rm(root, { recursive: true, force: true })
})

async function withServer(dashboardDir, fn) {
  let runs = 0
  const server = createServer({ triggerKey: KEY, run: async () => { runs++ }, dashboardDir })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base, () => runs)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

const expectSecurityHeaders = (res) => {
  for (const [k, v] of Object.entries(DASHBOARD_HEADERS)) assert.equal(res.headers.get(k), v, k)
}

test('GET / serves index.html with the security headers and no cache', async () => {
  await withServer(dist, async (base) => {
    const res = await fetch(`${base}/`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(res.headers.get('cache-control'), 'no-cache')
    expectSecurityHeaders(res)
    assert.equal(await res.text(), INDEX)
    assert.equal(res.headers.get('content-security-policy'), "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
  })
})

test('hashed assets: right content type, long immutable cache; HEAD has no body', async () => {
  await withServer(dist, async (base) => {
    const js = await fetch(`${base}/assets/index-AbC123.js`)
    assert.equal(js.status, 200)
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    expectSecurityHeaders(js)
    assert.equal(await js.text(), 'console.log("app")')
    const css = await fetch(`${base}/assets/index-DeF456.css`)
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8')
    const head = await fetch(`${base}/assets/index-AbC123.js`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  })
})

test('SPA fallback: app routes get index.html; a missing file with an extension is a 404', async () => {
  await withServer(dist, async (base) => {
    for (const p of ['/approvals/261019-1055-BZ89', '/runs/R-261019-1055-QHVG', '/content?type=brief', '/records/e6e7c815-a446-44cd-8395-a42c40ded50c']) {
      const res = await fetch(`${base}${p}`)
      assert.equal(res.status, 200, p)
      assert.equal(await res.text(), INDEX, p)
      assert.equal(res.headers.get('cache-control'), 'no-cache')
    }
    assert.equal((await fetch(`${base}/assets/missing-123.js`)).status, 404)
    assert.equal((await fetch(`${base}/favicon.ico`)).status, 404)
    assert.equal((await fetch(`${base}/index.html`, { method: 'POST' })).status, 404)
  })
})

test('no path traversal out of the dist folder', async () => {
  assert.equal(resolveInside(dist, '/../secret.txt'), null)
  assert.equal(resolveInside(dist, '/%2e%2e/secret.txt'), null)
  assert.equal(resolveInside(dist, '/assets/%2e%2e%2f%2e%2e%2fsecret.txt'), null)
  assert.equal(resolveInside(dist, '/%00'), null)
  assert.equal(resolveInside(dist, '/%E0%A4%A'), null)
  assert.equal(resolveInside(dist, '/assets/index-AbC123.js'), join(dist, 'assets', 'index-AbC123.js'))
  await withServer(dist, async (base) => {
    for (const p of ['/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt']) {
      const res = await fetch(`${base}${p}`)
      assert.notEqual(await res.text(), 'outside the dist folder', p)
    }
  })
})

test('no build: GET / is a short text page; other paths keep their 404', async () => {
  await withServer(join(root, 'not-built'), async (base) => {
    const res = await fetch(`${base}/`)
    assert.equal(res.status, 200)
    assert.equal(await res.text(), NOT_BUILT_TEXT)
    assert.equal(NOT_BUILT_TEXT, 'Dashboard not built. Run `npm run build:dashboard`.\n')
    expectSecurityHeaders(res)
    assert.equal((await fetch(`${base}/approvals`)).status, 404)
  })
})

test('/health, POST /run and /api are unchanged with a dashboard present', async () => {
  await withServer(dist, async (base, runs) => {
    const health = await fetch(`${base}/health`)
    assert.deepEqual(await health.json(), { ok: true, running: false })
    assert.equal((await fetch(`${base}/run`)).status, 405)
    assert.equal((await fetch(`${base}/run`, { method: 'POST', headers: { 'x-trigger-key': KEY } })).status, 202)
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(runs(), 1)
    const api = await fetch(`${base}/api/health`)
    assert.equal(api.headers.get('content-type'), 'application/json')
    assert.equal((await fetch(`${base}/api/nope`)).headers.get('content-type'), 'application/json')
  })
})
