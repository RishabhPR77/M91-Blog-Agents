// /runs — past and current runs, with status and mode filters. A row opens the run page (also for finished runs).
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRuns } from '../api/queries'
import type { RunSummary } from '../api/types'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { StatusBadge } from '../components/StatusBadge'
import { fmtDateTime, fmtDuration } from '../format'

export const aiCallsOf = (r: RunSummary) => (r.steps ?? []).reduce((n, s) => n + (s.ai_calls ?? 0), 0)

export default function Runs() {
  const [limit, setLimit] = useState(50)
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState('')
  const runs = useRuns(limit)
  const navigate = useNavigate()
  const all = useMemo(() => runs.data ?? [], [runs.data])
  const statuses = useMemo(() => [...new Set(all.map((r) => r.status))].sort(), [all])
  const modes = useMemo(() => [...new Set(all.map((r) => r.mode))].sort(), [all])
  const shown = all.filter((r) => (!status || r.status === status) && (!mode || r.mode === mode))

  return (
    <>
      <PageHeader title="Runs" subtitle="Every run the engine recorded, newest first." />
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
                    <td className="px-2 py-2">{r.mode}</td>
                    <td className="px-2 py-2">{r.trigger}</td>
                    <td className="px-2 py-2">{r.dry_run ? <span className="pill pill-amber">dry</span> : 'no'}</td>
                    <td className="whitespace-nowrap px-2 py-2">{fmtDateTime(r.started_at)}</td>
                    <td className="whitespace-nowrap px-2 py-2">{fmtDuration(r.ms)}</td>
                    <td className="px-2 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-2 py-2 text-right tabular-nums">{aiCallsOf(r)}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{r.brief_id ?? ''}</td>
                    <td className="min-w-64 px-2 py-2 text-slate-600 dark:text-slate-300">{r.result_summary}</td>
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
