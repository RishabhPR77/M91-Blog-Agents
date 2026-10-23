// A full pipeline run with fake AI over the real store and a fake Mem0 client that counts every request
// (Phase 9 A6). Real Scout, Strategist, Writer and Reviewer; the Reviewer fails v1, then passes v2.
// Requests are attributed to the step running at the time (step.started / step.finished events);
// requests outside a step are the run's own (run record, lock, orchestrator).
// Only stable engine APIs are used, so the same file also measures older code (the "before" numbers).
import { createStore, clearStoreCache } from '../../src/store.js'
import { createRunManager } from '../../src/runs.js'
import { createPublisher } from '../../src/publisher/index.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultAgents } from '../../src/orchestrator.js'
import { subscribe } from '../../src/events.js'
import { fakeConfig, memoryStore, fakeNotifier } from '../helpers.js'
import { fakeAi as scoutAi, fakeWeb, fakeChecker, LLMS } from '../scout/fixtures.js'
import { seededStore, fakeAi as strategistAi, CTA } from '../strategist/fixtures.js'
import { fakeAi as writerAi, draftAnswer, GOOD_MD } from '../writer/fixtures.js'
import { fakeReviewerAi, reviewAnswer, item } from '../reviewer/fixtures.js'
import { plainPlan } from './plain-plan.js'

const NOW = Date.parse('2026-10-17T08:35:00Z')
const STEPS = ['scout', 'strategist', 'writer', 'checks', 'reviewer', 'promo', 'designer', 'publisher']

/** A fake Mem0 account: sync adds answer results[].id and an event id (like the docs' infer=false answer). */
function countingMem0(count) {
  const memories = new Map()
  const ok = (m, f) => {
    if (f.AND) return f.AND.every((x) => ok(m, x))
    if (f.agent_id) return m.agentId === f.agent_id
    if (f.run_id) return m.runId === f.run_id
    if (f.metadata) return Object.entries(f.metadata).every(([k, v]) => String(m.metadata?.[k]) === String(v))
    return true
  }
  return {
    memories,
    async add(messages, o) {
      count('writes')
      const id = `uuid-${memories.size + 1}`
      memories.set(id, { id, memory: messages[0].content, metadata: o.metadata, agentId: o.agentId, runId: o.runId })
      return { message: 'ok', results: [{ id, event: 'ADD' }], event_id: `evt-${id}` }
    },
    async get(id) { count('reads'); return memories.get(id) },
    async update(id, body) {
      count('writes')
      const m = memories.get(id)
      if (body.text !== undefined) m.memory = body.text
      if (body.metadata) m.metadata = body.metadata
      return m
    },
    async getAll({ filters }) { count('reads'); return { next: null, results: [...memories.values()].filter((m) => ok(m, filters)) } },
    async search() { count('searches'); return { results: [] } },
    async delete(id) { count('writes'); memories.delete(id) }
  }
}

const PU = '{{POST_URL}}'
const PACK = {
  linkedin_post: `Agent approval pauses a risky step until a person says yes.
M91 rings the phone until someone answers. #AI
${PU}`,
  x_thread: ['A risky step can wait for a person.', 'The phone rings until someone answers.', `How it works: ${PU}`],
  newsletter_blurb: `Agent approval pauses a risky step until a person answers a phone call and decides. ${PU}`,
  video_script: [
    { on_screen_text: 'A risky step is coming', voiceover: 'Your software is about to do something risky.' },
    { on_screen_text: 'The phone rings', voiceover: 'A person answers and decides.' },
    { on_screen_text: `Read more: ${PU}`, voiceover: 'Read the full post.' }
  ],
  community_question: 'Which agent actions do you make wait for a person?'
}
const done = (opts, content) => ({ content: structuredClone(content), threadId: opts.threadId, messageId: 'm', finishReason: 'completed', model: 'fake', ms: 3, delivery: 'sync', parseFixes: [] })

