// The Reviewer (Phase 5 brief, Part B): the strict, final check before a post is approved.
// The AI judges gates and areas with evidence; the code decides pass or fail (decide.js).

import { getConfig } from '../config.js'
import { log } from '../util/log.js'
import { istIso, istDate } from '../util/time.js'
import { randomCode } from '../util/ids.js'
import { createViaSocketClient } from '../viasocket.js'
import { throwIfCancelled, CancelledError } from '../events.js'
import { urlKey } from '../checks/content.js'
import { loadBrief } from '../writer/inputs.js'
import { draftVersion, draftBriefVersion } from '../writer/save.js'
import { reviewer_result, reviewSchemaErrors } from './schemas.js'
import { buildReviewerPrompt, reviewRepairTail, quotesProblem } from './prompts.js'
import { loadDraft, loadFacts, loadPreviousReview, buildReviewerSections, buildReviewerMessage } from './inputs.js'
import { decide, missingQuotes, reviewSummaryLine } from './decide.js'
import { latestGuideDoc } from '../experience/index.js'
import { guideText } from '../experience/review.js'
import { saveRunLog } from '../util/runlog.js'

export class ReviewerError extends Error {
  constructor(message, { kind } = {}) {
    super(message)
    this.name = 'ReviewerError'
    if (kind) this.kind = kind
  }
}

const FATAL_KINDS = ['config', 'token', 'billing']

/** Fresh thread per call, never reused: reviewer-<brief_id>-v<version>-<4 random>. */
export const reviewerThreadId = (briefId, version) => `reviewer-${briefId}-v${version}-${randomCode(4).toLowerCase()}`

/**
 * Reviews one draft.
 * @param {{ briefId, version?, briefVersion?, runId?, draft?, brief?, previousReview?, facts?, sourcePack?, guideDoc? }} params
 *   guideDoc: the guide built in this run (null: none); undefined: the newest "ok" guide_doc of this version.
 *   draft/brief/previousReview/facts: in-memory hand-over for DRY_RUN (nothing was saved).
 * @param {{ config?, store, aiSend?, now? }} deps
 */
