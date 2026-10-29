// The Embarko upload: what the package contains and never contains, the scan that stops a leak, the names list and
// the deploy wrapper's guards. Temporary folders and fakes only: nothing is uploaded and no .env is read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { buildStage, scanStage, stagePackage, APP_HEAP_MB } from '../scripts/package-embarko.mjs'
import { envNames, parseTemplate, SET_BY_EMBARKO } from '../scripts/embarko-env.mjs'
import { maskToken, deployScriptPath, bashPath, versionLabel, DEFAULT_NAME } from '../scripts/deploy-embarko.mjs'

const tmp = (name) => mkdtempSync(join(tmpdir(), `m91-${name}-`))
const put = (root, rel, text = 'x') => {
  const file = join(root, ...rel.split('/'))
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}
const allFiles = (dir, base = dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n)
    out.push(f.slice(base.length + 1).replace(/\\/g, '/'))
    if (statSync(f).isDirectory()) allFiles(f, base, out)
  }
  return out
}

/** A small repo: an engine with a dashboard, the content package, and every kind of file that must stay behind. */
function fakeRepo({ dist = false } = {}) {
  const repo = tmp('repo')
  const engine = join(repo, 'apps', 'engine')
  put(engine, 'package.json', JSON.stringify({ name: '@m91/engine', version: '1.2.3', dependencies: { '@m91/content': '0.1.0', ajv: '8.18.0' }, devDependencies: { 'cross-env': '7' } }))
  put(engine, 'src/server.js', 'export {}')
  put(engine, 'src/util/a.js', 'export {}')
  put(engine, 'Dockerfile', 'FROM node')
  put(engine, 'data/mem0-usage.json', '{}')
  put(engine, 'exports/post.md', '# post')
  put(engine, 'drafts/q1.md', '# draft')
  put(engine, 'test/a.test.js', 'x')
  put(engine, 'docs/RUNBOOK.md', '# runbook')
  put(engine, '.env', 'MEM0_API_KEY=should-never-ship')
  put(engine, '.env.example', 'X=')
  put(engine, 'node_modules/pkg/index.js', 'x')
  put(engine, 'dashboard/package.json', JSON.stringify({ name: '@m91/dashboard', scripts: { build: 'tsc --noEmit && vite build' } }))
  put(engine, 'dashboard/package-lock.json', '{}')
  put(engine, 'dashboard/index.html', '<html>')
  put(engine, 'dashboard/src/main.tsx', 'x')
  put(engine, 'dashboard/test/a.test.tsx', 'x')
  put(engine, 'dashboard/scripts/dev.mjs', 'x')
  put(engine, 'dashboard/node_modules/react/index.js', 'x')
  if (dist) put(engine, 'dashboard/dist/index.html', '<html>built')
  put(repo, 'packages/content/package.json', JSON.stringify({ name: '@m91/content', version: '0.1.0' }))
  put(repo, 'packages/content/src/index.js', 'export {}')
  put(repo, 'packages/content/test/a.test.js', 'x')
  put(repo, '.env', 'MEM0_API_KEY=should-never-ship')
  return { repo, engine }
}

test('package.json: the engine dependencies, @m91/content as a local file, the dashboard built on Embarko, the heap capped', () => {
  const p = stagePackage({ engine: { version: '1.2.3', dependencies: { ajv: '8.18.0', '@m91/content': '0.1.0' } } })
  assert.deepEqual(p.dependencies, { ajv: '8.18.0', '@m91/content': 'file:vendor/content' })
  assert.equal(p.name, 'm91-engine')
  assert.equal(p.type, 'module')
  assert.equal(p.scripts.start, `node --max-old-space-size=${APP_HEAP_MB} src/server.js`)
  assert.ok(APP_HEAP_MB < 256, 'under the 256 MB the app has')
  assert.equal(p.scripts.build, 'npm --prefix dashboard ci --include=dev && npm --prefix dashboard run build:embarko')
  assert.ok(!('build' in stagePackage({ engine: { version: '1', dependencies: {} }, prebuilt: true }).scripts))
})

