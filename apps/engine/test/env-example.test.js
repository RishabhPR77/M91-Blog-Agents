// env.example (repo root) must list exactly the keys config.js reads, with secrets empty.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadConfig, SECRET_KEYS, AGENTS } from '../src/config.js'
import { fakeEnv } from './helpers.js'

const source = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8')
const example = readFileSync(new URL('../../../env.example', import.meta.url), 'utf8')
const entries = Object.fromEntries(example.split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))

function keysReadByConfig() {
  const keys = new Set([...source.matchAll(/(?:str|int|bool|url|oneOf|num|list)\('([A-Z0-9_]+)'/g)].map((m) => m[1]))
  for (const a of [...AGENTS, 'experience', 'planner']) for (const s of ['_AI_SERVICE', '_AI_MODEL', '_DELIVERY']) keys.add(a.toUpperCase() + s)
  return keys
}

test('env.example lists every key config.js reads, and nothing else', () => {
  const read = keysReadByConfig()
  const listed = new Set(Object.keys(entries))
  assert.deepEqual([...read].filter((k) => !listed.has(k)).sort(), [], 'keys missing from env.example')
  assert.deepEqual([...listed].filter((k) => !read.has(k)).sort(), [], 'keys in env.example that config does not read')
})

test('secrets are empty; no PUBLISH_* keys except PUBLISH_TARGET (Phase 11) and PUBLISH_VERIFY_TIMEOUT_MS (Phase 7); no inline comments after values', () => {
  for (const k of SECRET_KEYS) assert.equal(entries[k] ?? '', '', `${k} must be empty in env.example`)
  assert.deepEqual(Object.keys(entries).filter((k) => k.startsWith('PUBLISH_')).sort(), ['PUBLISH_TARGET', 'PUBLISH_VERIFY_TIMEOUT_MS'])
  for (const [k, v] of Object.entries(entries)) assert.ok(!/\s#/.test(v), `${k} has an inline comment`)
})

test('the defaults written in env.example are valid config values', () => {
  const env = { ...entries, ...fakeEnv() }
  for (const [k, v] of Object.entries(env)) if (v === '') delete env[k]
  assert.doesNotThrow(() => loadConfig(env))
})

test('Phase 3.5 keys: the Experience Designer (Phase 10) validated, promo off, blog settings, dashboard password only with auth', () => {
  const c = loadConfig(fakeEnv())
  assert.deepEqual(c.designer, { enabled: true, service: 'anthropic', model: 'claude-sonnet-4-6', delivery: 'rtlayer', maxRepairs: 1, maxComponents: 10, interactiveDefault: true })
  assert.equal(c.promo.enabled, false)
  assert.equal(c.limits.maxDesignerRevisions, 2)
  assert.throws(() => loadConfig(fakeEnv({ EXPERIENCE_MAX_COMPONENTS: '31' })), /EXPERIENCE_MAX_COMPONENTS/)
  assert.throws(() => loadConfig(fakeEnv({ PROMO_ENABLED: 'maybe' })), /PROMO_ENABLED/)
  assert.throws(() => loadConfig(fakeEnv({ INTERACTIVE_DEFAULT: 'maybe' })), /INTERACTIVE_DEFAULT/)
  assert.equal(loadConfig(fakeEnv({ INTERACTIVE_DEFAULT: 'false', EXPERIENCE_MAX_REPAIRS: '0' })).designer.interactiveDefault, false)
  assert.deepEqual(c.blog, { appName: 'm91-blog', baseUrl: 'https://m91-blog.embarko.app', embarkoDeployToken: undefined, noindexFirstNPosts: 10, embarkoApiBase: 'https://ship.embarko.ai', embarkoAgentName: 'm91-blog-engine', buildTimeoutMs: 300000, publishVerifyTimeoutMs: 120000 })
  assert.equal(c.dashboard.port, 5173)
  assert.equal(c.schedule, undefined, 'no scheduler for now')
  assert.equal(c.publish.target, 'embarko', 'the tests pin PUBLISH_TARGET=embarko (the Phase 11 default is none)')
  assert.throws(() => loadConfig(fakeEnv({ EXPERIENCE_AI_MODEL: 'gpt-99' })), /EXPERIENCE_AI_MODEL/)
  assert.throws(() => loadConfig(fakeEnv({ BLOG_BASE_URL: 'not a url' })), /BLOG_BASE_URL/)
})
