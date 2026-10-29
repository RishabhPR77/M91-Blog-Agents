// The Strategist (Phase 3): plan mode and re-brief mode. See the Phase 3 brief.

import { getConfig } from '../config.js'
import { log } from '../util/log.js'
import { istIso } from '../util/time.js'
import { newBriefId, newStrategistThreadId } from '../util/ids.js'
import { createViaSocketClient, TruncatedError } from '../viasocket.js'
import { strategist_brief, strategist_brief_target } from './schemas.js'
import { buildPlanPrompt, repairTail, rebriefTail, TRUNCATED_PROBLEM } from './prompts.js'
import { buildInputs, buildStrategistMessage, InputsError } from './inputs.js'
import { validateBrief, autoFix, findProblems } from './checks.js'
import { finalizeBrief, saveBrief, markLeadsUsed, setLeadStatus } from './save.js'
import { emit, throwIfCancelled, CancelledError } from '../events.js'
import { saveRunLog } from '../util/runlog.js'

export class StrategistError extends Error {
  constructor(message, problems = []) {
    super(problems.length ? `${message}:\n${problems.map((p) => `  - ${p}`).join('\n')}` : message)
    this.name = 'StrategistError'
    this.problems = problems
  }
}

const FATAL_KINDS = ['config', 'token', 'billing']
const DROP_LEAD = /duplicate|too weak|weak topic|already covered/i

/**
 * @param {{ mode: 'plan'|'rebrief', runId?, scoutResult?, briefId?, briefVersion?, feedback? }} params
 * @param {{ config?, store, notifier?, aiSend?, now? }} deps
 */