export async function runReviewer(params = {}, deps = {}) {
  const config = deps.config ?? getConfig()
  const store = deps.store
  const now = deps.now ?? Date.now
  const rc = config.reviewer
  if (!params.briefId) throw new ReviewerError('runReviewer needs a brief_id')
  const aiSend = deps.aiSend ?? createViaSocketClient({ config }).aiSend
  const runId = params.runId ?? params.briefId
  const started = now()
  const calls = []
  const dry = config.runtime.dryRun

  // ---------- inputs ----------
  const inMemoryDraft = dry && params.draft ? { id: null, version: params.draft.version, metadata: { brief_version: params.draft.brief_version }, payload: params.draft } : null
  const draftRec = (await loadDraft(store, params.briefId, { version: params.version, briefVersion: params.briefVersion })) ?? inMemoryDraft
  if (!draftRec) throw new ReviewerError(`no draft of brief ${params.briefId}${params.version ? ` v${params.version}` : ''} to review`)
  const draft = draftRec.payload
  const version = draftVersion(draftRec)
  const briefVersion = draftBriefVersion(draftRec)
  const briefRec = (await loadBrief(store, params.briefId, briefVersion)) ?? (dry && params.brief ? { payload: params.brief } : null)
  if (!briefRec) throw new ReviewerError(`no brief ${params.briefId} v${briefVersion}`)
  const brief = briefRec.payload
  const facts = params.facts ?? (await loadFacts(store))
  const sourcePack = params.sourcePack ?? (await store.getRecords({ type: 'source_pack', brief_id: params.briefId })).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.payload ?? null
  const story = brief.story?.use ? (await store.getRecords({ type: 'story_lead' })).find((r) => r.payload?.story_id === brief.story.story_id)?.payload ?? null : null
  const current = { version, metadata: { brief_version: briefVersion } }
  const previousReview = version > 1 || briefVersion > 1 ? params.previousReview ?? (await loadPreviousReview(store, params.briefId, current)) : null
  let guide = params.guideDoc
  if (guide === undefined) {
    const doc = await latestGuideDoc(store, params.briefId, version, briefVersion)
    guide = doc?.status === 'ok' ? doc.payload?.guide ?? null : null
  }
  const { sections, allowed } = await buildReviewerSections({ store, config, draft, brief, facts, sourcePack, story, previousReview, snippets: draft.snippets ?? [], guide })
  const prompt = buildReviewerPrompt(config)
  const warnings = []
  if (!facts) warnings.push('no current m91_facts record: the Reviewer judged M91 claims without M91 FACTS')

  // ---------- AI calls ----------
  async function runLog(entry) {
    const record = { run_id: runId, brief_id: params.briefId, agent: 'reviewer', time: istIso(new Date(now())), ...entry }
    calls.push(record)
    log.info('reviewer call', record)
    try {
      await saveRunLog(store, { briefId: runId, payload: record, status: entry.error ? 'error' : entry.result })
    } catch (e) {
      log.error('could not write reviewer run_log', { error: e })
    }
  }

  /** One call on a fresh thread. Returns { answer, problems, model }. */
  async function send(call, tail = '') {
    throwIfCancelled()
    const { message, trimmed } = buildReviewerMessage(sections, tail)
    if (trimmed.length) warnings.push(`message trimmed to fit 50,000 characters: ${trimmed.join(', ')}`)
    const t0 = now()
    try {
      const r = await aiSend({ agent: 'reviewer', call, prompt, message, jsonSchema: reviewer_result, threadId: reviewerThreadId(params.briefId, version), retries: config.viasocket.maxRetries })
      const problems = reviewSchemaErrors(r.content)
      await runLog({ call, model: r.model ?? rc.model, delivery: r.delivery ?? rc.delivery, ms: r.ms ?? now() - t0, result: problems.length ? 'schema_invalid' : 'ok', problems, error: null })
      return { answer: r.content, problems, model: r.model ?? rc.model }
    } catch (error) {
      if (error instanceof CancelledError) throw error
      await runLog({ call, model: rc.model, delivery: rc.delivery, ms: now() - t0, result: 'error', problems: [], error: error.message })
      if (FATAL_KINDS.includes(error?.kind)) throw new ReviewerError(`${call} call failed (${error.kind}): ${error.message}`, { kind: error.kind })
      return { answer: null, problems: [`call failed: ${error.message}`], model: rc.model, error }
    }
  }

  let repairs = 0
  let res = await send('review')
  // B6.1: one repair call, then retries within AI_MAX_RETRIES, then the run fails.
  for (let tries = 0; res.problems.length; tries++) {
    if (tries > (config.viasocket.maxRetries ?? 3)) throw new ReviewerError(`no valid review after ${tries} repair(s): ${res.problems.slice(0, 3).join('; ')}`, { kind: 'schema' })
    repairs++
    res = await send('review_repair', res.answer ? reviewRepairTail(res.answer, res.problems) : '')
  }
  // B6.3: more than half the quotes missing → one repair call asking for exact quotes.
  const missing = missingQuotes(`${draft.post_markdown}\n${guideText(guide)}`, res.answer.feedback)
  if (res.answer.feedback.length && missing.length > res.answer.feedback.length / 2) {
    repairs++
    const fixed = await send('review_repair', reviewRepairTail(res.answer, [quotesProblem(missing)]))
    if (!fixed.problems.length) res = fixed
    else warnings.push('the quote repair answer was not valid; kept the first answer')
  }

  // ---------- decide ----------
  throwIfCancelled()
  const d = decide(res.answer, { markdown: draft.post_markdown, checkResults: draft.checks?.results ?? [], allowedUrls: allowed.set, urlKey, config, guide, guideText: guideText(guide) })
  warnings.push(...d.warnings)
  for (const w of d.warnings) log.warn('reviewer', { briefId: params.briefId, version, warning: w })
  const ms = now() - started
  const payload = {
    brief_id: params.briefId, brief_version: briefVersion, version,
    gates: d.gates, areas: d.areas, total: d.total, pass: d.pass, feedback: d.feedback, fixed_previous: d.fixed_previous,
    sources_checked: d.sources_checked, lessons: d.lessons, summary: d.summary, model_used: res.model, ms, repairs_used: repairs,
    guide_reviewed: Boolean(guide)
  }

  // ---------- save (B7) ----------
  throwIfCancelled()
  const record = await store.createRecord({ type: 'review', briefId: params.briefId, payload, status: d.pass ? 'pass' : 'fail', version, date: istDate(), meta: { brief_version: briefVersion, pass: d.pass, total: d.total } })
  if (dry) log.info('DRY_RUN: review not saved', { review: payload })

  // C3: each lesson goes to Mem0 with inference on, so similar lessons merge. DRY_RUN logs them instead.
  for (const text of d.lessons) {
    try {
      await store.addLesson(text, { source: 'reviewer', brief_id: params.briefId })
    } catch (error) {
      warnings.push(`lesson not saved (${error.message}): ${text}`)
    }
  }

  const result = { ...payload, record_id: record.id, route_hint: d.route_hint, low_areas: d.low_areas, warnings, draft_record_id: draftRec.id ?? null }
  result.summary_line = reviewSummaryLine(result)
  return { ...result, calls }
}
