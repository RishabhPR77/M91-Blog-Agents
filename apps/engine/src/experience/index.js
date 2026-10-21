// The Experience Designer (Phase 10, C2): turns a draft into an interactive guide before the Reviewer sees it.
// One AI call per draft version, plus at most EXPERIENCE_MAX_REPAIRS repairs when the plan breaks the schema,
// the coverage rule, the limits or the no-new-facts checks. Whatever still fails after that is dropped (its
// parts become prose). If the post's text can't be placed exactly, there is no guide: the post is reviewed and
// published as it is. The Experience Designer never blocks a run.

import { getConfig } from '../config.js'
import { log } from '../util/log.js'
import { istIso, istDate } from '../util/time.js'
import { randomCode } from '../util/ids.js'
import { createViaSocketClient } from '../viasocket.js'
import { throwIfCancelled, CancelledError, isCancel } from '../events.js'
import { loadBrief } from '../writer/inputs.js'
import { draftVersion, draftBriefVersion, draftsOf } from '../writer/save.js'
import { loadDraft, loadFacts } from '../reviewer/inputs.js'
import { parseParts, bodyMarkdown } from '../designer/parts.js'
import { saveRunLog } from '../util/runlog.js'
import { experience_plan, planSchemaErrors } from './schemas.js'
import { buildExperiencePrompt, buildExperienceMessage, experienceRepairTail } from './prompts.js'
import { buildGuide } from './build.js'
import { guideCorpus, factProblems } from './checks.js'
import { bodyHash } from '../publisher/blocks.js'

export class ExperienceError extends Error {
  constructor(message, { kind, status = 400 } = {}) {
    super(message)
    this.name = 'ExperienceError'
    this.status = status
    if (kind) this.kind = kind
  }
}

export const experienceThreadId = (briefId, version) => `experience-${briefId}-v${version}-${randomCode(4).toLowerCase()}`

/** Drafts the Experience Designer may run on alone (re-run, "Change the design"): waiting, approved or published. */
export const DESIGNABLE_STATUSES = Object.freeze(['awaiting_human', 'approved', 'published'])

/** The newest such draft of a brief (or that version), or null. */
export async function designableDraft(store, briefId, { version } = {}) {
  return (await draftsOf(store, briefId)).find((d) => DESIGNABLE_STATUSES.includes(d.status) && (version == null || draftVersion(d) === Number(version))) ?? null
}

/** Is the post interactive? The draft's own flag, else INTERACTIVE_DEFAULT. */
export const isInteractive = (draftRec, config) => (typeof draftRec?.metadata?.interactive === 'boolean' ? draftRec.metadata.interactive : config.designer.interactiveDefault)

/** The newest guide_doc of a brief's draft version (and brief version, if given), or null. */
export async function latestGuideDoc(store, briefId, version, briefVersion) {
  const docs = await store.getRecords({ type: 'guide_doc', brief_id: briefId })
  return docs
    .filter((d) => Number(d.payload?.version ?? d.version) === Number(version) && (briefVersion == null || Number(d.payload?.brief_version ?? 1) === Number(briefVersion)))
    .sort((a, b) => String(b.payload?.created_at ?? b.createdAt ?? b.date).localeCompare(String(a.payload?.created_at ?? a.createdAt ?? a.date)))[0] ?? null
}

/** "6 chapters · 5 components: journey_steps, faq · 1 dropped · checks passed" */
export function experienceSummary({ guide, dropped = [], error }) {
  if (!guide) return `no guide (the post is shown as written): ${error ?? 'unknown reason'}`
  const types = guide.chapters.flatMap((c) => c.components.map((x) => x.type)).filter((t) => t !== 'prose')
  return [`${guide.chapters.length} chapters`, `${types.length} component${types.length === 1 ? '' : 's'}${types.length ? `: ${[...new Set(types)].join(', ')}` : ''}`, dropped.length ? `${dropped.length} dropped` : null, 'checks passed'].filter(Boolean).join(' · ')
}

const keyLabel = (key) => (/^\d+:\d+$/.test(key) ? `chapter ${Number(key.split(':')[0]) + 1} component ${Number(key.split(':')[1]) + 1}` : key)

/**
 * @param {{ briefId, version?, briefVersion?, runId?, draft?, brief?, facts?, feedback?: object[] }} params
 *   draft/brief/facts: in-memory hand-over (DRY_RUN); feedback: the Reviewer's or the editor's design items
 * @param {{ config?, store, aiSend?, now? }} deps
 */