test('the stage holds the engine, the content package and the dashboard sources — and none of the forbidden files', () => {
  const { repo, engine } = fakeRepo()
  const stage = join(tmp('stage'), 'out')
  const { problems } = buildStage({ stage, engineDir: engine, repoDir: repo })
  assert.deepEqual(problems, [])
  const files = allFiles(stage)
  for (const must of ['package.json', 'src/server.js', 'src/util/a.js', 'vendor/content/package.json', 'vendor/content/src/index.js', 'dashboard/package.json', 'dashboard/package-lock.json', 'dashboard/index.html', 'dashboard/src/main.tsx']) assert.ok(files.includes(must), must)
  for (const never of ['.env', 'Dockerfile', 'data', 'exports', 'drafts', 'docs', 'test', 'node_modules', 'dashboard/node_modules', 'dashboard/test', 'dashboard/scripts', 'vendor/content/test']) assert.ok(!files.some((f) => f === never || f.startsWith(`${never}/`)), `${never} is not uploaded`)
  assert.ok(!files.some((f) => /(^|\/)\.env/.test(f)), 'no .env or .env.* anywhere (the template .env.example included)')
  const dashPkg = JSON.parse(readFileSync(join(stage, 'dashboard', 'package.json'), 'utf8'))
  assert.equal(dashPkg.scripts['build:embarko'], 'vite build')
  assert.equal(dashPkg.scripts.build, 'tsc --noEmit && vite build', 'the original build script is kept')
  assert.equal(JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8')).version, '1.2.3')
  assert.ok(!readFileSync(join(stage, 'package.json'), 'utf8').includes('should-never-ship'))
})

test('--prebuilt: only the built dashboard travels, and it must exist', () => {
  const { repo, engine } = fakeRepo({ dist: true })
  const stage = join(tmp('stage'), 'out')
  assert.deepEqual(buildStage({ stage, engineDir: engine, repoDir: repo, prebuilt: true }).problems, [])
  const files = allFiles(stage)
  assert.ok(files.includes('dashboard/dist/index.html'))
  assert.ok(!files.some((f) => f.startsWith('dashboard/src') || f === 'dashboard/package.json'))
  assert.ok(!('build' in JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8')).scripts))
  const none = fakeRepo()
  assert.throws(() => buildStage({ stage: join(tmp('stage'), 'o2'), engineDir: none.engine, repoDir: none.repo, prebuilt: true }), /needs a built dashboard/)
})

test('the app id file (embarko.json) travels when it exists', () => {
  const { repo, engine } = fakeRepo()
  put(engine, 'embarko.json', '{"appId":"cmh1q2w3e0001abcdmyapp"}')
  const stage = join(tmp('stage'), 'out')
  buildStage({ stage, engineDir: engine, repoDir: repo })
  assert.equal(readFileSync(join(stage, 'embarko.json'), 'utf8'), '{"appId":"cmh1q2w3e0001abcdmyapp"}')
})

test('the scan stops a leak: .env files, data, exports, node_modules, key files, secret-looking text', () => {
  const clean = tmp('scan')
  put(clean, 'package.json', '{}')
  put(clean, 'src/a.js', 'const url = "https://example.com/x"')
  assert.deepEqual(scanStage(clean), [])
  for (const bad of ['.env', '.env.local', '.env.production', 'apps/.env', 'data/x.json', 'exports/post.md', 'node_modules/x/y.js', 'Dockerfile', 'keys/server.pem', 'id_rsa', '.npmrc', 'credentials']) {
    const dir = tmp('scan')
    put(dir, bad)
    assert.ok(scanStage(dir).some((p) => p.startsWith('forbidden path')), bad)
  }
  // Built from pieces, so these fake leaks do not trip the pre-push secret scan themselves.
  const leaks = ['key = "sk' + '-abcdefghijklmnop1234"', 'MEM0 m0' + '-abcdefghijklmnop1234', 'xox' + 'b-1234567890-abcdef', 'ghp' + '_abcdefghijklmnopqrst1234', 'ey' + 'JhbGciOiJIUzI1NiJ9abcdefghij.payload', 'https://flow.sokt.io/' + 'func/scri1234abcd', '-----BEGIN RSA PRIV' + 'ATE KEY-----']
  for (const text of leaks) {
    const dir = tmp('scan')
    put(dir, 'src/leak.js', text)
    assert.ok(scanStage(dir).some((p) => p.startsWith('looks like a secret in src/leak.js')), text)
  }
})

test('a leak in the repo stops the packaging result (a key in a source file is reported)', () => {
  const { repo, engine } = fakeRepo()
  put(engine, 'src/oops.js', `const k = "m0${'-'}abcdefghijklmnop1234"`)
  const { problems } = buildStage({ stage: join(tmp('stage'), 'out'), engineDir: engine, repoDir: repo })
  assert.deepEqual(problems, ['looks like a secret in src/oops.js'])
})

test('the real repo packages clean, with the Dockerfile, .env files, data and exports left out', () => {
  const stage = join(tmp('real'), 'out')
  const { problems } = buildStage({ stage })
  assert.deepEqual(problems, [])
  const files = allFiles(stage)
  assert.ok(files.includes('src/server.js') && files.includes('src/util/adminhash.js') && files.includes('vendor/content/package.json') && files.includes('dashboard/src/main.tsx'))
  assert.ok(!files.some((f) => /(^|\/)(data|exports|node_modules|Dockerfile)(\/|$)/.test(f) || /(^|\/)\.env/.test(f)), files.filter((f) => /(\.env|node_modules|Dockerfile|^data|^exports)/.test(f)).join(', '))
  assert.ok(existsSync(join(stage, 'package.json')))
})

test('env names: required, needed, only-if-set and optional — names only, from the template; Embarko-set keys are never listed', () => {
  const { required, needed, onlyIfSet, optional, secrets } = envNames()
  for (const k of ['VIASOCKET_EMBED_SECRET', 'PIPELINE_TRIGGER_KEY', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH']) assert.ok(required.includes(k), k)
  // viaSocket memory is the default store: the Mem0 key is needed only with MEMORY_BACKEND=mem0.
  assert.ok(!required.includes('MEM0_API_KEY') && onlyIfSet.includes('MEM0_API_KEY'))
  assert.deepEqual(needed.sort(), ['M91_ALERT_WEBHOOK_URL', 'M91_CTA_URL', 'SLACK_POST_WEBHOOK_URL', 'WEBHOOK_SHARED_KEY'])
  assert.ok(onlyIfSet.includes('MEM0_ORG_ID') && onlyIfSet.includes('DOCSTAR_API_KEY'))
  assert.ok(optional.includes('MEM0_AGENT_ID') && optional.includes('PUBLISH_TARGET'))
  for (const k of [...required, ...needed, ...onlyIfSet, ...optional]) {
    assert.ok(!SET_BY_EMBARKO.includes(k), `${k} is set by Embarko`)
    assert.ok(!['DASHBOARD_AUTH', 'DASHBOARD_PASSWORD', 'EMBARKO_DEPLOY_TOKEN', 'ENGINE_DATA_DIR', 'EXPORT_DIR'].includes(k), `${k} is not used when hosted`)
  }
  for (const k of ['ADMIN_PASSWORD_HASH', 'MEM0_API_KEY', 'PIPELINE_TRIGGER_KEY']) assert.ok(secrets.includes(k), `${k} is marked secret`)
  assert.deepEqual(parseTemplate('A=1\n# B=2\nC=\n  D=4\nE=x y'), { A: '1', C: '', E: 'x y' })
})

test('deploy wrapper: the token is masked wherever it shows, the script path and version label are sane', () => {
  assert.equal(maskToken('Bearer tok-123 and tok-123 again', 'tok-123'), 'Bearer *** and *** again')
  assert.equal(maskToken('nothing here', undefined), 'nothing here')
  assert.equal(DEFAULT_NAME, 'm91-engine')
  assert.match(deployScriptPath({}), /embarko-deploy[\\/]scripts[\\/]deploy\.sh$/)
  assert.equal(deployScriptPath({ EMBARKO_DEPLOY_SCRIPT: '/x/deploy.sh' }), '/x/deploy.sh')
  assert.match(versionLabel(new Date('2026-10-23T06:05:00Z')), /^\d+\.\d+\.\d+-[0-9a-z]+-20261023\d{4}$/)
})

test('deploy wrapper: Git Bash on Windows (WSL bash cannot see C:/ paths); EMBARKO_BASH wins; plain bash elsewhere', () => {
  const git = join('C:\\Program Files', 'Git', 'bin', 'bash.exe')
  const win = { platform: 'win32', exists: (p) => p === git }
  assert.equal(bashPath({ ProgramFiles: 'C:\\Program Files' }, win), git)
  assert.equal(bashPath({ ProgramFiles: 'C:\\Program Files', EMBARKO_BASH: 'D:\\tools\\bash.exe' }, win), 'D:\\tools\\bash.exe')
  assert.equal(bashPath({ ProgramFiles: 'C:\\Nowhere' }, win), 'bash', 'no Git Bash found: plain bash')
  assert.equal(bashPath({}, { platform: 'linux', exists: () => true }), 'bash')
})

test('deploy wrapper: without --yes nothing is uploaded; with --yes but no token it refuses (no anonymous deploy)', async () => {
  const { spawnSync } = await import('node:child_process')
  const script = fileURLToPath(new URL('../scripts/deploy-embarko.mjs', import.meta.url))
  const env = { ...process.env }
  delete env.EMBARKO_DEPLOY_TOKEN
  delete env.DEPLOY_TOKEN
  const dry = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /Not uploaded: add --yes/)
  const noToken = spawnSync(process.execPath, [script, '--yes'], { env, encoding: 'utf8' })
  assert.equal(noToken.status, 1)
  assert.match(noToken.stderr, /EMBARKO_DEPLOY_TOKEN is not set/)
  assert.ok(!/Authorization|Bearer/.test(noToken.stdout + noToken.stderr))
})

// ---------- looking after the deployed app (npm run embarko -- …) ----------

import { run as embarkoRun, call as embarkoCall, maskToken as maskApi, waitTerminal, EmbarkoError, API } from '../scripts/embarko-api.mjs'

/** A fake Embarko: answers by "METHOD path", records the calls (with the headers it was sent). */
function fakeEmbarko(routes) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const path = String(url).replace(API, '')
    const method = init.method ?? 'GET'
    calls.push({ method, path, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined })
    const r = routes[`${method} ${path}`]
    if (!r) return new Response(JSON.stringify({ error: `no route ${method} ${path}` }), { status: 404 })
    const reply = typeof r === 'function' ? r(calls.length) : r
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status ?? 200 })
  }
  return { fetchImpl, calls }
}
const TOKEN = 'tok-test-0123456789'
const noSleep = async () => {}

