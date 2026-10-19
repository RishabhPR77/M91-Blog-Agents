// Shapes returned by the engine API (apps/engine/src/server.js). Only the fields the dashboard uses.

export type Health = { ok: boolean; version: string; run_in_progress: boolean }

export type AgentModel = { service?: string; model?: string; delivery?: string; research_delivery?: string }

export type Settings = {
  version: string
  models: Record<string, AgentModel>
  scout: Record<string, unknown> & { question_groups?: number[]; max_calls?: number }
  strategist: Record<string, unknown>
  gates: { pass_score_min: number; pass_area_min: number }
  limits: Record<string, number>
  content: Record<string, unknown>
  runtime: { dry_run: boolean; auto_publish: boolean; log_level: string }
  dashboard: { auth: boolean; port: number | null }
  approval?: { max_human_revisions: number; rereview_after_human: boolean; m91_notify_on_awaiting: boolean }
  built_modes?: string[]
  decision_modes?: string[]
}

export type RunStepSummary = { name: string; status: string; ms: number | null; ai_calls: number }

export type RunSummary = {
  record_id: string
  run_id: string
  mode: string
  trigger: string
  dry_run: boolean
  status: string
  started_at: string
  finished_at: string | null
  ms: number | null
  brief_id: string | null
  result_summary: string
  steps: RunStepSummary[]
}

export type ApprovalItem = {
  brief_id: string
  version: number
  brief_version: number
  title: string
  total: number | null
  waiting_since: string | null
  record_id: string
}
