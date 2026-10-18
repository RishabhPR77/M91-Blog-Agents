// Runs (Phase 3.5, Tasks 3–4): startRun / cancelRun, one `run` record per run, the run lock,
// and run-level events. Everything a run does happens inside withRun(run_id, …), so its logs,
// AI calls and steps are tagged with the run automatically.

import { getConfig } from './config.js'
import { log } from './util/log.js'
import { newBriefId } from './util/ids.js'
import { istIso } from './util/time.js'
import { createStore } from './store.js'
import { createNotifier } from './notify.js'
import { withRun, emit, subscribe } from './events.js'
import { runPipeline, defaultAgents, acquireLock, LockedError } from './orchestrator.js'
import { runScout } from './scout/index.js'
import { runStrategist } from './strategist/index.js'
import { runWriter } from './writer/index.js'
import { loadBrief } from './writer/inputs.js'

export const MODES = Object.freeze(['full', 'scout', 'strategist', 'writer', 'reviewer', 'publish'])
export const BUILT_MODES = Object.freeze(['full', 'scout', 'strategist', 'writer'])
export const TRIGGERS = Object.freeze(['manual', 'cron', 'api', 'cli'])
const TOP_STEPS = ['scout', 'strategist', 'writer', 'checks', 'reviewer', 'promo', 'designer', 'publisher']

export class RunError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'RunError'
    this.code = code
    this.status = status
  }
}

