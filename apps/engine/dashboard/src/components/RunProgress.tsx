// What a run is doing, in plain words: "Researching what people ask…", "Writing the draft…", "AI review…", with a
// progress bar over the steps this run has. When it ends: done (and what to do next), waiting for you, or where it
// stopped and why.
import { Link } from 'react-router-dom'
import { CheckCircle2, Loader2, OctagonX, UserRound } from 'lucide-react'
import { trackerSteps, type RunView, type StepState } from '../state/runEvents'

export const DOING: Record<string, string> = {
  planner: 'Planning the roadmap…', guides: 'Reading the published guides…', scout: 'Researching what people ask…',
  strategist: 'Planning the post…', writer: 'Writing the draft…', checks: 'Checking the draft (reading level, links, facts)…',
  designer: 'Designing the interactive guide…', reviewer: 'AI review: reading and scoring the draft…', promo: 'Making the promo pack…',
  export: 'Saving the Markdown export…', publisher: 'Publishing…', roadmap: 'Planning the roadmap…', timely: 'Checking the news…'
}
const NAME: Record<string, string> = { scout: 'Research', strategist: 'Plan', writer: 'Draft', checks: 'Checks', designer: 'Design', reviewer: 'AI review', promo: 'Promo', export: 'Export', publisher: 'Publish' }

// The steps still to come in each kind of run (steps it already reported are always shown).
const AHEAD: Record<string, string[]> = { full: ['scout', 'strategist', 'writer', 'checks', 'designer', 'reviewer'], approve: ['promo', 'export', 'publisher'] }

/** The steps this run has, in order: the ones it reported, and while it runs, the ones still ahead of it. */
export function runSteps(view: RunView, { hidePromo = false, hideDesigner = false } = {}): StepState[] {
  const ahead = view.status === 'running' ? (AHEAD[view.mode ?? ''] ?? []) : []
  const hidden = (s: StepState) => (hidePromo && s.name === 'promo' && !s.aiCalls) || (hideDesigner && s.name === 'designer' && !s.aiCalls)
  const known = trackerSteps(view).filter((s) => !hidden(s) && s.status !== 'skipped' && (s.status !== 'waiting' || ahead.includes(s.name)))
  const extra = view.order.filter((n) => !n.includes('.') && !trackerSteps(view).some((s) => s.name === n)).map((n) => view.steps[n]).filter(Boolean)
  return [...extra, ...known]
}

export function RunProgress({ view, hidePromo, hideDesigner }: { view: RunView; hidePromo?: boolean; hideDesigner?: boolean }) {
  const steps = runSteps(view, { hidePromo, hideDesigner })
  const done = steps.filter((s) => s.status === 'done').length
  const running = steps.find((s) => s.status === 'running')
  const failed = steps.find((s) => s.status === 'failed' || s.status === 'cancelled')
  const waiting = view.approvals.findLast((a) => a.kind === 'waiting')
  const pct = view.status === 'succeeded' ? 100 : steps.length ? Math.round(((done + (running ? 0.5 : 0)) / steps.length) * 100) : 0

  let icon = <Loader2 size={22} className="animate-spin text-sky-600 dark:text-sky-400" />
  let headline = running ? (DOING[running.name] ?? `${running.name}…`) : 'Starting…'
  let sub = running ? `Step ${Math.min(done + 1, steps.length)} of ${steps.length}` : ''
  let bar = 'bg-sky-500'
  if (view.status === 'failed' || view.status === 'cancelled') {
    icon = <OctagonX size={22} className="text-red-600 dark:text-red-400" />
    headline = view.status === 'cancelled' ? `Stopped by you${failed ? ` at ${NAME[failed.name] ?? failed.name}` : ''}` : `Stopped${failed ? ` at ${NAME[failed.name] ?? failed.name}` : ''}`
    sub = failed?.error ?? view.resultSummary ?? ''
    bar = 'bg-red-500'
  } else if (view.status === 'succeeded' && waiting) {
    icon = <UserRound size={22} className="text-violet-600 dark:text-violet-400" />
    headline = 'Done: the draft waits for your review'
    sub = view.resultSummary ?? ''
    bar = 'bg-violet-500'
  } else if (view.status === 'succeeded') {
    icon = <CheckCircle2 size={22} className="text-emerald-600 dark:text-emerald-400" />
    headline = 'Done'
    sub = view.resultSummary ?? ''
    bar = 'bg-emerald-500'
  }

  return (
    <div data-testid="run-progress">
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold tracking-tight" data-testid="run-now">{headline}</div>
          {sub && <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{sub}</div>}
        </div>
        {waiting?.briefId && <Link to={`/approvals/${waiting.briefId}`} className="btn-primary shrink-0">Review the post</Link>}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Run progress">
        <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {steps.length > 0 && (
        <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Steps">
          {steps.map((s) => (
            <li key={s.name} className={s.status === 'done' ? 'text-emerald-700 dark:text-emerald-400' : s.status === 'running' ? 'font-semibold text-sky-700 dark:text-sky-300' : s.status === 'failed' || s.status === 'cancelled' ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}>
              {s.status === 'done' ? '✓ ' : s.status === 'running' ? '● ' : s.status === 'failed' ? '✕ ' : '○ '}{NAME[s.name] ?? s.name}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
