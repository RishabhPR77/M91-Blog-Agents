// Pipeline state machine: new → drafting → reviewing → (revising) → approved | failed.
// Reviewer routing by send_to (writer | strategist | scout) with per-route limits and a hard cap on rounds.

import { getConfig } from './config.js'
import { log } from './util/log.js'
import { newBriefId } from './util/ids.js'
import { istIso, istHuman } from './util/time.js'
import { stubAgents } from './agents/stubs.js'
import { runScout } from './scout/index.js'
import { runStrategist } from './strategist/index.js'
import { runWriter } from './writer/index.js'
import { emit, throwIfCancelled, CancelledError } from './events.js'

/** Reviewer feedback items for the Strategist: strings become { area, problem }. */
export function strategistFeedback(review) {
  return (review?.feedback ?? [])
    .map((f) => (typeof f === 'string' ? { area: 'general', problem: f, send_to: 'strategist' } : f))
    .filter((f) => !f.send_to || f.send_to === 'strategist')
}

/** Agents for a real run: the Scout (Phase 2), the Strategist (Phase 3) and the remaining stubs. */
export function defaultAgents({ config, store, notifier, agentDeps, scoutDeps = {} }) {
  const deps = { config, store, notifier, ...(agentDeps ?? scoutDeps) }
  return {
    ...stubAgents,
    async scout(ctx) {
      const output = ctx.scoutMode === 'sources'
        ? await runScout({ mode: 'sources', briefId: ctx.briefId, version: ctx.version, claims: ctx.review?.claims ?? ctx.review?.feedback ?? [], reviewerNote: ctx.review?.note }, deps)
        : await runScout({ mode: 'research', runId: ctx.runId }, deps)
      return { model: config.scout.model, output }
    },
    async writer(ctx) {
      const output = await runWriter({ mode: ctx.writerMode ?? 'new', runId: ctx.runId, briefId: ctx.briefId, briefVersion: ctx.briefVersion, feedback: ctx.writerMode === 'revise' ? ctx.review?.feedback ?? [] : [], sourcePack: ctx.writerMode === 'revise' ? ctx.sourcePack : null }, deps)
      return { model: output.model_used ?? config.writer.model, output }
    },
    async strategist(ctx) {
      const output = ctx.strategistMode === 'rebrief'
        ? await runStrategist({ mode: 'rebrief', runId: ctx.runId, briefId: ctx.briefId, briefVersion: ctx.briefVersion, feedback: strategistFeedback(ctx.review) }, deps)
        : await runStrategist({ mode: 'plan', runId: ctx.runId, briefId: ctx.briefId, scoutResult: ctx.leads }, deps)
      return { model: config.strategist.model, output }
    }
  }
}

export const STATES = Object.freeze(['new', 'drafting', 'reviewing', 'revising', 'approved', 'failed'])
const TRANSITIONS = {
  new: ['drafting', 'failed'],
  drafting: ['reviewing', 'failed'],
  reviewing: ['approved', 'revising', 'failed'],
  revising: ['drafting', 'failed'],
  approved: [],
  failed: []
}
export const LOCK_TTL_MS = 30 * 60 * 1000

export class TransitionError extends Error {}
export class LockedError extends Error {
  constructor(message = 'A pipeline run is already in progress') {
    super(message)
    this.name = 'LockedError'
  }
}

