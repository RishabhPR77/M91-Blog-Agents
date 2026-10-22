// Pipeline state machine: new → drafting → reviewing → (revising) → approved | failed.
// Reviewer routing by send_to (writer | strategist | scout | designer) with per-route limits and a hard cap on rounds.
// Phase 10: after each draft the Experience Designer builds the guide; the Reviewer reviews the whole guide.

import { getConfig } from './config.js'
import { log } from './util/log.js'
import { newBriefId } from './util/ids.js'
import { istIso, istHuman } from './util/time.js'
import { stubAgents } from './agents/stubs.js'
import { runScout } from './scout/index.js'
import { runStrategist } from './strategist/index.js'
import { runWriter } from './writer/index.js'
import { runReviewer } from './reviewer/index.js'
import { runPromo } from './promo/index.js'
import { runExperience, isInteractive } from './experience/index.js'
import { runPlanner } from './planner/index.js'
import { pickTarget, setSlotStatus } from './roadmap/pick.js'
import { loadBrief } from './writer/inputs.js'
import { loadDraft } from './reviewer/inputs.js'
import { draftVersion, draftBriefVersion } from './writer/save.js'
import { emit, throwIfCancelled, CancelledError, isCancel } from './events.js'
import { acquireRunLock, LockedError } from './util/runlock.js'
import { saveRunLog } from './util/runlog.js'

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
    // Phase 12: the Roadmap Planner (roadmap mode).
    async planner(ctx) {
      const output = await runPlanner({ runId: ctx.runId }, deps)
      return { model: output.calls.at(-1)?.model ?? config.planner.model, output }
    },
    async scout(ctx) {
      const output = ctx.scoutMode === 'sources'
        ? await runScout({ mode: 'sources', briefId: ctx.briefId, version: ctx.version, claims: ctx.routeClaims ?? ctx.review?.claims ?? [], reviewerNote: ctx.review?.summary }, deps)
        // Phase 12: with a roadmap target, the focused Scout researches only that post.
        : ctx.scoutMode === 'slot'
          ? await runScout({ mode: 'slot', runId: ctx.runId, briefId: ctx.briefId, target: ctx.target }, deps)
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
        draft: dry ? inMemoryDraft(ctx) : null, brief: ctx.brief, previousReview: dry ? ctx.review : null, facts, sourcePack: ctx.sourcePack,
        // The guide just built (null: no guide, the post is reviewed as written; undefined: load the newest).
        guideDoc: ctx.guideDoc === undefined ? undefined : ctx.guideDoc
      }, deps)
      return { model: output.model_used ?? config.reviewer.model, output }
    },
    async promo(ctx) {
      const dry = config.runtime.dryRun
      const output = await runPromo({ briefId: ctx.briefId, runId: ctx.runId, version: ctx.draft?.version, briefVersion: ctx.draft?.brief_version ?? ctx.briefVersion, draft: dry ? inMemoryDraft(ctx) : null, brief: ctx.brief }, deps)
      return { model: output.model_used ?? config.promo.model, output }
    },
    // Phase 10: the Experience Designer (step "designer"), on the draft just written, with design feedback if any.
    async designer(ctx) {
      const dry = config.runtime.dryRun
      const facts = (ctx.leads?.dry_run_records?.m91_facts ?? []).find((r) => r.status === 'current')?.payload
      const output = await runExperience({
        briefId: ctx.briefId, runId: ctx.runId, version: ctx.draft?.version, briefVersion: ctx.draft?.brief_version ?? ctx.briefVersion,
        draft: dry ? inMemoryDraft(ctx) : null, brief: ctx.brief, facts, feedback: ctx.designFeedback ?? []
      }, deps)
      return { model: output.model_used ?? config.designer.model, output }
    },
    async strategist(ctx) {
      const output = ctx.strategistMode === 'rebrief'
        ? await runStrategist({ mode: 'rebrief', runId: ctx.runId, briefId: ctx.briefId, briefVersion: ctx.briefVersion, feedback: strategistFeedback(ctx.review) }, deps)
        : await runStrategist({ mode: 'plan', runId: ctx.runId, briefId: ctx.briefId, scoutResult: ctx.leads }, deps)
      return { model: config.strategist.model, output }
    }
  }
}

