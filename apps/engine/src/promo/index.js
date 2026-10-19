// The promo pack (Phase 5 brief, D1): short promotion texts for one approved post.
// A promo problem never blocks approval: a pack that still fails its checks is saved "with_issues".

import { getConfig } from '../config.js'
import { log } from '../util/log.js'
import { istIso, istDate } from '../util/time.js'
import { randomCode } from '../util/ids.js'
import { createViaSocketClient } from '../viasocket.js'
import { throwIfCancelled, CancelledError } from '../events.js'
import { loadBrief } from '../writer/inputs.js'
import { draftVersion, draftBriefVersion, draftsOf } from '../writer/save.js'
import { promo_pack, promoSchemaErrors } from './schemas.js'
import { buildPromoPrompt, buildPromoMessage, promoRepairTail } from './prompts.js'
import { promoProblems } from './checks.js'

export class PromoError extends Error {
  constructor(message, { kind } = {}) {
    super(message)
    this.name = 'PromoError'
    if (kind) this.kind = kind
  }
}

const FATAL_KINDS = ['config', 'token', 'billing']

export const promoThreadId = (briefId, version) => `promo-${briefId}-v${version}-${randomCode(4).toLowerCase()}`

/** The approved draft of a brief (the given version within the brief version, else the newest approved). */
export async function approvedDraft(store, briefId, { version, briefVersion } = {}) {
  return (await draftsOf(store, briefId)).find((d) => d.status === 'approved' &&
    (version == null || draftVersion(d) === Number(version)) && (briefVersion == null || draftBriefVersion(d) === Number(briefVersion))) ?? null
}

/**
 * @param {{ briefId, version?, briefVersion?, runId?, draft?, brief? }} params  draft/brief: in-memory hand-over (DRY_RUN).
 * @param {{ config?, store, aiSend?, now? }} deps
 */
export async function runPromo(params = {}, deps = {}) {
  const config = deps.config ?? getConfig()
  const store = deps.store
  const now = deps.now ?? Date.now
  const pc = config.promo
  if (!params.briefId) throw new PromoError('runPromo needs a brief_id')
  const aiSend = deps.aiSend ?? createViaSocketClient({ config }).aiSend
  const runId = params.runId ?? params.briefId
  const dry = config.runtime.dryRun
  const calls = []
  const warnings = []

  const draftRec = (dry && params.draft ? { id: null, version: params.draft.version, metadata: { brief_version: params.draft.brief_version }, payload: params.draft } : null) ??
    (await approvedDraft(store, params.briefId, { version: params.version, briefVersion: params.briefVersion }))
  if (!draftRec) throw new PromoError(`no approved draft of brief ${params.briefId}${params.version ? ` v${params.version}` : ''}`)
  const draft = draftRec.payload
  const version = draftVersion(draftRec)
  const briefVersion = draftBriefVersion(draftRec)
  const briefRec = (await loadBrief(store, params.briefId, briefVersion)) ?? (params.brief ? { payload: params.brief } : null)
  if (!briefRec) throw new PromoError(`no brief ${params.briefId} v${briefVersion}`)
  const prompt = buildPromoPrompt(config)
  const message = buildPromoMessage({ draft, brief: briefRec.payload })
  const limits = { linkedinMax: pc.linkedinMaxChars, xMax: pc.xPostMaxChars }

  async function runLog(entry) {
    const record = { run_id: runId, brief_id: params.briefId, agent: 'promo', time: istIso(new Date(now())), ...entry }
    calls.push(record)
    log.info('promo call', record)
    try {
      await store.createRecord({ type: 'run_log', briefId: runId, payload: record, status: entry.error ? 'error' : entry.result })
    } catch (e) {
      log.error('could not write promo run_log', { error: e })
    }
  }

  async function send(call, tail = '') {
    throwIfCancelled()
    const t0 = now()
    try {
      const r = await aiSend({ agent: 'promo', call, prompt, message: tail ? `${message}\n${tail}` : message, jsonSchema: promo_pack, threadId: promoThreadId(params.briefId, version), retries: config.viasocket.maxRetries })
      const schema = promoSchemaErrors(r.content)
      const problems = schema.length ? schema : promoProblems(r.content, limits)
      await runLog({ call, model: r.model ?? pc.model, delivery: r.delivery ?? pc.delivery, ms: r.ms ?? now() - t0, result: problems.length ? 'problems' : 'ok', problems, error: null })
      return { pack: schema.length ? null : r.content, raw: r.content, problems, model: r.model ?? pc.model }
    } catch (error) {
      if (error instanceof CancelledError) throw error
      await runLog({ call, model: pc.model, delivery: pc.delivery, ms: now() - t0, result: 'error', problems: [], error: error.message })
      if (FATAL_KINDS.includes(error?.kind)) throw new PromoError(`${call} call failed (${error.kind}): ${error.message}`, { kind: error.kind })
      return { pack: null, raw: null, problems: [`call failed: ${error.message}`], model: pc.model }
    }
  }

  let res = await send('promo')
  let repairs = 0
  if (res.problems.length) {
    repairs++
    const fixed = await send('promo_repair', res.raw ? promoRepairTail(res.raw, res.problems) : '')
    // Keep the better of the two: a valid pack beats an invalid one; fewer problems beat more.
    if (fixed.pack && (!res.pack || fixed.problems.length <= res.problems.length)) res = fixed
  }
  if (!res.pack) throw new PromoError(`no usable promo pack: ${res.problems.slice(0, 3).join('; ')}`, { kind: 'schema' })
  const status = res.problems.length ? 'with_issues' : 'ok'
  if (status === 'with_issues') warnings.push(`promo pack saved with issues: ${res.problems.join(' | ')}`)

  throwIfCancelled()
  const payload = { ...res.pack, brief_id: params.briefId, brief_version: briefVersion, version, checks: { passed: !res.problems.length, problems: res.problems }, model_used: res.model, repairs_used: repairs }
  const record = await store.createRecord({ type: 'promo_pack', briefId: params.briefId, payload, status, version, date: istDate(), meta: { brief_version: briefVersion } })
  if (dry) log.info('DRY_RUN: promo pack not saved', { status, problems: res.problems, linkedin_post: res.pack.linkedin_post })
  return { brief_id: params.briefId, version, brief_version: briefVersion, record_id: record.id, status, pack: res.pack, problems: res.problems, model_used: res.model, repairs_used: repairs, warnings, calls }
}
