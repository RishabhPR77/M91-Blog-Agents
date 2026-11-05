// One bar per post: Topic → Research → Plan → Draft → AI review → You → Export → Published, as thin segments.
// Done steps are ink, the step a run is on moves (lime stripes), "You" glows lime when the post waits for you, a
// stopped step is red. Each step is done whichever run did it.
import { Link } from 'react-router-dom'
import type { JourneyStage, StageState } from '../api/journey'

const SEG: Record<StageState, string> = {
  done: 'bg-ink',
  current: 'bg-lime-400 bar-live',
  waiting: 'bg-hl animate-signal text-lime-500',
  failed: 'bg-red-500',
  todo: 'bg-ink/10',
  off: 'bg-transparent border border-dashed border-ink/20'
}
export const STATE_WORD: Record<StageState, string> = { done: 'done', current: 'in progress', waiting: 'needs you', failed: 'stopped', todo: 'not yet', off: 'off' }

export function JourneyBar({ stages, compact = false }: { stages: JourneyStage[]; compact?: boolean }) {
  return (
    <ol className={`flex w-full ${compact ? 'gap-1' : 'gap-1.5 overflow-x-auto pb-1'}`} aria-label="Post journey" data-testid="journey">
      {stages.map((s) => {
        const seg = <span className={`block w-full rounded-full ${compact ? 'h-1.5' : 'h-1.5'} ${SEG[s.state]}`} />
        const quiet = s.state === 'todo' || s.state === 'off'
        return (
          <li key={s.id} className={`flex min-w-0 flex-1 flex-col ${compact ? '' : 'min-w-[5.5rem]'}`} data-testid={`stage-${s.id}`} data-state={s.state} title={`${s.label}: ${STATE_WORD[s.state]}${s.detail ? ` · ${s.detail}` : ''}`}>
            {s.run_id && !compact ? <Link to={`/runs/${s.run_id}`} aria-label={`${s.label}: open its run`} className="block rounded-full py-1 transition-opacity hover:opacity-70">{seg}</Link> : <span className={compact ? '' : 'py-1'}>{seg}</span>}
            {!compact && (
              <>
                <span className={`mt-2 text-xs font-medium ${quiet ? 'text-ink-3' : s.state === 'waiting' ? 'text-hl-ink' : s.state === 'failed' ? 'text-red-600 dark:text-red-300' : 'text-ink'}`}>{s.label}</span>
                <span className="sr-only">{STATE_WORD[s.state]}</span>
                {s.detail && <span className="mt-0.5 line-clamp-2 pr-2 text-[11px] leading-snug text-ink-3">{s.detail}</span>}
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