/** A one-line summary plus record ids for a step's output (never the whole payload). */
export function summariseOutput(agent, out) {
  if (!out || typeof out !== 'object') return null
  if (agent === 'scout' && out.mode === 'research') {
    const c = out.counts ?? {}
    return {
      message: `${c.clusters_new ?? 0} new clusters (${c.clusters_merged ?? 0} merged), ${c.stories ?? 0} stories, ${c.tutorials ?? 0} tutorials${out.reused ? ' (reused research)' : ''}`,
      data: { cluster_ids: out.cluster_ids, story_ids: out.story_ids, tutorial_ids: out.tutorial_ids, style_profile_id: out.style_profile_id, calls_used: out.calls_used, warnings: out.warnings?.length ?? 0 }
    }
  }
  if (agent === 'scout' && out.mode === 'sources') {
    return { message: `${out.claims_supported} supported, ${out.claims_unverified} unverified, ${out.claims_contradicted} contradicted`, data: { record_id: out.record_id } }
  }
  if (agent === 'strategist' && out.brief_id) {
    return { message: `brief ${out.brief_id} v${out.brief_version}: "${out.title}"`, data: { brief_id: out.brief_id, brief_version: out.brief_version, record_id: out.record_id, lead: out.lead, repairs_used: out.repairs_used } }
  }
  if (agent === 'reviewer') return { message: out.pass ? `pass (${out.score})` : `fail (${out.score}) → ${out.send_to ?? 'writer'}`, data: { pass: out.pass, score: out.score, send_to: out.send_to ?? null } }
  if (agent === 'writer' && out.record_id) {
    return {
      message: `Draft v${out.version}: ${Number(out.word_count).toLocaleString('en-US')} words · grade ${out.reading?.post_grade} · hard checks ${out.hard_passed ? 'passed' : 'failed'} · repairs ${out.repairs_used}`,
      data: { record_id: out.record_id, brief_id: out.brief_id, version: out.version, hard_passed: out.hard_passed, model: out.model_used }
    }
  }
  if (agent === 'writer') return { message: `draft "${out.title ?? ''}"`, data: {} }
  return null
}

export function assertTransition(from, to) {
  if (!TRANSITIONS[from]?.includes(to)) throw new TransitionError(`Illegal transition ${from} → ${to}`)
  return to
}

/**
 * What to do after a review. counters: { writerRevisions, rebriefs, scoutRetries, rounds }.
 * Returns { action: 'approve' | 'revise' | 'rebrief' | 'rescout' | 'fail', reason? }.
 */
export function decideAfterReview(review, counters, limits) {
  if (review?.pass === true) return { action: 'approve' }
  if (counters.rounds >= limits.maxAiRoundsPerPost) {
    return { action: 'fail', reason: `hit MAX_AI_ROUNDS_PER_POST (${limits.maxAiRoundsPerPost})` }
  }
  const route = review?.send_to ?? 'writer'
  if (route === 'writer') {
    return counters.writerRevisions < limits.maxWriterRevisions
      ? { action: 'revise' }
      : { action: 'fail', reason: `hit MAX_WRITER_REVISIONS (${limits.maxWriterRevisions})` }
  }
  if (route === 'strategist') {
    return counters.rebriefs < limits.maxStrategistRebriefs
      ? { action: 'rebrief' }
      : { action: 'fail', reason: `hit MAX_STRATEGIST_REBRIEFS (${limits.maxStrategistRebriefs})` }
  }
  if (route === 'scout') {
    return counters.scoutRetries < limits.maxScoutRetries
      ? { action: 'rescout' }
      : { action: 'fail', reason: `hit MAX_SCOUT_RETRIES (${limits.maxScoutRetries})` }
  }
  return { action: 'fail', reason: `reviewer send_to "${route}" is not writer | strategist | scout` }
}

/** Takes the single run lock in the store. Stale locks (expired or older than 30 min) are cleared. */
export async function acquireLock(store, { owner, now = Date.now } = {}) {
  const t = now()
  const locks = await store.getRecords({ type: 'lock' })
  let active = []
  for (const lock of locks) {
    const acquiredAt = Date.parse(lock.payload?.acquired_at)
    const expiresAt = Date.parse(lock.payload?.expires_at)
    const stale = !(acquiredAt > 0) || t - acquiredAt > LOCK_TTL_MS || (expiresAt > 0 && expiresAt <= t)
    if (stale) {
      log.warn('clearing stale run lock', { id: lock.id, owner: lock.payload?.owner })
      await store.deleteRecord(lock.id)
    } else active.push(lock)
  }
  if (active.length) throw new LockedError(`A pipeline run is already in progress (owner ${active[0].payload?.owner})`)

  const payload = { owner, acquired_at: new Date(t).toISOString(), expires_at: new Date(t + LOCK_TTL_MS).toISOString() }
  const mine = await store.createRecord({ type: 'lock', payload, status: 'held' })
  // Two runs racing past the check: the earlier lock wins, the later one backs off.
  active = (await store.getRecords({ type: 'lock' })).filter((l) => l.id !== mine.id && Date.parse(l.payload?.expires_at) > t)
  const earlier = active.find((l) => l.payload?.acquired_at < payload.acquired_at || (l.payload?.acquired_at === payload.acquired_at && l.id < mine.id))
  if (earlier) {
    await store.deleteRecord(mine.id)
    throw new LockedError(`A pipeline run is already in progress (owner ${earlier.payload?.owner})`)
  }
  return { id: mine.id, release: () => store.deleteRecord(mine.id) }
}

