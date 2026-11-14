// Turns a run's events into what the Live run page shows: step states, AI-call totals, routing decisions,
// approval banners, outputs and log lines. Pure: (state, action) → state, so it is easy to test.
//
// Three sources, best first:
//   live      — events from GET /api/runs/:id/events (in-memory replay, then live). Everything, incl. info logs.
//   timeline  — the compact timeline saved in the run record (Phase 6): no info log lines.
//   record    — only the run record's steps (runs from before Phase 6).
import type { EngineEvent } from '../api/sse'

// Phase 10: the Experience Designer runs after each draft, before the Reviewer; the promo pack only on approval (if on).
// Phase 11: export (the Markdown export saved on approve) comes before the publisher.
export const PIPELINE = ['editor', 'scout', 'strategist', 'writer', 'checks', 'designer', 'reviewer', 'promo', 'export', 'publisher'] as const
export const MAX_LOG = 5000

export type StepStatus = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped'

export type StepState = {
  name: string
  status: StepStatus
  startedAt: string | null
  finishedAt: string | null
  ms: number | null
  aiCalls: number
  models: string[]
  retries: number
  rounds: number
  summary: string | null
  error: string | null
  placeholder: boolean
  children: string[]
}

export type Output = { seq: number; ts: string; step: string; message: string; data?: Record<string, unknown> }
export type Route = { seq: number; ts: string; message: string; action: string | null; sendTo: string | null; reason: string | null; total: number | null; version: number | null; round: number | null }
export type ApprovalBanner = { seq: number; ts: string; kind: string; message: string; briefId: string | null; version: number | null; total: number | null; data?: Record<string, unknown> }
export type LogLine = { seq: number; ts: string; type: string; step: string | null; level: string; message: string; data?: Record<string, unknown> }
export type RunSource = 'live' | 'timeline' | 'record' | 'none'
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'

/** Mem0 requests a run made (apps/engine/src/util/mem0count.js); cache hits sent no request. */
export type Mem0Counts = { reads: number; searches: number; writes: number; cache_hits: number; requests: number }

const mem0Of = (v: unknown): Mem0Counts | null => {
  const o = v as Partial<Mem0Counts> | null | undefined
  return o && typeof o.reads === 'number' && typeof o.writes === 'number'
    ? { reads: o.reads, searches: o.searches ?? 0, writes: o.writes, cache_hits: o.cache_hits ?? 0, requests: o.requests ?? o.reads + (o.searches ?? 0) + o.writes }
    : null
}

// Live previews (2026-11-14): what each agent has just produced, from "preview" events. Live only: a run rebuilt
// from its record has none (the panel then shows the saved draft and review).
export type PreviewItem = { group: string; text: string; meta: string }
export type ScoutPreview = { seq: number; step: string; call: string; items: PreviewItem[] }
export type EditorCandidate = { title: string; format: string; total: number | null; scores: Record<string, number> | null; leftOut: string | null; chosen: boolean }
export type EditorPreview = { seq: number; reason: string; chosenBy: string | null; candidates: EditorCandidate[]; fallback: { title: string; format: string } | null }
export type StrategistPreview = { seq: number; call: string; title: string; keyword: string; format: string; reader: string; angle: string; outline: { heading: string; answer_first: string }[]; problems: number }
export type WriterPass = { seq: number; pass: string; version: number | null; title: string; markdown: string; words: number | null; grade: number | null; hard: string[]; soft: string[]; fixes: string[] }
export type FactIssue = { quote: string; problem: string; fix: string }
export type FactCheckPreview = { seq: number; version: number | null; issues: FactIssue[] }
export type ReviewFeedback = { severity: string; area: string; quote: string; problem: string; fix: string }
export type ReviewerPreview = { seq: number; version: number | null; total: number | null; pass: boolean; passMark: number | null; gates: { id: string; passed: boolean }[]; areas: { id: string; score: number }[]; feedback: ReviewFeedback[] }
export type Previews = { scout: ScoutPreview[]; editor: EditorPreview | null; strategist: StrategistPreview[]; writer: WriterPass[]; factcheck: FactCheckPreview[]; reviewer: ReviewerPreview[] }
export const emptyPreviews = (): Previews => ({ scout: [], editor: null, strategist: [], writer: [], factcheck: [], reviewer: [] })

