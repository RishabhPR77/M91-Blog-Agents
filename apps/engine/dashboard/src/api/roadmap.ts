// Phase 12: the roadmap API (GET /api/roadmap and the slot actions). One query key, so every change and every
// run event refreshes the Roadmap page, the "Next up" line on Control and the approval screen.
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

/** covered: a guide already live on msg91.com/guide answers this slot (covered_by); it is done and never written. */
export type SlotStatus = 'planned' | 'drafting' | 'in_review' | 'approved' | 'skipped' | 'proposed' | 'covered'
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
  covered_by?: { url: string; title: string }
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
  /** One click: the run plans (and approves) the roadmap itself, then writes the first post. */
  | { kind: 'plan'; reason: string }
) & {
  timely_waiting?: TimelyWaiting
  /** The editor: why this topic, and the topics it left out as repeats of posts readers already have. */
  why?: string
  skipped?: { id: string; title: string; why: string }[]
}
export type RoadmapResponse = { roadmap: Roadmap | null; record_id: string | null; next: NextUp; problems: string[] }

export const roadmapKey = ['roadmap'] as const

/** The M91 guides already live on msg91.com/guide (GET /api/guides). covers: the slot a guide covers. */
export type Guide = { url: string; title: string; published_at: string | null; summary: string; headings: string[]; words: number | null; synced_at: string | null; covers: string | null }
export type GuidesResponse = { guides: Guide[]; newer_than_roadmap: number }
export const guidesKey = ['guides'] as const
export const useGuides = (enabled = true) =>
  useQuery({ queryKey: guidesKey, queryFn: () => api<GuidesResponse>('/api/guides'), enabled, staleTime: 30_000 })

export const useRoadmap = (enabled = true) =>
  useQuery({ queryKey: roadmapKey, queryFn: () => api<RoadmapResponse>('/api/roadmap'), enabled, staleTime: 15_000 })

/** "Stage 1 · Foundations · s1-2 Why a phone call beats a chat message" */
export function nextUpText(next: NextUp | undefined): string {
  if (!next) return ''
  if (next.kind === 'slot') return `Stage ${next.stage.number} · ${next.stage.name} · ${next.slot_id} ${next.title_idea}`
  if (next.kind === 'pinned') return `Pinned topic: ${next.topic}`
  if (next.kind === 'timely') return `Timely post: ${next.title} (reported by ${next.outlet})`
  if (next.kind === 'plan') return `First run: ${next.reason}`
  return next.reason
}
