// What a run is doing, in plain words: "Researching what people ask…", "Writing the draft…", "AI review…", with a
// progress bar over the steps this run has. When it ends: done (and what to do next), waiting for you, or where it
// stopped and why.
import { Link } from 'react-router-dom'
import { CheckCircle2, OctagonX, UserRound } from 'lucide-react'
import { fmtDuration } from '../format'
import { trackerSteps, type RunView, type StepState } from '../state/runEvents'
import { useNow } from '../state/useRunView'

export const DOING: Record<string, string> = {
  editor: 'Choosing this week\u2019s post…', guides: 'Reading the published guides…', scout: 'Researching what people ask…',
  strategist: 'Planning the post…', writer: 'Writing the draft…', checks: 'Checking the draft (reading level, links, facts)…',
  designer: 'Designing the interactive guide…', reviewer: 'AI review: reading and scoring the draft…', promo: 'Making the promo pack…',
  export: 'Saving the Markdown export…', publisher: 'Publishing…', timely: 'Checking the news…'
}
const NAME: Record<string, string> = { editor: 'Choose the topic', scout: 'Research', strategist: 'Plan', writer: 'Draft', checks: 'Checks', designer: 'Design', reviewer: 'AI review', promo: 'Promo', export: 'Export', publisher: 'Publish' }

// The steps still to come in each kind of run (steps it already reported are always shown).
const AHEAD: Record<string, string[]> = { full: ['editor', 'scout', 'strategist', 'writer', 'checks', 'designer', 'reviewer'], approve: ['promo', 'export', 'publisher'] }

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
  const live = view.status === 'running'
  const now = useNow(live)
  const elapsed = live && view.startedAt ? now - Date.parse(view.startedAt) : view.ms
  const pct = view.status === 'succeeded' ? 100 : steps.length ? Math.round(((done + (running ? 0.5 : 0)) / steps.length) * 100) : 0

  let icon = <span className="relative flex size-3"><span className="absolute inset-0 animate-ping rounded-full bg-lime-400 opacity-70" /><span className="relative size-3 rounded-full bg-lime-500" /></span>
  let eyebrow = 'Running now'
  let headline = running ? (DOING[running.name] ?? `${running.name}…`) : 'Starting…'
  let sub = running ? `Step ${Math.min(done + 1, steps.length)} of ${steps.length}` : ''
  let bar = 'bg-lime-400 bar-live'
  if (view.status === 'failed' || view.status === 'cancelled') {
    icon = <OctagonX size={18} className="text-red-600" />
    eyebrow = view.status === 'cancelled' ? 'Stopped' : 'Stopped with a problem'
    headline = view.status === 'cancelled' ? `Stopped by you${failed ? ` at ${NAME[failed.name] ?? failed.name}` : ''}` : `Stopped${failed ? ` at ${NAME[failed.name] ?? failed.name}` : ''}`
    sub = failed?.error ?? view.resultSummary ?? ''
    bar = 'bg-red-500'
  } else if (view.status === 'succeeded' && waiting) {
    icon = <UserRound size={18} className="text-lime-700" />
    eyebrow = 'Your turn'
    headline = 'Done: the draft waits for your review'
    sub = view.resultSummary ?? ''
    bar = 'bg-hl'
  } else if (view.status === 'succeeded') {
    icon = <CheckCircle2 size={18} className="text-emerald-600" />
    eyebrow = 'Finished'
    headline = 'Done'
    sub = view.resultSummary ?? ''
    bar = 'bg-ink'
  }

  return (
    <div data-testid="run-progress">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="eyebrow flex items-center gap-2.5">{icon} {eyebrow}{elapsed != null && <span className="font-medium tracking-normal normal-case tabular-nums">· {fmtDuration(elapsed)}</span>}</p>
          <div key={headline} className="mt-3 animate-enter font-serif text-[30px] leading-tight font-semibold tracking-[-0.02em] sm:text-[36px]" data-testid="run-now">{headline}</div>
          {sub && <div className="mt-2 max-w-2xl text-[15px] text-ink-2">{sub}</div>}
        </div>
        {waiting?.briefId && <Link to={`/approvals/${waiting.briefId}`} className="btn-primary shrink-0">Review the post</Link>}
      </div>
      <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Run progress">
        <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${bar}`} style={{ width: `${Math.max(pct, live ? 4 : 0)}%` }} />
      </div>
      {steps.length > 0 && <p className="mt-2 text-xs text-ink-3 tabular-nums">{done} of {steps.length} steps done</p>}
    </div>
  )
}