export type RunView = {
  runId: string
  mode: string | null
  trigger: string | null
  dryRun: boolean | null
  status: RunStatus
  startedAt: string | null
  finishedAt: string | null
  ms: number | null
  resultSummary: string | null
  briefId: string | null
  steps: Record<string, StepState>
  order: string[]
  routes: Route[]
  approvals: ApprovalBanner[]
  outputs: Output[]
  log: LogLine[]
  logDropped: number
  totals: { aiCalls: number; retries: number }
  /** null until the run ends (and for runs from before the counter). */
  mem0: Mem0Counts | null
  lastSeq: number
  seen: number
  source: RunSource
  timelineDropped: number
  previews: Previews
}

/** The run record as returned by GET /api/runs/:id (only the fields used here). */
export type RunRecord = {
  run_id: string
  mode?: string
  trigger?: string
  dry_run?: boolean
  status?: string
  started_at?: string | null
  finished_at?: string | null
  ms?: number | null
  brief_id?: string | null
  result_summary?: string
  steps?: { name: string; status: string; started_at?: string | null; finished_at?: string | null; ms?: number | null; ai_calls?: number; models?: string[]; retries?: number; record_ids?: string[]; summary?: string; error?: string | null }[]
  timeline?: TimelineEntry[]
  timeline_dropped?: number
  mem0?: Mem0Counts
}

/** One entry of the saved timeline (apps/engine/src/timeline.js). */
export type TimelineEntry = {
  seq: number
  ts: string
  type: string
  step?: string
  level?: string
  message?: string
  data?: Record<string, unknown>
  call?: string
  model?: string | null
  delivery?: string | null
  ms?: number | null
  retries?: number
  finish_reason?: string | null
}

export type Action =
  | { type: 'event'; event: EngineEvent }
  | { type: 'record'; record: RunRecord }
  | { type: 'rebuild'; record: RunRecord }
  | { type: 'reset'; runId: string }

export function initialRunView(runId: string): RunView {
  return {
    runId, mode: null, trigger: null, dryRun: null, status: 'unknown', startedAt: null, finishedAt: null, ms: null, resultSummary: null, briefId: null,
    steps: {}, order: [], routes: [], approvals: [], outputs: [], log: [], logDropped: 0, totals: { aiCalls: 0, retries: 0 }, mem0: null, lastSeq: 0, seen: 0, source: 'none', timelineDropped: 0,
    previews: emptyPreviews()
  }
}

/** Step name for a Scout sub-call, the same rule as the engine: questions-3 → scout.questions.g3. */
export function scoutStepName(call: string): string {
  const m = /^questions-(\d)$/.exec(call)
  return m ? `scout.questions.g${m[1]}` : `scout.${call}`
}

