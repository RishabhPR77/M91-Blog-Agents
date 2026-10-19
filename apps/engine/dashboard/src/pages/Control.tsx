// / — Control: start the pipeline or one agent (dry-run and low-cost switches, expected AI calls, confirm),
// the current run with Stop, drafts waiting for you, and the last 5 runs.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Square } from 'lucide-react'
import { api, errorMessage, isApiError } from '../api/client'
import { useApprovals, useHealth, useRuns, useSettings } from '../api/queries'
import type { RunSummary } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { RunButton } from '../components/RunButton'
import { StatusBadge } from '../components/StatusBadge'
import { toast } from '../components/Toasts'
import { expectedCalls, type CostKey } from '../config/costs'
import { buildRunRequest, leastUsedGroup, TOPIC_GROUPS } from '../config/runOptions'
import { fmtDateTime, fmtDuration } from '../format'
import { useNow } from '../state/useRunView'

type Trimmed = { id: string; type: string; status: string | null; brief_id: string | null; topic_group: string | number | null; version: number | null; key_id: string | null; title: string | null; date: string | null }
type Pending = { mode: string; label: string; costKey: CostKey; params: Record<string, unknown>; details: [string, string][] }

const RUN_ID = /R-\d{6}-\d{4}-[A-Z0-9]{4}/

const useRecords = (key: string, query: string, enabled: boolean) =>
  useQuery({ queryKey: ['records', key], queryFn: async () => (await api<{ records: Trimmed[] }>(`/api/records?${query}`)).records, enabled, staleTime: 30_000 })

function aiCalls(r: RunSummary) {
  return (r.steps ?? []).reduce((n, s) => n + (s.ai_calls ?? 0), 0)
}

