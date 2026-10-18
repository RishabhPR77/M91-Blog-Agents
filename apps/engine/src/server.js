// HTTP server.
//   GET  /health, POST /run (x-trigger-key)  — kept for cloud schedulers (Phase 1)
//   /api/*                                   — dashboard API (Phase 3.5, Task 5)
// With DASHBOARD_AUTH=false the server binds to 127.0.0.1 only and /api needs no login.

import http from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getConfig, ConfigError } from './config.js'
import { log, mask, registerSecrets, setLevel } from './util/log.js'
import { createRunManager, RunError, RUN_ID_RE } from './runs.js'
import { getStore, RECORD_TYPES } from './store.js'
import { replay, subscribe, TERMINAL_TYPES } from './events.js'
import { listPins, addPin, cancelPin, PinError } from './pins.js'

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
export function publicSettings(config, schedule = null) {
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
      style_reuse_days: sc.styleReuseDays, docs_max_pages: sc.docsMaxPages, docs_max_chars: sc.docsMaxChars, dedupe_similarity: sc.dedupeSimilarity
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
    schedule: schedule ?? { enabled: config.schedule?.enabled ?? false, cron: config.schedule?.cron ?? null, next_run_at: null },
    dashboard: { auth: Boolean(config.dashboard?.auth), port: config.dashboard?.port ?? null }
  }
}

const TITLE_OF = (p = {}) => p.titles?.[0] ?? p.title ?? p.main_question ?? p.topic ?? p.call ?? p.result_summary ?? null
const KEY_ID_OF = (p = {}) => p.brief_id ?? p.cluster_id ?? p.story_id ?? p.tutorial_id ?? p.profile_id ?? p.pinned_id ?? p.run_id ?? null

/** A record with its payload trimmed to key fields. */
export function trimRecord(r) {
  return { id: r.id, type: r.type, status: r.status ?? null, brief_id: r.briefId ?? null, date: r.date ?? null, topic_group: r.topicGroup ?? null, version: r.version ?? null, key_id: KEY_ID_OF(r.payload), title: TITLE_OF(r.payload) }
}

const runSummary = (r) => {
  const p = r.payload ?? {}
  return {
    record_id: r.id, run_id: p.run_id, mode: p.mode, trigger: p.trigger, dry_run: Boolean(p.dry_run), status: p.status ?? r.status,
    started_at: p.started_at, finished_at: p.finished_at, ms: p.ms, brief_id: p.brief_id ?? null, result_summary: p.result_summary ?? '',
    steps: (p.steps ?? []).map((s) => ({ name: s.name, status: s.status, ms: s.ms, ai_calls: s.ai_calls }))
  }
}

const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]))

/**
 * @param {{ triggerKey, run?, manager?, store?, config?, scheduler?, now?, keepAliveMs?, sessionMs? }} deps
 *   `run` alone keeps the Phase 1 behaviour (POST /run runs it); with `manager`, /run and /api use the run manager.
 */
export function createServer({ triggerKey, run, manager, store, config, scheduler, now = Date.now, keepAliveMs = 15000, sessionMs = 12 * 3600 * 1000 } = {}) {
  let legacyRunning = null
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

  async function findRun(runId) {
    const rec = (await store.getRecords({ type: 'run', brief_id: runId })).find((r) => r.payload?.run_id === runId)
      ?? (await store.getRecords({ type: 'run' })).find((r) => r.payload?.run_id === runId)
    return rec ?? null
  }

  async function producedRecords(run) {
    const ids = new Set((run.payload?.steps ?? []).flatMap((s) => s.record_ids ?? []))
    if (run.payload?.brief_id) ids.add(run.payload.brief_id)
    if (!ids.size) return []
    const out = []
    for (const type of ['m91_facts', 'question_cluster', 'story_lead', 'tutorial_lead', 'tone_profile', 'brief', 'source_pack', 'draft', 'review']) {
      for (const r of await store.getRecords({ type })) if (ids.has(r.id) || ids.has(KEY_ID_OF(r.payload))) out.push(trimRecord(r))
    }
    return out
  }

  async function api(req, res, url) {
    const path = url.pathname
    const method = req.method
    const seg = path.split('/').filter(Boolean) // ['api', ...]

    if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, version: VERSION, run_in_progress: isRunning() })

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

    // Settings
    if (path === '/api/settings' && method === 'GET') return send(res, 200, publicSettings(config, scheduler?.status() ?? null))
    if (path === '/api/settings/schedule' && method === 'POST') {
      const body = await readJson(req)
      if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'bad_enabled', 'enabled must be true or false')
      if (!scheduler) return fail(res, 503, 'no_scheduler', 'the scheduler is not running in this process')
      return send(res, 200, await scheduler.setEnabled(body.enabled))
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

  const server = http.createServer(async (req, res) => {
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
  })
  server.isRunning = isRunning
  // Close open event streams so the server can stop cleanly.
  const close = server.close.bind(server)
  server.close = (cb) => {
    for (const s of streams) {
      clearInterval(s.timer)
      s.off?.()
      s.res.end()
    }
    streams.clear()
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
  let scheduler = null
  try {
    const { createScheduler } = await import('./scheduler.js')
    scheduler = createScheduler({ config, store, manager })
    await scheduler.start()
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') log.error('scheduler did not start', { error })
  }
  const server = createServer({ triggerKey: config.runtime.triggerKey, manager, store, config, scheduler })
  const port = config.server?.port ?? (Number(process.env.PORT) || 8080)
  // Without dashboard auth the API is for this machine only.
  const host = config.dashboard?.auth ? '0.0.0.0' : '127.0.0.1'
  server.listen(port, host, () => log.info('server listening', { host, port, dryRun: config.runtime.dryRun, dashboardAuth: Boolean(config.dashboard?.auth), schedule: scheduler?.status() ?? null }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
