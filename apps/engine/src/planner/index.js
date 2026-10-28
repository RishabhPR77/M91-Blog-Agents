// The Roadmap Planner (Phase 12, Task 2): one AI call (plus at most PLANNER_MAX_REPAIRS repairs) turns the M91
// facts and the six stages into a roadmap of slots. Code checks it (roadmap/checks.js), keeps every locked slot of
// the existing roadmap exactly as it was, and saves it as status "draft": the person approves it in the dashboard.
// Without today's M91 facts, the Scout's facts step runs first (one more AI call).

import { getConfig } from '../config.js'
import { log } from '../util/log.js'
import { istIso } from '../util/time.js'
import { randomCode } from '../util/ids.js'
import { createViaSocketClient } from '../viasocket.js'
import { emit, throwIfCancelled, CancelledError } from '../events.js'
import { saveRunLog } from '../util/runlog.js'
import { summariseFacts, runScout } from '../scout/index.js'
import { STAGES, LOCKED_STATUSES, loadRoadmap, saveRoadmap } from '../roadmap/model.js'
import { roadmapProblems } from '../roadmap/checks.js'
import { planner_roadmap, plannerSchemaErrors } from './schemas.js'
import { PLANNER_PROMPT, buildPlannerMessage, plannerRepairTail } from './prompts.js'
import { listGuides } from '../guides/sync.js'

export class PlannerError extends Error {
  constructor(message, { problems = [] } = {}) {
    super(message)
    this.name = 'PlannerError'
    this.problems = problems
  }
}

export const plannerThreadId = (runId, call) => `planner-${runId}-${call}-${randomCode(4).toLowerCase()}`

/**
 * The roadmap from a Planner answer: the code's stages with the answer's slots (status "planned"), then every
 * locked slot and every proposed slot of the existing roadmap put back exactly as it was.
 */
export function roadmapFromAnswer(answer, existing = null, guides = []) {
  const byStage = new Map((answer?.stages ?? []).map((st) => [st.number, st.slots ?? []]))
  const keep = (existing?.stages ?? []).flatMap((st) => (st.slots ?? []).filter((s) => LOCKED_STATUSES.includes(s.status) || s.status === 'proposed').map((s) => ({ ...s, stage: st.number })))
  const stages = STAGES.map((st) => {
    const slots = (byStage.get(st.number) ?? []).map((s) => ({
      slot_id: String(s.slot_id ?? '').trim(), title_idea: String(s.title_idea ?? '').trim(), question: String(s.question ?? '').trim(),
      teaches: (s.teaches ?? []).map((t) => String(t).trim()).filter(Boolean), needs: (s.needs ?? []).map((t) => String(t).trim()).filter(Boolean),
      status: 'planned', brief_id: ''
    }))
    for (const k of keep.filter((s) => s.stage === st.number)) {
      const { stage: _s, ...slot } = k
      const i = slots.findIndex((s) => s.slot_id === slot.slot_id)
      if (i >= 0) slots[i] = slot
      else slots.push(slot)
    }
    return { ...st, slots }
  })
  // Slots a published guide answers: covered (done, never written). Only known guide URLs, only planned slots.
  const byUrl = new Map(guides.map((g) => [g.url, g]))
  for (const c of answer?.covered ?? []) {
    const guide = byUrl.get(String(c.guide_url ?? '').trim())
    const slot = stages.flatMap((st) => st.slots).find((s) => s.slot_id === String(c.slot_id ?? '').trim())
    if (guide && slot && slot.status === 'planned') {
      slot.status = 'covered'
      slot.covered_by = { url: guide.url, title: guide.title }
    }
  }
  return { version: 1, status: 'draft', stages }
}

/**
 * @param {{ runId? }} params
 * @param {{ config?, store, aiSend?, now?, runFacts? }} deps  runFacts: the Scout's facts step (tests inject it)
 * @returns {{ record_id, roadmap, slots, repairs_used, facts_reused, calls, warnings, summary_line }}
 */
