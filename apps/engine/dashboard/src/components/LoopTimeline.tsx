// Every routing decision after a review (loop.route), one card per round.
import { ArrowRight } from 'lucide-react'
import { fmtTime } from '../format'
import type { Route } from '../state/runEvents'

const TARGET: Record<string, string> = { writer: 'Writer', strategist: 'Strategist', scout: 'Scout' }

export function routeLabel(r: Route): string {
  if (r.action === 'approve') return `Reviewer → waiting for you${r.total != null ? ` (score ${r.total})` : ''}`
  if (r.action === 'fail') return `Reviewer → stopped: ${r.reason ?? r.message}`
  const to = TARGET[r.sendTo ?? ''] ?? (r.action === 'rebrief' ? 'Strategist' : r.action === 'rescout' ? 'Scout' : 'Writer')
  return `Reviewer → ${to}: ${r.reason ?? r.message}`
}

export function LoopTimeline({ routes }: { routes: Route[] }) {
  if (!routes.length) return <p className="text-sm text-slate-500">No routing decisions in this run.</p>
  return (
    <ol className="flex flex-wrap items-stretch gap-2">
      {routes.map((r, i) => (
        <li key={r.seq} className="flex items-center gap-2">
          <div className={`rounded-lg border px-3 py-2 text-sm ${r.action === 'approve' ? 'border-emerald-300 dark:border-emerald-800' : r.action === 'fail' ? 'border-red-300 dark:border-red-800' : 'border-slate-200 dark:border-slate-700'}`}>
            <div className="text-xs text-slate-500">Round {r.round != null ? r.round + 1 : i + 1}{r.version != null ? ` · v${r.version}` : ''} · {fmtTime(r.ts)}</div>
            <div className="font-medium">{routeLabel(r)}</div>
          </div>
          {i < routes.length - 1 && <ArrowRight size={14} className="text-slate-400" aria-hidden />}
        </li>
      ))}
    </ol>
  )
}
