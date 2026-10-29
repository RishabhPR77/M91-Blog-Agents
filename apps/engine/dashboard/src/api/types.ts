// Shapes returned by the engine API (apps/engine/src/server.js). Only the fields the dashboard uses.

/** The engine's index (Phase 9 A4): when it was loaded, and whether another process changed Mem0 since. */
export type IndexStatus = { loaded_at: string | null; types: string[]; records: number; out_of_date: boolean }

/** The Mem0 quota guard's estimate for this month (Phase 9 A5). The Mem0 console has the exact figure. */
export type Mem0Usage = { month: string; used: number; limit: number; pct: number; level: 'ok' | 'warn' | 'stop'; warn_pct: number; stop_pct: number; resets_on: string; limited?: 'retrievals' | 'adds' | null; adds?: { used: number; limit: number; pct: number; level: 'ok' | 'warn' | 'stop' }; blocked?: Mem0Blocked | null; backend?: 'mem0' | 'viasocket'; cost_usd?: number | null }
/** Mem0 itself refused a request: its monthly limit is reached until its reset date (until). */
export type Mem0Blocked = { kind: 'retrievals' | 'adds'; limit: number | null; used: number | null; until: string; at: string }

/** `login`: how the engine logs people in (the only thing a caller without a session is told): off, password, or the admin ID + password. */
export type Health = { ok: boolean; login?: 'off' | 'password' | 'admin'; version: string; run_in_progress: boolean; index?: IndexStatus; mem0_usage?: Mem0Usage }

export type AgentModel = { service?: string; model?: string; delivery?: string; research_delivery?: string }

export type Settings = {
  version: string
  /** The weekly editor: how far back the questions go, how many candidates, how many real signals each needs. */
  weekly?: { question_days: number; questions_max: number; candidates: number; min_evidence: number; similarity: number }
  /** The news check (RAPID_RESPONSE_ENABLED): its cards are the editor's news; Write now makes one the next post. */
  timely?: { enabled: boolean; check_on_run: boolean; window_days: number; max_per_week: number }
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
  /** Phase 7: the blog and the Publisher (deploy_token_set is yes/no only, never the token). */
  blog?: { auto_publish: boolean; app_name: string; base_url: string; noindex_first_n_posts: number; deploy_token_set: boolean }
  publish_modes?: string[]
  /** Phase 8: interactive blocks. */
  /** Phase 11: where approved posts go (none: the Markdown export is the output) and whether Docstar is set up. */
  publish?: { target: 'none' | 'embarko' | 'docstar'; docstar_configured: boolean; auto_publish: boolean }
  designer?: { enabled?: boolean; max_components?: number; max_repairs: number; interactive_default: boolean; max_designer_revisions?: number | null; promo_enabled?: boolean }
}

/** GET /api/posts: one row per published_post record (Phase 7). */
export type PostItem = {
  record_id: string
  slug: string
  title: string
  status: 'publishing' | 'published' | 'publish_failed' | 'unpublished' | string
  noindex: boolean
  url: string | null
  brief_id: string | null
  version: number | null
  topic_group: number | null
  published_at: string | null
  updated_at: string | null
  deployed_at: string | null
  last_error: string | null
  /** Interactive blocks in the published post (0 = plain Markdown). Older engines don't send it. */
  blocks?: number
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