/**
 * Runs one pipeline.
 * @param {{ config?, store, notifier, agents?, now?, onState? }} deps
 */
export async function runPipeline({ config = getConfig(), store, notifier, agents, now = Date.now, briefId = newBriefId(new Date(now())), runId = briefId, lock: useLock = true, signal = null } = {}) {
  agents ??= defaultAgents({ config, store, notifier })
  const limits = config.limits
  const dryRun = config.runtime.dryRun
  const counters = { writerRevisions: 0, rebriefs: 0, scoutRetries: 0, rounds: 0 }
  const steps = []
  let state = 'new'
  let version = 0
  let leads, brief, draft, review, sourcePack, briefRecord
  let scoutMode = 'research'
  let strategistMode = 'plan'
  let writerMode = 'new'
  let briefVersion = 0
  const ctx = () => ({ runId, briefId, version, round: counters.rounds, leads, brief, briefVersion, draft, review, sourcePack, scoutMode, strategistMode, writerMode, config })

  const setState = (to) => {
    state = assertTransition(state, to)
    log.info('pipeline state', { briefId, state, version })
  }

  async function runLog(entry) {
    const record = { time: istIso(new Date(now())), state, round: counters.rounds, version, ...entry }
    steps.push(record)
    try {
      await store.createRecord({ type: 'run_log', briefId: runId, payload: record, status: entry.result, version })
    } catch (error) {
      log.error('could not write run_log', { briefId, error })
    }
  }

  async function step(agent, input) {
    throwIfCancelled(signal)
    const started = now()
    emit('step.started', { agent, step: agent })
    try {
      const { output, model } = await agents[agent](input)
      await runLog({ agent, model: model ?? null, ms: now() - started, result: 'ok', error: null })
      emit('step.finished', { agent, step: agent, data: { ms: now() - started, model: model ?? null } })
      const summary = summariseOutput(agent, output)
      if (summary) emit('step.output', { agent, step: agent, ...summary })
      return output
    } catch (error) {
      await runLog({ agent, model: null, ms: now() - started, result: 'error', error: error.message })
      emit('step.failed', { agent, step: agent, message: error.message, data: { ms: now() - started } })
      throw error
    }
  }

  async function research() {
    scoutMode = 'research'
    leads = await step('scout', ctx())
  }
  // Reviewer sent the post to the Scout: find sources for its claims, then back to the Writer.
  async function findSources() {
    scoutMode = 'sources'
    sourcePack = await step('scout', ctx())
  }
  // mode: 'plan' first; 'rebrief' when the Reviewer sends the post to the Strategist.
  async function plan(mode = 'plan') {
    strategistMode = mode
    const out = await step('strategist', ctx())
    if (out?.record_id) {
      // The real Strategist saves its own brief record (and versions it on re-brief).
      brief = out.brief
      briefRecord = { id: out.record_id }
      briefVersion = out.brief_version
    } else {
      brief = out
      briefVersion++
      briefRecord = await store.createRecord({ type: 'brief', briefId, payload: brief, status: 'active', version: briefVersion, topicGroup: brief?.topic_group ?? null })
    }
  }

  let lock
  try {
    lock = useLock ? await acquireLock(store, { owner: runId, now }) : { release: async () => {} }
  } catch (error) {
    log.warn('pipeline not started', { error })
    return { briefId, state: 'skipped', reason: error.message, steps }
  }

  try {
    await research()
    await plan()
    setState('drafting')

    for (;;) {
      version++
      counters.rounds++
      draft = await step('writer', ctx())
      // The real Writer saves its own draft (and numbers it); the stub's draft is saved here.
      if (draft?.record_id) version = draft.version
      else await store.createRecord({ type: 'draft', briefId, payload: draft, status: 'drafted', version, topicGroup: brief?.topic_group ?? null })
      setState('reviewing')
      review = await step('reviewer', ctx())
      await store.createRecord({ type: 'review', briefId, payload: review, status: review?.pass ? 'pass' : 'fail', version })

      const decision = decideAfterReview(review, counters, limits)
      if (decision.action === 'approve') {
        setState('approved')
        if (briefRecord?.id) await store.updateRecord(briefRecord.id, undefined, { status: 'approved' })
        break
      }
      const reason = (review?.feedback ?? []).map((f) => (typeof f === 'string' ? f : f.problem)).filter(Boolean).slice(0, 2).join('; ')
      emit('loop.route', { agent: 'reviewer', message: decision.action === 'fail' ? `stop: ${decision.reason}` : `send_to ${review?.send_to ?? 'writer'}${reason ? `: ${reason}` : ''}`, data: { send_to: review?.send_to ?? 'writer', action: decision.action, score: review?.score ?? null, round: counters.rounds } })
      if (decision.action === 'fail') throw Object.assign(new Error(decision.reason), { routing: true })

      setState('revising')
      if (decision.action === 'revise') {
        counters.writerRevisions++
        writerMode = 'revise'
      }
      if (decision.action === 'rebrief') {
        counters.rebriefs++
        await plan('rebrief')
        writerMode = 'new'
      }
      if (decision.action === 'rescout') {
        counters.scoutRetries++
        await findSources()
        writerMode = 'revise'
      }
      setState('drafting')
    }

    await publish()
    await runLog({ agent: 'orchestrator', model: null, ms: 0, result: 'approved', error: null })
    return { briefId, state, version, counters, steps }
  } catch (error) {
    // Once a run is cancelled, a later error (e.g. a network failure mid-step) still ends it as cancelled: no failure alert.
    if (error instanceof CancelledError || signal?.aborted) {
      state = 'cancelled'
      await runLog({ agent: 'orchestrator', model: null, ms: 0, result: 'cancelled', error: null })
      log.info('pipeline cancelled', { runId, briefId })
      return { runId, briefId, state, version, counters, steps }
    }
    if (state !== 'failed') state = 'failed'
    await runLog({ agent: 'orchestrator', model: null, ms: 0, result: 'failed', error: error.message })
    log.error('pipeline failed', { briefId, error, counters })
    await alertFailure(error)
    return { briefId, state, version, counters, steps, error: error.message }
  } finally {
    await lock.release().catch((error) => log.error('could not release run lock', { error }))
  }

  // Phase 1: publishing is a placeholder. AUTO_PUBLISH=false (or DRY_RUN) means never publish.
  async function publish() {
    if (!config.runtime.autoPublish || dryRun) {
      log.info('publish skipped', { briefId, autoPublish: config.runtime.autoPublish, dryRun })
      return
    }
    log.info('publish placeholder: nothing to publish in Phase 1', { briefId })
  }

  // LOW: the post failed all its retries (a routing limit). MEDIUM: the pipeline crashed.
  async function alertFailure(error) {
    const severity = error.routing ? 'LOW' : 'MEDIUM'
    const what = error.routing ? 'post failed all retries' : 'pipeline crashed'
    const text = `M91 blog pipeline: ${what}\nbrief_id: ${briefId}\nversion: ${version}\nwhen: ${istHuman(new Date(now()))}\nreason: ${error.message}`
    try {
      await notifier.slack(text)
      await notifier.m91Alert({ title: `Blog pipeline: ${what} (${briefId})`, description: text, severity })
    } catch (notifyError) {
      log.error('failure notification failed', { briefId, error: notifyError })
    }
  }
}