test('embarko: read commands call the right addresses with the token as the Authorization header only', async () => {
  const f = fakeEmbarko({
    'GET /apps/m91-engine/status': { body: { status: 'live', links: { app: 'https://m91-engine.embarko.app' } } },
    'GET /apps/m91-engine/logs?stream=stderr': { body: { available: true, logs: 'listening on 8080' } },
    'GET /api/apps/m91-engine/deployments': { body: { deployments: [{ id: 'd2', status: 'live', version: '0.2.0-abc', createdAt: '2026-10-23', rollbackTarget: false }, { id: 'd1', status: 'live', version: '0.2.0-def', rollbackTarget: true }] } },
    'GET /api/apps/m91-engine/env-vars': { body: { vars: [{ key: 'ZED' }, { key: 'ADMIN_USERNAME' }] } }
  })
  const opts = { token: TOKEN, fetchImpl: f.fetchImpl }
  assert.deepEqual(await embarkoRun('status', [], opts), ['m91-engine: live', 'address: https://m91-engine.embarko.app'])
  assert.deepEqual(await embarkoRun('logs', [], opts), ['listening on 8080'])
  const dep = await embarkoRun('deployments', [], opts)
  assert.match(dep[0], /^d2\s+live/)
  assert.match(dep[1], /d1.*rollback target$/)
  assert.deepEqual(await embarkoRun('env-keys', [], opts), ['ADMIN_USERNAME', 'ZED'], 'names only, sorted')
  for (const c of f.calls) {
    assert.equal(c.headers.authorization, `Bearer ${TOKEN}`)
    assert.equal(c.headers['x-agent-name'], 'claude-code')
    assert.ok(!c.path.includes(TOKEN), 'never in the address')
  }
  assert.equal(f.calls.every((c) => c.method === 'GET'), true)
})