export async function runExperience(params = {}, deps = {}) {
  const config = deps.config ?? getConfig()
  const store = deps.store
  const now = deps.now ?? Date.now
  const dc = config.designer
  if (!params.briefId) throw new ExperienceError('runExperience needs a brief_id')
  const aiSend = deps.aiSend ?? createViaSocketClient({ config }).aiSend
  const runId = params.runId ?? params.briefId
  const dry = config.runtime.dryRun
  const calls = []
  const warnings = []
  const started = now()

  const draftRec = (await loadDraft(store, params.briefId, { version: params.version, briefVersion: params.briefVersion })) ??
    (dry && params.draft ? { id: null, version: params.draft.version, metadata: { brief_version: params.draft.brief_version }, payload: params.draft } : null)
  if (!draftRec) throw new ExperienceError(`brief ${params.briefId} has no draft${params.version ? ` v${params.version}` : ''}`, { kind: 'no_draft', status: 404 })
  const draft = draftRec.payload ?? {}
  const version = draftVersion(draftRec)
  const briefVersion = draftBriefVersion(draftRec)
  const brief = (await loadBrief(store, params.briefId, briefVersion))?.payload ?? params.brief ?? {}
  const facts = params.facts ?? (await loadFacts(store))
  const snippets = draft.snippets ?? []
  const parsed = parseParts(bodyMarkdown(draft.post_markdown))
  const title = String(draft.title ?? brief.titles?.[0] ?? '')
  const feedback = params.feedback ?? []
  const previous = feedback.length ? await latestGuideDoc(store, params.briefId, version, briefVersion) : null
  const corpus = guideCorpus({ draft, brief, facts, snippets })
  const claimsToAvoid = brief.claims_to_avoid ?? []
  const prompt = buildExperiencePrompt(config)
  const message = buildExperienceMessage({ title, parts: parsed.parts, snippets, brief, facts, config, feedback, previousPlan: previous?.payload?.plan ?? null })
  const threadId = experienceThreadId(params.briefId, version)

  async function runLog(entry) {
    const record = { run_id: runId, brief_id: params.briefId, agent: 'designer', time: istIso(new Date(now())), ...entry }
    calls.push(record)
    log.info('experience designer call', record)
    try {
      await saveRunLog(store, { briefId: runId, payload: record, status: entry.error ? 'error' : entry.result })
    } catch (e) {
      log.error('could not write experience designer run_log', { error: e })
    }
  }

  /** Builds and checks a plan: { built, facts, problems } (problems = what a repair should fix). */
  const evaluate = (plan, drop) => {
    const built = buildGuide(plan, { title, parsed, snippets, maxComponents: dc.maxComponents, drop })
    const found = factProblems(built.authored, { corpus, claimsToAvoid })
    return { built, facts: found, problems: [...built.problems, ...found.map((f) => `${keyLabel(f.key)} ${f.field}: ${f.problem}`)] }
  }

  async function send(call, tail = '') {
    throwIfCancelled()
    const t0 = now()
    try {
      const r = await aiSend({ agent: 'designer', call, prompt, message: tail ? `${message}\n\n${tail}` : message, jsonSchema: experience_plan, threadId, retries: config.viasocket.maxRetries })
      const errors = planSchemaErrors(r.content)
      const checked = errors.length ? null : evaluate(r.content)
      const problems = errors.length ? errors : checked.problems
      await runLog({ call, model: r.model ?? dc.model, delivery: r.delivery ?? dc.delivery, ms: r.ms ?? now() - t0, result: errors.length ? 'schema_invalid' : problems.length ? 'with_problems' : 'ok', problems: problems.slice(0, 10), error: null })
      return { plan: errors.length ? null : r.content, raw: r.content, problems, checked, model: r.model ?? dc.model }
    } catch (error) {
      if (error instanceof CancelledError || isCancel(error)) throw error
      await runLog({ call, model: dc.model, delivery: dc.delivery, ms: now() - t0, result: 'error', problems: [], error: error.message })
      return { plan: null, raw: null, problems: [], model: dc.model, failed: error.message }
    }
  }

  let res = await send('designer')
  let repairs = 0
  while (!res.failed && res.problems.length && repairs < dc.maxRepairs) {
    repairs++
    const next = await send('designer_repair', experienceRepairTail(res.raw, res.problems))
    // A repair that came back worse (or failed) never replaces a usable plan.
    if (next.plan || !res.plan) res = next.failed && res.plan ? res : next
  }

  let error = null
  let result = res.checked
  const firstFacts = result?.facts ?? []
  if (res.failed) error = `the call failed: ${res.failed}`
  else if (!res.plan) error = `the plan did not match the schema after ${repairs} repair(s): ${res.problems.slice(0, 3).join('; ')}`
  else if (result.facts.length) {
    // Still failing the checks after the repair: drop what failed (components, the hero, a chapter's own text).
    const drop = new Set(result.facts.map((f) => f.key))
    result = evaluate(res.plan, drop)
    if (result.facts.length) error = `the checks still failed after dropping: ${result.facts.slice(0, 3).map((f) => f.problem).join('; ')}`
  }
  const guide = !error && result?.built.guide ? result.built.guide : null
  if (!error && !guide) error = result?.built.coverage.passed === false ? result.built.coverage.details.join('; ') : `the guide could not be built: ${result?.built.problems.slice(0, 3).join('; ')}`
  const dropped = result?.built.dropped ?? []
  for (const d of dropped) warnings.push(`Experience Designer: ${d.type ?? 'component'} in chapter ${d.chapter} dropped: ${d.reason}`)
  if (error) warnings.push(`Experience Designer: no guide, the post is shown as written: ${error}`)

  throwIfCancelled()
  const status = guide ? 'ok' : 'fallback'
  const summary_line = experienceSummary({ guide, dropped, error })
  const payload = {
    brief_id: params.briefId, brief_version: briefVersion, version,
    plan: res.plan ?? null,
    guide,
    // The Publisher uses the guide only with exactly this body (a later edit means a new Experience Designer run).
    body_sha256: bodyHash(parsed.markdown),
    dropped,
    coverage: result?.built.coverage ?? { passed: false, details: error ? [error] : [] },
    checks: { first: firstFacts, final: result?.facts ?? [], problems: result?.problems ?? res.problems },
    feedback,
    error,
    summary: summary_line,
    model_used: res.model,
    repairs_used: repairs,
    ms: now() - started,
    created_at: istIso(new Date(now()))
  }
  const record = await store.createRecord({ type: 'guide_doc', briefId: params.briefId, payload, status, version, date: istDate(), meta: { brief_version: briefVersion } })
  if (dry) log.info('DRY_RUN: guide_doc not saved', { status, chapters: guide?.chapters.length ?? 0, dropped: dropped.length })
  return { brief_id: params.briefId, version, brief_version: briefVersion, status, guide, dropped, coverage: payload.coverage, checks: payload.checks, record_id: record.id, model_used: res.model, repairs_used: repairs, warnings, calls, summary_line, error }
}
