// The run as a vertical timeline: Editor → Scout → Strategist → Writer → Checks → Reviewer → Export → Publisher.
// Each agent is a node on one line; the line fills in ink as steps finish. The step that runs pulses lime, says what
// it is doing in plain words, counts its time live and shows a moving stripe; a finished step pops a tick. The
// Writer ↔ Reviewer rounds show under the Reviewer. Sub-steps (scout.facts, scout.questions.g1, …) sit under their
// step. Promo and the Experience Designer are hidden while they are off, unless a run used them.
import { Ban, Check, Minus, X } from 'lucide-react'
import { fmtDuration } from '../format'
import { trackerSteps, type RunView, type StepState, type StepStatus } from '../state/runEvents'
import { useNow } from '../state/useRunView'
import { DOING } from './RunProgress'

const LABEL: Record<string, string> = { editor: 'Editor', scout: 'Scout', strategist: 'Strategist', writer: 'Writer', checks: 'Checks', reviewer: 'Reviewer', promo: 'Promo', designer: 'Experience Designer', export: 'Markdown export', publisher: 'Publisher' }
const ROLE: Record<string, string> = {
  editor: 'Picks this week’s most useful topic', scout: 'Researches facts and real questions', strategist: 'Plans the post: angle, outline, sources',
  writer: 'Writes the draft', checks: 'Checks reading level, length, links and facts', reviewer: 'Scores the draft and sends it back if needed',
  promo: 'Makes the promo pack', designer: 'Builds the interactive guide', export: 'Saves the final Markdown file', publisher: 'Sends the post on'
}
const WORD: Record<StepStatus, string> = { waiting: 'waiting', running: 'running', done: 'done', failed: 'failed', cancelled: 'cancelled', skipped: 'skipped' }

/** The node on the line: a hollow ring (waiting), a pulsing lime dot (running), an ink tick (done), red (failed). */
export function StatusIcon({ status, size = 14 }: { status: StepStatus; size?: number }) {
  switch (status) {
    case 'running': return <span aria-label="running" className="block size-2.5 rounded-full bg-ink" />
    case 'done': return <Check size={size} strokeWidth={3} aria-label="done" />
    case 'failed': return <X size={size} strokeWidth={3} aria-label="failed" />
    case 'cancelled': return <Ban size={size} aria-label="cancelled" />
    case 'skipped': return <Minus size={size} aria-label="skipped" />
    default: return <span aria-label="waiting" className="block size-2 rounded-full bg-ink/20" />
  }
}

const NODE: Record<StepStatus, string> = {
  waiting: 'border-line-strong bg-surface text-ink-3',
  running: 'border-transparent bg-hl text-lime-600 animate-signal',
  done: 'border-transparent bg-ink text-white animate-pop',
  failed: 'border-transparent bg-red-600 text-white animate-pop',
  cancelled: 'border-transparent bg-amber-500 text-white',
  skipped: 'border-dashed border-line-strong bg-transparent text-ink-3'
}

function Stats({ st }: { st: StepState }) {
  const bits = [
    st.ms != null && st.status !== 'waiting' && st.status !== 'running' ? fmtDuration(st.ms) : null,
    st.aiCalls ? `${st.aiCalls} AI call${st.aiCalls === 1 ? '' : 's'}` : null,
    st.retries ? `${st.retries} retr${st.retries === 1 ? 'y' : 'ies'}` : null,
    st.rounds > 1 ? `${st.rounds} rounds` : null
  ].filter(Boolean)
  return bits.length ? <span className="tabular-nums">{bits.join(' · ')}</span> : null
}

/** The live clock of the running step. */
function Elapsed({ since }: { since: string | null }) {
  const now = useNow(true)
  if (!since) return null
  return <span className="font-medium text-hl-ink tabular-nums">{fmtDuration(now - Date.parse(since))}</span>
}