/** run_id: R-YYMMDD-HHMM-XXXX (IST, brief-id alphabet). */
export const newRunId = (date = new Date()) => `R-${newBriefId(date)}`
export const RUN_ID_RE = /^R-\d{6}-\d{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/

// Run params that may change settings for one run only (e.g. the low-cost smoke settings).
const SCOUT_PARAMS = {
  question_groups: ['questionGroups', (v) => (Array.isArray(v) && v.length && v.every((g) => [1, 2, 3, 4, 5].includes(g)) ? [...new Set(v)].sort() : null)],
  questions_per_group: ['questionsPerGroup', (v) => (Number.isInteger(v) && v >= 1 && v <= 50 ? v : null)],
  max_calls: ['maxCalls', (v) => (Number.isInteger(v) && v >= 1 && v <= 100 ? v : null)],
  docs_max_chars: ['docsMaxChars', (v) => (Number.isInteger(v) && v >= 1000 && v <= 48000 ? v : null)],
  docs_max_pages: ['docsMaxPages', (v) => (Number.isInteger(v) && v >= 1 && v <= 50 ? v : null)],
  min_open_clusters: ['minOpenClusters', (v) => (Number.isInteger(v) && v >= 0 ? v : null)]
}

/** A frozen copy of config with this run's dry-run flag and allowed param overrides. Throws RunError on bad params. */
export function configForRun(config, { dryRun, params = {} } = {}) {
  const scout = { ...config.scout }
  for (const [key, value] of Object.entries(params.scout ?? {})) {
    const spec = SCOUT_PARAMS[key]
    if (!spec) throw new RunError('bad_params', `params.scout.${key} is not a run setting (allowed: ${Object.keys(SCOUT_PARAMS).join(', ')})`)
    const v = spec[1](value)
    if (v === null) throw new RunError('bad_params', `params.scout.${key} has an invalid value`)
    scout[spec[0]] = v
  }
  const viasocket = { ...config.viasocket }
  if (params.ai_max_retries !== undefined) {
    if (!Number.isInteger(params.ai_max_retries) || params.ai_max_retries < 0 || params.ai_max_retries > 10) throw new RunError('bad_params', 'params.ai_max_retries must be 0–10')
    viasocket.maxRetries = params.ai_max_retries
  }
  const runtime = { ...config.runtime, dryRun: dryRun ?? config.runtime.dryRun }
  return Object.freeze({ ...config, scout: Object.freeze(scout), viasocket: Object.freeze(viasocket), runtime: Object.freeze(runtime) })
}

/**
 * @param {{ config?, storeFactory?, notifierFactory?, agentsFactory?, now? }} deps  factories take the run's config
 */
export function createRunManager({ config = getConfig(), storeFactory, notifierFactory, agentsFactory, now = Date.now } = {}) {
  storeFactory ??= (cfg) => createStore({ config: cfg })
  notifierFactory ??= (cfg) => createNotifier({ config: cfg })
  let active = null // { runId, controller, done }
  const finished = new Map() // run_id → final result (last 20)

  /** Starts a run in the background and returns its run_id at once. */
  async function startRun({ mode = 'full', trigger = 'manual', dryRun, params = {} } = {}) {
    if (!MODES.includes(mode)) throw new RunError('bad_mode', `mode must be one of ${MODES.join(', ')}`)
    if (!BUILT_MODES.includes(mode)) throw new RunError('not_built', `mode "${mode}" is not built yet`, 501)
    if (!TRIGGERS.includes(trigger)) throw new RunError('bad_trigger', `trigger must be one of ${TRIGGERS.join(', ')}`)
    if (dryRun !== undefined && typeof dryRun !== 'boolean') throw new RunError('bad_params', 'dry_run must be true or false')
    if (active) throw new RunError('run_in_progress', `run ${active.runId} is in progress`, 409)
    if (mode === 'writer') await checkWriterParams(params, configForRun(config, { dryRun, params }))

    const runConfig = configForRun(config, { dryRun, params })
    const runId = newRunId(new Date(now()))
    const controller = new AbortController()
    const entry = { runId, controller, done: null }
    active = entry
    entry.done = withRun(runId, () => execute({ runId, mode, trigger, params, runConfig, signal: controller.signal }), { signal: controller.signal })
      .catch((error) => ({ status: 'failed', error: error.message }))
      .then((result) => {
        finished.set(runId, result)
        while (finished.size > 20) finished.delete(finished.keys().next().value)
        if (active === entry) active = null
        return result
      })
    return { run_id: runId }
  }

  async function execute({ runId, mode, trigger, params, runConfig, signal }) {
    const store = storeFactory(runConfig)
    const notifier = notifierFactory(runConfig)
    const startedAt = now()
    const dry = runConfig.runtime.dryRun
    const run = {
      run_id: runId, trigger, mode, dry_run: dry, status: 'running', started_at: istIso(new Date(startedAt)), finished_at: null, ms: null,
      steps: [], brief_id: null, result_summary: '', warnings: []
    }

    // The run record follows the step events; writes are queued so they happen in order.
    let record = null
    let queue = Promise.resolve()
    const save = () => {
      queue = queue.then(async () => {
        try {
          if (!record) record = await store.createRecord({ type: 'run', briefId: runId, payload: run, status: run.status })
          else await store.updateRecord(record.id, structuredClone(run), { type: 'run', status: run.status })
        } catch (error) {
          log.error('could not save run record', { runId, error })
        }
      })
      return queue
    }
    const stepFor = (name) => run.steps.find((s) => s.name === name && s.status === 'running') ?? run.steps.findLast((s) => s.name === name)
    const topOf = (e) => (e.step ? String(e.step).split('.')[0] : e.agent)
    const unsubscribe = subscribe((e) => {
      if (e.type === 'step.started' && TOP_STEPS.includes(e.step)) {
        run.steps.push({ name: e.step, status: 'running', started_at: e.ts, finished_at: null, ms: null, ai_calls: 0, models: [], retries: 0, record_ids: [], summary: '', error: null })
        save()
      } else if ((e.type === 'step.finished' || e.type === 'step.failed') && TOP_STEPS.includes(e.step)) {
        const s = stepFor(e.step)
        if (s) Object.assign(s, { status: e.type === 'step.finished' ? 'succeeded' : 'failed', finished_at: e.ts, ms: e.data?.ms ?? null, error: e.type === 'step.failed' ? e.message ?? 'failed' : null })
        save()
      } else if (e.type === 'ai.call') {
        const s = stepFor(topOf(e))
        if (s) {
          s.ai_calls++
          s.retries += e.data?.retries ?? 0
          if (e.data?.model && !s.models.includes(e.data.model)) s.models.push(e.data.model)
        }
      } else if (e.type === 'step.output' && TOP_STEPS.includes(e.step)) {
        const s = stepFor(e.step)
        if (s) {
          s.summary = e.message ?? s.summary
          const d = e.data ?? {}
          for (const id of [d.record_id, ...(d.cluster_ids ?? []), ...(d.story_ids ?? []), ...(d.tutorial_ids ?? []), d.style_profile_id].filter(Boolean)) if (!s.record_ids.includes(id)) s.record_ids.push(id)
          if (d.brief_id) run.brief_id = d.brief_id
        }
      }
    }, { runId })

    emit('run.started', { message: `${mode} run (${trigger}${dry ? ', dry run' : ''})`, data: { mode, trigger, dry_run: dry } })
    await save()

    let lock = null
    let result
    try {
      lock = await acquireLock(store, { owner: runId, now })
      result = await runMode({ mode, runId, params, runConfig, store, notifier, signal })
    } catch (error) {
      result = error instanceof LockedError
        ? { status: 'failed', error: error.message, summary: 'another run holds the lock' }
        : { status: error.name === 'CancelledError' || signal.aborted ? 'cancelled' : 'failed', error: error.message }
    } finally {
      await lock?.release().catch((error) => log.error('could not release run lock', { runId, error }))
    }

    Object.assign(run, {
      status: result.status,
      finished_at: istIso(new Date(now())),
      ms: now() - startedAt,
      brief_id: run.brief_id ?? result.brief_id ?? null,
      result_summary: result.summary ?? result.error ?? '',
      warnings: result.warnings ?? []
    })
    for (const s of run.steps) if (s.status === 'running') Object.assign(s, { status: result.status === 'cancelled' ? 'cancelled' : 'failed', finished_at: run.finished_at })
    const type = result.status === 'succeeded' ? 'run.finished' : result.status === 'cancelled' ? 'run.cancelled' : 'run.failed'
    await save()
    await queue
    unsubscribe()
    emit(type, { message: run.result_summary, data: { status: run.status, ms: run.ms, brief_id: run.brief_id } })
    if (result.status === 'cancelled') {
      try {
        await notifier.slack(`⏹️ Run ${runId} cancelled`)
      } catch (error) {
        log.warn('cancel Slack line not sent', { runId, error })
      }
    }
    return { ...result, run_id: runId, record_id: record?.id ?? null, run }
  }

  async function runMode({ mode, runId, params, runConfig, store, notifier, signal }) {
    const agentDeps = agentsFactory ? undefined : {}
    if (mode === 'full') {
      const agents = agentsFactory?.(runConfig, { store, notifier }) ?? defaultAgents({ config: runConfig, store, notifier, agentDeps })
      const r = await runPipeline({ config: runConfig, store, notifier, agents, now, runId, briefId: params.brief_id ?? newBriefId(new Date(now())), lock: false, signal })
      const status = r.state === 'approved' ? 'succeeded' : r.state === 'cancelled' ? 'cancelled' : 'failed'
      return { status, brief_id: r.briefId, summary: r.error ?? `pipeline ${r.state} (version ${r.version ?? 0})`, error: r.error }
    }
    const agents = agentsFactory?.(runConfig, { store, notifier })
    if (mode === 'scout') {
      emit('step.started', { agent: 'scout', step: 'scout' })
      try {
        const out = agents?.scout
          ? (await agents.scout({ runId, scoutMode: 'research', config: runConfig })).output
          : await runScout({ mode: 'research', runId }, { config: runConfig, store, notifier })
        emit('step.finished', { agent: 'scout', step: 'scout' })
        const c = out.counts ?? {}
        emit('step.output', { agent: 'scout', step: 'scout', message: `${c.clusters_new ?? 0} new clusters, ${c.stories ?? 0} stories, ${c.tutorials ?? 0} tutorials`, data: { cluster_ids: out.cluster_ids, story_ids: out.story_ids, tutorial_ids: out.tutorial_ids, style_profile_id: out.style_profile_id } })
        return { status: 'succeeded', summary: `scout: ${out.calls_used} calls, ${c.questions ?? 0} questions, ${c.stories ?? 0} stories, ${c.tutorials ?? 0} tutorials${out.reused ? ' (reused)' : ''}`, warnings: out.warnings }
      } catch (error) {
        emit('step.failed', { agent: 'scout', step: 'scout', message: error.message })
        throw error
      }
    }
    if (mode === 'writer') {
      emit('step.started', { agent: 'writer', step: 'writer' })
      try {
        const feedback = params.feedback ?? []
        const wmode = feedback.length ? 'revise' : 'new'
        const out = agents?.writer
          ? (await agents.writer({ runId, briefId: params.brief_id, briefVersion: params.brief_version, writerMode: wmode, review: { feedback }, config: runConfig })).output
          : await runWriter({ mode: wmode, runId, briefId: params.brief_id, briefVersion: params.brief_version, feedback }, { config: runConfig, store, notifier })
        emit('step.finished', { agent: 'writer', step: 'writer' })
        emit('step.output', { agent: 'writer', step: 'writer', message: `Draft v${out.version}: ${out.word_count} words · grade ${out.reading?.post_grade} · hard checks ${out.hard_passed ? 'passed' : 'failed'} · repairs ${out.repairs_used}`, data: { record_id: out.record_id, brief_id: out.brief_id, version: out.version } })
        return { status: 'succeeded', brief_id: out.brief_id, summary: `draft v${out.version} of ${out.brief_id}: ${out.title}`, warnings: out.warnings }
      } catch (error) {
        emit('step.failed', { agent: 'writer', step: 'writer', message: error.message })
        throw error
      }
    }
    // strategist
    emit('step.started', { agent: 'strategist', step: 'strategist' })
    try {
      const briefId = params.brief_id ?? newBriefId(new Date(now()))
      const out = agents?.strategist
        ? (await agents.strategist({ runId, briefId, strategistMode: 'plan', config: runConfig })).output
        : await runStrategist({ mode: 'plan', runId, briefId }, { config: runConfig, store, notifier })
      emit('step.finished', { agent: 'strategist', step: 'strategist' })
      emit('step.output', { agent: 'strategist', step: 'strategist', message: `brief ${out.brief_id} v${out.brief_version}: "${out.title}"`, data: { brief_id: out.brief_id, record_id: out.record_id } })
      return { status: 'succeeded', brief_id: out.brief_id, summary: `brief ${out.brief_id}: ${out.title}`, warnings: out.warnings }
    } catch (error) {
      emit('step.failed', { agent: 'strategist', step: 'strategist', message: error.message })
      throw error
    }
  }

  /** writer mode needs params.brief_id of an existing brief (checked before the run starts → 400). */
  async function checkWriterParams(params, runConfig) {
    if (typeof params.brief_id !== 'string' || !params.brief_id.trim()) throw new RunError('bad_params', 'writer mode needs params.brief_id')
    if (params.brief_version !== undefined && !(Number.isInteger(params.brief_version) && params.brief_version >= 1)) throw new RunError('bad_params', 'params.brief_version must be a whole number ≥ 1')
    if (params.feedback !== undefined && !Array.isArray(params.feedback)) throw new RunError('bad_params', 'params.feedback must be a list of feedback items')
    const brief = await loadBrief(storeFactory(runConfig), params.brief_id, params.brief_version)
    if (!brief) throw new RunError('unknown_brief', `no brief ${params.brief_id}${params.brief_version ? ` v${params.brief_version}` : ''}`)
  }

  /** Cancels the active run (Task 4). Returns false if that run isn't running. */
  function cancelRun(runId) {
    if (!active || active.runId !== runId) return false
    active.controller.abort()
    return true
  }

  return {
    startRun,
    cancelRun,
    isRunning: () => Boolean(active),
    activeRunId: () => active?.runId ?? null,
    /** Resolves with the final result of a run started by this manager. */
    wait: async (runId) => (active?.runId === runId ? active.done : finished.get(runId) ?? null)
  }
}
