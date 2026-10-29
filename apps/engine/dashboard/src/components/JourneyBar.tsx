// One bar per post: Topic → Research → Plan → Draft → AI review → You → Export → Published. Each step is green when
// done, whichever run did it; the step a run is on pulses; "You" turns violet when the post waits for you.
import { Link } from 'react-router-dom'
import { Check, Loader2, Minus, UserRound, X } from 'lucide-react'
import type { JourneyStage, StageState } from '../api/journey'

const DOT: Record<StageState, string> = {
  done: 'bg-emerald-500 text-white border-emerald-500',
  current: 'bg-sky-500 text-white border-sky-500',
  waiting: 'bg-violet-600 text-white border-violet-600',
  failed: 'bg-red-500 text-white border-red-500',
  todo: 'bg-white text-slate-400 border-slate-300 dark:bg-slate-900 dark:border-slate-600',
  off: 'bg-white text-slate-300 border-dashed border-slate-300 dark:bg-slate-900 dark:border-slate-700'
}
const LINE: Record<StageState, string> = {
  done: 'bg-emerald-500', current: 'bg-sky-300 dark:bg-sky-700', waiting: 'bg-violet-300 dark:bg-violet-700',
  failed: 'bg-red-300 dark:bg-red-800', todo: 'bg-slate-200 dark:bg-slate-700', off: 'bg-slate-200 dark:bg-slate-700'
}
export const STATE_WORD: Record<StageState, string> = { done: 'done', current: 'in progress', waiting: 'needs you', failed: 'stopped', todo: 'not yet', off: 'off' }

function Icon({ state }: { state: StageState }) {
  if (state === 'done') return <Check size={14} strokeWidth={3} />
  if (state === 'current') return <Loader2 size={14} className="animate-spin" />
  if (state === 'waiting') return <UserRound size={14} />
  if (state === 'failed') return <X size={14} strokeWidth={3} />
  if (state === 'off') return <Minus size={14} />
  return null
}

export function JourneyBar({ stages, compact = false }: { stages: JourneyStage[]; compact?: boolean }) {
  return (
    <ol className={`flex w-full items-start ${compact ? '' : 'overflow-x-auto pb-1'}`} aria-label="Post journey" data-testid="journey">
      {stages.map((s, i) => {
        const dot = (
          <span className={`relative z-10 flex ${compact ? 'h-5 w-5' : 'h-7 w-7'} shrink-0 items-center justify-center rounded-full border-2 ${DOT[s.state]} ${s.state === 'current' ? 'ring-4 ring-sky-100 dark:ring-sky-400/20' : s.state === 'waiting' ? 'ring-4 ring-violet-100 dark:ring-violet-400/20' : ''}`}>
            {!compact && <Icon state={s.state} />}
          </span>
        )
        return (
          <li key={s.id} className={`relative flex flex-1 flex-col items-center text-center ${compact ? 'min-w-0' : 'min-w-[4.75rem]'}`} data-testid={`stage-${s.id}`} data-state={s.state} title={`${s.label}: ${STATE_WORD[s.state]}${s.detail ? ` · ${s.detail}` : ''}`}>
            {i > 0 && <span aria-hidden className={`absolute right-1/2 left-[-50%] h-0.5 ${compact ? 'top-2.5' : 'top-3.5'} ${LINE[s.state === 'todo' || s.state === 'off' ? s.state : 'done']}`} />}
            {s.run_id && !compact ? <Link to={`/runs/${s.run_id}`} aria-label={`${s.label}: open its run`}>{dot}</Link> : dot}
            {!compact && (
              <>
                <span className={`mt-1.5 text-xs font-medium ${s.state === 'todo' || s.state === 'off' ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'}`}>{s.label}</span>
                <span className="sr-only">{STATE_WORD[s.state]}</span>
                {s.detail && <span className="mt-0.5 line-clamp-2 max-w-[9rem] px-1 text-[11px] leading-tight text-slate-500 dark:text-slate-400">{s.detail}</span>}
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** A one-line, plain-language status of a post from its journey. */
export function journeyLine(stages: JourneyStage[]): { text: string; tone: 'green' | 'blue' | 'violet' | 'red' | 'gray' } {
  const by = (state: StageState) => stages.find((s) => s.state === state)
  const failed = by('failed')
  const current = by('current')
  if (current) return { text: `${current.label}…`, tone: 'blue' }
  if (by('waiting')) return { text: 'Waiting for your review', tone: 'violet' }
  if (failed) return { text: `Stopped at ${failed.label}`, tone: 'red' }
  const pub = stages.find((s) => s.id === 'published')
  if (pub?.state === 'done') return { text: 'Published', tone: 'green' }
  const exp = stages.find((s) => s.id === 'export')
  if (exp?.state === 'done') return { text: pub?.state === 'off' ? 'Done: Markdown exported' : 'Approved, not published yet', tone: 'green' }
  const next = stages.find((s) => s.state === 'todo')
  return { text: next ? `Next: ${next.label}` : 'Done', tone: 'gray' }
}