// A Reviewer pass ends the run at awaiting_human (Phase 5.5): only the human's approval approves a post.
export const STATES = Object.freeze(['new', 'drafting', 'reviewing', 'revising', 'awaiting_human', 'failed'])
const TRANSITIONS = {
  new: ['drafting', 'failed'],
  drafting: ['reviewing', 'failed'],
  reviewing: ['awaiting_human', 'revising', 'failed'],
  revising: ['drafting', 'failed'],
  awaiting_human: [],
  failed: []
}
export class TransitionError extends Error {}
// The run lock is a local file since Phase 9 (util/runlock.js); LockedError keeps its message.
export { LockedError }

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
  if (out.placeholder) return { message: out.message, data: { placeholder: true } }
  if (agent === 'designer' && out.summary_line) {
    const comps = out.guide ? out.guide.chapters.flatMap((c) => c.components).filter((x) => x.type !== 'prose') : []
    return {
      message: out.summary_line,
      data: {
        record_id: out.record_id ?? null, status: out.status, chapters: out.guide?.chapters.length ?? 0, components: comps.map((x) => x.type),
        dropped: (out.dropped ?? []).map((d) => ({ type: d.type, chapter: d.chapter, reason: d.reason })), coverage: out.coverage?.passed ?? null,
        checks: { first: out.checks?.first?.length ?? 0, final: out.checks?.final?.length ?? 0 }, repairs_used: out.repairs_used ?? 0
      }
    }
  }
  if (agent === 'export' && out.summary) return { message: out.summary, data: { filename: out.filename ?? null, record_id: out.record_id ?? null, version: out.version ?? null } }
  if (agent === 'publisher' && out.summary) return { message: out.summary, data: { url: out.url ?? null, dist: out.dist ?? null } }
  if (agent === 'promo' && out.pack) {
    return {
      message: `Promo pack ${out.status}: LinkedIn ${out.pack.linkedin_post.length} chars · X thread ${out.pack.x_thread.length} posts · ${out.pack.video_script.length} video scenes · ${out.problems?.length ?? 0} issue(s)`,
      data: { record_id: out.record_id ?? null, status: out.status, problems: out.problems?.length ?? 0, repairs_used: out.repairs_used ?? 0 }
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
 * strategist (re-brief) → scout (sources for claims) → writer (revise) → designer (design only) → fail. Fallbacks: strategist
 * items with no re-briefs left go to the Writer as "must" items; scout items with no retries left go
 * to the Writer with UNVERIFIED_FIX. Every route is one round towards MAX_AI_ROUNDS_PER_POST.
 * counters: { writerRevisions, rebriefs, scoutRetries, rounds }; limits: config.limits + feedbackMaxItems.
 * Returns { action: 'approve'|'rebrief'|'rescout'|'revise'|'redesign'|'fail', send_to, reason, feedback?, claims? }.
 * Design items (send_to "designer") never go to the Writer: alone they re-run the Experience Designer
 * (MAX_DESIGNER_REVISIONS); with text items they wait for the Experience Designer run after the revision.
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
  const design = must.filter((f) => f.send_to === 'designer')
  const text = must.filter((f) => f.send_to !== 'designer')
  const why = (items) => items.map((f) => f.problem).filter(Boolean).slice(0, 2).join('; ')

  if (strat.length && counters.rebriefs < limits.maxStrategistRebriefs) {
    return { action: 'rebrief', send_to: 'strategist', reason: why(strat), feedback: strat }
  }
  if (scout.length && counters.scoutRetries < limits.maxScoutRetries) {
    return { action: 'rescout', send_to: 'scout', reason: why(scout), claims: [...new Set(scout.flatMap((f) => f.claims))], feedback: writerItems(text, should.filter((f) => f.send_to !== 'designer'), maxItems) }
  }
  // Phase 10: only the design needs work: re-run the Experience Designer with its items (cheaper than a revision).
  if (design.length && !text.length && (counters.designerRevisions ?? 0) < (limits.maxDesignerRevisions ?? 0)) {
    return { action: 'redesign', send_to: 'designer', reason: why(design), feedback: [...design, ...should.filter((f) => f.send_to === 'designer')].slice(0, maxItems) }
  }
  if (!text.length && design.length) return { action: 'fail', send_to: null, reason: `hit MAX_DESIGNER_REVISIONS (${limits.maxDesignerRevisions})` }
  if (counters.writerRevisions < limits.maxWriterRevisions) {
    // Limits reached upstream: those items go to the Writer instead.
    // Design items stay with the Experience Designer (it runs again after the revision, with them).
    const fallback = text.map((f) => (f.send_to === 'scout' ? { ...f, fix: [f.fix, UNVERIFIED_FIX].filter(Boolean).join(' ') } : f))
    const notes = [strat.length && 'strategist items to the Writer (no re-briefs left)', scout.length && 'unsourced claims to the Writer (no Scout retries left)'].filter(Boolean)
    return { action: 'revise', send_to: 'writer', reason: [why(must) || 'score below the pass mark', ...notes].join(' · '), feedback: writerItems(fallback, should.filter((f) => f.send_to !== 'designer'), maxItems) }
  }
  return { action: 'fail', send_to: null, reason: `hit MAX_WRITER_REVISIONS (${limits.maxWriterRevisions})` }
}

/** Takes the run lock (a local file, 0 Mem0 requests). The store argument is kept for older callers. */
export async function acquireLock(_store, { owner, now = Date.now, config = getConfig() } = {}) {
  return acquireRunLock({ owner, config, now })
}

/**
 * Runs one pipeline.
 * resume: { version?, briefVersion? } starts at the review of a saved draft of briefId (reviewer mode, route: true);
 *   with startAt: 'writer' and feedback (human items) it starts with a Writer revision (human_revise); skipReview
 *   sends that revision straight back to awaiting_human (REREVIEW_AFTER_HUMAN=false).
 * @param {{ config?, store, notifier, agents?, now?, onState? }} deps
 */
export async function runPipeline({ config = getConfig(), store, notifier, agents, now = Date.now, briefId = newBriefId(new Date(now())), runId = briefId, lock: useLock = true, signal = null, resume = null } = {}) {
  agents ??= defaultAgents({ config, store, notifier })
  const limits = config.limits
  const dryRun = config.runtime.dryRun
  const counters = { writerRevisions: 0, rebriefs: 0, scoutRetries: 0, designerRevisions: 0, rounds: 0 }
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
  // Phase 10: the guide of the current draft (null: none, the post is reviewed as written; undefined: not built in
  // this run, the Reviewer loads the newest) and the design feedback for the next Experience Designer run.
  let guideDoc
  let designFeedback = []
  let best = null
  let reviews = 0
  const warnings = []
  // Phase 12: what this run writes about (a roadmap slot or a pinned topic); null without the roadmap.
  let target = null
  const ctx = () => ({ runId, briefId, version, round: counters.rounds, leads, brief, briefVersion, draft, review, sourcePack, scoutMode, strategistMode, writerMode, routeFeedback, routeClaims, guideDoc, designFeedback, target, config })

  const setState = (to) => {
    state = assertTransition(state, to)
    log.info('pipeline state', { briefId, state, version })
  }

  async function runLog(entry) {
    const record = { time: istIso(new Date(now())), state, round: counters.rounds, version, ...entry }
    steps.push(record)
    try {
      await saveRunLog(store, { briefId: runId, payload: record, status: entry.result, version })
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
      // A step interrupted by a cancel is "cancelled", not "failed" (also when a later error follows the cancel).
      const cancelled = isCancel(error, signal)
      await runLog({ agent, model: null, ms: now() - started, result: cancelled ? 'cancelled' : 'error', error: cancelled ? null : error.message })
      if (cancelled) emit('step.cancelled', { agent, step: agent, message: 'cancelled', data: { ms: now() - started } })
      else emit('step.failed', { agent, step: agent, message: error.message, data: { ms: now() - started } })
      throw error
    }
  }

  // The Experience Designer on the current draft, if the post is interactive. It never fails the run: an error
  // means no guide (the post is reviewed and published as written).
  async function design() {
    // Phase 11: EXPERIENCE_ENABLED=false: no guide, no step; the Reviewer reviews the post as written.
    if (config.designer?.enabled === false) {
      guideDoc = null
      designFeedback = []
      return
    }
    const latest = draft?.record_id ? (await store.getRecords({ type: 'draft', brief_id: briefId })).find((d) => d.id === draft.record_id) : null
    if (!isInteractive(latest ?? { metadata: {} }, config)) {
      guideDoc = null
      emit('step.output', { agent: 'designer', step: 'designer', message: 'Interactive guides are off for this post: the Experience Designer did not run', data: { placeholder: true } })
      return
    }
    try {
      const out = await step('designer', ctx())
      guideDoc = out?.status === 'ok' && out.guide ? out.guide : null
      warnings.push(...(out?.warnings ?? []))
    } catch (error) {
      if (isCancel(error, signal)) throw error
      guideDoc = null
      warnings.push(`Experience Designer failed (no guide for this version): ${error.message}`)
    }
    designFeedback = []
  }

  async function research() {
    scoutMode = target && target.kind !== 'none' ? 'slot' : 'research'
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
    lock = useLock ? await acquireLock(store, { owner: runId, now, config }) : { release: async () => {} }
  } catch (error) {
    log.warn('pipeline not started', { error })
    return { briefId, state: 'skipped', reason: error.message, steps }
  }

  try {
    if (resume) {
      // reviewer mode with route: start the loop at the review of a saved draft (no Scout, no Strategist).
      const b = await loadBrief(store, briefId, resume.briefVersion)
      if (!b) throw new Error(`no brief ${briefId}`)
      brief = b.payload
      briefVersion = b.payload?.brief_version ?? b.version ?? 1
      briefRecord = { id: b.id, status: b.status }
      const d = await loadDraft(store, briefId, { version: resume.version, briefVersion: resume.briefVersion ?? briefVersion })
      if (!d) throw new Error(`no draft of brief ${briefId}${resume.version ? ` v${resume.version}` : ''}`)
      draft = { record_id: d.id, version: draftVersion(d), brief_version: draftBriefVersion(d), title: d.payload?.title, draft: d.payload }
      version = draft.version
      if (resume.startAt === 'writer') {
        // human_revise (B3): the Writer revises with the human's feedback first.
        writerMode = 'revise'
        routeFeedback = resume.feedback ?? []
      }
      if (resume.startAt === 'designer') {
        // Phase 10 C5 ("Change the design"): only the Experience Designer runs again, with the human's feedback.
        designFeedback = resume.feedback ?? []
      }
    } else {
      if (config.roadmap?.enabled) {
        // Phase 12: a pinned topic that is due, else the next slot of the approved roadmap. Nothing to write: no AI call.
        target = await pickTarget(store, { now })
        if (target.kind === 'none') {
          emit('step.output', { agent: 'orchestrator', step: 'roadmap', message: target.reason, data: {} })
          return { briefId, state: 'skipped', reason: target.reason, error: target.reason, steps, warnings }
        }
        if (target.kind === 'slot') {
          await setSlotStatus(store, { slotId: target.slot.slot_id }, 'drafting', { setBriefId: briefId, now })
          emit('step.output', { agent: 'orchestrator', step: 'roadmap', message: `Next up: stage ${target.stage.number} (${target.stage.name}) · ${target.slot.slot_id} ${target.slot.title_idea}`, data: { slot_id: target.slot.slot_id, stage: target.stage.number } })
        } else emit('step.output', { agent: 'orchestrator', step: 'roadmap', message: `Pinned topic first: ${target.pin.topic}`, data: { pinned_id: target.pin.pinned_id } })
      }
      await research()
      await plan()
    }
    setState('drafting')

    let skipWriter = Boolean(resume) && resume.startAt !== 'writer'
    let redesign = resume?.startAt === 'designer'
    let skipReview = Boolean(resume?.skipReview)
    for (;;) {
      if (skipWriter) skipWriter = false
      else {
        version++
        draft = await step('writer', ctx())
        // The real Writer saves its own draft (and numbers it); a stub's draft is saved here.
        if (draft?.record_id) version = draft.version
        else await store.createRecord({ type: 'draft', briefId, payload: draft, status: 'drafted', version, topicGroup: brief?.topic_group ?? null })
        redesign = true
      }
      if (redesign) {
        redesign = false
        await design()
      }
      setState('reviewing')
      if (skipReview) {
        // REREVIEW_AFTER_HUMAN=false: the human's revision goes straight back to the human.
        skipReview = false
        review = { pass: true, total: null, feedback: [], skipped: true }
        emit('step.output', { agent: 'orchestrator', step: 'approval', message: 'Reviewer skipped (REREVIEW_AFTER_HUMAN=false)', data: { version } })
      } else {
        review = await step('reviewer', ctx())
        reviews++
        // The real Reviewer saves its own review record; a mock's review is saved here.
        if (!review?.record_id) await store.createRecord({ type: 'review', briefId, payload: review, status: review?.pass ? 'pass' : 'fail', version })
      }
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
        setState('awaiting_human')
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
        designFeedback = (review?.feedback ?? []).filter((f) => typeof f === 'object' && f.send_to === 'designer')
      }
      if (decision.action === 'redesign') {
        counters.designerRevisions++
        designFeedback = decision.feedback ?? []
        skipWriter = true
        redesign = true
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

    const summary = await awaitHuman()
    if (target?.kind === 'slot') await setSlotStatus(store, { slotId: target.slot.slot_id }, 'in_review', { now })
    await runLog({ agent: 'orchestrator', model: null, ms: 0, result: 'awaiting_human', error: null })
    return { briefId, state, version, counters, steps, summary, warnings }
  } catch (error) {
    // Once a run is cancelled, a later error (e.g. a network failure mid-step) still ends it as cancelled: no failure alert.
    if (error instanceof CancelledError || signal?.aborted) {
      state = 'cancelled'
      if (target?.kind === 'slot') await setSlotStatus(store, { slotId: target.slot.slot_id }, 'planned', { setBriefId: '', now })
      await runLog({ agent: 'orchestrator', model: null, ms: 0, result: 'cancelled', error: null })
      log.info('pipeline cancelled', { runId, briefId })
      return { runId, briefId, state, version, counters, steps }
    }
    if (state !== 'failed') state = 'failed'
    // Phase 12: the slot is free again (a new run picks it).
    if (target?.kind === 'slot') await setSlotStatus(store, { slotId: target.slot.slot_id }, 'planned', { setBriefId: '', now })
    await runLog({ agent: 'orchestrator', model: null, ms: 0, result: 'failed', error: error.message })
    log.error('pipeline failed', { briefId, error, counters })
    if (error.routing) await failReview(error)
    else await alertFailure(error)
    return { briefId, state, version, counters, steps, error: error.message, warnings }
  } finally {
    await lock.release().catch((error) => log.error('could not release run lock', { error }))
  }

  /** Status update that never fails the run (a warning instead). */
  async function setStatus(id, status, what, extra = {}) {
    if (!id) return
    try {
      await store.updateRecord(id, undefined, { status, ...extra })
    } catch (error) {
      warnings.push(`could not mark the ${what} ${status}: ${error.message}`)
    }
  }

  /** Slack or M91 send that never fails the run; "pending flows" and errors become warnings. */
  async function send(kind, args) {
    try {
      const r = kind === 'slack' ? await notifier.slack(args) : await notifier.m91Alert(args)
      if (r?.skipped === 'pending_flows') warnings.push(`${kind === 'slack' ? 'Slack message' : 'M91 alert'} skipped: pending flows (${r.key} is empty)`)
    } catch (error) {
      warnings.push(`${kind === 'slack' ? 'Slack message' : 'M91 alert'} not sent: ${error.message}`)
    }
  }

  function titleOf() {
    return draft?.title ?? draft?.draft?.title ?? brief?.titles?.[0] ?? briefId
  }

  /** A record id that exists in Mem0 (not a DRY_RUN placeholder), else null. */
  function savedId(id) {
    return id && !String(id).startsWith('dryrun-') ? id : null
  }

  // B1: a Reviewer pass waits for the human (Phase 5.5). Statuses → awaiting_human (only one waiting draft per
  // brief), Slack, the optional M91 nudge, and approval.waiting. The run ends here; the human's decision starts a new run.
  async function awaitHuman() {
    const total = review?.total ?? review?.score ?? null
    const draftId = savedId(draft?.record_id)
    if (draftId) {
      for (const other of await store.getRecords({ type: 'draft', brief_id: briefId })) {
        if (other.id !== draftId && other.status === 'awaiting_human') await setStatus(other.id, 'superseded', 'draft')
      }
    }
    await setStatus(draftId, 'awaiting_human', 'draft', { awaiting_since: istIso(new Date(now())), review_total: total })
    await setStatus(briefRecord?.id, 'awaiting_human', 'brief')
    const title = titleOf()
    const score = total === null ? 'not re-reviewed' : `score ${total}/100`
    await send('slack', `📝 Ready for your approval: *${title}* · ${score} · v${version} · brief ${briefId}`)
    const markdown = draft?.draft?.post_markdown ?? draft?.post_markdown
    // DRY_RUN would only log a preview of each part, and log lines become events: no post text in events.
    if (config.notify.postApproved && markdown && dryRun) log.info('DRY_RUN: draft not posted to Slack', { chars: markdown.length })
    else if (config.notify.postApproved && markdown) await send('slack', markdown)
    if (config.approval.notifyOnAwaiting) await send('m91', { title: 'Blog draft ready for approval', description: `${title} — ${score}. Open the dashboard.`, severity: 'LOW' })
    const summary = `awaiting human approval (v${version}, ${total === null ? 'not re-reviewed' : `score ${total}`})`
    emit('step.output', { agent: 'orchestrator', step: 'approval', message: 'Awaiting human approval', data: { brief_id: briefId, version, total } })
    emit('approval.waiting', { agent: 'orchestrator', message: summary, data: { brief_id: briefId, version, total } })
    return summary
  }

  // D3: limits reached without a pass. Statuses → failed_review / failed, Slack with the best score, LOW M91 alert.
  async function failReview(error) {
    await setStatus(savedId(draft?.record_id), 'failed_review', 'draft')
    await setStatus(briefRecord?.id, 'failed', 'brief')
    const title = titleOf()
    const bestTotal = best?.total ?? '?'
    const must = (review?.feedback ?? []).filter((f) => typeof f === 'object' && f.severity === 'must').slice(0, 3)
    const lines = [
      `❌ Not approved: *${title}* after ${reviews} rounds · best score ${bestTotal}/100`,
      `Stopped: ${error.message}`,
      ...(review?.summary ? [review.summary] : []),
      ...must.map((f, i) => `${i + 1}. ${f.problem}${f.quote ? ` ("${f.quote}")` : ''} → ${f.fix ?? ''}`)
    ]
    await send('slack', lines.join('\n'))
    await send('m91', { title: 'Blog post failed review', description: `${title} — best score ${bestTotal}/100. See Slack.`, severity: 'LOW' })
  }

  // MEDIUM: the pipeline crashed (a failed review is failReview's LOW alert).
  async function alertFailure(error) {
    const severity = 'MEDIUM'
    const what = 'pipeline crashed'
    const text = `M91 blog pipeline: ${what}\nbrief_id: ${briefId}\nversion: ${version}\nwhen: ${istHuman(new Date(now()))}\nreason: ${error.message}`
    try {
      await notifier.slack(text)
      await notifier.m91Alert({ title: `Blog pipeline: ${what} (${briefId})`, description: text, severity })
    } catch (notifyError) {
      log.error('failure notification failed', { briefId, error: notifyError })
    }
  }
}