const parentOf = (name: string) => (name.includes('.') ? name.split('.')[0] : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

function blankStep(name: string): StepState {
  return { name, status: 'waiting', startedAt: null, finishedAt: null, ms: null, aiCalls: 0, models: [], retries: 0, rounds: 0, summary: null, error: null, placeholder: false, children: [] }
}

/** Copy-on-write helpers (the reducer never mutates its input). */
function withStep(s: RunView, name: string, change: (st: StepState) => StepState): RunView {
  const existing = s.steps[name]
  const steps = { ...s.steps, [name]: change(existing ? { ...existing } : blankStep(name)) }
  let order = s.order
  if (!existing) {
    order = [...order, name]
    const parent = parentOf(name)
    if (parent) {
      const p = steps[parent] ? { ...steps[parent] } : blankStep(parent)
      if (!p.children.includes(name)) p.children = [...p.children, name]
      steps[parent] = p
      if (!order.includes(parent)) order = [...order, parent]
    }
  }
  return { ...s, steps, order }
}

const addModel = (models: string[], m: unknown) => (typeof m === 'string' && m && !models.includes(m) ? [...models, m] : models)
const msBetween = (a: string | null, b: string) => (a ? Math.max(0, Date.parse(b) - Date.parse(a)) : null)

function finishStepsOnEnd(s: RunView, status: RunStatus, ts: string): RunView {
  const steps = { ...s.steps }
  for (const [k, st] of Object.entries(steps)) {
    if (st.status === 'running') steps[k] = { ...st, status: status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'done', finishedAt: ts, ms: st.ms ?? msBetween(st.startedAt, ts) }
  }
  return { ...s, steps }
}

function pushLog(s: RunView, e: EngineEvent): RunView {
  const line: LogLine = { seq: e.seq, ts: e.ts, type: e.type, step: e.step ?? e.agent ?? null, level: e.level ?? (e.type.endsWith('.failed') ? 'error' : 'info'), message: e.message ?? '', ...(e.data && { data: e.data }) }
  const log = s.log.length >= MAX_LOG ? [...s.log.slice(s.log.length - MAX_LOG + 1), line] : [...s.log, line]
  return { ...s, log, logDropped: s.logDropped + (s.log.length >= MAX_LOG ? 1 : 0) }
}

/** Applies one engine event. Events with seq ≤ lastSeq were already applied (replay after a reconnect) and are skipped. */
export function applyEvent(state: RunView, e: EngineEvent): RunView {
  if (typeof e?.seq !== 'number' || e.seq <= state.lastSeq) return state
  let s: RunView = { ...state, lastSeq: e.seq, seen: state.seen + 1 }
  const d = e.data ?? {}
  switch (e.type) {
    case 'run.started':
      s = { ...s, status: 'running', startedAt: s.startedAt ?? e.ts, mode: str(d.mode) ?? s.mode, trigger: str(d.trigger) ?? s.trigger, dryRun: typeof d.dry_run === 'boolean' ? d.dry_run : s.dryRun }
      break
    case 'run.finished':
    case 'run.failed':
    case 'run.cancelled': {
      const status: RunStatus = e.type === 'run.finished' ? 'succeeded' : e.type === 'run.failed' ? 'failed' : 'cancelled'
      s = finishStepsOnEnd({ ...s, status, finishedAt: e.ts, ms: num(d.ms) ?? s.ms, resultSummary: e.message ?? s.resultSummary, briefId: str(d.brief_id) ?? s.briefId, mem0: mem0Of(d.mem0) ?? s.mem0 }, status, e.ts)
      break
    }
    case 'step.started': {
      const name = e.step ?? e.agent ?? 'unknown'
      s = withStep(s, name, (st) => ({ ...st, status: 'running', startedAt: e.ts, finishedAt: null, error: null, rounds: st.rounds + 1 }))
      break
    }
    case 'step.finished':
    case 'step.failed':
    case 'step.cancelled': {
      const name = e.step ?? e.agent ?? 'unknown'
      const status: StepStatus = e.type === 'step.finished' ? 'done' : e.type === 'step.failed' ? 'failed' : 'cancelled'
      s = withStep(s, name, (st) => ({
        ...st, status, finishedAt: e.ts,
        // Each round adds its own time (a Writer that runs twice shows both rounds together).
        ms: (st.rounds > 1 ? st.ms ?? 0 : 0) + (num(d.ms) ?? msBetween(st.startedAt, e.ts) ?? 0),
        models: addModel(st.models, d.model),
        error: status === 'failed' ? e.message ?? 'failed' : st.error
      }))
      break
    }
    case 'step.output': {
      const name = e.step ?? e.agent ?? 'unknown'
      s = withStep(s, name, (st) => ({ ...st, summary: e.message ?? st.summary, placeholder: st.placeholder || d.placeholder === true }))
      s = { ...s, outputs: [...s.outputs, { seq: e.seq, ts: e.ts, step: name, message: e.message ?? '', ...(e.data && { data: e.data }) }], briefId: str(d.brief_id) ?? s.briefId }
      break
    }
    case 'ai.call': {
      const call = str(d.call)
      const name = e.step ?? (e.agent === 'scout' && call ? scoutStepName(call) : e.agent ?? 'unknown')
      const retries = num(d.retries) ?? 0
      const count = (st: StepState) => ({ ...st, aiCalls: st.aiCalls + 1, retries: st.retries + retries, models: addModel(st.models, d.model), error: e.level === 'error' ? st.error ?? 'AI call failed' : st.error })
      s = withStep(s, name, count)
      const parent = parentOf(name)
      if (parent) s = withStep(s, parent, count)
      s = { ...s, totals: { aiCalls: s.totals.aiCalls + 1, retries: s.totals.retries + retries } }
      break
    }
    case 'preview':
      // Large (a draft): kept in previews only, never in the log.
      return { ...s, previews: applyPreview(s.previews, e) }
    case 'loop.route':
      s = {
        ...s,
        routes: [...s.routes, {
          seq: e.seq, ts: e.ts, message: e.message ?? '', action: str(d.action), sendTo: str(d.send_to), reason: str(d.reason), total: num(d.total), version: num(d.version),
          round: num((d.counters as Record<string, unknown> | undefined)?.rounds)
        }]
      }
      break
    default:
      if (e.type.startsWith('approval.')) {
        s = { ...s, approvals: [...s.approvals, { seq: e.seq, ts: e.ts, kind: e.type.slice('approval.'.length), message: e.message ?? '', briefId: str(d.brief_id), version: num(d.version), total: num(d.total), ...(e.data && { data: e.data }) }], briefId: str(d.brief_id) ?? s.briefId }
      }
    // log and unknown types: only the log line below.
  }
  return pushLog(s, e)
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const text = (v: unknown) => (typeof v === 'string' ? v : '')

/** One preview event into the previews (each list keeps its newest entries). */
function applyPreview(p: Previews, e: EngineEvent): Previews {
  const d = (e.data ?? {}) as Record<string, unknown>
  switch (d.kind) {
    case 'scout':
      return { ...p, scout: [...p.scout, { seq: e.seq, step: e.step ?? 'scout', call: text(d.call), items: arr<PreviewItem>(d.items) }].slice(-20) }
    case 'editor':
      return { ...p, editor: { seq: e.seq, reason: text(d.reason), chosenBy: str(d.chosen_by), fallback: (d.fallback as EditorPreview['fallback']) ?? null,
        candidates: arr<Record<string, unknown>>(d.candidates).map((c) => ({ title: text(c.title), format: text(c.format), total: num(c.total), scores: (c.scores as Record<string, number> | null) ?? null, leftOut: str(c.left_out), chosen: c.chosen === true })) } }
    case 'strategist':
      return { ...p, strategist: [...p.strategist, { seq: e.seq, call: text(d.call), title: text(d.title), keyword: text(d.keyword), format: text(d.format), reader: text(d.reader), angle: text(d.angle), outline: arr<{ heading: string; answer_first: string }>(d.outline), problems: num(d.problems) ?? 0 }].slice(-4) }
    case 'writer':
      return { ...p, writer: [...p.writer, { seq: e.seq, pass: text(d.pass), version: num(d.version), title: text(d.title), markdown: text(d.markdown), words: num(d.words), grade: num(d.grade), hard: arr<string>(d.hard), soft: arr<string>(d.soft), fixes: arr<string>(d.fixes) }].slice(-10) }
    case 'factcheck':
      return { ...p, factcheck: [...p.factcheck, { seq: e.seq, version: num(d.version), issues: arr<FactIssue>(d.issues) }].slice(-4) }
    case 'reviewer':
      return { ...p, reviewer: [...p.reviewer, { seq: e.seq, version: num(d.version), total: num(d.total), pass: d.pass === true, passMark: num(d.pass_mark), gates: arr<{ id: string; passed: boolean }>(d.gates), areas: arr<{ id: string; score: number }>(d.areas), feedback: arr<ReviewFeedback>(d.feedback) }].slice(-4) }
    default:
      return p
  }
}

const RECORD_STATUS: Record<string, RunStatus> = { running: 'running', succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled' }

/** Run-level fields from the run record (mode, trigger, times, final status). Never touches steps. */
export function applyRecord(state: RunView, r: RunRecord): RunView {
  const status = RECORD_STATUS[String(r.status)] ?? state.status
  // A terminal status from the record wins over "running" (the terminal event is not in a saved timeline).
  const next = state.status === 'running' || state.status === 'unknown' ? status : state.status
  let s: RunView = {
    ...state,
    mode: r.mode ?? state.mode, trigger: r.trigger ?? state.trigger, dryRun: typeof r.dry_run === 'boolean' ? r.dry_run : state.dryRun,
    startedAt: state.startedAt ?? r.started_at ?? null, finishedAt: r.finished_at ?? state.finishedAt, ms: r.ms ?? state.ms,
    resultSummary: r.result_summary || state.resultSummary, briefId: r.brief_id ?? state.briefId, status: next,
    timelineDropped: r.timeline_dropped ?? state.timelineDropped,
    // run.finished counts the record's own final save too, so a count from the event wins.
    mem0: state.mem0 ?? mem0Of(r.mem0)
  }
  if (next !== 'running' && next !== 'unknown' && state.status === 'running') s = finishStepsOnEnd(s, next, r.finished_at ?? new Date().toISOString())
  return s
}

/** A saved timeline entry → the event it came from (ai.call entries keep their fields flat). */
export function timelineToEvent(runId: string, t: TimelineEntry): EngineEvent {
  if (t.type === 'ai.call') {
    return { run_id: runId, seq: t.seq, ts: t.ts, type: 'ai.call', agent: t.step, data: { ...(t.call && { call: t.call }), model: t.model, delivery: t.delivery, ms: t.ms, retries: t.retries ?? 0, finish_reason: t.finish_reason } }
  }
  return { run_id: runId, seq: t.seq, ts: t.ts, type: t.type, ...(t.step && { agent: t.step, step: t.step }), ...(t.level && { level: t.level }), ...(t.message !== undefined && { message: t.message }), ...(t.data && { data: t.data }) }
}

const STEP_STATUS: Record<string, StepStatus> = { succeeded: 'done', failed: 'failed', cancelled: 'cancelled', running: 'running' }

/** Rebuilds a finished run without live events: from its saved timeline, or else from its steps. */
export function rebuildFromRecord(runId: string, r: RunRecord): RunView {
  let s = initialRunView(runId)
  if (r.timeline?.length) {
    // Step entries in the timeline have step = agent; ai.call entries map Scout calls to sub-steps.
    for (const t of r.timeline) s = applyEvent(s, timelineToEvent(runId, t))
    s = { ...applyRecord(s, r), source: 'timeline' }
    return s
  }
  for (const st of r.steps ?? []) {
    // A step listed more than once (each Writer / Reviewer round) adds up; the last round sets the status.
    s = withStep(s, st.name, (x) => ({
      ...x, status: STEP_STATUS[st.status] ?? 'waiting', startedAt: x.startedAt ?? st.started_at ?? null, finishedAt: st.finished_at ?? null,
      ms: st.ms == null ? x.ms : (x.ms ?? 0) + st.ms,
      aiCalls: x.aiCalls + (st.ai_calls ?? 0), models: (st.models ?? []).reduce(addModel, x.models), retries: x.retries + (st.retries ?? 0), rounds: x.rounds + 1,
      summary: st.summary || x.summary, error: st.error ?? null,
      placeholder: x.placeholder || /not built yet/.test(st.summary ?? '')
    }))
    if (st.summary) s = { ...s, outputs: [...s.outputs, { seq: 0, ts: st.finished_at ?? '', step: st.name, message: st.summary, data: { record_ids: st.record_ids ?? [] } }] }
  }
  const aiCalls = (r.steps ?? []).reduce((n, st) => n + (st.ai_calls ?? 0), 0)
  const retries = (r.steps ?? []).reduce((n, st) => n + (st.retries ?? 0), 0)
  const out: RunView = { ...applyRecord({ ...s, totals: { aiCalls, retries } }, r), source: 'record' }
  // A finished run whose record still has a step "running" (it stopped mid-step): that step ended with the run.
  return out.status !== 'running' && out.status !== 'unknown' ? finishStepsOnEnd(out, out.status, r.finished_at ?? new Date().toISOString()) : out
}

export function runReducer(state: RunView, action: Action): RunView {
  switch (action.type) {
    case 'reset':
      return initialRunView(action.runId)
    case 'event': {
      const next = applyEvent(state.source === 'live' || state.source === 'none' ? state : initialRunView(state.runId), action.event)
      return next === state ? state : { ...next, source: 'live' }
    }
    case 'record':
      return applyRecord(state, action.record)
    case 'rebuild':
      // Only when no live event arrived (the in-memory buffer is gone).
      return state.seen > 0 && state.source === 'live' ? applyRecord(state, action.record) : rebuildFromRecord(state.runId, action.record)
  }
}

/** The pipeline steps to draw, in order; never-started steps are "waiting" while running, else "skipped". */
export function trackerSteps(s: RunView): StepState[] {
  const ended = s.status !== 'running' && s.status !== 'unknown'
  return PIPELINE.map((name) => s.steps[name] ?? { ...blankStep(name), status: ended ? 'skipped' : 'waiting' })
}

/** Every record id mentioned by the run's outputs (for links). */
export function outputRecordIds(o: Output): string[] {
  const d = o.data ?? {}
  const ids: unknown[] = [d.record_id, ...(Array.isArray(d.cluster_ids) ? d.cluster_ids : []), ...(Array.isArray(d.story_ids) ? d.story_ids : []), ...(Array.isArray(d.tutorial_ids) ? d.tutorial_ids : []), d.style_profile_id, ...(Array.isArray(d.record_ids) ? d.record_ids : [])]
  return [...new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0))]
}