export async function runStrategist(params = {}, deps = {}) {
  const config = deps.config ?? getConfig()
  const store = deps.store
  const now = deps.now ?? Date.now
  const aiSend = deps.aiSend ?? createViaSocketClient({ config }).aiSend
  const st = config.strategist
  const mode = params.mode ?? 'plan'
  if (mode !== 'plan' && mode !== 'rebrief') throw new StrategistError(`unknown Strategist mode "${mode}"`)
  const runId = params.runId ?? params.briefId ?? newBriefId(new Date(now()))
  const briefId = params.briefId ?? runId
  const warnings = []
  const autoFixes = []
  const calls = []

  // Re-brief: the version being revised.
  let current = null
  const feedback = (params.feedback ?? []).filter((f) => !f.send_to || f.send_to === 'strategist')
  if (mode === 'rebrief') {
    if (!params.briefId) throw new StrategistError('re-brief needs brief_id')
    const versions = await store.getRecords({ type: 'brief', brief_id: params.briefId })
    current = versions.find((r) => (r.payload?.brief_version ?? r.version) === params.briefVersion)
      ?? versions.sort((a, b) => (b.payload?.brief_version ?? 0) - (a.payload?.brief_version ?? 0))[0]
    if (!current) throw new StrategistError(`no brief ${params.briefId} (v${params.briefVersion ?? '?'}) found to revise`)
    if (!feedback.length) throw new StrategistError('re-brief needs at least one feedback item with send_to "strategist"')
  }
  const briefVersion = mode === 'rebrief' ? (current.payload?.brief_version ?? current.version ?? 1) + 1 : 1

  let inputs
  try {
    inputs = await buildInputs({ config, store, scoutResult: params.scoutResult, now, forBriefId: mode === 'rebrief' ? briefId : null, target: params.target ?? null })
  } catch (error) {
    if (error instanceof InputsError) throw new StrategistError(error.message)
    throw error
  }
  if (inputs.leadCount === 0) throw new StrategistError('No open leads (pinned topics, stories, clusters or tutorials). The Scout found nothing usable.')

  const prompt = buildPlanPrompt(config, inputs)
  const baseTail = mode === 'rebrief' ? rebriefTail(current.payload, briefVersion - 1, feedback) : ''

  async function runLog(entry) {
    const record = { run_id: runId, agent: 'strategist', time: istIso(new Date(now())), ...entry }
    calls.push(record)
    log.info('strategist call', record)
    emit('step.output', { agent: 'strategist', step: `strategist.${entry.call}`, message: entry.error ? `failed: ${entry.error}` : `${entry.result}${entry.problems?.length ? ` (${entry.problems.length} problems)` : ''}`, data: { result: entry.result, problems: entry.problems?.length ?? 0, auto_fixes: entry.auto_fixes?.length ?? 0, ms: entry.ms } })
    try {
      await saveRunLog(store, { briefId: runId, payload: record, status: entry.error ? 'error' : entry.result })
    } catch (e) {
      log.error('could not write strategist run_log', { error: e })
    }
  }

  // Plan (or re-brief), then up to STRATEGIST_MAX_REPAIRS repairs, each on a fresh thread.
  let brief = null
  let previous = null
  let problems = []
  let repairs = 0
  let callName = mode
  let tail = baseTail
  for (;;) {
    throwIfCancelled()
    const { message, trimmed } = buildStrategistMessage(inputs, tail)
    if (trimmed.length) warnings.push(`message trimmed to fit 50,000 characters (${trimmed.at(-1)})`)
    const started = now()
    let res = null
    try {
      res = await aiSend({ agent: 'strategist', prompt, message, jsonSchema: inputs.target ? strategist_brief_target : strategist_brief, threadId: newStrategistThreadId(runId, callName), retries: config.viasocket.maxRetries })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      const meta = { call: callName, model: st.model, delivery: st.delivery, ms: now() - started }
      if (error instanceof TruncatedError) {
        problems = [TRUNCATED_PROBLEM]
        await runLog({ ...meta, result: 'truncated', problems, auto_fixes: [], error: null })
      } else if (error?.kind === 'parse') {
        problems = ['schema: the answer is not valid JSON']
        await runLog({ ...meta, result: 'problems', problems, auto_fixes: [], error: null })
      } else {
        await runLog({ ...meta, result: 'error', problems: [], auto_fixes: [], error: error.message })
        throw new StrategistError(`${callName} call failed${FATAL_KINDS.includes(error?.kind) ? ` (${error.kind})` : ''}: ${error.message}`)
      }
    }
    if (res) {
      if (res.recoveredFromHistory) warnings.push(`${callName}: sync call hit the gateway timeout (502); the answer was read from the thread history`)
      const v = validateBrief(res.content, { target: Boolean(inputs.target) })
      let fixes = []
      if (v.errors.length) problems = v.errors
      else {
        ;({ brief, fixes } = autoFix(v.value, { config, inputs }))
        autoFixes.push(...fixes)
        problems = await findProblems(brief, { config, inputs, store, excludeBriefId: mode === 'rebrief' ? briefId : null })
      }
      await runLog({ call: callName, model: res.model ?? st.model, delivery: res.delivery ?? st.delivery, ms: res.ms ?? now() - started, result: problems.length ? 'problems' : 'ok', problems, auto_fixes: fixes, error: null })
      if (v.value) previous = brief ?? v.value
    }
    if (!problems.length) break
    if (repairs >= st.maxRepairs) {
      throw new StrategistError(`The brief still fails ${problems.length} check(s) after ${repairs} repair(s); no lead was marked used`, problems)
    }
    repairs++
    callName = 'repair'
    tail = [baseTail, repairTail(previous ?? {}, problems)].filter(Boolean).join('\n')
  }

  // Save first, then update leads.
  const final = finalizeBrief(brief, { briefId, briefVersion, runId, config, now })
  // The weekly editor's pick stays on the brief: the post page shows why this post, and the next editor sees its format.
  if (inputs.target?.weekly) final.weekly = { pick_id: inputs.target.pick_id, format: inputs.target.format, why_now: inputs.target.why_now, hook: inputs.target.hook?.title ?? null }
  if (config.runtime.dryRun) log.info('DRY_RUN: brief not saved', { brief: final })
  const rec = await saveBrief(store, final)

  if (mode === 'plan') {
    warnings.push(...(await markLeadsUsed(store, final, inputs)))
  } else {
    await store.updateRecord(current.id, undefined, { status: 'superseded' })
    const oldLeadId = current.payload?.lead?.id
    if (oldLeadId !== final.lead.id) {
      warnings.push(...(await markLeadsUsed(store, final, inputs)))
      const old = inputs.leadIndex.get(oldLeadId)
      const drop = feedback.some((f) => DROP_LEAD.test(`${f.area ?? ''} ${f.problem ?? f.issue ?? ''}`))
      if (old) {
        const w = await setLeadStatus(store, old.record, drop ? 'discarded' : 'open', null)
        if (w) warnings.push(w)
      } else warnings.push(`old lead ${oldLeadId} not found; its status was not changed`)
    }
  }

  await postSlack(deps.notifier, final, repairs, warnings)

  const result = {
    mode,
    brief_id: briefId,
    brief_version: briefVersion,
    record_id: rec.id,
    post_type: final.post_type,
    topic_group: final.topic_group,
    title: final.titles[0],
    lead: final.lead,
    repairs_used: repairs,
    auto_fixes: autoFixes,
    warnings
  }
  emit('step.output', { agent: 'strategist', step: 'strategist', message: `brief ${briefId} v${briefVersion}: ${final.post_type}, group ${final.topic_group} — "${final.titles[0]}"`, data: { brief_id: briefId, brief_version: briefVersion, record_id: rec.id, lead: final.lead, repairs_used: repairs } })
  return { ...result, brief: final, calls }
}

async function postSlack(notifier, b, repairs, warnings) {
  if (!notifier) return
  const text = [
    `🧭 Brief ready: *${b.titles[0]}*`,
    `Type: ${b.post_type} · Group: ${b.topic_group} · Format: ${b.format} · Intent: ${b.intent}`,
    `Angle: ${b.angle}`,
    `Keyword: ${b.keyword}`,
    `Tone: ${b.tone.source} (${b.tone.profile_id})`,
    `Why today: ${b.why_today}`,
    `Brief ID: ${b.brief_id} (v${b.brief_version}) · Repairs: ${repairs}`,
    'Next: Writer'
  ].join('\n')
  try {
    await notifier.slack(text)
  } catch (error) {
    warnings.push(`Slack brief message not sent: ${error.message}`)
  }
}
