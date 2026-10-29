// The weekly editor (GET /api/weekly): what the next run does first, and the editor's latest decisions with their
// reason, evidence, news hook and runners-up. Also the guides already live on msg91.com/guide (GET /api/guides).
// Run events refresh both (Layout).
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export type Evidence = { id: string; kind: 'question' | 'news' | 'm91_change' | 'm91_integration' | 'pinned_idea' | string; text: string; url: string | null; where?: string; demand?: string }
export type Hook = { title: string; what_happened?: string; outlet?: string; published_date?: string; source_url: string }
export type PickFormat = 'tutorial' | 'explainer' | 'news_analysis' | 'comparison' | 'checklist'
export type RunnerUp = { title: string; question: string; format: PickFormat; why_now: string; total: number; hook: Hook | null; left_out?: string }
export type WeeklyPick = {
  record_id?: string
  pick_id: string
  date: string
  chosen_at: string
  /** editor: its first choice · editor_runner_up: its first choice failed a check · fallback: code picked. */
  chosen_by: 'editor' | 'editor_runner_up' | 'fallback' | string
  model: string | null
  reason: string
  brief_id: string
  status?: string
  pick: { title: string; question: string; format: PickFormat; angle: string; why_now: string; total: number; evidence: Evidence[]; hook: Hook | null }
  runners_up: RunnerUp[]
  signals?: { counts: Record<string, number> }
}
export type NextRun =
  | { kind: 'editor'; timely_waiting?: { title: string; opportunity_id: string | null; reason: string } }
  | { kind: 'pinned'; topic: string; pinned_id: string; timely_waiting?: { title: string; opportunity_id: string | null; reason: string } }
  | { kind: 'timely'; title: string; opportunity_id: string; outlet: string; timely_waiting?: { title: string; opportunity_id: string | null; reason: string } }
export type WeeklyResponse = { next: NextRun; model: { service: string; model: string } | null; picks: WeeklyPick[] }

export const weeklyKey = ['weekly'] as const
export const useWeekly = (enabled = true) =>
  useQuery({ queryKey: weeklyKey, queryFn: () => api<WeeklyResponse>('/api/weekly'), enabled, staleTime: 15_000, retry: false, meta: { silent: true } })

export const FORMAT_LABEL: Record<string, string> = { tutorial: 'Tutorial', explainer: 'Explainer', news_analysis: 'News analysis', comparison: 'Comparison', checklist: 'Checklist' }
export const CHOSEN_LABEL: Record<string, string> = { editor: 'chosen by the editor', editor_runner_up: 'the editor’s runner-up', fallback: 'chosen by code (the editor was not usable)', stub: 'stub' }

/** What the next run does, in one line. */
export function nextRunText(next: NextRun | undefined, model?: WeeklyResponse['model']): string {
  if (!next) return ''
  if (next.kind === 'pinned') return `Your pinned topic: ${next.topic}`
  if (next.kind === 'timely') return `The news you chose with Write now: ${next.title} (${next.outlet})`
  return `The editor decides when the run starts, from this week's questions, news and M91 changes${model ? ` (${model.model})` : ''}`
}

/** The M91 guides already live on msg91.com/guide. */
export type Guide = { url: string; title: string; published_at: string | null; summary: string; headings: string[]; words: number | null; synced_at: string | null }
export const guidesKey = ['guides'] as const
export const useGuides = (enabled = true) =>
  useQuery({ queryKey: guidesKey, queryFn: () => api<{ guides: Guide[] }>('/api/guides'), enabled, staleTime: 30_000 })
