// TanStack Query hooks for the engine API. Keys are shared so live events can invalidate them: run.* and
// approval.* events refresh runs, approvals, posts and health at once. Phase 9 A4: no polling except
// /api/health (no Mem0); the lists are served from the engine's index.
import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { ApprovalItem, Health, PostItem, RunSummary, Settings } from './types'

export const keys = {
  health: ['health'] as const,
  settings: ['settings'] as const,
  approvals: ['approvals'] as const,
  runs: (limit: number) => ['runs', limit] as const,
  posts: ['posts'] as const
}

/** Engine status; errors here mean "offline" and are shown as a banner, not a toast. */
export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: () => api<Health>('/api/health'), refetchInterval: 10_000, retry: false, meta: { silent: true } })

export const useSettings = (enabled = true) =>
  useQuery({ queryKey: keys.settings, queryFn: () => api<Settings>('/api/settings'), staleTime: 60_000, enabled })

export const useApprovals = (enabled = true) =>
  useQuery({ queryKey: keys.approvals, queryFn: async () => (await api<{ approvals: ApprovalItem[] }>('/api/approvals')).approvals, enabled })

export const useRuns = (limit = 20, enabled = true) =>
  useQuery({ queryKey: keys.runs(limit), queryFn: async () => (await api<{ runs: RunSummary[] }>(`/api/runs?limit=${limit}`)).runs, enabled })

/** Blog posts (Phase 7). Run events refresh it, so a publish shows up without a reload. */
export const usePosts = (enabled = true) =>
  useQuery({ queryKey: keys.posts, queryFn: async () => (await api<{ posts: PostItem[] }>('/api/posts')).posts, enabled })
