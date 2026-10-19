// /runs/:runId — one run, live or finished: header, approval banners, pipeline tracker, loop timeline,
// outputs and the event log.
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Info, Square } from 'lucide-react'
import { api, errorMessage, isApiError } from '../api/client'
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
  const tone = a.kind === 'waiting' ? 'border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/50' : a.kind === 'rejected' ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/50' : a.kind === 'approved' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50' : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50'
  return (
    <div role="status" data-testid={`approval-${a.kind}`} className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${tone}`}>
      <div className="flex-1">
        <div className="font-medium">{APPROVAL_TEXT[a.kind] ?? `approval.${a.kind}`}</div>
        <div className="text-slate-600 dark:text-slate-300">{a.message}{a.briefId ? ` · brief ${a.briefId}` : ''}</div>
      </div>
      {a.kind === 'waiting' && a.briefId && <Link to={`/approvals/${a.briefId}`} className="btn-primary">Open the approval screen</Link>}
    </div>
  )
}

export default function RunLive() {
  const { runId = '' } = useParams()
  const { view, detail, stream, error } = useRunView(runId)
  const qc = useQueryClient()
  const running = view.status === 'running'
  const now = useNow(running)
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)

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
    ['AI calls', String(view.totals.aiCalls) + (view.totals.retries ? ` (+${view.totals.retries} retries)` : '')]
  ]
  const warnings = detail?.run?.warnings ?? []

  return (
    <>
      <PageHeader
        title={`Run ${runId}`}
        subtitle={view.resultSummary ?? (running ? 'Running…' : stream === 'connecting' || stream === 'waiting' ? 'Loading…' : '')}
        actions={
          <>
            <StatusBadge status={view.status === 'unknown' ? (detail?.run?.status ?? 'unknown') : view.status} />
            {running && <button type="button" className="btn-danger" onClick={() => setConfirmStop(true)}><Square size={14} /> Stop</button>}
          </>
        }
      />
      <div className="space-y-4">
        <Card>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {header.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="font-medium" data-testid={`run-${k.toLowerCase().replace(/\s+/g, '-')}`}>{v}</dd>
              </div>
            ))}
          </dl>
          {detail?.run?.approved_unreviewed && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Approved without a Reviewer pass (force_unreviewed).</p>}
          {warnings.length > 0 && (
            <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-300">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </Card>

        {view.source !== 'live' && view.source !== 'none' && (
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300" data-testid="source-note">
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
        {stream === 'reconnecting' && <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">Connection lost: reconnecting…</div>}

        {view.approvals.map((a) => <Banner key={a.seq} a={a} />)}

        <Card title="Pipeline"><PipelineTracker view={view} /></Card>
        {publisherProgress(view.outputs).size > 0 && <Card title="Publisher"><PublisherSteps outputs={view.outputs} stepStatus={view.steps.publisher?.status ?? null} /></Card>}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Loop timeline"><LoopTimeline routes={view.routes} /></Card>
          <Card title="Outputs"><StepOutputs outputs={view.outputs} records={detail?.records} /></Card>
        </div>
        <Card title="Event log"><EventLog lines={view.log} dropped={view.logDropped} /></Card>
      </div>

      <ConfirmDialog open={confirmStop} title={`Stop run ${runId}?`} expectedCalls="0 (calls already made are not refunded)" confirmLabel="Stop the run" danger busy={stopping} onConfirm={stop} onCancel={() => setConfirmStop(false)}>
        <p>The current step is interrupted and recorded as cancelled. Nothing after it runs.</p>
      </ConfirmDialog>
    </>
  )
}
