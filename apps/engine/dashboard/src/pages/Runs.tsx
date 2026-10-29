// /runs — "By post": one row per post with its journey (every run that worked on it, in one bar), and the runs that
// belong to no post (roadmap, guides, news). "All runs": every run, with status and mode filters; a row opens the
// run page (also for finished runs).
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useRuns } from '../api/queries'
import { modeLabel, usePostJourneys } from '../api/journey'
import type { RunSummary } from '../api/types'
import { JourneyBar, journeyLine } from '../components/JourneyBar'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { StatusBadge } from '../components/StatusBadge'
import { fmtAgo, fmtDateTime, fmtDuration } from '../format'

export const aiCallsOf = (r: RunSummary) => (r.steps ?? []).reduce((n, s) => n + (s.ai_calls ?? 0), 0)

const TONE = { green: 'pill-green', blue: 'pill-blue', violet: 'pill-blue', red: 'pill-red', gray: 'pill-gray' } as const

function ByPost() {
  const posts = usePostJourneys(30)
  const runs = useRuns(20)
  const other = (runs.data ?? []).filter((r) => !r.brief_id).slice(0, 8)
  if (posts.isPending) return <p className="text-sm text-slate-500">Loading posts…</p>
  return (
    <div className="space-y-4">
      {!posts.data?.length ? (
        <EmptyState>No posts yet. Click “Write the next post” on Control.</EmptyState>
      ) : (
        <ul className="space-y-3" aria-label="Posts">
          {posts.data.map((p) => {
            const line = journeyLine(p.stages)
            return (
              <li key={p.brief_id} data-testid={`post-${p.brief_id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Link to={`/approvals/${p.brief_id}`} className="min-w-0 flex-1 truncate font-semibold text-slate-900 hover:underline dark:text-slate-100">{p.title || 'A post in the making'}</Link>
                    <span className={`pill ${TONE[line.tone]}`}>{line.text}</span>
                  </div>
                  <JourneyBar stages={p.stages} />
                  <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    <span>{p.runs} run{p.runs === 1 ? '' : 's'}</span>
                    {p.updated_at && <span>last run {fmtAgo(p.updated_at)}</span>}
                    {p.active_run_id && <Link to={`/runs/${p.active_run_id}`} className="text-sky-700 underline dark:text-sky-300">watch the run</Link>}
                    <span className="font-mono">{p.brief_id}</span>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      {other.length > 0 && (
        <Card title="Other runs (not about one post)">
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {other.map((r) => (
              <li key={r.run_id} className="flex flex-wrap items-center gap-2 py-2">
                <Link to={`/runs/${r.run_id}`} className="font-medium hover:underline">{modeLabel(r.mode)}</Link>
                <StatusBadge status={r.status} />
                <span className="text-xs text-slate-500">{fmtDateTime(r.started_at)}</span>
                <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{r.result_summary}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export default function Runs() {
  const [view, setView] = useState<'posts' | 'all'>('posts')
  const [limit, setLimit] = useState(50)
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState('')
  const runs = useRuns(limit, view === 'all')
  const navigate = useNavigate()
  const all = useMemo(() => runs.data ?? [], [runs.data])
  const statuses = useMemo(() => [...new Set(all.map((r) => r.status))].sort(), [all])
  const modes = useMemo(() => [...new Set(all.map((r) => r.mode))].sort(), [all])
  const shown = all.filter((r) => (!status || r.status === status) && (!mode || r.mode === mode))

  return (
    <>
      <PageHeader
        title="Runs"
        subtitle={view === 'posts' ? 'Each post with every step it went through, whichever run did it.' : 'Every run the engine recorded, newest first.'}
        actions={
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm dark:border-slate-700 dark:bg-slate-900" role="tablist">
            {([['posts', 'By post'], ['all', 'All runs']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-md px-3 py-1.5 font-medium ${view === k ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'}`}>{label}</button>
            ))}
          </div>
        }
      />
      {view === 'posts' ? <ByPost /> : (
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <select aria-label="Status" className="input w-auto py-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Status: all</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Mode" className="input w-auto py-1.5" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">Mode: all</option>
            {modes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select aria-label="How many" className="input w-auto py-1.5" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[20, 50, 100].map((n) => <option key={n} value={n}>Last {n}</option>)}
          </select>
        </div>
        {runs.isPending ? (
          <p className="text-sm text-slate-500">Loading runs…</p>
        ) : shown.length === 0 ? (
          <EmptyState>{all.length ? 'No runs match these filters.' : 'No runs yet. Start one from Control.'}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  {['Run', 'Mode', 'Trigger', 'Dry run', 'Started', 'Duration', 'Status', 'AI calls', 'Brief', 'Result'].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.run_id}
                    tabIndex={0}
                    onClick={() => navigate(`/runs/${r.run_id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/runs/${r.run_id}`)}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none dark:border-slate-800/60 dark:hover:bg-slate-800/50 dark:focus:bg-slate-800/50"
                  >
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{r.run_id}</td>
                    <td className="px-2 py-2">{modeLabel(r.mode)}</td>
                    <td className="px-2 py-2">{r.trigger}</td>
                    <td className="px-2 py-2">{r.dry_run ? <span className="pill pill-amber">dry</span> : 'no'}</td>
                    <td className="whitespace-nowrap px-2 py-2">{fmtDateTime(r.started_at)}</td>
                    <td className="whitespace-nowrap px-2 py-2">{fmtDuration(r.ms)}</td>
                    <td className="px-2 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-2 py-2 text-right tabular-nums">{aiCallsOf(r)}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{r.brief_id ? <Link to={`/approvals/${r.brief_id}`} onClick={(e) => e.stopPropagation()} className="underline">{r.brief_id}</Link> : ''}</td>
                    <td className="min-w-64 px-2 py-2 text-slate-600 dark:text-slate-300">{r.result_summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}
    </>
  )
}