test('embarko: rollback and apply-env change nothing without --yes; with it they wait until the app is back', async () => {
  let polls = 0
  const f = fakeEmbarko({
    'POST /api/apps/m91-engine/rollback': { status: 202, body: { statusUrl: '/apps/m91-engine/status' } },
    'POST /api/apps/m91-engine/env-vars/apply': { status: 202, body: { statusUrl: `${API}/apps/m91-engine/status` } },
    'GET /apps/m91-engine/status': () => ({ body: ++polls < 3 ? { status: 'starting' } : { status: 'live', terminal: true } })
  })
  const opts = { token: TOKEN, fetchImpl: f.fetchImpl, sleep: noSleep }
  assert.match((await embarkoRun('rollback', [], opts))[0], /^Not done: "rollback" changes the running app\. Add --yes/)
  assert.match((await embarkoRun('apply-env', [], opts))[0], /^Not done/)
  assert.equal(f.calls.length, 0, 'nothing was sent')
  assert.deepEqual(await embarkoRun('rollback', ['--yes'], opts), ['rollback: live'])
  assert.deepEqual(f.calls[0], { method: 'POST', path: '/api/apps/m91-engine/rollback', headers: f.calls[0].headers, body: {} })
  polls = 0
  assert.deepEqual(await embarkoRun('rollback', ['--yes', 'dep-123'], opts), ['rollback: live'])
  assert.deepEqual(f.calls.find((c) => c.body?.deploymentId)?.body, { deploymentId: 'dep-123' })
  polls = 0
  assert.deepEqual(await embarkoRun('apply-env', ['--yes'], opts), ['apply-env: live'])
})

