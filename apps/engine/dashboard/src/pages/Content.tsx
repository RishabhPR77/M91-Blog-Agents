// /content — every kind of record the engine keeps, one tab per type, with status and brief filters.
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { StatusBadge } from '../components/StatusBadge'

export const CONTENT_TABS = [
  { type: 'brief', label: 'Briefs' },
  { type: 'draft', label: 'Drafts' },
  { type: 'review', label: 'Reviews' },
  { type: 'guide_doc', label: 'Guides' },
  { type: 'promo_pack', label: 'Promo packs' },
  { type: 'question_cluster', label: 'Question clusters' },
  { type: 'story_lead', label: 'Stories' },
  { type: 'tutorial_lead', label: 'Tutorials' },
  { type: 'tone_profile', label: 'Style notes' },
  { type: 'm91_facts', label: 'M91 facts' },
  { type: 'source_pack', label: 'Source packs' }
] as const

// Statuses each type can have (the filter also lists any other status seen in the results).
const STATUSES: Record<string, string[]> = {
  brief: ['new', 'active', 'drafted', 'awaiting_human', 'approved', 'rejected', 'failed', 'superseded'],
  draft: ['drafted', 'drafted_with_issues', 'awaiting_human', 'changes_requested', 'approved', 'rejected', 'failed_review', 'superseded'],
  review: ['pass', 'fail'],
  guide_doc: ['ok', 'fallback'],
  promo_pack: ['ok', 'with_issues'],
  question_cluster: ['open', 'used', 'old', 'discarded'],
  story_lead: ['open', 'used', 'expired', 'discarded'],
  tutorial_lead: ['open', 'used', 'discarded'],
  tone_profile: ['current', 'old'],
  m91_facts: ['current', 'old'],
  source_pack: ['current', 'old']
}

export type TrimmedRecord = { id: string; type: string; status: string | null; brief_id: string | null; date: string | null; topic_group: string | number | null; version: number | null; key_id: string | null; title: string | null }

export const recordsQuery = (params: Record<string, string>) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  // Record lists are slow to build (Mem0); a short cache avoids refetching when switching tabs.
  return { queryKey: ['records', qs], queryFn: async () => (await api<{ records: TrimmedRecord[] }>(`/api/records?${qs}`)).records, staleTime: 30_000 }
}

export default function Content() {
  const [params, setParams] = useSearchParams()
  const type = CONTENT_TABS.some((t) => t.type === params.get('type')) ? params.get('type')! : 'brief'
  const [status, setStatus] = useState('')
  const [briefId, setBriefId] = useState('')
  const [limit, setLimit] = useState('50')
  const navigate = useNavigate()
  const list = useQuery(recordsQuery({ type, status, brief_id: briefId.trim(), limit }))
  const rows = list.data
  const statuses = useMemo(() => [...new Set([...(STATUSES[type] ?? []), ...(rows ?? []).map((r) => r.status).filter((s): s is string => Boolean(s))])], [type, rows])
  const loading = list.isPending
  const showBrief = ['brief', 'draft', 'review', 'guide_doc', 'promo_pack', 'source_pack'].includes(type)
  const showVersion = ['brief', 'draft', 'review', 'guide_doc', 'promo_pack', 'source_pack'].includes(type)

  function pick(t: string) {
    setStatus('')
    setParams({ type: t })
  }

  return (
    <>
      <PageHeader title="Content" subtitle="Everything the agents produced and keep in memory." />
      <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Record types">
        {CONTENT_TABS.map((t) => (
          <button key={t.type} type="button" role="tab" aria-selected={t.type === type} onClick={() => pick(t.type)}
            className={`rounded-lg px-3 py-1.5 text-sm ${t.type === type ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <select aria-label="Status" className="input w-auto py-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Status: all</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {showBrief && <input aria-label="Brief id" className="input w-52 py-1.5" placeholder="Brief id (exact)" value={briefId} onChange={(e) => setBriefId(e.target.value)} />}
          <select aria-label="How many" className="input w-auto py-1.5" value={limit} onChange={(e) => setLimit(e.target.value)}>
            {['20', '50', '200'].map((n) => <option key={n} value={n}>Last {n}</option>)}
          </select>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !rows?.length ? (
          <EmptyState>{status || briefId ? 'Nothing matches these filters.' : 'Nothing of this kind yet. The agents create these when they run.'}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label={`${type} records`}>
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-2 py-1.5 font-medium">Id</th>
                  <th className="px-2 py-1.5 font-medium">Title / text</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  {showBrief && <th className="px-2 py-1.5 font-medium">Brief</th>}
                  {showVersion && <th className="px-2 py-1.5 font-medium">Version</th>}
                  <th className="px-2 py-1.5 font-medium">Group</th>
                  <th className="px-2 py-1.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} tabIndex={0} onClick={() => navigate(`/records/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/records/${r.id}`)}
                    className="cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50 focus:bg-slate-50 focus:outline-none dark:border-slate-800/60 dark:hover:bg-slate-800/50 dark:focus:bg-slate-800/50">
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{r.key_id ?? r.id.slice(0, 8)}</td>
                    <td className="px-2 py-1.5">{r.title ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-2 py-1.5"><StatusBadge status={r.status} /></td>
                    {showBrief && <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{r.brief_id ?? ''}</td>}
                    {showVersion && <td className="px-2 py-1.5">{r.version != null ? `v${r.version}` : ''}</td>}
                    <td className="px-2 py-1.5">{r.topic_group ?? ''}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{r.date ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
