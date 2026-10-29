// One post, one journey (GET /api/journeys and /api/journeys/:briefId): Topic → Research → Plan → Draft → AI review → You
// → Export → Published, whichever runs did each step. Run events refresh both keys (Layout).
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

/** done · current (a run is on it) · waiting (needs you) · failed · todo · off (not used, e.g. publishing off). */
export type StageState = 'done' | 'current' | 'waiting' | 'failed' | 'todo' | 'off'
export type StageId = 'topic' | 'research' | 'plan' | 'draft' | 'review' | 'you' | 'export' | 'published'
export type JourneyStage = { id: StageId; label: string; state: StageState; detail: string; run_id: string | null; at: string | null }
export type JourneyRun = { run_id: string; mode: string; status: string; started_at: string; finished_at: string | null; result_summary: string }
export type PostJourney = {
  brief_id: string
  title: string
  status: string
  stages: JourneyStage[]
  runs: JourneyRun[]
  active_run_id: string | null
  updated_at: string | null
}
/** The list has the number of runs, not the runs. */
export type PostSummary = Omit<PostJourney, 'runs'> & { runs: number }

export const journeyKeys = { one: (briefId: string) => ['post-journey', briefId] as const, all: ['post-journeys'] as const }

/** Older engines have no /api/journeys: the page then simply shows no journey (silent, no retry). */
export const usePostJourney = (briefId: string, enabled = true) =>
  useQuery({ queryKey: journeyKeys.one(briefId), queryFn: () => api<PostJourney>(`/api/journeys/${briefId}`), enabled: enabled && Boolean(briefId), retry: false, meta: { silent: true } })

export const usePostJourneys = (limit = 30) =>
  useQuery({ queryKey: [...journeyKeys.all, limit], queryFn: async () => (await api<{ posts: PostSummary[] }>(`/api/journeys?limit=${limit}`)).posts, retry: false, meta: { silent: true } })

/** Plain words for a run's mode, for people who don't know the engine's names. */
export const MODE_LABEL: Record<string, string> = {
  full: 'Write a post', scout: 'Research', strategist: 'Plan', writer: 'Write', reviewer: 'AI review', approve: 'Approve',
  human_revise: 'Your changes', reject_topic: 'Reject topic', approval_review: 'AI review', publish: 'Publish', unpublish: 'Unpublish',
  designer: 'Design', export: 'Export', guides: 'Read published guides', timely_check: 'Check the news',
  promo: 'Promo pack', set_index: 'Index setting', rebuild_blog: 'Rebuild blog'
}
export const modeLabel = (mode: string) => MODE_LABEL[mode] ?? mode.replace(/_/g, ' ')