export function PipelineTracker({ view, hidePromo = false, hideDesigner = false }: { view: RunView; hidePromo?: boolean; hideDesigner?: boolean }) {
  // The promo pack is off: its step is hidden unless this run really made one (AI calls). Phase 11: the same for
  // the Experience Designer when EXPERIENCE_ENABLED=false, and the export step until a run has one.
  const steps = trackerSteps(view).filter((st) => !(hidePromo && st.name === 'promo' && !st.aiCalls) && !(hideDesigner && st.name === 'designer' && !st.aiCalls) && !((st.name === 'export' || st.name === 'editor') && (st.status === 'waiting' || st.status === 'skipped')))
  // A single-agent run (scout, writer, …) shows only its own steps while it runs, not the whole pipeline as "waiting".
  const own = view.status === 'running' && view.mode !== 'full' ? steps.filter((st) => st.status !== 'waiting') : steps
  const rounds = view.routes.filter((r) => r.total != null)
  return (
    <ol className="relative" aria-label="Pipeline">
      {own.map((st, i) => {
        const placeholder = st.placeholder || ((st.name === 'designer' || st.name === 'publisher') && st.status !== 'waiting' && st.status !== 'skipped' && /not built yet|Publishing is off|Interactive guides are off/.test(st.summary ?? ''))
        const last = i === own.length - 1
        const filled = st.status === 'done' || st.status === 'skipped' || st.status === 'failed' || st.status === 'cancelled'
        const running = st.status === 'running'
        const quiet = st.status === 'waiting' || st.status === 'skipped'
        return (
          <li key={st.name} data-testid={`step-${st.name}`} data-status={st.status} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 pb-7 last:pb-0">
            {!last && (
              <span aria-hidden className="absolute top-9 bottom-1 left-[15px] w-0.5 overflow-hidden rounded-full bg-line">
                <span className={`block h-full w-full origin-top rounded-full transition-transform duration-700 ease-out ${filled ? 'scale-y-100 bg-ink' : running ? 'scale-y-[0.35] bg-lime-400' : 'scale-y-0 bg-ink'}`} />
              </span>
            )}
            <span key={st.status} className={`relative z-10 flex size-8 items-center justify-center rounded-full border-2 transition-colors duration-300 ${NODE[st.status]}`}>
              <StatusIcon status={st.status} />
            </span>
            <div className={`min-w-0 pt-1 ${quiet ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-[15px] font-semibold tracking-[-0.01em]">{LABEL[st.name] ?? st.name}</span>
                <span className={`text-xs ${running ? 'text-hl-ink' : st.status === 'failed' ? 'text-red-700' : 'text-ink-3'}`}>{placeholder ? 'not built yet' : WORD[st.status]}</span>
                <span className="ml-auto text-xs text-ink-3">{running ? <Elapsed since={st.startedAt} /> : <Stats st={st} />}</span>
              </div>
              <p className="mt-0.5 text-sm text-ink-2">
                {running ? <span className="font-medium text-ink">{DOING[st.name] ?? `${LABEL[st.name] ?? st.name}…`}</span> : st.status === 'done' && st.summary && !placeholder ? st.summary : ROLE[st.name] ?? ''}
              </p>
              {running && (
                <div className="mt-2.5 h-1 w-full max-w-sm overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
                  <div className="bar-live h-full w-full rounded-full bg-lime-400" />
                </div>
              )}
              {running && (st.aiCalls > 0 || st.retries > 0) && <p className="mt-1.5 text-xs text-ink-3"><Stats st={st} /></p>}
              {st.models.length > 0 && !quiet && <p className="mt-1 truncate text-xs text-ink-3" title={st.models.join(', ')}>{st.models.join(', ')}</p>}
              {st.error && <p className="mt-1.5 line-clamp-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" title={st.error}>{st.error}</p>}
              {st.name === 'reviewer' && rounds.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Review rounds">
                  {rounds.map((r) => (
                    <li key={r.seq} className="animate-fade rounded-full bg-ink/[0.05] px-2.5 py-0.5 text-xs text-ink-2 tabular-nums">
                      Round {r.round ?? '?'}: {r.total}/100 → {r.sendTo === 'human' || r.action === 'await_human' ? 'you' : r.sendTo ?? 'next'}
                    </li>
                  ))}
                </ul>
              )}
              {st.children.length > 0 && (
                <ul className="mt-2 space-y-1 border-l-2 border-line pl-3" aria-label={`${LABEL[st.name] ?? st.name} sub-steps`}>
                  {st.children.map((c) => {
                    const sub = view.steps[c]
                    if (!sub) return null
                    return (
                      <li key={c} data-testid={`substep-${c}`} className="flex animate-fade items-center gap-1.5 text-xs text-ink-2">
                        <span className={sub.status === 'done' ? 'text-emerald-600' : sub.status === 'running' ? 'text-lime-600' : sub.status === 'failed' ? 'text-red-600' : 'text-ink-3'}><StatusIcon status={sub.status} size={11} /></span>
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{c.split('.').slice(1).join('.')}</span>
                          <span className="text-ink-3">{[sub.ms != null && sub.status !== 'running' ? fmtDuration(sub.ms) : null, sub.aiCalls ? `${sub.aiCalls} call${sub.aiCalls === 1 ? '' : 's'}` : null, sub.retries ? `${sub.retries} retr${sub.retries === 1 ? 'y' : 'ies'}` : null].filter(Boolean).map((b) => ` · ${b}`).join('')}</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