test('embarko: errors say what Embarko said; a missing token and an unknown command are refused; the token is masked', async () => {
  const f = fakeEmbarko({ 'GET /apps/m91-engine/status': { status: 404, body: { error: 'not found', next: 'check the name and the token' } } })
  await assert.rejects(embarkoRun('status', [], { token: TOKEN, fetchImpl: f.fetchImpl }), /status: 404 not found check the name and the token/)
  await assert.rejects(embarkoRun('status', [], { fetchImpl: f.fetchImpl }), /EMBARKO_DEPLOY_TOKEN is not set/)
  assert.equal(f.calls.length, 1, 'only the first call went out: the token-less one sent nothing')
  await assert.rejects(embarkoRun('nope', [], { token: TOKEN, fetchImpl: f.fetchImpl }), (e) => e instanceof EmbarkoError && /unknown command "nope"/.test(e.message))
  assert.equal(maskApi(`Bearer ${TOKEN} / ${TOKEN}`, TOKEN), 'Bearer *** / ***')
  await assert.rejects(waitTerminal({ token: TOKEN, fetchImpl: fakeEmbarko({ 'GET /s': { body: { status: 'starting' } } }).fetchImpl, statusUrl: '/s', sleep: noSleep, tries: 2 }), /still not finished/)
  assert.equal((await embarkoCall({ token: TOKEN, fetchImpl: f.fetchImpl, path: '/apps/m91-engine/status' })).status, 404)
})

// ---------- copying the settings from .env to Embarko (names printed, values never) ----------

import { planSync, sync } from '../scripts/embarko-env-sync.mjs'

const SECRET_VALUE = 'super-secret-value-0001'
const syncEnv = {
  MEM0_API_KEY: SECRET_VALUE, VIASOCKET_ORG_ID: 'org-1', VIASOCKET_PROJECT_ID: 'proj-1', VIASOCKET_EMBED_SECRET: 'embed-secret-0002', PIPELINE_TRIGGER_KEY: 'trigger-key-0123456789',
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: 'scrypt:32768:8:3:AAAAAAAAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  M91_CTA_URL: 'https://m91.msg91.com/signup', MEM0_AGENT_ID: 'm91-blog', MEM0_ORG_ID: '   ',
  // never sent:
  PORT: '8080', DATA_DIR: '/x', APP_NAME: 'x', DASHBOARD_AUTH: 'true', DASHBOARD_PASSWORD: 'local-only-pass', EMBARKO_DEPLOY_TOKEN: TOKEN, ENGINE_DATA_DIR: '/local', EXPORT_DIR: '/local/e',
  PUBLISH_TARGET: 'embarko', PATH: '/usr/bin', HOME: '/home/x'
}