function CurrentRun({ run }: { run: RunSummary }) {
  const now = useNow(true)
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const current = [...(run.steps ?? [])].reverse().find((s) => s.status === 'running')?.name ?? '—'
  async function stop() {
    setBusy(true)
    try {
      await api(`/api/runs/${run.run_id}/cancel`, { method: 'POST' })
      toast('info', 'Cancelling… the current step stops at its next safe point.')
      void qc.invalidateQueries({ queryKey: ['runs'] })
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  return (
    <Card title="Current run" actions={<Link to={`/runs/${run.run_id}`} className="text-sm text-sky-700 hover:underline dark:text-sky-300">Watch live →</Link>}>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-slate-500">Run</dt><dd className="font-mono text-xs">{run.run_id}</dd></div>
        <div><dt className="text-xs text-slate-500">Mode</dt><dd>{run.mode}{run.dry_run ? ' (dry run)' : ''}</dd></div>
        <div><dt className="text-xs text-slate-500">Elapsed</dt><dd data-testid="current-elapsed">{fmtDuration(run.started_at ? now - Date.parse(run.started_at) : null)}</dd></div>
        <div><dt className="text-xs text-slate-500">Current step · AI calls</dt><dd>{current} · {aiCalls(run)}</dd></div>
      </dl>
      <button type="button" className="btn-danger mt-3" onClick={() => setConfirm(true)}><Square size={14} /> Stop</button>
      <ConfirmDialog open={confirm} title={`Stop run ${run.run_id}?`} expectedCalls="0 (calls already made are not refunded)" confirmLabel="Stop the run" danger busy={busy} onConfirm={stop} onCancel={() => setConfirm(false)}>
        <p>The current step is interrupted and recorded as cancelled.</p>
      </ConfirmDialog>
    </Card>
  )
}

export default function Control() {
  const health = useHealth()
  const online = health.isSuccess
  const settings = useSettings(online)
  const runs = useRuns(5, online)
  const approvals = useApprovals(online)
  const briefs = useRecords('brief', 'type=brief&limit=30', online)
  const drafts = useRecords('draft', 'type=draft&limit=60', online)
  const approved = useRecords('draft-approved', 'type=draft&status=approved&limit=30', online)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [dryRun, setDryRun] = useState<boolean | null>(null)
  const [lowCost, setLowCost] = useState(true)
  const [group, setGroup] = useState<number | null>(null)
  const [briefId, setBriefId] = useState('')
  const [draftKey, setDraftKey] = useState('')
  const [route, setRoute] = useState(false)
  const [promoBrief, setPromoBrief] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [starting, setStarting] = useState(false)
  const [conflict, setConflict] = useState<{ message: string; runId: string | null } | null>(null)

  // Defaults: dry run from the engine's settings; the Scout group = the least-used one in recent briefs.
  useEffect(() => {
    if (dryRun === null && settings.data) setDryRun(settings.data.runtime.dry_run)
  }, [settings.data, dryRun])
  const suggestedGroup = useMemo(() => leastUsedGroup((briefs.data ?? []).map((b) => b.topic_group)), [briefs.data])
  const effectiveGroup = group ?? suggestedGroup
  // An engine started before Phase 6 does not report its run modes: ask for a restart instead of guessing.
  const modesKnown = Array.isArray(settings.data?.built_modes)
  const built = new Set(settings.data?.built_modes ?? [])
  const isBuilt = (mode: string) => (modesKnown ? built.has(mode) : true)
  const activeRun = runs.data?.find((r) => r.status === 'running')
  const offline = !online
  const outdated = Boolean(settings.data) && !modesKnown
  const busyReason = offline ? 'Engine offline' : outdated ? 'Restart the engine first' : !settings.data ? 'Loading settings…' : activeRun ? 'A run is in progress' : null

  const draftOptions = (drafts.data ?? []).filter((d) => d.brief_id && d.version != null)
  const approvedOptions = [...new Map((approved.data ?? []).filter((d) => d.brief_id).map((d) => [d.brief_id, d])).values()]

  function ask(mode: string, label: string, costKey: CostKey, params: Record<string, unknown> = {}, details: [string, string][] = []) {
    setConflict(null)
    setPending({ mode, label, costKey, params, details })
  }

  async function start() {
    if (!pending) return
    setStarting(true)
    const body = buildRunRequest(pending.mode, { dryRun: dryRun ?? true, lowCost, group: effectiveGroup, params: pending.params })
    try {
      const { run_id } = await api<{ run_id: string }>('/api/runs', { method: 'POST', body })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      void qc.invalidateQueries({ queryKey: ['health'] })
      setPending(null)
      navigate(`/runs/${run_id}`)
    } catch (e) {
      setPending(null)
      if (isApiError(e) && e.status === 409) setConflict({ message: e.message, runId: RUN_ID.exec(e.message)?.[0] ?? activeRun?.run_id ?? null })
      else toast('error', errorMessage(e))
    } finally {
      setStarting(false)
    }
  }

  const waiting = approvals.data?.length ?? 0

  return (
    <>
      <PageHeader title="Control" subtitle="Run the pipeline or one agent. Every run asks you first and shows its expected AI calls." />
      <div className="space-y-4">
        {outdated && (
          <div role="alert" data-testid="engine-outdated" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>The running engine does not report its run modes (it was started before the dashboard was added). Restart it with <code>npm run dev:engine</code> to enable the run buttons.</div>
          </div>
        )}
        {conflict && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              A run is already in progress: {conflict.message}.{' '}
              {conflict.runId && <Link className="font-medium underline" to={`/runs/${conflict.runId}`}>Open {conflict.runId}</Link>}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Run options" className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={dryRun ?? true} onChange={(e) => setDryRun(e.target.checked)} aria-describedby="dry-note" />
                  Dry run
                </label>
                <p id="dry-note" className="mt-1 text-xs text-slate-500">Dry run still uses AI credits; it only stops saving and sending.</p>
                <p className="mt-1 text-xs text-slate-500">Engine default: {settings.data ? (settings.data.runtime.dry_run ? 'dry run' : 'live') : '…'}</p>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={lowCost} onChange={(e) => setLowCost(e.target.checked)} />
                  Low cost
                </label>
                <p className="mt-1 text-xs text-slate-500">Scout: 1 question group, 3 questions, max 6 calls, smaller docs · 1 AI retry · 1 source check · 1 Writer revision · 2 AI rounds per post.</p>
                <label className="mt-2 flex items-center gap-2 text-xs">
                  Scout question group
                  <select aria-label="Scout question group" className="input w-auto py-1" value={effectiveGroup} disabled={!lowCost} onChange={(e) => setGroup(Number(e.target.value))}>
                    {TOPIC_GROUPS.map((g) => <option key={g} value={g}>{g}{g === suggestedGroup ? ' (least used)' : ''}</option>)}
                  </select>
                </label>
              </div>
            </div>
          </Card>
          <Card title="Waiting for you">
            <p className="text-3xl font-semibold tabular-nums" data-testid="waiting-count">{waiting}</p>
            <p className="text-sm text-slate-500">{waiting === 1 ? 'draft waits' : 'drafts wait'} for your approval.</p>
            <Link to="/approvals" className="btn-secondary mt-3">Open Approvals</Link>
          </Card>
        </div>

        {activeRun && <CurrentRun run={activeRun} />}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <RunButton title="Run full pipeline" description="Scout → Strategist → Writer → checks → Reviewer, until a pass (then it waits for you) or a limit." costKey="full" lowCost={lowCost} built={isBuilt('full')} disabledReason={busyReason}
            onRun={() => ask('full', 'Full pipeline', 'full')} />
          <RunButton title="Run Scout" description="Research: M91 facts, questions people ask, stories and tutorials." costKey="scout" lowCost={lowCost} built={isBuilt('scout')} disabledReason={busyReason}
            onRun={() => ask('scout', 'Scout', 'scout')} />
          <RunButton title="Run Strategist" description="Plan one brief from the latest Scout data." costKey="strategist" lowCost={lowCost} built={isBuilt('strategist')} disabledReason={busyReason}
            onRun={() => ask('strategist', 'Strategist', 'strategist')} />
          <RunButton title="Run Writer" description="Write a draft for a brief." costKey="writer" lowCost={lowCost} built={isBuilt('writer')} disabledReason={busyReason ?? (briefId ? null : 'Pick a brief')}
            onRun={() => ask('writer', 'Writer', 'writer', { brief_id: briefId }, [['Brief', briefId]])}>
            <select aria-label="Brief for the Writer" className="input py-1.5" value={briefId} onChange={(e) => setBriefId(e.target.value)}>
              <option value="">Pick a brief…</option>
              {(briefs.data ?? []).filter((b) => b.key_id).map((b) => <option key={b.id} value={b.key_id!}>{b.key_id} · {b.status} · {(b.title ?? '').slice(0, 60)}</option>)}
            </select>
          </RunButton>
          <RunButton title="Run Reviewer" description="Review one draft (optionally with the revision loop)." costKey={route ? 'reviewer_route' : 'reviewer'} lowCost={lowCost} built={isBuilt('reviewer')} disabledReason={busyReason ?? (draftKey ? null : 'Pick a draft')}
            onRun={() => {
              const [b, v] = draftKey.split('|')
              ask('reviewer', route ? 'Reviewer + routing loop' : 'Reviewer', route ? 'reviewer_route' : 'reviewer', { brief_id: b, version: Number(v), route }, [['Draft', `${b} v${v}`], ['Routing loop', route ? 'yes' : 'no']])
            }}>
            <select aria-label="Draft for the Reviewer" className="input py-1.5" value={draftKey} onChange={(e) => setDraftKey(e.target.value)}>
              <option value="">Pick a draft…</option>
              {draftOptions.map((d) => <option key={d.id} value={`${d.brief_id}|${d.version}`}>{d.brief_id} v{d.version} · {d.status} · {(d.title ?? '').slice(0, 50)}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={route} onChange={(e) => setRoute(e.target.checked)} /> Also run the routing loop</label>
          </RunButton>
          <RunButton title="Create promo pack" description="LinkedIn post, X thread, newsletter blurb, video script for an approved draft." costKey="promo" lowCost={lowCost} built={isBuilt('promo')} disabledReason={busyReason ?? (promoBrief ? null : 'Pick an approved draft')}
            onRun={() => ask('promo', 'Promo pack', 'promo', { brief_id: promoBrief }, [['Approved draft of', promoBrief]])}>
            <select aria-label="Approved draft for the promo pack" className="input py-1.5" value={promoBrief} onChange={(e) => setPromoBrief(e.target.value)}>
              <option value="">{approvedOptions.length ? 'Pick an approved draft…' : 'No approved drafts yet'}</option>
              {approvedOptions.map((d) => <option key={d.id} value={d.brief_id!}>{d.brief_id} v{d.version} · {(d.title ?? '').slice(0, 50)}</option>)}
            </select>
          </RunButton>
          <RunButton title="Designer" description="Illustrations and interactive blocks for an approved post." lowCost={lowCost} built={built.has('design')} comingIn="Phase 8" onRun={() => {}} />
          <RunButton title="Publish" description="Put an approved post on the blog." lowCost={lowCost} built={built.has('publish')} comingIn="Phase 7" onRun={() => {}} />
        </div>

        <Card title="Recent runs" actions={<Link to="/runs" className="text-sm text-sky-700 hover:underline dark:text-sky-300">All runs →</Link>}>
          {!runs.data?.length ? (
            <EmptyState>{runs.isPending && online ? 'Loading…' : 'No runs yet.'}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {runs.data.map((r) => (
                <li key={r.run_id}>
                  <Link to={`/runs/${r.run_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <StatusBadge status={r.status} />
                    <span className="font-mono text-xs">{r.run_id}</span>
                    <span>{r.mode}{r.dry_run ? ' (dry)' : ''}</span>
                    <span className="text-slate-500">{fmtDateTime(r.started_at)} · {fmtDuration(r.ms)} · {aiCalls(r)} AI calls</span>
                    <span className="w-full truncate text-slate-600 sm:w-auto sm:flex-1 dark:text-slate-300">{r.result_summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(pending)}
        title={`Start: ${pending?.label ?? ''}`}
        expectedCalls={pending ? expectedCalls(pending.costKey, lowCost) : ''}
        confirmLabel="Start the run"
        busy={starting}
        onConfirm={start}
        onCancel={() => setPending(null)}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1" data-testid="run-summary">
          <dt className="text-slate-500">Mode</dt><dd className="font-mono">{pending?.mode}</dd>
          <dt className="text-slate-500">Dry run</dt><dd>{dryRun ?? true ? 'yes: nothing is saved or sent (AI is still called)' : 'no: results are saved and Slack/M91 may be sent'}</dd>
          <dt className="text-slate-500">Low cost</dt><dd>{lowCost ? `on (Scout group ${effectiveGroup})` : 'off'}</dd>
          {pending?.details.map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd>{v}</dd></Fragment>)}
        </dl>
      </ConfirmDialog>
    </>
  )
}
