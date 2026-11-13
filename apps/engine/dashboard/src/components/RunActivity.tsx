// Beside a run: what is happening, as it happens (a short live feed, newest first, each line sliding in), and when a
// run stops, why it stopped (the failing step and its error, the run's own reason, its warnings, the last review).
// A run rebuilt from its record has no event lines: the feed then lists its steps' results instead.
import { fmtDuration } from '../format'
import type { LogLine, RunView } from '../state/runEvents'
import { subStepLabel } from './stepWords'

const LABEL: Record<string, string> = { editor: 'Editor', scout: 'Scout', strategist: 'Strategist', writer: 'Writer', checks: 'Checks', reviewer: 'Reviewer', promo: 'Promo', designer: 'Designer', export: 'Export', publisher: 'Publisher', guides: 'Guides', timely: 'News check' }
// A sub-step says which part of its agent it is ("Scout · This week’s news started"), not just "Scout done" while the
// Scout is still running.
const label = (step: string | null) => {
  if (!step) return 'Run'
  const agent = LABEL[step.split('.')[0]] ?? step
  return step.includes('.') ? `${agent} · ${subStepLabel(step)}` : agent
}
const time = (ts: string) => {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

type Item = { key: string; ts: string; tone: 'ok' | 'now' | 'bad' | 'warn' | 'quiet'; text: string }

function lineOf(l: LogLine): Item | null {
  const d = (l.data ?? {}) as Record<string, unknown>
  const who = label(l.step)
  const msg = l.message ? `: ${l.message}` : ''
  switch (l.type) {
    case 'run.started': return { key: `${l.seq}`, ts: l.ts, tone: 'now', text: 'Run started' }
    case 'run.finished': return { key: `${l.seq}`, ts: l.ts, tone: 'ok', text: `Run finished${msg}` }
    case 'run.failed': return { key: `${l.seq}`, ts: l.ts, tone: 'bad', text: `Run failed${msg}` }
    case 'run.cancelled': return { key: `${l.seq}`, ts: l.ts, tone: 'warn', text: 'Run stopped by you' }
    case 'step.started': return { key: `${l.seq}`, ts: l.ts, tone: 'now', text: `${who} started` }
    case 'step.finished': return { key: `${l.seq}`, ts: l.ts, tone: 'ok', text: `${who} done${msg}` }
    case 'step.failed': return { key: `${l.seq}`, ts: l.ts, tone: 'bad', text: `${who} failed${msg}` }
    case 'step.cancelled': return { key: `${l.seq}`, ts: l.ts, tone: 'warn', text: `${who} cancelled` }
    case 'step.output': return l.message ? { key: `${l.seq}`, ts: l.ts, tone: 'quiet', text: `${who}: ${l.message}` } : null
    case 'loop.route': return { key: `${l.seq}`, ts: l.ts, tone: 'warn', text: `Decision: ${l.message}` }
    case 'ai.call': {
      const ms = typeof d.ms === 'number' ? ` in ${fmtDuration(d.ms)}` : ''
      const retries = typeof d.retries === 'number' && d.retries > 0 ? `, after ${d.retries} retr${d.retries === 1 ? 'y' : 'ies'}` : ''
      return { key: `${l.seq}`, ts: l.ts, tone: 'quiet', text: `${who}: AI answered${ms}${d.model ? ` (${String(d.model)})` : ''}${retries}` }
    }
    default:
      if (l.level === 'error') return { key: `${l.seq}`, ts: l.ts, tone: 'bad', text: `${who}: ${l.message}` }
      if (l.level === 'warn') return { key: `${l.seq}`, ts: l.ts, tone: 'warn', text: `${who}: ${l.message}` }
      return null
  }
}

const DOT: Record<Item['tone'], string> = { ok: 'bg-ink', now: 'bg-lime-500', bad: 'bg-red-500', warn: 'bg-amber-500', quiet: 'bg-ink/20' }

export function ActivityFeed({ view }: { view: RunView }) {
  let items = view.log.map(lineOf).filter((x): x is Item => Boolean(x))
  if (!items.length) {
    // No event lines (a run rebuilt from its record): its steps' results, in order.
    items = Object.values(view.steps)
      .filter((s) => !s.name.includes('.') && s.status !== 'waiting' && s.status !== 'skipped')
      .map((s, i) => ({ key: `step-${i}`, ts: s.finishedAt ?? s.startedAt ?? '', tone: s.status === 'failed' ? 'bad' : s.status === 'running' ? 'now' : s.status === 'cancelled' ? 'warn' : 'ok', text: `${label(s.name)} ${s.status === 'done' ? 'done' : s.status}${s.error ? `: ${s.error}` : s.summary ? `: ${s.summary}` : ''}` }) as Item)
  }
  const shown = items.slice(-40).reverse()
  const live = view.status === 'running'
  return (
    <section aria-label="Activity">
      <p className="eyebrow mb-4 flex items-center gap-2">
        {live && <span className="relative flex size-2"><span className="absolute inset-0 animate-ping rounded-full bg-lime-400 opacity-70" /><span className="relative size-2 rounded-full bg-lime-500" /></span>}
        Activity {live ? '· live' : ''}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-ink-3">{live ? 'Waiting for the first step…' : 'Nothing recorded for this run.'}</p>
      ) : (
        <ol className="relative max-h-[28rem] space-y-3 overflow-y-auto pr-1 [mask-image:linear-gradient(to_bottom,black_85%,transparent)]" data-testid="activity">
          {shown.map((it) => (
            <li key={it.key} className="grid animate-slide-in grid-cols-[0.5rem_minmax(0,1fr)] gap-x-3">
              <span className={`mt-1.5 size-2 rounded-full ${DOT[it.tone]}`} />
              <div className="min-w-0">
                <p className={`text-[13px] leading-snug break-words ${it.tone === 'bad' ? 'text-red-700' : it.tone === 'quiet' ? 'text-ink-3' : 'text-ink'}`}>{it.text}</p>
                {it.ts && <p className="mt-0.5 text-[11px] text-ink-3 tabular-nums">{time(it.ts)}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** Why the run stopped: shown only for a failed or cancelled run. */
export function WhyStopped({ view, warnings = [] }: { view: RunView; warnings?: string[] }) {
  if (view.status !== 'failed' && view.status !== 'cancelled') return null
  const failedStep = Object.values(view.steps).find((s) => !s.name.includes('.') && (s.status === 'failed' || s.status === 'cancelled'))
  const lastRoute = [...view.routes].reverse().find((r) => r.total != null)
  // The run's own reason is usually the failed step's error again: shown only when it says something more.
  const err = failedStep?.error ?? ''
  const own = view.resultSummary && !(err && (view.resultSummary.includes(err) || err.includes(view.resultSummary))) ? view.resultSummary : null
  const reasons = [
    failedStep ? `${label(failedStep.name)} ${failedStep.status === 'cancelled' ? 'was stopped' : 'failed'}${err ? `: ${err}` : ''}` : null,
    own ? `The run's own reason: ${own}` : null,
    lastRoute ? `Last review: ${lastRoute.total}/100 (round ${lastRoute.round != null ? lastRoute.round + 1 : '?'})${lastRoute.reason ? `, because of ${lastRoute.reason}` : ''}` : null,
    ...warnings.map((w) => `Warning: ${w}`)
  ].filter((x): x is string => Boolean(x))
  return (
    <section className="animate-enter rounded-2xl border border-red-200 bg-red-50/70 p-5" aria-label="Why it stopped" data-testid="why-stopped">
      <p className="eyebrow mb-3 text-red-700">Why it stopped</p>
      <ul className="space-y-2 text-[13.5px] leading-snug text-red-900">
        {reasons.map((r, i) => <li key={i} className="flex gap-2"><span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-red-500" />{r}</li>)}
      </ul>
    </section>
  )
}