/** A blog folder whose fake build renders every exported post, a fake deploy, and fetch serving that build. */
function fakeBlog(baseUrl) {
  const blogDir = mkdtempSync(join(tmpdir(), 'm91-fullrun-blog-'))
  mkdirSync(join(blogDir, 'src', 'config'), { recursive: true })
  writeFileSync(join(blogDir, 'src', 'config', 'site.ts'), `export const SITE_URL = '${baseUrl}'
`)
  const contentDir = join(blogDir, 'src', 'content', 'posts')
  const dist = join(blogDir, 'dist')
  let live = null
  const build = async () => {
    rmSync(dist, { recursive: true, force: true })
    mkdirSync(dist, { recursive: true })
    const posts = existsSync(contentDir) ? readdirSync(contentDir).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(readFileSync(join(contentDir, x), 'utf8'))) : []
    writeFileSync(join(dist, 'index.html'), posts.filter((p) => !p.noindex).map((p) => `<a href="/posts/${p.slug}/">${p.title}</a>`).join(''))
    for (const p of posts) {
      mkdirSync(join(dist, 'posts', p.slug), { recursive: true })
      writeFileSync(join(dist, 'posts', p.slug, 'index.html'), `${p.noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}<h1>${p.title}</h1>`)
    }
    return { ms: 1, dist }
  }
  const deployFn = async (dir) => { live = dir; return { status: 'live', app: 'm91-blog', polls: 0 } }
  const fetch = async (url) => {
    const file = join(live ?? '/none', new URL(url).pathname, 'index.html')
    return existsSync(file) ? { status: 200, ok: true, text: async () => readFileSync(file, 'utf8') } : { status: 404, ok: false, text: async () => '' }
  }
  return { blogDir, contentDir, build, deployFn, fetch }
}

/**
 * Runs one full pipeline and returns { status, byStep: { step: { reads, searches, writes } }, total, ai }.
 * env: extra settings (e.g. { DEDUPE_MODE: 'mem0' }).
 */
