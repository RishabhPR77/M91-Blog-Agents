// HTTP server.
//   GET  /health, POST /run (x-trigger-key)  — manual runs from a terminal or a cloud trigger
//   /api/*                                   — dashboard API (Phase 3.5, Task 5)
//   GET  anything else                       — the built dashboard (dashboard/dist, Phase 6), SPA fallback
// With DASHBOARD_AUTH=false the server binds to 127.0.0.1 only and /api needs no login.

import http from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { getConfig, ConfigError } from './config.js'
import { log, mask, registerSecrets, setLevel } from './util/log.js'
import { createRunManager, RunError, RUN_ID_RE, BUILT_MODES, PUBLISH_MODES, DECISION_MODES } from './runs.js'
import { getStore, RECORD_TYPES } from './store.js'
import { replay, subscribe, TERMINAL_TYPES } from './events.js'
import { listPins, addPin, cancelPin, PinError } from './pins.js'
import { draftsOf, draftVersion, draftBriefVersion } from './writer/save.js'
import { BRIEF_ID_RE } from './util/ids.js'
import { reviewOfDraft, hardChecksPassed } from './approval.js'
import { lessonText } from './lessons.js'
import { isInteractive, latestGuideDoc } from './experience/index.js'
import { buildPreview, readPreview, previewDir, PREVIEW_ROOT, PreviewError } from './publisher/preview.js'
import { withMem0Count, mem0Requests } from './util/mem0count.js'
import { createEngineIndex } from './engineindex.js'
import { usageStatus, stopMessage } from './util/mem0usage.js'

const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch {
    return 'unknown'
  }
})()

