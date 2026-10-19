// TanStack Query hooks for the engine API. Keys are shared so live events can invalidate them: run.* and
// approval.* events refresh runs, approvals and health at once, so the polling below is only a slow backstop
// (the runs and approvals lists each make the engine scan Mem0).
import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { ApprovalItem, Health, RunSummary, Settings } from './types'

export const keys = {
  health: ['health'] as const,
  settings: ['settings'] as const,
  approvals: ['approvals'] as const,
  runs: (limit: number) => ['runs', limit] as const
}

/** Engine status; errors here mean "offline" and are shown as a banner, not a toast. */
export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: () => api<Health>('/api/health'), refetchInterval: 10_000, retry: false, meta: { silent: true } })

export const useSettings = (enabled = true) =>
  useQuery({ queryKey: keys.settings, queryFn: () => api<Settings>('/api/settings'), staleTime: 60_000, enabled })

export const useApprovals = (enabled = true) =>
  useQuery({ queryKey: keys.approvals, queryFn: async () => (await api<{ approvals: ApprovalItem[] }>('/api/approvals')).approvals, refetchInterval: 30_000, enabled })

export const useRuns = (limit = 20, enabled = true) =>
  useQuery({ queryKey: keys.runs(limit), queryFn: async () => (await api<{ runs: RunSummary[] }>(`/api/runs?limit=${limit}`)).runs, refetchInterval: 30_000, enabled })
