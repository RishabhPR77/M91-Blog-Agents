// The human approval gate (Phase 5.5, Part B). The Reviewer is the automatic gate; a draft it passes
// waits at awaiting_human. These run modes carry out the human's decision: approve, request changes
// (a counter prompt), or reject the topic. Only an approval leads to the promo pack and publishing.

import { log } from './util/log.js'
import { istIso } from './util/time.js'
import { emit, isCancel } from './events.js'
import { loadBrief } from './writer/inputs.js'
import { loadDraft } from './reviewer/inputs.js'
import { quoteFound } from './reviewer/decide.js'
import { draftVersion, draftBriefVersion, draftsOf } from './writer/save.js'
import { runPromo } from './promo/index.js'
import { createPublisher } from './publisher/index.js'
import { setLeadStatus } from './strategist/save.js'

export const FEEDBACK_MIN_CHARS = 5
export const FEEDBACK_MAX_CHARS = 2000

export class ApprovalError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ApprovalError'
    this.code = code
    this.status = status
  }
}

/**
 * The brief's newest draft; throws 409 unless it is awaiting_human.
 * allowApproved (counter prompts only): an approved draft that is not published may be reopened. A published
 * draft has the status "published" (the Publisher sets it), so it is refused: unpublish it first.
 */
export async function requireAwaiting(store, briefId, { allowApproved = false } = {}) {
  const d = await loadDraft(store, briefId)
  if (!d) throw new ApprovalError('unknown_draft', `no draft of brief ${briefId}`, 404)
  if (allowApproved && d.status === 'approved') return d
  if (allowApproved && d.status === 'published') {
    throw new ApprovalError('published', `the latest draft of ${briefId} (v${draftVersion(d)}) is live on the blog: unpublish it first, then send a counter prompt`, 409)
  }
  if (d.status !== 'awaiting_human') throw new ApprovalError('not_awaiting_human', `the latest draft of ${briefId} (v${draftVersion(d)}) is ${d.status ?? 'unknown'}, not awaiting_human${allowApproved ? ' or approved' : ''}`, 409)
  return d
}

/** The newest review record of this draft version (and brief version), or null. */
export async function reviewOfDraft(store, d) {
  const reviews = await store.getRecords({ type: 'review', brief_id: d.briefId ?? d.payload?.brief_id })
  return reviews
    .filter((r) => Number(r.payload?.version ?? r.version) === draftVersion(d) && Number(r.payload?.brief_version ?? r.metadata?.brief_version ?? 1) === draftBriefVersion(d))
    .sort((a, b) => String(b.createdAt ?? b.date).localeCompare(String(a.createdAt ?? a.date)))[0] ?? null
}

/** True when the draft's own hard content checks passed (missing results count as not passed). */
export const hardChecksPassed = (d) => d?.payload?.checks?.hard_passed === true

export const NOT_REVIEWED_MESSAGE = 'This version was not checked by the Reviewer. Review it first, or approve with force_unreviewed.'

/** Counter prompts already used for a brief: drafts that carry human_feedback. */
export async function humanRevisionsUsed(store, briefId) {
  return (await draftsOf(store, briefId)).filter((d) => d.payload?.human_feedback).length
}

/** The human's counter prompt as Writer feedback items (B5): one per quote, or one without a quote. */
export function humanFeedbackItems(text, quotes = []) {
  const item = (quote) => ({ source: 'human', area: 'human', quote, problem: text, fix: text, severity: 'must' })
  return quotes.length ? quotes.map(item) : [item('')]
}

/**
 * Checks a decision before its run starts (so the API can answer 400 / 404 / 409 at once).
 * mode: approve | human_revise | reject_topic | approval_review.
 * approve: the draft's hard content checks must have passed (always; force_unreviewed never overrides that),
 * and with REREVIEW_AFTER_HUMAN=true it needs a passing review unless params.force_unreviewed is true.
 */