/** Constant-time comparison; hashing first makes lengths equal so length isn't leaked either. */
export function keysMatch(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Non-secret settings, built from an allowlist (never secrets, never URLs carrying keys). */
export function publicSettings(config) {
  const agent = (a) => ({ service: a.service, model: a.model, delivery: a.delivery })
  const sc = config.scout
  const st = config.strategist
  return {
    version: VERSION,
    models: {
      scout: { ...agent(sc), research_delivery: sc.researchDelivery },
      strategist: agent(st), writer: agent(config.writer), reviewer: agent(config.reviewer), promo: agent(config.promo),
      ...(config.designer && { designer: agent(config.designer) })
    },
    scout: {
      max_calls: sc.maxCalls, reuse_hours: sc.reuseHours, min_open_clusters: sc.minOpenClusters, questions_per_group: sc.questionsPerGroup,
      question_groups: sc.questionGroups, story_lookback_days: sc.storyLookbackDays, rapid_response_days: sc.rapidResponseDays,
      style_reuse_days: sc.styleReuseDays, docs_max_pages: sc.docsMaxPages, docs_max_chars: sc.docsMaxChars, dedupe_similarity: sc.dedupeSimilarity, dedupe_mode: sc.dedupeMode, dedupe_similarity_local: sc.dedupeSimilarityLocal
    },
    strategist: {
      max_repairs: st.maxRepairs, recent_briefs_window: st.recentBriefsWindow, title_max_chars: st.titleMaxChars,
      outline_sections: [st.outlineMinSections, st.outlineMaxSections], min_question_headings: st.minQuestionHeadings, allow_update_briefs: st.allowUpdateBriefs
    },
    gates: { pass_score_min: config.gates.passScoreMin, pass_area_min: config.gates.passAreaMin },
    limits: {
      max_writer_revisions: config.limits.maxWriterRevisions, max_strategist_rebriefs: config.limits.maxStrategistRebriefs,
      max_scout_retries: config.limits.maxScoutRetries, max_ai_rounds_per_post: config.limits.maxAiRoundsPerPost
    },
    content: {
      target_words: [config.content.targetWordsMin, config.content.targetWordsMax], default_tone: config.content.defaultTone,
      timezone: config.content.timezone, reading_grade_intro_max: config.content.readingGradeIntroMax, reading_grade_post_max: config.content.readingGradePostMax
    },
    runtime: { dry_run: config.runtime.dryRun, auto_publish: config.runtime.autoPublish, log_level: config.runtime.logLevel },
    dashboard: { auth: Boolean(config.dashboard?.auth), port: config.dashboard?.port ?? null },
    approval: config.approval && {
      max_human_revisions: config.approval.maxHumanRevisions, rereview_after_human: config.approval.rereviewAfterHuman,
      m91_notify_on_awaiting: config.approval.notifyOnAwaiting
    },
    // The blog and the Publisher (Phase 7): whether a deploy token is set, never its value.
    blog: config.blog && {
      auto_publish: config.runtime.autoPublish, app_name: config.blog.appName, base_url: config.blog.baseUrl,
      noindex_first_n_posts: config.blog.noindexFirstNPosts, deploy_token_set: Boolean(config.blog.embarkoDeployToken)
    },
    // Interactive guides (Phase 10): the Experience Designer's limits, whether new posts get a guide, the promo pack.
    designer: config.designer && {
      max_components: config.designer.maxComponents, max_repairs: config.designer.maxRepairs, interactive_default: config.designer.interactiveDefault,
      max_designer_revisions: config.limits?.maxDesignerRevisions ?? null, promo_enabled: Boolean(config.promo?.enabled)
    },
    built_modes: [...BUILT_MODES],
    decision_modes: [...DECISION_MODES],
    publish_modes: [...PUBLISH_MODES]
  }
}

const TITLE_OF = (p = {}) => p.titles?.[0] ?? p.title ?? p.main_question ?? p.topic ?? p.call ?? p.result_summary ?? null
const KEY_ID_OF = (p = {}) => p.brief_id ?? p.cluster_id ?? p.story_id ?? p.tutorial_id ?? p.profile_id ?? p.pinned_id ?? p.run_id ?? null

/** A record with its payload trimmed to key fields. */
export function trimRecord(r) {
  // A lesson is plain text, not JSON: its text is the title.
  const title = r.type === 'lesson' ? lessonText(r).slice(0, 300) : TITLE_OF(r.payload ?? {})
  return { id: r.id, type: r.type, status: r.status ?? null, brief_id: r.briefId ?? null, date: r.date ?? null, topic_group: r.topicGroup ?? null, version: r.version ?? null, key_id: KEY_ID_OF(r.payload ?? {}), title }
}

const runSummary = (r) => {
  const p = r.payload ?? {}
  return {
    record_id: r.id, run_id: p.run_id, mode: p.mode, trigger: p.trigger, dry_run: Boolean(p.dry_run), status: p.status ?? r.status,
    started_at: p.started_at, finished_at: p.finished_at, ms: p.ms, brief_id: p.brief_id ?? null, result_summary: p.result_summary ?? '',
    steps: (p.steps ?? []).map((s) => ({ name: s.name, status: s.status, ms: s.ms, ai_calls: s.ai_calls }))
  }
}

// ---------- the built dashboard (Phase 6) ----------

export const DEFAULT_DASHBOARD_DIR = fileURLToPath(new URL('../dashboard/dist', import.meta.url))

/** Headers on every dashboard file: no inline scripts, same-origin API only, never framed. */
export const DASHBOARD_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin'
})

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8'
}

export const NOT_BUILT_TEXT = 'Dashboard not built. Run `npm run build:dashboard`.\n'