test('env sync plan: only the listed settings that have a value; local-only and Embarko-set keys and OS variables stay out', () => {
  const plan = planSync(syncEnv)
  assert.deepEqual(Object.keys(plan.send).sort(), ['ADMIN_PASSWORD_HASH', 'ADMIN_USERNAME', 'M91_CTA_URL', 'MEM0_AGENT_ID', 'MEM0_API_KEY', 'PIPELINE_TRIGGER_KEY', 'VIASOCKET_EMBED_SECRET', 'VIASOCKET_ORG_ID', 'VIASOCKET_PROJECT_ID'])
  for (const never of ['PORT', 'DATA_DIR', 'APP_NAME', 'DASHBOARD_AUTH', 'DASHBOARD_PASSWORD', 'EMBARKO_DEPLOY_TOKEN', 'ENGINE_DATA_DIR', 'EXPORT_DIR', 'PATH', 'HOME', 'MEM0_ORG_ID']) assert.ok(!(never in plan.send), never)
  assert.deepEqual(plan.skipped, ['PUBLISH_TARGET (the old blog target: it stays off on Embarko; none and docstar are sent)'])
  assert.deepEqual(plan.missingRequired.sort(), ['M91_ALERT_WEBHOOK_URL', 'SLACK_POST_WEBHOOK_URL', 'WEBHOOK_SHARED_KEY'])
  assert.equal(planSync({ ...syncEnv, PUBLISH_TARGET: 'none' }).send.PUBLISH_TARGET, 'none')
  assert.equal(planSync({ ...syncEnv, PUBLISH_TARGET: 'docstar' }).send.PUBLISH_TARGET, 'docstar', 'Docstar publishing works from Embarko')
})

test('env sync: nothing is sent without --yes; with it the values go to Embarko, and no printed line holds a value', async () => {
  const f = fakeEmbarko({ 'PUT /api/apps/m91-engine/env-vars': { body: { applied: true } } })
  const dry = await sync({ env: syncEnv, token: TOKEN, fetchImpl: f.fetchImpl })
  assert.equal(f.calls.length, 0)
  assert.match(dry[0], /^Would send 9 settings to m91-engine: ADMIN_PASSWORD_HASH ADMIN_USERNAME /)
  assert.match(dry.at(-1), /Nothing was sent: add --yes/)
  const lines = await sync({ env: syncEnv, token: TOKEN, yes: true, fetchImpl: f.fetchImpl })
  assert.equal(f.calls.length, 1)
  const put = f.calls[0]
  assert.equal(put.headers.authorization, `Bearer ${TOKEN}`)
  assert.equal(put.body.apply, true)
  assert.equal(put.body.vars.find((v) => v.key === 'MEM0_API_KEY').value, SECRET_VALUE, 'the value does reach Embarko')
  assert.deepEqual(put.body.vars.map((v) => v.key), [...put.body.vars.map((v) => v.key)].sort())
  const printed = [...dry, ...lines].join('\n')
  for (const v of Object.values(syncEnv).filter((x) => x.trim().length >= 6)) assert.ok(!printed.includes(v) || /^(8080|true)$/.test(v), `a value was printed: ${v.slice(0, 4)}…`)
  assert.ok(!printed.includes(SECRET_VALUE) && !printed.includes(TOKEN))
  assert.match(lines.join('\n'), /Saved 9 settings and applied them\./)
  assert.match(lines.join('\n'), /Not in .env.*M91_ALERT_WEBHOOK_URL/)
})

test('env sync: waits for the app when Embarko answers with a status address; refuses without a token; reports a refusal', async () => {
  let polls = 0
  const f = fakeEmbarko({
    'PUT /api/apps/m91-engine/env-vars': { status: 202, body: { statusUrl: '/apps/m91-engine/status' } },
    'GET /apps/m91-engine/status': () => ({ body: ++polls < 2 ? { status: 'starting' } : { status: 'crashed', terminal: true, error: 'exit code 2' } })
  })
  assert.match((await sync({ env: syncEnv, token: TOKEN, yes: true, fetchImpl: f.fetchImpl, sleep: noSleep })).join('\n'), /App: crashed \(exit code 2\)/)
  await assert.rejects(sync({ env: syncEnv, yes: true, fetchImpl: f.fetchImpl }), /EMBARKO_DEPLOY_TOKEN is not set/)
  const refuse = fakeEmbarko({ 'PUT /api/apps/m91-engine/env-vars': { status: 422, body: { code: 'invalid_env_key' } } })
  await assert.rejects(sync({ env: syncEnv, token: TOKEN, yes: true, fetchImpl: refuse.fetchImpl }), /Embarko refused the settings: 422 invalid_env_key/)
})