export async function checkDecision(mode, params, { store, config }) {
  if (typeof params.brief_id !== 'string' || !params.brief_id.trim()) throw new ApprovalError('bad_params', `${mode} needs params.brief_id`)
  if (mode === 'approve' && params.force_unreviewed !== undefined && typeof params.force_unreviewed !== 'boolean') {
    throw new ApprovalError('bad_params', 'force_unreviewed must be true or false')
  }
  if (mode === 'human_revise') {
    const fb = params.feedback
    if (typeof fb !== 'string' || fb.trim().length < FEEDBACK_MIN_CHARS || fb.length > FEEDBACK_MAX_CHARS) {
      throw new ApprovalError('bad_params', `feedback must be ${FEEDBACK_MIN_CHARS}–${FEEDBACK_MAX_CHARS.toLocaleString('en-US')} characters`)
    }
    if (params.quotes !== undefined && !(Array.isArray(params.quotes) && params.quotes.every((q) => typeof q === 'string' && q.trim()))) {
      throw new ApprovalError('bad_params', 'quotes must be a list of exact sentences from the draft')
    }
  }
  if (mode === 'reject_topic' && params.reason !== undefined && (typeof params.reason !== 'string' || params.reason.length > FEEDBACK_MAX_CHARS)) {
    throw new ApprovalError('bad_params', `reason must be text of at most ${FEEDBACK_MAX_CHARS.toLocaleString('en-US')} characters`)
  }
  const d = await requireAwaiting(store, params.brief_id, { allowApproved: mode === 'human_revise' })
  if (mode === 'human_revise') {
    const missing = (params.quotes ?? []).filter((q) => !quoteFound(d.payload?.post_markdown, q))
    if (missing.length) throw new ApprovalError('quote_not_found', `quote(s) not found in the draft: ${missing.map((q) => `"${q.slice(0, 80)}"`).join(', ')}`)
    const used = await humanRevisionsUsed(store, params.brief_id)
    if (used >= config.approval.maxHumanRevisions) {
      throw new ApprovalError('max_human_revisions', `MAX_HUMAN_REVISIONS (${config.approval.maxHumanRevisions}) counter prompts already used for ${params.brief_id}: approve or reject the topic`, 409)
    }
  }
  if (mode === 'approve') {
    if (!hardChecksPassed(d)) {
      throw new ApprovalError('hard_checks_failed', `v${draftVersion(d)} of ${params.brief_id} did not pass the hard content checks: send a counter prompt or reject the topic (force_unreviewed does not override this)`, 409)
    }
    const review = await reviewOfDraft(store, d)
    if (config.approval.rereviewAfterHuman && review?.payload?.pass !== true && params.force_unreviewed !== true) {
      throw new ApprovalError('not_reviewed', NOT_REVIEWED_MESSAGE, 409)
    }
  }
  return d
}

// Lead kind → record type and id field (the Strategist's lead index).
const LEAD_TYPES = { pinned: ['pinned_topic', 'pinned_id'], cluster: ['question_cluster', 'cluster_id'], story: ['story_lead', 'story_id'], tutorial: ['tutorial_lead', 'tutorial_id'] }

/** The record a brief's lead points to, or null. */
export async function findLeadRecord(store, lead) {
  const spec = LEAD_TYPES[lead?.kind]
  if (!spec) return null
  return (await store.getRecords({ type: spec[0] })).find((r) => r.payload?.[spec[1]] === lead.id) ?? null
}

/** Slack / M91 send that never fails the run: "pending flows" and errors become warnings. */
async function notifySafe(notifier, warnings, kind, args) {
  try {
    const r = kind === 'slack' ? await notifier.slack(args) : await notifier.m91Alert(args)
    if (r?.skipped === 'pending_flows') warnings.push(`${kind === 'slack' ? 'Slack message' : 'M91 alert'} skipped: pending flows (${r.key} is empty)`)
  } catch (error) {
    warnings.push(`${kind === 'slack' ? 'Slack message' : 'M91 alert'} not sent: ${error.message}`)
  }
}

/**
 * B2: the human approves. Statuses → approved (approved_by "human", approved_at), the promo pack (never
 * blocks), placeholder Designer and Publisher steps, Slack, approval.approved.
 * ctx: { briefId, runId, config, store, notifier, agents?, runStep(agent, fn), now }
 */