/** A file inside dir for a URL path, or null when the path escapes dir or is malformed. */
export function resolveInside(dir, urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const root = resolve(dir)
  const file = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`)
  return file === root || file.startsWith(root + sep) ? file : null
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

/**
 * Serves the built dashboard for a GET/HEAD request. Returns false when it did not answer (the caller sends
 * its own 404). Hashed files under /assets/ are cached for a year; index.html never.
 */
export async function serveDashboard(req, res, url, dir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const index = resolve(dir, 'index.html')
  const built = await isFile(index)
  if (!built) {
    if (url.pathname !== '/') return false
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...DASHBOARD_HEADERS })
    res.end(req.method === 'HEAD' ? undefined : NOT_BUILT_TEXT)
    return true
  }
  let file = url.pathname === '/' ? index : resolveInside(dir, url.pathname)
  if (!file) return false
  if (!(await isFile(file))) {
    // SPA fallback for app routes (/approvals/…); a missing file with an extension is a real 404.
    if (extname(url.pathname)) return false
    file = index
  }
  const body = await readFile(file)
  const hashed = url.pathname.startsWith('/assets/') && file !== index
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...DASHBOARD_HEADERS
  })
  res.end(req.method === 'HEAD' ? undefined : body)
  return true
}

const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]))

/**
 * @param {{ triggerKey, run?, manager?, store?, config?, now?, keepAliveMs?, sessionMs?, dashboardDir? }} deps
 *   `run` alone keeps the Phase 1 behaviour (POST /run runs it); with `manager`, /run and /api use the run manager.
 *   dashboardDir: the built dashboard (default dashboard/dist); null serves none.
 */
export function createServer({ triggerKey, run, manager, store, config, now = Date.now, keepAliveMs = 15000, sessionMs = 12 * 3600 * 1000, dashboardDir = DEFAULT_DASHBOARD_DIR, previewRoot = PREVIEW_ROOT, previewDeps = {} } = {}) {
  let legacyRunning = null
  // Phase 10 D1: one page preview build at a time (it uses the blog's build folder like the Publisher).
  let previewBuilding = null
  // Phase 9 A4: every API read goes through the engine's index (0 Mem0 requests once a type is loaded),
  // and the run manager's checks and runs start from it too.
  if (store && !store.isIndex) store = createEngineIndex(store, { config, now })
  manager?.useIndex?.(store)
  const auth = Boolean(config?.dashboard?.auth)
  const password = config?.dashboard?.password ?? ''
  const sessions = new Map() // token → expires at
  const loginTries = new Map() // ip → [timestamps]
  const streams = new Set()

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
    res.end(JSON.stringify(mask(body)))
  }
  const fail = (res, status, code, message) => send(res, status, { error: { code, message } })
  const isRunning = () => (manager ? manager.isRunning() : Boolean(legacyRunning))

  /**
   * GET /api/approvals/:brief_id — the newest draft in full, its review, its check results, and the earlier
   * versions (title, status, score, human feedback) for comparison. 404 when the brief has no draft.
   */
  async function approvalDetail(briefId) {
    const drafts = await draftsOf(store, briefId)
    if (!drafts.length) throw new ApiError(404, 'not_found', `no draft of brief ${briefId}`)
    const reviews = await store.getRecords({ type: 'review', brief_id: briefId })
    const reviewOf = (d) => reviews
      .filter((r) => Number(r.payload?.version ?? r.version) === draftVersion(d) && Number(r.payload?.brief_version ?? r.metadata?.brief_version ?? 1) === draftBriefVersion(d))
      .sort((a, b) => String(b.createdAt ?? b.date).localeCompare(String(a.createdAt ?? a.date)))[0]?.payload ?? null
    const [d, ...earlier] = drafts
    const p = d.payload ?? {}
    const review = reviewOf(d)
    // reviewed: the newest review of this version is a pass (the approve rule, Phase 5.5).
    const reviewed = (await reviewOfDraft(store, d))?.payload?.pass === true
    // Interactive guide (Phase 10): the switch and the newest Experience Designer result for this version (one guide_doc read).
    const doc = config?.designer ? await latestGuideDoc(store, briefId, draftVersion(d), draftBriefVersion(d)) : null
    const dp = doc?.payload ?? {}
    return {
      brief_id: briefId,
      draft: {
        record_id: d.id, version: draftVersion(d), brief_version: draftBriefVersion(d), status: d.status, waiting_since: d.metadata?.awaiting_since ?? null,
        title: p.title, tldr: p.tldr, seo: p.seo, post_markdown: p.post_markdown, word_count: p.word_count, reading: p.reading,
        revision_notes: p.revision_notes ?? [], model_used: p.model_used ?? null,
        reviewed, hard_passed: hardChecksPassed(d), approved_unreviewed: d.metadata?.approved_unreviewed ?? null
      },
      review: review && { total: review.total, pass: review.pass, gates: review.gates, areas: review.areas, feedback: review.feedback, summary: review.summary, sources_checked: review.sources_checked },
      checks: p.checks?.results ?? [],
      // Phase 10 D1: the page preview built for this brief, if any (read from disk, no Mem0).
      preview: readPreview(briefId, previewRoot),
      // Counter prompts used for this brief: writing changes (human_feedback) and design changes (C5).
      revisions_used: drafts.filter((x) => x.payload?.human_feedback).length + drafts.reduce((n, x) => n + (x.payload?.design_feedback?.length ?? 0), 0),
      interactive: config?.designer ? {
        on: isInteractive(d, config), default: config.designer.interactiveDefault, set: typeof d.metadata?.interactive === 'boolean',
        guide_doc: doc && {
          record_id: doc.id, status: doc.status ?? null, summary: dp.summary ?? '', chapters: dp.guide?.chapters?.length ?? 0,
          components: (dp.guide?.chapters ?? []).flatMap((c) => c.components).filter((x) => x.type !== 'prose').length,
          dropped: dp.dropped?.length ?? 0, coverage_passed: dp.coverage?.passed ?? null, created_at: dp.created_at ?? null
        }
      } : null,
      earlier: earlier.map((e) => ({
        version: draftVersion(e), brief_version: draftBriefVersion(e), status: e.status, title: e.payload?.title ?? '',
        // score and total are the same number (total is the dashboard's name; score kept for older callers).
        ...(() => { const t = reviewOf(e)?.total ?? e.metadata?.review_total ?? null; return { score: t, total: t } })(),
        human_feedback: e.payload?.human_feedback ?? null, record_id: e.id
      }))
    }
  }

  async function readJson(req) {
    const chunks = []
    let size = 0
    for await (const c of req) {
      size += c.length
      if (size > 64 * 1024) throw new ApiError(413, 'too_large', 'request body is larger than 64 KB')
      chunks.push(c)
    }
    if (!size) return {}
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
      return v
    } catch {
      throw new ApiError(400, 'bad_json', 'request body must be a JSON object')
    }
  }

  function authed(req) {
    if (!auth) return true
    const token = parseCookies(req.headers.cookie).m91_session
    const exp = token && sessions.get(token)
    if (!exp) return false
    if (exp <= now()) {
      sessions.delete(token)
      return false
    }
    return true
  }

  function openStream(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.write(': connected\n\n')
    const stream = { res, timer: setInterval(() => res.write(': keep-alive\n\n'), keepAliveMs), off: null }
    streams.add(stream)
    const close = () => {
      clearInterval(stream.timer)
      stream.off?.()
      streams.delete(stream)
      res.end()
    }
    req.on('close', close)
    const write = (e) => res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    return { write, close, stream }
  }

  /** A run record by run_id: run records are stored under run_id = <run id>, so this is one small filtered read. */
  async function findRun(runId) {
    return (await store.getRecords({ type: 'run', brief_id: runId })).find((r) => r.payload?.run_id === runId) ?? null
  }

  async function producedRecords(run) {
    const ids = new Set((run.payload?.steps ?? []).flatMap((s) => s.record_ids ?? []))
    if (run.payload?.brief_id) ids.add(run.payload.brief_id)
    if (!ids.size) return []
    // One filtered (and cached) read per type, in parallel.
    const types = ['m91_facts', 'question_cluster', 'story_lead', 'tutorial_lead', 'tone_profile', 'brief', 'source_pack', 'draft', 'review', 'block_doc', 'guide_doc']
    const lists = await Promise.all(types.map((type) => store.getRecords({ type })))
    return lists.flat().filter((r) => ids.has(r.id) || ids.has(KEY_ID_OF(r.payload))).map(trimRecord)
  }

  async function api(req, res, url) {
    const path = url.pathname
    const method = req.method
    const seg = path.split('/').filter(Boolean) // ['api', ...]

    // Health never touches Mem0: the index's age and whether another process changed Mem0 since it loaded.
    if (method === 'GET' && path === '/api/health') {
      const u = config ? usageStatus(config, { now }) : null
      return send(res, 200, { ok: true, version: VERSION, run_in_progress: isRunning(), ...(store?.isIndex && { index: store.status() }), ...(u && { mem0_usage: { month: u.month, used: u.used, limit: u.limit, pct: u.pct, level: u.level, warn_pct: u.warn_pct, stop_pct: u.stop_pct, resets_on: u.resets_on, total: u.total } }) })
    }

    if (path === '/api/login' && method === 'POST') {
      if (!auth) return fail(res, 400, 'auth_off', 'login is not needed: DASHBOARD_AUTH is false')
      const ip = req.socket.remoteAddress ?? 'unknown'
      const recent = (loginTries.get(ip) ?? []).filter((t) => now() - t < 60000)
      if (recent.length >= 5) return fail(res, 429, 'too_many_attempts', 'too many login attempts; wait a minute')
      recent.push(now())
      loginTries.set(ip, recent)
      const body = await readJson(req)
      if (!keysMatch(body.password, password)) return fail(res, 401, 'bad_password', 'wrong password')
      const token = randomBytes(32).toString('hex')
      sessions.set(token, now() + sessionMs)
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
      return send(res, 200, { ok: true }, { 'set-cookie': `m91_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionMs / 1000)}${secure}` })
    }
    if (path === '/api/logout' && method === 'POST') {
      const token = parseCookies(req.headers.cookie).m91_session
      if (token) sessions.delete(token)
      return send(res, 200, { ok: true }, { 'set-cookie': 'm91_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' })
    }

    if (!authed(req)) return fail(res, 401, 'unauthorized', 'log in first (POST /api/login)')
    if (!manager || !store) return fail(res, 503, 'not_ready', 'the run manager is not available')

    // Runs
    if (path === '/api/runs' && method === 'POST') {
      const body = await readJson(req)
      if (body.mode !== undefined && typeof body.mode !== 'string') throw new ApiError(400, 'bad_mode', 'mode must be a string')
      if (body.dry_run !== undefined && typeof body.dry_run !== 'boolean') throw new ApiError(400, 'bad_params', 'dry_run must be true or false')
      if (body.params !== undefined && (typeof body.params !== 'object' || Array.isArray(body.params) || body.params === null)) throw new ApiError(400, 'bad_params', 'params must be an object')
      const { run_id } = await manager.startRun({ mode: body.mode ?? 'full', trigger: 'manual', dryRun: body.dry_run, params: body.params ?? {} })
      return send(res, 202, { run_id })
    }
    if (path === '/api/runs' && method === 'GET') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20))
      const runs = (await store.getRecords({ type: 'run' })).sort((a, b) => String(b.payload?.started_at).localeCompare(String(a.payload?.started_at))).slice(0, limit)
      return send(res, 200, { runs: runs.map(runSummary) })
    }
    if (seg[1] === 'runs' && seg[2]) {
      const runId = seg[2]
      if (!RUN_ID_RE.test(runId)) throw new ApiError(400, 'bad_run_id', 'run_id must look like R-YYMMDD-HHMM-XXXX')
      if (seg[3] === 'cancel' && method === 'POST' && seg.length === 4) {
        if (manager.cancelRun(runId)) return send(res, 202, { run_id: runId, cancelling: true })
        return fail(res, 409, 'not_running', `run ${runId} is not running`)
      }
      if (seg[3] === 'events' && method === 'GET' && seg.length === 4) {
        const buffered = replay(runId)
        if (!buffered.length && manager.activeRunId() !== runId && !(await findRun(runId))) return fail(res, 404, 'not_found', `no run ${runId}`)
        const s = openStream(req, res)
        for (const e of buffered) s.write(e)
        if (buffered.some((e) => TERMINAL_TYPES.includes(e.type)) || (manager.activeRunId() !== runId)) return s.close()
        const lastSeq = buffered.at(-1)?.seq ?? 0
        s.stream.off = subscribe((e) => {
          if (e.seq <= lastSeq) return
          s.write(e)
          if (TERMINAL_TYPES.includes(e.type)) s.close()
        }, { runId })
        return
      }
      if (method === 'GET' && seg.length === 3) {
        const runRec = await findRun(runId)
        if (!runRec) return fail(res, 404, 'not_found', `no run ${runId}`)
        return send(res, 200, { run: { record_id: runRec.id, ...runRec.payload, status: runRec.payload?.status ?? runRec.status }, records: await producedRecords(runRec) })
      }
    }
    if (path === '/api/events' && method === 'GET') {
      const s = openStream(req, res)
      s.stream.off = subscribe((e) => s.write(e))
      return
    }

    // Phase 10 D1: the page preview of a brief's newest draft. POST builds it (no AI, nothing saved or deployed);
    // GET returns what was built. It is served at /preview/<brief_id>/.
    if (seg[1] === 'approvals' && seg[2] && seg[3] === 'preview' && seg.length === 4) {
      const briefId = seg[2]
      if (!BRIEF_ID_RE.test(briefId)) throw new ApiError(400, 'bad_brief_id', 'brief_id must look like YYMMDD-HHMM-XXXX')
      if (method === 'GET') {
        const m = readPreview(briefId, previewRoot)
        return m ? send(res, 200, m) : fail(res, 404, 'not_found', `no preview of ${briefId} yet`)
      }
      if (method === 'POST') {
        if (isRunning()) throw new ApiError(409, 'run_in_progress', 'a run is in progress: build the preview when it has finished')
        if (previewBuilding) throw new ApiError(409, 'preview_in_progress', `a preview of ${previewBuilding} is being built`)
        previewBuilding = briefId
        try {
          return send(res, 200, await buildPreview({ briefId, store, config, now, root: previewRoot, ...previewDeps }))
        } catch (error) {
          if (error instanceof PreviewError) throw new ApiError(error.status, error.code, error.message)
          throw new ApiError(500, 'preview_failed', `the preview could not be built: ${error.message}`)
        } finally {
          previewBuilding = null
        }
      }
    }

    // Approvals (Phase 5.5 B7): drafts waiting for the human, and the human's three decisions.
    if (path === '/api/approvals' && method === 'GET') {
      const waiting = (await store.getRecords({ type: 'draft', status: 'awaiting_human' }))
        .sort((a, b) => String(a.metadata?.awaiting_since).localeCompare(String(b.metadata?.awaiting_since)))
        .map((d) => ({
          brief_id: d.briefId, version: d.version, brief_version: d.metadata?.brief_version ?? d.payload?.brief_version ?? 1,
          title: d.payload?.title ?? '', total: d.metadata?.review_total ?? null, waiting_since: d.metadata?.awaiting_since ?? null, record_id: d.id
        }))
      return send(res, 200, { approvals: waiting })
    }
    if (seg[1] === 'approvals' && seg[2]) {
      const briefId = seg[2]
      if (!BRIEF_ID_RE.test(briefId)) throw new ApiError(400, 'bad_brief_id', 'brief_id must look like YYMMDD-HHMM-XXXX')
      if (seg.length === 3 && method === 'GET') return send(res, 200, await approvalDetail(briefId))
      const action = { approve: 'approve', revise: 'human_revise', reject: 'reject_topic', review: 'approval_review' }[seg[3]]
      if (action && seg.length === 4 && method === 'POST') {
        const body = await readJson(req)
        // Optional one-run settings (e.g. { rereview_after_human: false }); configForRun validates them.
        if (body.params !== undefined && (typeof body.params !== 'object' || Array.isArray(body.params) || body.params === null)) throw new ApiError(400, 'bad_params', 'params must be an object')
        const params = { ...(body.params ?? {}), brief_id: briefId }
        delete params.feedback
        delete params.quotes
        delete params.reason
        delete params.force_unreviewed
        delete params.target
        // C5: target "writing" (default: Writer, then the Experience Designer) or "design" (the Experience Designer only).
        if (action === 'human_revise') Object.assign(params, { feedback: body.feedback, ...(body.quotes !== undefined && { quotes: body.quotes }), ...(body.target !== undefined && { target: body.target }) })
        if (action === 'reject_topic' && body.reason !== undefined) params.reason = body.reason
        if (action === 'approve' && body.force_unreviewed !== undefined) params.force_unreviewed = body.force_unreviewed
        const { run_id } = await manager.startRun({ mode: action, trigger: 'manual', params })
        return send(res, 202, { run_id })
      }
    }

    // The interactive guide on or off for a brief's newest draft: stored on the draft as metadata.interactive.
    // It takes effect at the next Experience Designer run or publish; it never starts a run itself.
    if (seg[1] === 'drafts' && seg[2] && seg[3] === 'interactive' && seg.length === 4 && method === 'POST') {
      const briefId = seg[2]
      if (!BRIEF_ID_RE.test(briefId)) throw new ApiError(400, 'bad_brief_id', 'brief_id must look like YYMMDD-HHMM-XXXX')
      const body = await readJson(req)
      if (typeof body.on !== 'boolean') throw new ApiError(400, 'bad_params', 'on must be true or false')
      if (isRunning()) throw new ApiError(409, 'run_in_progress', 'a run is in progress: try again when it has finished')
      const [d] = await draftsOf(store, briefId)
      if (!d) throw new ApiError(404, 'not_found', `no draft of brief ${briefId}`)
      const saved = await store.updateRecord(d.id, undefined, { interactive: body.on })
      return send(res, 200, { brief_id: briefId, version: draftVersion(d), on: body.on, saved: !saved?.dryRun })
    }

    // Records
    if (path === '/api/records' && method === 'GET') {
      const type = url.searchParams.get('type') || undefined
      if (type && !RECORD_TYPES.includes(type)) throw new ApiError(400, 'bad_type', `type must be one of ${RECORD_TYPES.join(', ')}`)
      const status = url.searchParams.get('status') || undefined
      const briefId = url.searchParams.get('brief_id') || undefined
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50))
      const records = (await store.getRecords({ ...(type && { type }), ...(status && { status }), ...(briefId && { brief_id: briefId }) }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, limit)
      return send(res, 200, { records: records.map(trimRecord) })
    }
    if (seg[1] === 'records' && seg[2] && seg.length === 3 && method === 'GET') {
      const r = await store.getRecord(seg[2])
      if (!r) return fail(res, 404, 'not_found', `no record ${seg[2]}`)
      return send(res, 200, { record: r })
    }

    // Refresh from Mem0 (Phase 9 A4): reload every type the index holds (one read per type).
    if (path === '/api/index/refresh' && method === 'POST') {
      if (isRunning()) throw new ApiError(409, 'run_in_progress', 'a run is in progress: refresh when it has finished')
      const u = usageStatus(config, { now })
      if (u.level === 'stop') throw new ApiError(429, 'mem0_quota', stopMessage(u))
      return send(res, 200, { index: await store.refresh() })
    }

    // Settings
    if (path === '/api/settings' && method === 'GET') return send(res, 200, publicSettings(config))
    // Phase 7: the published posts for the dashboard's Posts page (never the post text).
    if (path === '/api/posts' && method === 'GET') {
      const posts = (await store.getRecords({ type: 'published_post' })).map((r) => {
        const p = r.payload ?? {}
        return {
          record_id: r.id, slug: p.slug ?? p.post?.slug ?? null, title: p.title ?? p.post?.title ?? '', status: r.status, noindex: Boolean(p.noindex ?? p.post?.noindex),
          url: p.url ?? p.post?.canonical_url ?? null, brief_id: p.brief_id ?? r.briefId ?? null, version: p.version ?? null, topic_group: p.topic_group ?? null,
          published_at: p.post?.published_at ?? null, updated_at: p.post?.updated_at ?? null, deployed_at: p.deployed_at ?? null, last_error: p.last_error ?? null,
          blocks: Array.isArray(p.post?.blocks) ? p.post.blocks.length : 0
        }
      }).sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
      return send(res, 200, { posts })
    }

    // Lessons (Phase 6): the dashboard can delete one; only lesson records.
    if (seg[1] === 'lessons' && seg[2] && seg.length === 3 && method === 'DELETE') {
      const r = await store.getRecord(seg[2])
      if (!r || r.type !== 'lesson') return fail(res, 404, 'not_found', `no lesson ${seg[2]}`)
      await store.deleteRecord(r.id)
      return send(res, 200, { deleted: r.id })
    }

    // Pinned topics
    if (path === '/api/pinned' && method === 'GET') return send(res, 200, { pinned: await listPins(store) })
    if (path === '/api/pinned' && method === 'POST') {
      const body = await readJson(req)
      const { pin, saved } = await addPin(store, { topic: body.topic, date: body.target_date ?? body.date, priority: body.priority, notes: body.notes })
      return send(res, saved ? 201 : 200, { pinned: pin, saved })
    }
    if (seg[1] === 'pinned' && seg[2] && seg.length === 3 && method === 'DELETE') return send(res, 200, { pinned: await cancelPin(store, seg[2]) })

    return fail(res, 404, 'not_found', `no route ${method} ${path}`)
  }

  // Mem0 calls per API request: logged when the response ends (path and method only; never headers).
  // A run started by a request counts in its own scope, not here.
  const server = http.createServer((req, res) => {
    const started = now()
    const { counts, result } = withMem0Count(() => handle(req, res))
    res.on('finish', () => {
      if (!req.url?.startsWith('/api/')) return
      const requests = mem0Requests(counts)
      const line = { method: req.method, path: new URL(req.url, 'http://localhost').pathname, status: res.statusCode, ms: now() - started, mem0: { ...counts, requests } }
      if (requests || counts.cache_hits) log.info('api Mem0 calls', line)
      else log.debug('api Mem0 calls', line)
    })
    return result
  })

  /**
   * Phase 10 D1: GET /preview/<brief_id>/… — the built preview. Never indexed, never cached, framed only by the
   * dashboard (same origin); with DASHBOARD_AUTH=true it needs the dashboard session like the API.
   */
  async function servePreview(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    const [, , briefId, ...rest] = url.pathname.split('/')
    if (!BRIEF_ID_RE.test(briefId ?? '')) return false
    const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'content-security-policy': "frame-ancestors 'self'" }
    if (!authed(req)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', ...headers })
      res.end('Log in to the dashboard first.\n')
      return true
    }
    const dist = join(previewDir(briefId, previewRoot), 'dist')
    let file = resolveInside(dist, `/${rest.join('/')}`)
    if (file && (await isDir(file))) file = join(file, 'index.html')
    if (!file || !(await isFile(file))) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...headers })
      res.end('No preview page here. Build it with "Preview the page" on the approval screen.\n')
      return true
    }
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': body.length, ...headers })
    res.end(req.method === 'HEAD' ? undefined : body)
    return true
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url)
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, running: isRunning() })
      if (url.pathname === '/run') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
        if (!keysMatch(req.headers['x-trigger-key'], triggerKey)) return send(res, 401, { error: 'unauthorized' })
        if (manager) {
          const { run_id } = await manager.startRun({ mode: 'full', trigger: 'api' })
          return send(res, 202, { accepted: true, run_id })
        }
        if (legacyRunning) return send(res, 409, { error: 'a run is already in progress' })
        legacyRunning = Promise.resolve()
          .then(run)
          .then((result) => log.info('background run finished', { briefId: result?.briefId, state: result?.state }))
          .catch((error) => log.error('background run crashed', { error }))
          .finally(() => { legacyRunning = null })
        return send(res, 202, { accepted: true })
      }
      if (url.pathname.startsWith('/preview/') && (await servePreview(req, res, url))) return
      if (dashboardDir && (await serveDashboard(req, res, url, dashboardDir))) return
      return send(res, 404, { error: 'not found' })
    } catch (error) {
      if (res.headersSent) return res.end()
      if (error instanceof RunError || error instanceof PinError || error instanceof ApiError) {
        if (url.pathname === '/run') return send(res, error.status, { error: error.message })
        return fail(res, error.status ?? 400, error.code ?? 'bad_request', error.message)
      }
      log.error('request failed', { path: url.pathname, error })
      return fail(res, 500, 'internal', 'internal error')
    }
  }
  server.isRunning = isRunning
  server.index = store?.isIndex ? store : null
  // Close open event streams so the server can stop cleanly.
  const close = server.close.bind(server)
  server.close = (cb) => {
    for (const s of streams) {
      clearInterval(s.timer)
      s.off?.()
      s.res.end()
    }
    streams.clear()
    server.index?.close?.()
    return close(cb)
  }
  return server
}

async function main() {
  let config
  try {
    config = getConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message)
      process.exit(2)
    }
    throw error
  }
  registerSecrets(config.secretValues)
  setLevel(config.runtime.logLevel)
  if (!config.runtime.triggerKey || config.runtime.triggerKey.length < 16) {
    console.error('Invalid configuration:\n  - PIPELINE_TRIGGER_KEY: required for the server, at least 16 characters')
    process.exit(2)
  }
  const store = getStore()
  const manager = createRunManager({ config })
  const server = createServer({ triggerKey: config.runtime.triggerKey, manager, store, config })
  // Load the dashboard's lists once at start (one read per type); later writes keep them current.
  try {
    await server.index.build()
  } catch (error) {
    log.error('index not loaded at start; types load on first use', { error })
  }
  const port = config.server?.port ?? (Number(process.env.PORT) || 8080)
  // Without dashboard auth the API is for this machine only.
  const host = config.dashboard?.auth ? '0.0.0.0' : '127.0.0.1'
  server.listen(port, host, () => log.info('server listening', { host, port, dryRun: config.runtime.dryRun, dashboardAuth: Boolean(config.dashboard?.auth) }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
