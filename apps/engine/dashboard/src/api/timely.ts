// The timely lane (GET /api/timely and the card actions). One query key: every action and every run event
// refreshes the This week page's cards and the badge on Control.
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export type TimelyStatus = 'proposed' | 'write_now' | 'added_to_roadmap' | 'dismissed' | 'written' | 'expired'
export type TimelyCard = {
  record_id: string
  opportunity_id: string
  status: TimelyStatus
  title: string
  what_happened: string
  source_url: string
  outlet: string
  published_date: string
  why_m91: string
  urgency: 'low' | 'medium' | 'high'
  urgency_reason: string
  topic_group: number | null
  found_at: string | null
  brief_id: string | null
  written_at: string | null
}
export type TimelyResponse = {
  enabled: boolean
  settings: { window_days: number; max_per_week: number; check_on_run: boolean } | null
  open: number
  next: { opportunity_id: string; title: string } | null
  waiting: { opportunity_id: string; title: string; reason: string } | null
  opportunities: TimelyCard[]
}
export type TimelyAction = 'write_now' | 'dismiss'

export const timelyKey = ['timely'] as const

export const useTimely = (enabled = true) =>
  useQuery({ queryKey: timelyKey, queryFn: () => api<TimelyResponse>('/api/timely'), enabled, staleTime: 15_000 })

export const OPEN: TimelyStatus[] = ['proposed', 'write_now']