export async function runApprove({ briefId, runId, params = {}, config, store, notifier, agents, runStep, now = Date.now, publisher = null }) {
  const warnings = []
  // The same gate as before the run starts: awaiting_human, hard checks passed, reviewed (or force_unreviewed).
  const d = await checkDecision('approve', { ...params, brief_id: briefId }, { store, config })
  const version = draftVersion(d)
  const briefVersion = draftBriefVersion(d)
  const at = istIso(new Date(now()))
  const briefRec = await loadBrief(store, briefId, briefVersion)
  // approved_unreviewed: no passing review of this version (force_unreviewed, or REREVIEW_AFTER_HUMAN=false).
  const unreviewed = (await reviewOfDraft(store, d))?.payload?.pass !== true
  if (unreviewed) warnings.push(`v${version} approved without a Reviewer pass (${params.force_unreviewed === true ? 'force_unreviewed' : 'REREVIEW_AFTER_HUMAN=false'})`)
  await store.updateRecord(d.id, undefined, { status: 'approved', approved_by: 'human', approved_at: at, approved_unreviewed: unreviewed })
  if (briefRec?.id) await store.updateRecord(briefRec.id, undefined, { status: 'approved', approved_by: 'human', approved_at: at })
  const total = d.metadata?.review_total ?? null

  let promo = null
  try {
    const inMemory = config.runtime.dryRun ? { ...d.payload, version, brief_version: briefVersion } : null
    promo = await runStep('promo', async () => (agents?.promo
      ? (await agents.promo({ runId, briefId, briefVersion, draft: { version, brief_version: briefVersion, draft: inMemory }, brief: briefRec?.payload, config })).output
      : runPromo({ briefId, runId, version, briefVersion, draft: inMemory, brief: briefRec?.payload }, { config, store })))
    if (promo?.status === 'with_issues') warnings.push(...(promo.warnings ?? []))
  } catch (error) {
    if (isCancel(error)) throw error
    warnings.push(`promo pack failed (approval stands): ${error.message}`)
  }
  // Phase 8 replaces the Designer placeholder; until then the post goes out as Markdown.
  await runStep('designer', async () => {
    const message = 'Designer: not built yet (Phase 8)'
    log.info(message, { briefId, version })
    return { placeholder: true, message }
  })

  const title = d.payload?.title ?? briefRec?.payload?.titles?.[0] ?? briefId
  await notifySafe(notifier, warnings, 'slack', `✅ Approved by you: *${title}* · v${version}`)
  if (promo?.pack) await notifySafe(notifier, warnings, 'slack', `Promo pack preview (${promo.status}):\n\nLinkedIn:\n${promo.pack.linkedin_post}\n\nNewsletter:\n${promo.pack.newsletter_blurb}`)
  emit('approval.approved', { agent: 'human', message: `approved by you (v${version}${unreviewed ? ', unreviewed' : ''})`, data: { brief_id: briefId, version, total, approved_unreviewed: unreviewed } })
  const scoreText = unreviewed ? ', not reviewed' : total === null ? '' : `, score ${total}`

  // Phase 7 C2: AUTO_PUBLISH=true publishes straight away; false (the kill switch) stops at approved.
  let published = null
  if (config.runtime.autoPublish) {
    try {
      published = await runStep('publisher', async () => (publisher ?? createPublisher({ config, store, notifier })).publish({ briefId }))
      warnings.push(...(published?.warnings ?? []))
    } catch (error) {
      if (isCancel(error)) throw error
      warnings.push(`publish failed (the post stays approved): ${error.message}`)
    }
  } else {
    await runStep('publisher', async () => {
      const message = 'Publishing is off (AUTO_PUBLISH=false): use Publish in the dashboard'
      log.info(message, { briefId, version })
      return { placeholder: true, message }
    })
  }
  const pubText = published?.url ? `; published → ${published.url}` : ''
  return { status: 'succeeded', brief_id: briefId, summary: `approved by you (v${version}${scoreText})${pubText}`, warnings, run_fields: { approved_unreviewed: unreviewed } }
}

/**
 * The human asks for one review of the waiting version (no routing loop): 1 Reviewer call. The review is
 * recorded and the draft stays awaiting_human, on a pass or a fail; the score is saved on the draft.
 * ctx: { briefId, runId, config, store, agents, runStep, now }
 */
export async function runApprovalReview({ briefId, runId, config, store, agents, runStep, now = Date.now }) {
  const d = await checkDecision('approval_review', { brief_id: briefId }, { store, config })
  const version = draftVersion(d)
  const briefVersion = draftBriefVersion(d)
  const briefRec = await loadBrief(store, briefId, briefVersion)
  const draft = { record_id: d.id, version, brief_version: briefVersion, title: d.payload?.title, draft: d.payload }
  const review = await runStep('reviewer', async () => (await agents.reviewer({ runId, briefId, version, briefVersion, draft, brief: briefRec?.payload, config })).output)
  // The real Reviewer saves its own review record; a mock's review is saved here.
  if (!review?.record_id) await store.createRecord({ type: 'review', briefId, payload: { ...review, version, brief_version: briefVersion }, status: review?.pass ? 'pass' : 'fail', version, meta: { brief_version: briefVersion, pass: Boolean(review?.pass), total: review?.total ?? null } })
  const total = review?.total ?? review?.score ?? null
  await store.updateRecord(d.id, undefined, { review_total: total, reviewed_at: istIso(new Date(now())) })
  const verdict = review?.pass ? 'pass' : 'fail'
  emit('approval.reviewed', { agent: 'reviewer', message: `v${version} reviewed: ${verdict}`, data: { brief_id: briefId, version, total, pass: Boolean(review?.pass) } })
  const next = review?.pass ? 'still awaiting your approval' : 'still awaiting you: send a counter prompt, reject the topic, or approve with force_unreviewed'
  return { status: 'succeeded', brief_id: briefId, summary: `review of v${version}: ${verdict}${total === null ? '' : ` (score ${total})`}; ${next}`, warnings: review?.warnings ?? [] }
}

