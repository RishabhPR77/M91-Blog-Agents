// Scout → Strategist → Writer → Checks → Experience Designer → Reviewer → Promo → Publisher, with each step's state,
// (Promo is hidden while PROMO_ENABLED=false, unless a run used it.)
// time, AI calls, models and retries. Sub-steps (scout.facts, scout.questions.g1, …) are listed under their step.
import { Ban, Check, ChevronRight, Circle, Loader2, MinusCircle, X } from 'lucide-react'
import { fmtDuration } from '../format'
import { trackerSteps, type RunView, type StepState, type StepStatus } from '../state/runEvents'

const LABEL: Record<string, string> = { editor: 'Editor', scout: 'Scout', strategist: 'Strategist', writer: 'Writer', checks: 'Checks', reviewer: 'Reviewer', promo: 'Promo', designer: 'Experience Designer', export: 'Markdown export', publisher: 'Publisher' }

const STYLE: Record<StepStatus, string> = {
  waiting: 'border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-500',
  running: 'border-sky-400 bg-sky-50 text-sky-900 dark:border-sky-600 dark:bg-sky-950 dark:text-sky-100',
  done: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100',
  failed: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-100',
  cancelled: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100',
  skipped: 'border-dashed border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-500'
}

export function StatusIcon({ status, size = 14 }: { status: StepStatus; size?: number }) {
  switch (status) {
    case 'running': return <Loader2 size={size} className="animate-spin" aria-label="running" />
    case 'done': return <Check size={size} aria-label="done" />
    case 'failed': return <X size={size} aria-label="failed" />
    case 'cancelled': return <Ban size={size} aria-label="cancelled" />
    case 'skipped': return <MinusCircle size={size} aria-label="skipped" />
    default: return <Circle size={size} aria-label="waiting" />
  }
}

function Stats({ st }: { st: StepState }) {
  const bits = [
    st.ms != null && st.status !== 'waiting' ? fmtDuration(st.ms) : null,
    st.aiCalls ? `${st.aiCalls} AI call${st.aiCalls === 1 ? '' : 's'}` : null,
    st.retries ? `${st.retries} retr${st.retries === 1 ? 'y' : 'ies'}` : null,
    st.rounds > 1 ? `${st.rounds} rounds` : null
  ].filter(Boolean)
  return bits.length ? <div className="text-xs opacity-80">{bits.join(' · ')}</div> : null
}

export function PipelineTracker({ view, hidePromo = false, hideDesigner = false }: { view: RunView; hidePromo?: boolean; hideDesigner?: boolean }) {
  // The promo pack is off: its step is hidden unless this run really made one (AI calls). Phase 11: the same for
  // the Experience Designer when EXPERIENCE_ENABLED=false, and the export step until a run has one.
  const steps = trackerSteps(view).filter((st) => !(hidePromo && st.name === 'promo' && !st.aiCalls) && !(hideDesigner && st.name === 'designer' && !st.aiCalls) && !((st.name === 'export' || st.name === 'editor') && (st.status === 'waiting' || st.status === 'skipped')))
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8" aria-label="Pipeline">
      {steps.map((st, i) => {
        const placeholder = st.placeholder || ((st.name === 'designer' || st.name === 'publisher') && st.status !== 'waiting' && st.status !== 'skipped' && /not built yet|Publishing is off|Interactive guides are off/.test(st.summary ?? ''))
        return (
          <li key={st.name} data-testid={`step-${st.name}`} data-status={st.status} className={`relative rounded-lg border p-2.5 ${STYLE[st.status]}`}>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <StatusIcon status={st.status} />
              <span>{LABEL[st.name] ?? st.name}</span>
              {i < steps.length - 1 && <ChevronRight size={14} className="absolute -right-2.5 top-3 hidden text-slate-300 xl:block dark:text-slate-600" aria-hidden />}
            </div>
            <div className="mt-1 text-xs capitalize opacity-80">{placeholder ? 'not built yet' : st.status}</div>
            <Stats st={st} />
            {st.models.length > 0 && <div className="mt-0.5 truncate text-xs opacity-70" title={st.models.join(', ')}>{st.models.join(', ')}</div>}
            {st.error && <div className="mt-1 line-clamp-3 text-xs text-red-700 dark:text-red-300" title={st.error}>{st.error}</div>}
            {st.children.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-current/10 pt-2" aria-label={`${LABEL[st.name] ?? st.name} sub-steps`}>
                {st.children.map((c) => {
                  const sub = view.steps[c]
                  if (!sub) return null
                  return (
                    <li key={c} data-testid={`substep-${c}`} className="flex items-start gap-1 text-xs">
                      <span className="mt-0.5"><StatusIcon status={sub.status} size={11} /></span>
                      <span className="min-w-0">
                        <span className="font-medium">{c.split('.').slice(1).join('.')}</span>
                        <span className="opacity-75">{[sub.ms != null && sub.status !== 'running' ? fmtDuration(sub.ms) : null, sub.aiCalls ? `${sub.aiCalls} call${sub.aiCalls === 1 ? '' : 's'}` : null, sub.retries ? `${sub.retries} retr${sub.retries === 1 ? 'y' : 'ies'}` : null].filter(Boolean).map((b) => ` · ${b}`).join('')}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}