export async function measureFullRun(env = {}, { decisions = false } = {}) {
  clearStoreCache()
  const config = fakeConfig({ M91_DOCS_URL: LLMS, M91_CTA_URL: CTA, TARGET_WORDS_MIN: '180', TARGET_WORDS_MAX: '500', AI_MAX_RETRIES: '1', STORE_CACHE_TTL_MS: '30000', ...env })
  // A stack: the Writer's "checks" step runs inside the Writer step.
  const stack = []
  const byStep = {}
  const count = (kind) => {
    const step = stack.at(-1) ?? 'run'
    byStep[step] ??= { reads: 0, searches: 0, writes: 0 }
    byStep[step][kind]++
  }
  const mem0 = countingMem0(count)
  // The world before the run (the Strategist's fixtures): copied straight into Mem0, not counted.
  const seed = await seededStore()
  for (const r of seed.records.values()) mem0.memories.set(r.id, { id: r.id, memory: JSON.stringify(r.payload), metadata: r.metadata, agentId: config.mem0.agentId, runId: r.briefId ?? undefined })
  // Event polls (older code) are reads too.
  const fetch = async (url) => {
    count('reads')
    const id = String(url).match(/evt-(uuid-\d+)/)?.[1]
    return { ok: true, status: 200, json: async () => ({ status: 'SUCCEEDED', results: [{ id }] }), text: async () => '' }
  }
  const store = () => createStore({ config, clientFactory: async () => mem0, fetch, sleepFn: async () => {} })

  const ai = { scout: scoutAi(), strategist: strategistAi(), writer: writerAi({ revise: draftAnswer({ revision_notes: [{ feedback_quote: 'q', what_changed: 'w' }] }) }) }
  const quote = GOOD_MD.split('\n').find((l) => l.startsWith('Agent approval means')).split('. ')[0] + '.'
  ai.reviewer = fakeReviewerAi([reviewAnswer({ scores: { simplicity: 5 }, gates: { no_invented_content: false }, feedback: [item({ quote, severity: 'must' })] }), reviewAnswer()])
  ai.promo = async (opts) => done(opts, PACK)
  // Phase 10: the Experience Designer gets a plain guide (one chapter per H2, all prose) for every draft.
  ai.designer = async (opts) => done(opts, plainPlan(GOOD_MD, draftAnswer().title))
  const calls = { scout: 0, strategist: 0, writer: 0, reviewer: 0 }
  const aiSend = async (opts) => {
    const agent = opts.agent ?? String(opts.threadId).split('-')[0]
    calls[agent] = (calls[agent] ?? 0) + 1
    return ai[agent](opts)
  }
  const web = fakeWeb()
  const blog = fakeBlog(config.blog.baseUrl)
  const manager = createRunManager({
    publisherFactory: (rc, d) => createPublisher({ config: rc, ...d, fetch: blog.fetch, now: () => NOW, sleepFn: async () => {}, build: blog.build, deployFn: blog.deployFn, blogDir: blog.blogDir, contentDir: blog.contentDir }),
    config,
    now: () => NOW,
    storeFactory: () => store(),
    notifierFactory: () => fakeNotifier(),
    agentsFactory: (rc, d) => defaultAgents({ config: rc, ...d, agentDeps: { aiSend, fetch: web, urlChecker: fakeChecker({}), now: () => NOW } })
  })
  const off = subscribe((e) => {
    if (e.type === 'step.started' && STEPS.includes(e.step)) stack.push(e.step)
    if ((e.type === 'step.finished' || e.type === 'step.failed' || e.type === 'step.cancelled') && STEPS.includes(e.step)) {
      const i = stack.lastIndexOf(e.step)
      if (i >= 0) stack.splice(i, 1)
    }
  })
  try {
    const { run_id } = await manager.startRun({ mode: 'full' })
    const result = await manager.wait(run_id)
    const sum = () => {
      const t = { reads: 0, searches: 0, writes: 0 }
      for (const c of Object.values(byStep)) for (const k of Object.keys(t)) t[k] += c[k]
      return t
    }
    const types = {}
    for (const m of mem0.memories.values()) types[m.metadata?.type] = (types[m.metadata?.type] ?? 0) + 1
    const out = { status: result.status, summary: result.run?.result_summary ?? result.error, byStep: { ...byStep }, total: sum(), ai: { ...calls }, types }
    if (!decisions) return out
    // Decision runs on the same Mem0 account, each counted on its own (no engine index: each reads Mem0).
    const briefId = result.run?.brief_id
    out.decisions = {}
    const steps = [
      ['human_revise', { brief_id: briefId, feedback: 'Make the opening shorter and say who answers the call.' }],
      ['approve', { brief_id: briefId }],
      ['designer', { brief_id: briefId }],
      ['publish', { brief_id: briefId }],
      ['unpublish', null]
    ]
    for (const [mode, params0] of steps) {
      for (const k of Object.keys(byStep)) delete byStep[k]
      const before = { ...calls }
      let params = params0
      if (mode === 'unpublish') params = { slug: [...mem0.memories.values()].map((m) => JSON.parse(m.memory)).find((p) => p?.slug && p?.post)?.slug }
      const { run_id: id } = await manager.startRun({ mode, params })
      const r = await manager.wait(id)
      out.decisions[mode] = { status: r.status, summary: r.run?.result_summary ?? r.error, total: sum(), ai: Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, v - (before[k] ?? 0)]).filter(([, v]) => v)) }
    }
    rmSync(blog.blogDir, { recursive: true, force: true })
    // What Mem0 holds after the decisions (by type and status).
    out.typesAfter = {}
    for (const m of mem0.memories.values()) {
      const k = `${m.metadata?.type}:${m.metadata?.status}`
      out.typesAfter[k] = (out.typesAfter[k] ?? 0) + 1
    }
    return out
  } finally {
    off()
  }
}

/** A plain-text table of the counts. */
export function table(m) {
  const row = (name, c) => `${name.padEnd(12)} ${String(c.reads).padStart(5)} ${String(c.searches).padStart(8)} ${String(c.writes).padStart(6)} ${String(c.reads + c.searches + c.writes).padStart(6)}`
  return ['step         reads searches writes  total', ...Object.entries(m.byStep).map(([k, v]) => row(k, v)), row('TOTAL', m.total)].join('\n')
}

export { memoryStore }