/**
 * B3: the human sends a counter prompt. The waiting draft → changes_requested with human_feedback, then the
 * pipeline resumes with a Writer revision (and the Reviewer and routing loop unless REREVIEW_AFTER_HUMAN=false).
 * ctx: { briefId, runId, params, config, store, notifier, agents, runPipeline, signal, now }
 */
export async function runHumanRevise({ briefId, runId, params, config, store, notifier, agents, runPipeline, signal, now = Date.now }) {
  const d = await checkDecision('human_revise', { ...params, brief_id: briefId }, { store, config })
  const version = draftVersion(d)
  const briefVersion = draftBriefVersion(d)
  const at = istIso(new Date(now()))
  const quotes = params.quotes ?? []
  const used = await humanRevisionsUsed(store, briefId)
  // A counter prompt on an approved (not published) draft reopens it: the approval no longer stands, and the
  // brief waits for the human again until the new version is approved. Who and when are kept on both records.
  const reopened = d.status === 'approved'
  const reopen = reopened ? { reopened_by: 'human', reopened_at: at, reopened_from: 'approved' } : {}
  await store.updateRecord(d.id, { ...d.payload, human_feedback: { text: params.feedback, quotes, at } }, { status: 'changes_requested', human_feedback_at: at, ...reopen })
  if (reopened) {
    const briefRec = await loadBrief(store, briefId, briefVersion)
    if (briefRec?.id) await store.updateRecord(briefRec.id, undefined, { status: 'awaiting_human', ...reopen })
  }
  emit('approval.changes_requested', { agent: 'human', message: `changes requested on v${version}${reopened ? ' (reopened from approved)' : ''}`, data: { brief_id: briefId, version, human_revisions_used: used + 1, max: config.approval.maxHumanRevisions, reopened } })
  const r = await runPipeline({
    config, store, notifier, agents, now, runId, briefId, lock: false, signal,
    resume: { version, briefVersion, startAt: 'writer', feedback: humanFeedbackItems(params.feedback, quotes), skipReview: !config.approval.rereviewAfterHuman }
  })
  const status = r.state === 'awaiting_human' ? 'succeeded' : r.state === 'cancelled' ? 'cancelled' : 'failed'
  return { status, brief_id: briefId, summary: r.error ?? r.summary ?? `human revision ${r.state}`, error: r.error, warnings: r.warnings }
}

/**
 * B4: the human rejects the topic. Brief and draft → rejected, the lead → discarded (never picked again),
 * the reason saved as a lesson. No AI call.
 */
export async function runRejectTopic({ briefId, params = {}, config, store }) {
  const warnings = []
  const d = await checkDecision('reject_topic', { ...params, brief_id: briefId }, { store, config })
  const version = draftVersion(d)
  const briefRec = await loadBrief(store, briefId, draftBriefVersion(d))
  const at = istIso(new Date())
  await store.updateRecord(d.id, undefined, { status: 'rejected', rejected_at: at })
  if (briefRec?.id) await store.updateRecord(briefRec.id, undefined, { status: 'rejected', rejected_at: at })
  const lead = briefRec?.payload?.lead
  const leadRec = await findLeadRecord(store, lead)
  if (leadRec) {
    const w = await setLeadStatus(store, leadRec, 'discarded')
    if (w) warnings.push(w)
  } else warnings.push(`lead ${lead?.kind ?? '?'} ${lead?.id ?? '?'} not found: not discarded`)
  const reason = String(params.reason ?? '').trim()
  if (reason) await store.addLesson(`Topic rejected by the human: ${reason}`, { source: 'human', brief_id: briefId })
  emit('approval.rejected', { agent: 'human', message: `topic rejected (v${version})`, data: { brief_id: briefId, version, lead: lead ?? null, lesson_saved: Boolean(reason) } })
  return { status: 'succeeded', brief_id: briefId, summary: `topic rejected (v${version})${leadRec ? `; lead ${lead.kind} ${lead.id} discarded` : ''}`, warnings }
}
