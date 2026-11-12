// /runs/:runId — one run, live or finished. On top, what it is doing in plain words ("Writing the draft…") with a
// progress bar, and the journey of its post (every green of the post, from all its runs). Then its steps; the
// facts, loop timeline, outputs and event log are under "Details".
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Info, Square } from 'lucide-react'
import { api, errorMessage, isApiError } from '../api/client'
import { useSettings } from '../api/queries'
import { modeLabel, usePostJourney } from '../api/journey'
import { JourneyBar } from '../components/JourneyBar'
import { ActivityFeed, WhyStopped } from '../components/RunActivity'
import { RunProgress } from '../components/RunProgress'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EventLog } from '../components/EventLog'
import { LoopTimeline } from '../components/LoopTimeline'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { PipelineTracker } from '../components/PipelineTracker'
import { StatusBadge } from '../components/StatusBadge'
import { StepOutputs } from '../components/StepOutputs'
import { PublisherSteps, publisherProgress } from '../components/PublisherSteps'
import { toast } from '../components/Toasts'
import { fmtDateTime, fmtDuration } from '../format'
import type { ApprovalBanner } from '../state/runEvents'
import { useNow, useRunView } from '../state/useRunView'

const APPROVAL_TEXT: Record<string, string> = {
  waiting: 'A draft is waiting for your approval',
  approved: 'Approved by you',
  changes_requested: 'You asked for changes',
  rejected: 'Topic rejected',
  reviewed: 'Reviewed on request'
}

