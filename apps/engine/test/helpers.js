// Shared fixtures for unit tests. All values are fake.

import { loadConfig } from '../src/config.js'

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
    async createRecord({ type, payload, briefId = null, status = null, version = null, topicGroup = null, date = '2026-10-17' }) {
      if (type === 'run_log') payload = { ...payload, dry_run: dryRun }
      if (dryRun && type !== 'run_log') return { id: `dryrun-${++seq}`, type, payload, briefId, status, version, topicGroup, date, dryRun: true }
      writes.create++
      const id = `mem-${++seq}`
      const record = { id, type, payload, briefId, status, version, topicGroup, date, metadata: { type, brief_id: briefId, status, version, topic_group: topicGroup, date } }
      records.set(id, record)
      return record
    },
    async updateRecord(id, payload, metadata = {}) {
      if (dryRun) return { id, payload, metadata, dryRun: true }
      writes.update++
      const r = records.get(id)
      Object.assign(r, { payload: payload ?? r.payload, metadata: { ...r.metadata, ...metadata } })
      if (metadata.status) r.status = metadata.status
      return r
    },
    async searchSimilar(text, filters = {}) {
      return [...records.values()].filter((r) => matches(r, { type: filters.type })).map((r) => ({ ...r, score: score(text, r) }))
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
