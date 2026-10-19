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
import { runReviewer } from './reviewer/index.js'
import { emit, throwIfCancelled, CancelledError } from './events.js'

/** Reviewer feedback items for the Strategist: strings become { area, problem }. */
export function strategistFeedback(review) {
  return (review?.feedback ?? [])
    .map((f) => (typeof f === 'string' ? { area: 'general', problem: f, send_to: 'strategist' } : f))
    .filter((f) => !f.send_to || f.send_to === 'strategist')
}

/** The Writer's last draft as one object (with its version and brief version), or null. */
const inMemoryDraft = (ctx) => (ctx.draft?.draft ? { ...ctx.draft.draft, version: ctx.draft.version, brief_version: ctx.draft.brief_version } : null)

/** Agents for a real run: Scout, Strategist, Writer and Reviewer (the promo pack is a step of its own). */
export function defaultAgents({ config, store, notifier, agentDeps, scoutDeps = {} }) {
  const deps = { config, store, notifier, ...(agentDeps ?? scoutDeps) }
  return {
    ...stubAgents,
    async scout(ctx) {
      const output = ctx.scoutMode === 'sources'
        ? await runScout({ mode: 'sources', briefId: ctx.briefId, version: ctx.version, claims: ctx.routeClaims ?? ctx.review?.claims ?? [], reviewerNote: ctx.review?.summary }, deps)
        : await runScout({ mode: 'research', runId: ctx.runId }, deps)
      return { model: config.scout.model, output }
    },
    async writer(ctx) {
      const output = await runWriter({ mode: ctx.writerMode ?? 'new', runId: ctx.runId, briefId: ctx.briefId, briefVersion: ctx.briefVersion, feedback: ctx.writerMode === 'revise' ? ctx.routeFeedback ?? ctx.review?.feedback ?? [] : [], sourcePack: ctx.writerMode === 'revise' ? ctx.sourcePack : null, brief: ctx.brief, previousDraft: inMemoryDraft(ctx) }, deps)
      return { model: output.model_used ?? config.writer.model, output }
    },
    async reviewer(ctx) {
      // DRY_RUN saves nothing: hand over the in-memory draft, brief, previous review and the Scout's facts.
      const dry = config.runtime.dryRun
      const facts = (ctx.leads?.dry_run_records?.m91_facts ?? []).find((r) => r.status === 'current')?.payload
      const output = await runReviewer({
        briefId: ctx.briefId, runId: ctx.runId, version: ctx.draft?.version, briefVersion: ctx.draft?.brief_version ?? ctx.briefVersion,
        draft: dry ? inMemoryDraft(ctx) : null, brief: ctx.brief, previousReview: dry ? ctx.review : null, facts, sourcePack: ctx.sourcePack
      }, deps)
      return { model: output.model_used ?? config.reviewer.model, output }
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
  if (agent === 'reviewer') {
    return {
      message: out.summary_line ?? (out.pass ? `pass (${out.total ?? out.score})` : `fail (${out.total ?? out.score})`),
      data: { record_id: out.record_id ?? null, pass: out.pass, total: out.total ?? out.score ?? null, route_hint: out.route_hint ?? null }
    }
  }
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

export const UNVERIFIED_FIX = 'Remove this claim, or say plainly that it could not be verified.'

/** Feedback for the Writer: every "must" item, then "should" items up to maxItems in total. send_to becomes "writer". */
function writerItems(must, should, maxItems) {
  const items = [...must, ...should.slice(0, Math.max(0, maxItems - must.length))]
  return items.map((f) => ({ ...f, send_to: 'writer' }))
}

/**
 * What to do after a review (Phase 5 brief, C1), from the review's "must" items, in this order:
 * strategist (re-brief) → scout (sources for claims) → writer (revise) → fail. Fallbacks: strategist
 * items with no re-briefs left go to the Writer as "must" items; scout items with no retries left go
 * to the Writer with UNVERIFIED_FIX. Every route is one round towards MAX_AI_ROUNDS_PER_POST.
 * counters: { writerRevisions, rebriefs, scoutRetries, rounds }; limits: config.limits + feedbackMaxItems.
 * Returns { action: 'approve'|'rebrief'|'rescout'|'revise'|'fail', send_to, reason, feedback?, claims? }.
 */
export function decideAfterReview(review, counters, limits) {
  if (review?.pass === true) return { action: 'approve', send_to: null, reason: `pass (${review.total ?? review.score ?? '?'})` }
  if (counters.rounds >= limits.maxAiRoundsPerPost) {
    return { action: 'fail', send_to: null, reason: `hit MAX_AI_ROUNDS_PER_POST (${limits.maxAiRoundsPerPost})` }
  }
  const feedback = (review?.feedback ?? []).map((f) => (typeof f === 'string' ? { area: 'general', quote: '', problem: f, fix: '', severity: 'must', send_to: 'writer', claims: [] } : f))
  const must = feedback.filter((f) => f.severity === 'must')
  const should = feedback.filter((f) => f.severity !== 'must')
  const maxItems = limits.feedbackMaxItems ?? 8
  const strat = must.filter((f) => f.send_to === 'strategist')
  const scout = must.filter((f) => f.send_to === 'scout' && f.claims?.length)
  const why = (items) => items.map((f) => f.problem).filter(Boolean).slice(0, 2).join('; ')

  if (strat.length && counters.rebriefs < limits.maxStrategistRebriefs) {
    return { action: 'rebrief', send_to: 'strategist', reason: why(strat), feedback: strat }
  }
  if (scout.length && counters.scoutRetries < limits.maxScoutRetries) {
    return { action: 'rescout', send_to: 'scout', reason: why(scout), claims: [...new Set(scout.flatMap((f) => f.claims))], feedback: writerItems(must, should, maxItems) }
  }
  if (counters.writerRevisions < limits.maxWriterRevisions) {
    // Limits reached upstream: those items go to the Writer instead.
    const fallback = must.map((f) => (f.send_to === 'scout' ? { ...f, fix: [f.fix, UNVERIFIED_FIX].filter(Boolean).join(' ') } : f))
    const notes = [strat.length && 'strategist items to the Writer (no re-briefs left)', scout.length && 'unsourced claims to the Writer (no Scout retries left)'].filter(Boolean)
    return { action: 'revise', send_to: 'writer', reason: [why(must) || 'score below the pass mark', ...notes].join(' · '), feedback: writerItems(fallback, should, maxItems) }
  }
  return { action: 'fail', send_to: null, reason: `hit MAX_WRITER_REVISIONS (${limits.maxWriterRevisions})` }
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
  let routeFeedback = null
  let routeClaims = null
  let best = null
  const ctx = () => ({ runId, briefId, version, round: counters.rounds, leads, brief, briefVersion, draft, review, sourcePack, scoutMode, strategistMode, writerMode, routeFeedback, routeClaims, config })

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
      draft = await step('writer', ctx())
      // The real Writer saves its own draft (and numbers it); a stub's draft is saved here.
      if (draft?.record_id) version = draft.version
      else await store.createRecord({ type: 'draft', briefId, payload: draft, status: 'drafted', version, topicGroup: brief?.topic_group ?? null })
      setState('reviewing')
      review = await step('reviewer', ctx())
      // The real Reviewer saves its own review record; a mock's review is saved here.
      if (!review?.record_id) await store.createRecord({ type: 'review', briefId, payload: review, status: review?.pass ? 'pass' : 'fail', version })
      const total = review?.total ?? review?.score
      if (typeof total === 'number') best = best === null || total > best.total ? { total, version, review } : best

      throwIfCancelled(signal)
      const decision = decideAfterReview(review, counters, { ...limits, feedbackMaxItems: config.reviewer.feedbackMaxItems })
      emit('loop.route', {
        agent: 'orchestrator',
        message: decision.action === 'approve' ? `approve: ${decision.reason}` : decision.action === 'fail' ? `stop: ${decision.reason}` : `send_to ${decision.send_to}: ${decision.reason}`,
        data: { send_to: decision.send_to, action: decision.action, reason: decision.reason, total: total ?? null, version, counters: { ...counters } }
      })
      if (decision.action === 'approve') {
        setState('approved')
        if (briefRecord?.id) await store.updateRecord(briefRecord.id, undefined, { status: 'approved' })
        break
      }
      if (decision.action === 'fail') throw Object.assign(new Error(decision.reason), { routing: true })

      counters.rounds++
      routeFeedback = decision.feedback ?? null
      routeClaims = decision.claims ?? null
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