export async function runPlanner(params = {}, deps = {}) {
  const config = deps.config ?? getConfig()
  const store = deps.store
  const now = deps.now ?? Date.now
  const pc = config.planner
  const aiSend = deps.aiSend ?? createViaSocketClient({ config }).aiSend
  const runId = params.runId ?? `roadmap-${Date.now()}`
  const calls = []
  const warnings = []

  // M91 facts: today's (or the newest current) record; none at all → the Scout's facts step (1 AI call).
  const current = (await store.getRecords({ type: 'm91_facts', status: 'current' })).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
  let facts = current?.payload ?? null
  let factsReused = Boolean(facts)
  if (!facts) {
    emit('step.output', { agent: 'planner', step: 'planner', message: 'No M91 facts yet: the Scout reads the M91 docs first (1 AI call)', data: {} })
    const runFacts = deps.runFacts ?? ((p) => runScout({ mode: 'facts', runId: p.runId }, { config, store, now }))
    const f = await runFacts({ runId })
    facts = f.facts ?? f.payload
    factsReused = Boolean(f.reused)
    warnings.push(...(f.warnings ?? []))
  }
  if (!facts) throw new PlannerError('no M91 facts: the Scout could not read the M91 docs')

  const existingRec = await loadRoadmap(store)
  const existing = existingRec?.payload ?? null
  // The M91 guides already live (saved by the guide sync): the Planner marks the slots they answer as covered.
  const guides = await listGuides(store)
  const message = buildPlannerMessage({ factsText: summariseFacts(facts), existing, guides })

  async function send(call, tail = '') {
    throwIfCancelled()
    const started = now()
    try {
      const r = await aiSend({ agent: 'planner', prompt: PLANNER_PROMPT, message: tail ? `${message}\n${tail}` : message, jsonSchema: planner_roadmap, threadId: plannerThreadId(runId, call), retries: config.viasocket.maxRetries })
      const schema = plannerSchemaErrors(r.content)
      const roadmap = schema.length ? null : roadmapFromAnswer(r.content, existing, guides)
      const problems = schema.length ? schema : roadmapProblems(roadmap)
      const entry = { run_id: runId, agent: 'planner', call, model: r.model ?? pc.model, delivery: r.delivery ?? pc.delivery, ms: r.ms ?? now() - started, result: problems.length ? 'problems' : 'ok', problems: problems.slice(0, 10), error: null, time: istIso(new Date(now())) }
      calls.push(entry)
      log.info('planner call', entry)
      emit('step.output', { agent: 'planner', step: `planner.${call}`, message: problems.length ? `${problems.length} problem(s)` : 'ok', data: { problems: problems.length } })
      return { answer: r.content, roadmap, problems, model: r.model ?? pc.model, notes: r.content?.notes ?? '' }
    } catch (error) {
      if (error instanceof CancelledError) throw error
      const entry = { run_id: runId, agent: 'planner', call, model: pc.model, delivery: pc.delivery, ms: now() - started, result: 'error', problems: [], error: error.message, time: istIso(new Date(now())) }
      calls.push(entry)
      try { await saveRunLog(store, { briefId: runId, payload: entry, status: 'error' }) } catch {}
      throw new PlannerError(`the Roadmap Planner call failed: ${error.message}`)
    }
  }

  let res = await send('plan')
  let repairs = 0
  while (res.problems.length && repairs < pc.maxRepairs) {
    repairs++
    res = await send('repair', plannerRepairTail(res.answer, res.problems))
  }
  if (res.problems.length) throw new PlannerError(`the roadmap still had problems after ${repairs} repair(s): ${res.problems.slice(0, 3).join('; ')}`, { problems: res.problems })

  const roadmap = { ...res.roadmap, generated_at: istIso(new Date(now())), approved_at: null, model_used: res.model, notes: res.notes }
  const rec = await saveRoadmap(store, roadmap, existingRec, { now })
  const slots = roadmap.stages.reduce((n, st) => n + st.slots.length, 0)
  const summary_line = `Roadmap draft: ${slots} slots in ${roadmap.stages.length} stages (${roadmap.stages.map((st) => st.slots.length).join('/')})${repairs ? ` · ${repairs} repair` : ''}${factsReused ? '' : ' · M91 facts read first'} · approve it in the dashboard`
  return { record_id: rec.id, roadmap, slots, repairs_used: repairs, facts_reused: factsReused, calls, warnings, summary_line }
}
