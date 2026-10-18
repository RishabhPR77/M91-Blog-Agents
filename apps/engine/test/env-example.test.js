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
  for (const a of [...AGENTS, 'designer']) for (const s of ['_AI_SERVICE', '_AI_MODEL', '_DELIVERY']) keys.add(a.toUpperCase() + s)
  return keys
}

test('env.example lists every key config.js reads, and nothing else', () => {
  const read = keysReadByConfig()
  const listed = new Set(Object.keys(entries))
  assert.deepEqual([...read].filter((k) => !listed.has(k)).sort(), [], 'keys missing from env.example')
  assert.deepEqual([...listed].filter((k) => !read.has(k)).sort(), [], 'keys in env.example that config does not read')
})

test('secrets are empty; no PUBLISH_* keys; no inline comments after values', () => {
  for (const k of SECRET_KEYS) assert.equal(entries[k] ?? '', '', `${k} must be empty in env.example`)
  assert.ok(!Object.keys(entries).some((k) => k.startsWith('PUBLISH_')))
  for (const [k, v] of Object.entries(entries)) assert.ok(!/\s#/.test(v), `${k} has an inline comment`)
})

test('the defaults written in env.example are valid config values', () => {
  const env = { ...entries, ...fakeEnv() }
  for (const [k, v] of Object.entries(env)) if (v === '') delete env[k]
  assert.doesNotThrow(() => loadConfig(env))
})

test('Phase 3.5 keys: designer validated, blog settings, dashboard password only with auth', () => {
  const c = loadConfig(fakeEnv())
  assert.deepEqual(c.designer, { service: 'openai', model: 'gpt-5.6-luna', delivery: 'rtlayer' })
  assert.deepEqual(c.blog, { appName: 'm91-blog', baseUrl: 'https://m91-blog.embarko.app', embarkoDeployToken: undefined, noindexFirstNPosts: 10 })
  assert.equal(c.dashboard.port, 5173)
  assert.equal(c.schedule, undefined, 'no scheduler for now')
  assert.equal(c.publish, undefined)
  assert.throws(() => loadConfig(fakeEnv({ DESIGNER_AI_MODEL: 'gpt-99' })), /DESIGNER_AI_MODEL/)
  assert.throws(() => loadConfig(fakeEnv({ BLOG_BASE_URL: 'not a url' })), /BLOG_BASE_URL/)
})