function Banner({ a }: { a: ApprovalBanner }) {
  const tone = a.kind === 'waiting' ? 'border-lime-400/60 bg-hl-tint dark:border-lime-300/25' : a.kind === 'rejected' ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/50' : a.kind === 'approved' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50' : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50'
  return (
    <div role="status" data-testid={`approval-${a.kind}`} className={`flex animate-enter flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <div className="flex-1">
        <div className="font-medium">{APPROVAL_TEXT[a.kind] ?? `approval.${a.kind}`}</div>
        <div className="text-slate-600 dark:text-slate-300">{a.message}{a.briefId ? ` · brief ${a.briefId}` : ''}</div>
      </div>
      {a.kind === 'waiting' && a.briefId && <Link to={`/approvals/${a.briefId}`} className="btn-secondary">Open the approval screen</Link>}
    </div>
  )
}

export default function RunLive() {
  const { runId = '' } = useParams()
  const { view, detail, stream, error } = useRunView(runId)
  const settings = useSettings()
  const qc = useQueryClient()
  const running = view.status === 'running'
  const now = useNow(running)
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const briefId = view.briefId ?? detail?.run?.brief_id ?? null
  const journey = usePostJourney(briefId ?? '', Boolean(briefId))

  async function stop() {
    setStopping(true)
    try {
      await api(`/api/runs/${runId}/cancel`, { method: 'POST' })
      toast('info', 'Cancelling… the current step stops at its next safe point.')
      void qc.invalidateQueries({ queryKey: ['runs'] })
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setStopping(false)
      setConfirmStop(false)
    }
  }

  if (isApiError(error) && error.status === 404 && view.seen === 0) {
    return (
      <>
        <PageHeader title="Run not found" />
        <EmptyState>There is no run {runId}. <Link className="underline" to="/runs">See all runs</Link>.</EmptyState>
      </>
    )
  }

  const elapsed = running && view.startedAt ? now - Date.parse(view.startedAt) : view.ms
  const header = [
    ['Mode', view.mode ?? '—'],
    ['Trigger', view.trigger ?? '—'],
    ['Dry run', view.dryRun == null ? '—' : view.dryRun ? 'yes' : 'no'],
    ['Started', fmtDateTime(view.startedAt)],
    [running ? 'Elapsed' : 'Total time', fmtDuration(elapsed)],
    ['AI calls', String(view.totals.aiCalls) + (view.totals.retries ? ` (+${view.totals.retries} retries)` : '')],
    ['Mem0 calls', view.mem0 ? `${view.mem0.requests} (${view.mem0.reads} reads · ${view.mem0.searches} searches · ${view.mem0.writes} writes · ${view.mem0.cache_hits} cached)` : running ? 'counted at the end' : 'not counted (older run)']
  ]
  const warnings = detail?.run?.warnings ?? []

  return (
    <>
      <PageHeader
        title={view.mode ? modeLabel(view.mode) : 'Run'}
        subtitle={<><span className="font-mono text-xs">{runId}</span>{view.startedAt ? ` · started ${fmtDateTime(view.startedAt)}` : ''}{stream === 'connecting' || stream === 'waiting' ? ' · loading…' : ''}</>}
        actions={
          <>
            <StatusBadge status={view.status === 'unknown' ? (detail?.run?.status ?? 'unknown') : view.status} />
            {running && <button type="button" className="btn-danger" onClick={() => setConfirmStop(true)}><Square size={13} className="fill-current" /> Stop</button>}
          </>
        }
      />
      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_320px] xl:gap-16">
        <div className="min-w-0 space-y-12">
          <RunProgress view={view} hidePromo={settings.data?.designer?.promo_enabled === false} hideDesigner={settings.data?.designer?.enabled === false} />
          <section aria-label="Steps of this run" className="animate-enter [animation-delay:120ms]">
            <p className="eyebrow mb-6">Steps of this run</p>
            <PipelineTracker view={view} hidePromo={settings.data?.designer?.promo_enabled === false} hideDesigner={settings.data?.designer?.enabled === false} />
          </section>
          {publisherProgress(view.outputs).size > 0 && <Card title="Publisher"><PublisherSteps outputs={view.outputs} stepStatus={view.steps.publisher?.status ?? null} /></Card>}
        </div>

        <aside className="space-y-8 lg:sticky lg:top-24 animate-enter [animation-delay:200ms]" aria-label="About this run">
          <WhyStopped view={view} warnings={warnings} />
          {view.approvals.map((a) => <Banner key={a.seq} a={a} />)}
          {briefId && journey.data?.stages?.length ? (
            <div>
              <p className="eyebrow mb-2">The post</p>
              <Link to={`/approvals/${briefId}`} className="font-serif text-[20px] leading-snug font-semibold tracking-[-0.01em] hover:underline">{journey.data.title || 'This post'}</Link>
              <div className="mt-4"><JourneyBar stages={journey.data.stages} compact /></div>
            </div>
          ) : null}
          <ActivityFeed view={view} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-6 text-sm">
            {header.map(([k, v]) => (
              <div key={k} className={k === 'Mem0 calls' ? 'col-span-2' : ''}>
                <dt className="text-xs text-ink-3">{k === 'Mem0 calls' ? 'Memory calls' : k}</dt>
                <dd className="mt-0.5 font-medium tabular-nums" data-testid={`run-${k.toLowerCase().replace(/\s+/g, '-')}`}>{v}</dd>
              </div>
            ))}
          </dl>
          {detail?.run?.approved_unreviewed && <p className="text-sm text-amber-700">Approved without a Reviewer pass (force_unreviewed).</p>}
          {warnings.length > 0 && view.status !== 'failed' && view.status !== 'cancelled' && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </aside>
      </div>

      <details className="group mt-16 border-t border-line pt-6" data-testid="run-details">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink-2 hover:text-ink">
          Technical details: the loop, outputs and the event log <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-6 space-y-8">
          {view.source !== 'live' && view.source !== 'none' && (
            <div className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2" data-testid="source-note">
              <Info size={16} className="mt-0.5 shrink-0" />
              <div>
                Info-level log lines are kept only while the engine runs.
                {view.source === 'timeline'
                  ? ' This view is rebuilt from the run’s saved timeline.'
                  : ' This run has no saved timeline (it ran before the dashboard was added), so only its steps and summaries are shown; there is no event log or loop timeline.'}
                {view.timelineDropped > 0 && ` The oldest ${view.timelineDropped} timeline entries were not kept.`}
              </div>
            </div>
          )}
          {stream === 'reconnecting' && <div className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900">Connection lost: reconnecting…</div>}
          <div className="grid gap-10 lg:grid-cols-2">
            <Card title="Loop timeline"><LoopTimeline routes={view.routes} /></Card>
            <Card title="Outputs"><StepOutputs outputs={view.outputs} records={detail?.records} /></Card>
          </div>
          <Card title="Event log"><EventLog lines={view.log} dropped={view.logDropped} /></Card>
        </div>
      </details>

      <ConfirmDialog open={confirmStop} title={`Stop run ${runId}?`} expectedCalls="0 (calls already made are not refunded)" confirmLabel="Stop the run" danger busy={stopping} onConfirm={stop} onCancel={() => setConfirmStop(false)}>
        <p>The current step is interrupted and recorded as cancelled. Nothing after it runs.</p>
      </ConfirmDialog>
    </>
  )
}
