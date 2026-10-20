// Shared fixtures for unit tests. All values are fake.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'

// Each test process gets its own engine data folder (run lock, Mem0 usage): test files run in parallel.
export const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'm91-engine-data-'))
import { sampleSentences } from '../src/agents/stubs.js'

// Unit tests never touch the network: the real fetch only reaches local test servers.
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  const host = new URL(String(url?.url ?? url)).hostname
  if (host === '127.0.0.1' || host === 'localhost') return realFetch(url, opts)
  throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: `network disabled in unit tests (${host})` } })
}

export function fakeEnv(overrides = {}) {
  return {
    VIASOCKET_ORG_ID: 'org-test',
    VIASOCKET_PROJECT_ID: 'proj-test',
    VIASOCKET_EMBED_SECRET: 'fake-embed-secret-for-tests',
    MEM0_API_KEY: 'm0-fakekeyfortests123',
    SLACK_POST_WEBHOOK_URL: 'https://flow.sokt.io/func/scriFAKESLACK',
    M91_ALERT_WEBHOOK_URL: 'https://flow.sokt.io/func/scriFAKEM91',
    WEBHOOK_SHARED_KEY: 'fake-shared-key-123',
    PIPELINE_TRIGGER_KEY: 'fake-trigger-key-0123456789',
    // The read cache is shared per process: off in unit tests unless a test turns it on.
    STORE_CACHE_TTL_MS: '0',
    ENGINE_DATA_DIR: TEST_DATA_DIR,
    ...overrides
  }
}

export const fakeConfig = (overrides) => loadConfig(fakeEnv(overrides))

/**
 * In-memory stand-in for src/store.js with the same interface.
 * `similarity(text, record)` → score for searchSimilar (default: 1 on an exact text match, else 0).
 * `dryRun: true` mimics the store's DRY_RUN rule (only run_log is written).
 */
export function memoryStore({ similarity, dryRun = false } = {}) {
  const records = new Map()
  let seq = 0
  const writes = { create: 0, update: 0 }
  const textOf = (r) => r.payload?.main_question ?? r.payload?.title ?? r.payload?.topic ?? ''
  const score = similarity ?? ((text, r) => (textOf(r).toLowerCase() === String(text).toLowerCase() ? 1 : 0))
  const matches = (r, f = {}) =>
    (f.type === undefined || r.type === f.type) &&
    ((f.brief_id ?? f.briefId) === undefined || r.briefId === (f.brief_id ?? f.briefId)) &&
    (f.status === undefined || r.status === f.status) &&
    (f.version === undefined || r.version === f.version)
  return {
    records,
    writes,
    dryRun,
    /** Seed first, then switch DRY_RUN on. */
    setDryRun(value) {
      dryRun = value
      this.dryRun = value
    },
    async createRecord({ type, payload, briefId = null, status = null, version = null, topicGroup = null, date = '2026-10-17', meta = {} }) {
      if (type === 'run_log' || type === 'run') payload = { ...payload, dry_run: dryRun }
      if (dryRun && type !== 'run_log' && type !== 'run') return { id: `dryrun-${++seq}`, type, payload, briefId, status, version, topicGroup, date, metadata: { ...meta, type }, dryRun: true }
      writes.create++
      const id = `mem-${++seq}`
      const record = { id, type, payload, briefId, status, version, topicGroup, date, metadata: { ...meta, type, brief_id: briefId, status, version, topic_group: topicGroup, date, ...((type === 'run_log' || type === 'run') && { dry_run: dryRun }) } }
      records.set(id, record)
      return record
    },
    async updateRecord(id, payload, metadata = {}) {
      if (dryRun && metadata.type !== 'run') return { id, payload, metadata, dryRun: true }
      writes.update++
      const r = records.get(id)
      Object.assign(r, { payload: payload ?? r.payload, metadata: { ...r.metadata, ...metadata } })
      if (metadata.status) r.status = metadata.status
      return r
    },
    lessons: [],
    async addLesson(text, meta = {}) {
      if (dryRun) return { eventId: null, status: 'DRY_RUN' }
      this.lessons.push({ text, meta })
      const id = `mem-${++seq}`
      records.set(id, { id, type: 'lesson', payload: text, briefId: null, status: null, version: null, date: '2026-10-19', metadata: { ...meta, type: 'lesson' } })
      return { eventId: `evt-${id}`, status: 'PENDING' }
    },
    async searchSimilar(text, filters = {}) {
      return [...records.values()].filter((r) => matches(r, { type: filters.type })).map((r) => ({ ...r, score: score(text, r) }))
    },
    async getRecord(id) {
      return records.get(id) ?? null
    },
    async getRecords(filters) {
      return [...records.values()].filter((r) => matches(r, filters))
    },
    async getOne(type, briefId) {
      return [...records.values()].find((r) => r.type === type && r.briefId === briefId) ?? null
    },
    async deleteRecord(id) {
      records.delete(id)
    },
    byType(type) {
      return [...records.values()].filter((r) => r.type === type)
    }
  }
}

/**
 * An injected reviewer for unit tests (the env-controlled stub is gone, Phase 5 C2).
 * script: entries used in order, the last one repeating: 'pass' | 'fail' | a review object | (ctx, n) => entry.
 * 'fail' quotes two real sentences of the draft: one "must" and one "should" item for the Writer.
 */
export function mockReviewer(script = ['pass']) {
  let n = 0
  const fn = async (ctx = {}) => {
    let s = script[Math.min(n++, script.length - 1)]
    if (typeof s === 'function') s = s(ctx, n)
    if (s === 'pass') return { model: 'mock', output: { pass: true, total: 90, feedback: [], summary_line: 'Score 90/100 · pass · gates 10/10 · 0 should-fix items' } }
    if (s === 'fail') {
      const quotes = sampleSentences(ctx.draft?.draft?.post_markdown ?? ctx.draft?.post_markdown ?? '', 2)
      const feedback = [
        { area: 'simplicity', quote: quotes[0] ?? '', problem: 'This sentence is harder to follow than it needs to be.', fix: 'Say it in shorter, plainer words.', severity: 'must', send_to: 'writer', claims: [] },
        { area: 'answers_question', quote: quotes[1] ?? '', problem: 'The point comes too late in this part.', fix: 'Put the direct answer first.', severity: 'should', send_to: 'writer', claims: [] }
      ]
      return { model: 'mock', output: { pass: false, total: 70, feedback, summary: 'Not yet.', summary_line: 'Score 70/100 · fail · simplicity 6 → writer' } }
    }
    return { model: 'mock', output: s }
  }
  fn.count = () => n
  return fn
}

export function fakeNotifier() {
  const sent = { slack: [], m91: [] }
  return {
    sent,
    async slack(text) { sent.slack.push(text) },
    async m91Alert(args) { sent.m91.push(args) }
  }
}

/** A fetch stub: handler(url, init) → { status, body }. Records calls. */
export function fakeFetch(handler) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined })
    const { status = 200, body = {} } = await handler(url, init, calls.length)
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => body
    }
  }
  fn.calls = calls
  return fn
}

/** The run lock file of this test process (Phase 9): its JSON, or null when no run holds it. */
export function heldLock() {
  try {
    return JSON.parse(readFileSync(join(TEST_DATA_DIR, 'run.lock'), 'utf8'))
  } catch {
    return null
  }
}
