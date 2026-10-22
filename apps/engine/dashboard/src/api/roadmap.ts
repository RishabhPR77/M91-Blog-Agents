// Phase 12: the roadmap API (GET /api/roadmap and the slot actions). One query key, so every change and every
// run event refreshes the Roadmap page, the "Next up" line on Control and the approval screen.
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export type SlotStatus = 'planned' | 'drafting' | 'in_review' | 'approved' | 'skipped' | 'proposed'
export type RoadmapSlot = {
  slot_id: string
  title_idea: string
  question: string
  teaches: string[]
  needs: string[]
  status: SlotStatus
  brief_id: string
  evidence_url?: string
  demand_evidence?: string
}
export type RoadmapStage = { number: number; name: string; level: 'beginner' | 'intermediate' | 'advanced'; goal: string; slots: RoadmapSlot[] }
export type Roadmap = { version: number; status: 'draft' | 'approved'; stages: RoadmapStage[]; generated_at?: string | null; approved_at?: string | null; model_used?: string | null; notes?: string; updated_at?: string }
/** The timely lane: a Write now card that waits, and why. */
export type TimelyWaiting = { title: string; opportunity_id: string | null; reason: string }
export type NextUp = (
  | { kind: 'slot'; slot_id: string; title_idea: string; stage: { number: number; name: string; level: string; goal?: string } }
  | { kind: 'pinned'; topic: string; pinned_id: string }
  | { kind: 'timely'; title: string; opportunity_id: string; outlet: string }
  | { kind: 'none'; reason: string }
) & { timely_waiting?: TimelyWaiting }
export type RoadmapResponse = { roadmap: Roadmap | null; record_id: string | null; next: NextUp; problems: string[] }

export const roadmapKey = ['roadmap'] as const

export const useRoadmap = (enabled = true) =>
  useQuery({ queryKey: roadmapKey, queryFn: () => api<RoadmapResponse>('/api/roadmap'), enabled, staleTime: 15_000 })

/** "Stage 1 · Foundations · s1-2 Why a phone call beats a chat message" */
export function nextUpText(next: NextUp | undefined): string {
  if (!next) return ''
  if (next.kind === 'slot') return `Stage ${next.stage.number} · ${next.stage.name} · ${next.slot_id} ${next.title_idea}`
  if (next.kind === 'pinned') return `Pinned topic: ${next.topic}`
  if (next.kind === 'timely') return `Timely post: ${next.title} (reported by ${next.outlet})`
  return next.reason
}
