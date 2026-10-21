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
import { expectedCalls, expectedMem0, PRESETS, type CostKey, type Preset } from '../config/costs'
import { flagsOf } from '../config/flags'
import { buildRunRequest, leastUsedGroup, TOPIC_GROUPS } from '../config/runOptions'
import { fmtDateTime, fmtDuration } from '../format'
import { useNow } from '../state/useRunView'

type Trimmed = { id: string; type: string; status: string | null; brief_id: string | null; topic_group: string | number | null; version: number | null; key_id: string | null; title: string | null; date: string | null }
type Pending = { mode: string; label: string; costKey: CostKey; params: Record<string, unknown>; details: [string, string][] }

const RUN_ID = /R-\d{6}-\d{4}-[A-Z0-9]{4}/
// Publisher modes use no AI: the low-cost params do not apply to them.
const NO_AI_MODES = ['publish', 'unpublish', 'set_index', 'rebuild_blog', 'export']

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
  // Phase 9 C1: two presets; a normal run is the default.
  const [preset, setPreset] = useState<Preset>('normal')
  const lowCost = preset === 'lowcost'
  const [group, setGroup] = useState<number | null>(null)
  const [briefId, setBriefId] = useState('')
  const [draftKey, setDraftKey] = useState('')
  const [route, setRoute] = useState(false)
  const [promoBrief, setPromoBrief] = useState('')
  const [designBrief, setDesignBrief] = useState('')
  const [exportBrief, setExportBrief] = useState('')
  const [publishBrief, setPublishBrief] = useState('')
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
  const blog = settings.data?.blog
  // Phase 11: the Experience Designer and the blog actions follow EXPERIENCE_ENABLED and PUBLISH_TARGET.
  const flags = flagsOf(settings.data)
  const routeCost = flags.experienceOn ? 'reviewer_route' as const : 'reviewer_route_plain' as const
  // A real deploy needs the token; a dry run builds locally and needs none.
  const tokenReason = blog && !blog.deploy_token_set && !(dryRun ?? true) ? 'Deploy token not set (dry run only)' : null
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
    const body = buildRunRequest(pending.mode, { dryRun: dryRun ?? true, lowCost: lowCost && !NO_AI_MODES.includes(pending.mode), group: effectiveGroup, params: pending.params })
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
                <fieldset>
                  <legend className="text-sm font-medium">Preset</legend>
                  {(Object.keys(PRESETS) as Preset[]).map((p) => (
                    <label key={p} className="mt-1 flex items-start gap-2 text-sm" data-testid={`preset-${p}`}>
                      <input type="radio" name="preset" className="mt-1" checked={preset === p} onChange={() => setPreset(p)} />
                      <span>
                        <span className="font-medium">{PRESETS[p].label}</span>
                        <span className="block text-xs text-slate-500">{PRESETS[p].text} Full run: {expectedCalls('full', p === 'lowcost')} AI calls · Mem0 {expectedMem0('full', p === 'lowcost')}.</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
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
          <RunButton title="Run full pipeline" description={`Scout → Strategist → Writer → checks → ${flags.experienceOn ? 'Experience Designer → ' : ''}Reviewer, until a pass (then it waits for you) or a limit.`} costKey={flags.experienceOn ? 'full' : 'full_plain'} lowCost={lowCost} built={isBuilt('full')} disabledReason={busyReason}
            onRun={() => ask('full', 'Full pipeline', flags.experienceOn ? 'full' : 'full_plain')} />
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
          <RunButton title="Run Reviewer" description="Review one draft (optionally with the revision loop)." costKey={route ? routeCost : 'reviewer'} lowCost={lowCost} built={isBuilt('reviewer')} disabledReason={busyReason ?? (draftKey ? null : 'Pick a draft')}
            onRun={() => {
              const [b, v] = draftKey.split('|')
              ask('reviewer', route ? 'Reviewer + routing loop' : 'Reviewer', route ? routeCost : 'reviewer', { brief_id: b, version: Number(v), route }, [['Draft', `${b} v${v}`], ['Routing loop', route ? 'yes' : 'no']])
            }}>
            <select aria-label="Draft for the Reviewer" className="input py-1.5" value={draftKey} onChange={(e) => setDraftKey(e.target.value)}>
              <option value="">Pick a draft…</option>
              {draftOptions.map((d) => <option key={d.id} value={`${d.brief_id}|${d.version}`}>{d.brief_id} v{d.version} · {d.status} · {(d.title ?? '').slice(0, 50)}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={route} onChange={(e) => setRoute(e.target.checked)} /> Also run the routing loop</label>
          </RunButton>
          {settings.data?.designer?.promo_enabled !== false && (
            <RunButton title="Create promo pack" description="LinkedIn post, X thread, newsletter blurb, video script for an approved draft." costKey="promo" lowCost={lowCost} built={isBuilt('promo')} disabledReason={busyReason ?? (promoBrief ? null : 'Pick an approved draft')}
              onRun={() => ask('promo', 'Promo pack', 'promo', { brief_id: promoBrief }, [['Approved draft of', promoBrief]])}>
              <select aria-label="Approved draft for the promo pack" className="input py-1.5" value={promoBrief} onChange={(e) => setPromoBrief(e.target.value)}>
                <option value="">{approvedOptions.length ? 'Pick an approved draft…' : 'No approved drafts yet'}</option>
                {approvedOptions.map((d) => <option key={d.id} value={d.brief_id!}>{d.brief_id} v{d.version} · {(d.title ?? '').slice(0, 50)}</option>)}
              </select>
            </RunButton>
          )}
          {flags.experienceOn && <RunButton title="Experience Designer" description="Build the interactive guide again for an approved post (no review). Republish to put it live." costKey="designer" lowCost={lowCost} built={isBuilt('designer')} disabledReason={busyReason ?? (designBrief ? null : 'Pick an approved draft')}
            onRun={() => ask('designer', 'Experience Designer', 'designer', { brief_id: designBrief }, [['Approved draft of', designBrief]])}>
            <select aria-label="Approved draft for the Experience Designer" className="input py-1.5" value={designBrief} onChange={(e) => setDesignBrief(e.target.value)}>
              <option value="">{approvedOptions.length ? 'Pick an approved draft…' : 'No approved drafts yet'}</option>
              {approvedOptions.map((d) => <option key={d.id} value={d.brief_id!}>{d.brief_id} v{d.version} · {(d.title ?? '').slice(0, 50)}</option>)}
            </select>
          </RunButton>}
          <RunButton title="Export Markdown" description="Save the final Markdown export of an approved post again (Mem0 and apps/engine/exports). Approving already does this." costKey="export_save" lowCost={lowCost} built={isBuilt('export')}
            disabledReason={busyReason ?? (exportBrief ? null : 'Pick an approved draft')}
            onRun={() => ask('export', 'Export Markdown', 'export_save', { brief_id: exportBrief, save: true }, [['Approved draft of', exportBrief]])}>
            <select aria-label="Approved draft to export" className="input py-1.5" value={exportBrief} onChange={(e) => setExportBrief(e.target.value)}>
              <option value="">{approvedOptions.length ? 'Pick an approved draft…' : 'No approved drafts yet'}</option>
              {approvedOptions.map((d) => <option key={d.id} value={d.brief_id!}>{d.brief_id} v{d.version} · {(d.title ?? '').slice(0, 50)}</option>)}
            </select>
          </RunButton>
          {flags.target !== 'none' && <RunButton title={flags.blogOn ? 'Publish' : 'Send to Docstar'} description={flags.blogOn ? `Put an approved post on the blog: build, deploy, check it is live.${blog?.auto_publish ? ' (AUTO_PUBLISH is on: approving publishes too.)' : ''}` : `Send an approved post's Markdown export to Docstar.${flags.docstarConfigured ? '' : ' Docstar is not configured yet (DOCSTAR_* keys): it answers "not configured".'}`} costKey="publish" lowCost={lowCost} built={isBuilt('publish')} comingIn="Phase 7"
            disabledReason={busyReason ?? (publishBrief ? (flags.blogOn ? tokenReason : null) : 'Pick an approved draft')}
            onRun={() => ask('publish', flags.blogOn ? 'Publish' : 'Send to Docstar', 'publish', { brief_id: publishBrief }, [['Approved draft of', publishBrief], ['Goes to', flags.blogOn ? blog?.base_url ?? '…' : 'Docstar']])}>
            <select aria-label="Approved draft to publish" className="input py-1.5" value={publishBrief} onChange={(e) => setPublishBrief(e.target.value)}>
              <option value="">{approvedOptions.length ? 'Pick an approved draft…' : 'No approved drafts yet'}</option>
              {approvedOptions.map((d) => <option key={d.id} value={d.brief_id!}>{d.brief_id} v{d.version} · {(d.title ?? '').slice(0, 50)}</option>)}
            </select>
          </RunButton>}
          {flags.blogOn && <RunButton title="Rebuild blog" description="Rebuild and redeploy the blog from the published posts without changing any post (after a change to the blog's code or look)." costKey="rebuild_blog" lowCost={lowCost} built={isBuilt('rebuild_blog')} comingIn="Phase 7"
            disabledReason={busyReason ?? tokenReason}
            onRun={() => ask('rebuild_blog', 'Rebuild blog', 'rebuild_blog', {}, [['Deploys to', blog?.base_url ?? '…']])} />}
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
        expectedMem0={pending ? expectedMem0(pending.costKey, lowCost && !NO_AI_MODES.includes(pending.mode)) : undefined}
        confirmLabel="Start the run"
        busy={starting}
        onConfirm={start}
        onCancel={() => setPending(null)}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1" data-testid="run-summary">
          <dt className="text-slate-500">Mode</dt><dd className="font-mono">{pending?.mode}</dd>
          <dt className="text-slate-500">Dry run</dt><dd>{dryRun ?? true ? 'yes: nothing is saved or sent (AI is still called)' : 'no: results are saved and Slack/M91 may be sent'}</dd>
          <dt className="text-slate-500">Preset</dt><dd data-testid="run-preset">{pending && NO_AI_MODES.includes(pending.mode) ? 'not used (no AI)' : lowCost ? `${PRESETS.lowcost.label} (Scout group ${effectiveGroup})` : PRESETS.normal.label}</dd>
          {pending?.details.map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd>{v}</dd></Fragment>)}
        </dl>
      </ConfirmDialog>
    </>
  )
}
