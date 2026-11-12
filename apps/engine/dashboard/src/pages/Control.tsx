// / — Control. On top, one big card: "Write the next post" (what comes next and why, each step's AI model, the
// cost). Then what waits for you, the current run in plain words (with Stop) and the run options. The single
// agents and the other actions are under "Run one agent"; at the bottom, the latest posts with their journeys.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Check, ChevronDown, Square } from 'lucide-react'
import { api, errorMessage, isApiError } from '../api/client'
import { useApprovals, useHealth, useRuns, useSettings } from '../api/queries'
import type { RunSummary } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, LoadingRows } from '../components/Page'
import { RunButton } from '../components/RunButton'
import { DOING } from '../components/RunProgress'
import { JourneyBar, journeyLine } from '../components/JourneyBar'
import { modeLabel, usePostJourneys } from '../api/journey'
import { StatusBadge } from '../components/StatusBadge'
import { toast } from '../components/Toasts'
import { expectedCalls, expectedMem0, PRESETS, type CostKey, type Preset } from '../config/costs'
import { flagsOf } from '../config/flags'
import { FORMAT_LABEL, nextRunText, useWeekly } from '../api/weekly'
import { TimelySection } from '../components/TimelySection'
import { useTimely } from '../api/timely'
import { buildRunRequest, leastUsedGroup, TOPIC_GROUPS } from '../config/runOptions'
import { fmtAgo, fmtDateTime, fmtDuration } from '../format'
import { useNow } from '../state/useRunView'

type ModelRow = [string, { service?: string; model?: string } | undefined]

type Trimmed = { id: string; type: string; status: string | null; brief_id: string | null; topic_group: string | number | null; version: number | null; key_id: string | null; title: string | null; date: string | null }
type Pending = { mode: string; label: string; costKey: CostKey; params: Record<string, unknown>; details: [string, string][] }

const RUN_ID = /R-\d{6}-\d{4}-[A-Z0-9]{4}/
// Publisher modes use no AI: the low-cost params do not apply to them.
const NO_AI_MODES = ['publish', 'unpublish', 'set_index', 'rebuild_blog', 'export']

const useRecords = (key: string, query: string, enabled: boolean) =>
  useQuery({ queryKey: ['records', key], queryFn: async () => (await api<{ records: Trimmed[] }>(`/api/records?${query}`)).records, enabled, staleTime: 30_000 })

/** Good morning / afternoon / evening, by the local hour. */
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.'
}

function aiCalls(r: RunSummary) {
  return (r.steps ?? []).reduce((n, s) => n + (s.ai_calls ?? 0), 0)
}

const STRIP_NAME: Record<string, string> = { editor: 'Editor', scout: 'Scout', strategist: 'Strategist', writer: 'Writer', checks: 'Checks', designer: 'Designer', reviewer: 'Reviewer', promo: 'Promo', export: 'Export', publisher: 'Send' }
// The steps a full run still has ahead of it, so the strip shows the whole way from the start.
const FULL_STEPS = ['editor', 'scout', 'strategist', 'writer', 'checks', 'reviewer']

/** The run as a row of nodes on a line: done ones ink, the running one pulsing lime, the rest still to come. */
function RunStrip({ run }: { run: RunSummary }) {
  const seen = new Map<string, string>()
  for (const st of run.steps ?? []) if (!st.name.includes('.')) seen.set(st.name, st.status)
  const names = [...new Set([...(run.mode === 'full' ? FULL_STEPS : []), ...seen.keys()])].filter((n) => n !== 'promo' || seen.has(n))
  const order = run.mode === 'full' ? [...names].sort((a, b) => (FULL_STEPS.indexOf(a) + 1 || 99) - (FULL_STEPS.indexOf(b) + 1 || 99)) : names
  return (
    <ol className="flex items-start" aria-label="Run steps">
      {order.map((name, i) => {
        const status = seen.get(name) ?? 'waiting'
        const done = status === 'done' || status === 'succeeded'
        const running = status === 'running'
        const failed = status === 'failed'
        return (
          <li key={name} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
            {i > 0 && <span aria-hidden className="absolute top-[11px] right-1/2 -left-1/2 h-0.5 overflow-hidden rounded-full bg-line"><span className={`block h-full origin-left bg-ink transition-transform duration-700 ease-out ${done || running || failed ? 'scale-x-100' : 'scale-x-0'}`} /></span>}
            <span className={`relative z-10 flex size-6 items-center justify-center rounded-full border-2 transition-colors duration-300 ${done ? 'animate-pop border-transparent bg-ink text-white' : running ? 'animate-signal border-transparent bg-hl text-lime-600' : failed ? 'border-transparent bg-red-600 text-white' : 'border-line-strong bg-surface'}`}>
              {done ? <Check size={12} strokeWidth={3} /> : running ? <span className="size-2 rounded-full bg-ink" /> : failed ? <span className="text-[10px] font-bold">!</span> : null}
            </span>
            <span className={`mt-2 truncate px-1 text-[11px] ${running ? 'font-semibold text-ink' : done ? 'text-ink-2' : 'text-ink-3'}`}>{STRIP_NAME[name] ?? name}</span>
          </li>
        )
      })}
    </ol>
  )
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
    <div>
      <div className="mb-5 flex items-center justify-between gap-3"><p className="eyebrow">Current run</p><Link to={`/runs/${run.run_id}`} className="text-sm link-quiet">Watch live →</Link></div>
      <RunStrip run={run} />
      <p className="mt-6 flex items-center gap-2.5 font-serif text-[22px] font-semibold tracking-[-0.01em]" data-testid="current-doing">
        <span className="relative flex size-2.5"><span className="absolute inset-0 animate-ping rounded-full bg-lime-400 opacity-70" /><span className="relative size-2.5 rounded-full bg-lime-500" /></span>
        <span key={current} className="animate-enter">{DOING[current] ?? (current === '—' ? 'Starting…' : `${current}…`)}</span>
      </p>
      <p className="mt-1.5 text-xs text-ink-3">
        {modeLabel(run.mode)}{run.dry_run ? ' (dry run)' : ''} · <span data-testid="current-elapsed">{fmtDuration(run.started_at ? now - Date.parse(run.started_at) : null)}</span> · <span data-testid="current-calls">{current} · {aiCalls(run)}</span> AI calls so far
      </p>
      <button type="button" className="btn-secondary mt-4 py-1.5 text-red-700 dark:text-red-300" onClick={() => setConfirm(true)}><Square size={14} /> Stop</button>
      <ConfirmDialog open={confirm} title={`Stop run ${run.run_id}?`} expectedCalls="0 (calls already made are not refunded)" confirmLabel="Stop the run" danger busy={busy} onConfirm={stop} onCancel={() => setConfirm(false)}>
        <p>The current step is interrupted and recorded as cancelled.</p>
      </ConfirmDialog>
    </div>
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
  // Each agent's AI model, as the engine has it now (from the settings), shown on its card.
  const models = settings.data?.models as Record<string, { service?: string; model?: string } | undefined> | undefined
  // The weekly editor: what the next run writes about, and its last decision (shown on the big card).
  const weekly = useWeekly(online)
  const lastPick = weekly.data?.picks?.[0]
  // AUTO_APPROVE: a post the AI review passes is approved and published in the same run.
  const autoApprove = settings.data?.approval?.auto_approve === true
  const publishTitle = flags.blogOn ? 'Publish' : flags.target === 'slack' ? 'Send to Slack' : flags.target === 'email' ? 'Send by email' : 'Send to Docstar'
  // The timely lane: open cards (a badge) and a Write now card that waits.
  const timelyOn = settings.data?.timely?.enabled === true
  const timely = useTimely(timelyOn)
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
  const firstWaiting = approvals.data?.[0]
  const posts = usePostJourneys(5)

  const lastRun = runs.data?.[0]
  const doneCount = (posts.data ?? []).filter((p) => journeyLine(p.stages).tone === 'green').length

  return (
    <>
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div className="animate-rise">
          <p className="eyebrow mb-3">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="font-serif text-[40px] leading-[1.05] font-semibold tracking-[-0.025em] sm:text-[48px]">{greeting()}</h1>
          <p className="mt-3 max-w-2xl text-[15.5px] text-ink-2">
            {waiting > 0
              ? <><span className="marker font-medium text-ink">{waiting} post{waiting === 1 ? '' : 's'} waiting</span> for your review.{activeRun ? ' A run is writing right now.' : ' Write the next one whenever you like.'}</>
              : activeRun ? <>A run is <span className="marker font-medium text-ink">writing right now</span>. Nothing else needs you.</> : 'Nothing needs you right now. Write the next post whenever you like.'}
          </p>
        </div>
      </header>
      <div className="space-y-6">
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

        <div className="stagger grid gap-6 lg:grid-cols-3">
          <section className="tile lg:col-span-2 lg:row-span-2" aria-label="Next post">
            {activeRun && <div className="mb-8 border-b border-line pb-8"><CurrentRun run={activeRun} /></div>}
            <p className="eyebrow mb-3">{activeRun ? 'After this run' : 'Next post'}</p>
            <RunButton variant="hero" title="Write the next post" description={`The AI researches, plans, writes and reviews it. ${autoApprove ? (flags.target === 'slack' ? 'Then it is approved and sent to Slack with a link to download the .md (if no version passes, the best one goes).' : flags.target === 'email' ? 'Then it is approved and emailed to you with the .md attached (if no version passes, the best one goes).' : 'Then it is approved and published.') : 'It waits for your review.'}`}
              models={[['Editor', models?.editor], ['Scout', models?.scout], ['Strategist', models?.strategist], ['Writer', models?.writer], ...(flags.experienceOn ? [['Designer', models?.designer] as ModelRow] : []), ['Reviewer', models?.reviewer]]} costKey={flags.experienceOn ? 'full' : 'full_plain'} lowCost={lowCost} built={isBuilt('full')} disabledReason={busyReason}
              onRun={() => ask('full', 'Write the next post', flags.experienceOn ? 'full' : 'full_plain', {}, [['Topic', nextRunText(weekly.data?.next, weekly.data?.model)]])}>
              <p className="font-serif text-[26px] leading-snug font-semibold tracking-[-0.015em] sm:text-[30px]" data-testid="control-next-up"><span className="sr-only">Topic: </span>{weekly.isPending ? 'Reading this week’s signals…' : nextRunText(weekly.data?.next, weekly.data?.model)}</p>
              {lastPick && <p className="text-sm text-ink-2" data-testid="control-last-pick"><span className="font-medium">Last pick:</span> {lastPick.pick.title} <span className="text-xs text-slate-500">({FORMAT_LABEL[lastPick.pick.format] ?? lastPick.pick.format}, {lastPick.date}): {lastPick.reason}</span></p>}
              {timelyOn && (timely.data?.open ?? 0) > 0 && <p className="text-sm" data-testid="control-timely"><Link to="/week#timely" className="pill pill-amber">{timely.data!.open} news item{timely.data!.open === 1 ? '' : 's'} this week</Link>{timely.data?.waiting ? <span className="ml-2 text-xs text-slate-500">“{timely.data.waiting.title}” waits: {timely.data.waiting.reason}</span> : null}</p>}
            </RunButton>
          </section>

          <section className="tile flex flex-col" aria-label="Needs you">
            <p className="eyebrow">Needs you</p>
            <div className="mt-4 flex items-baseline gap-3">
              <p className="font-serif text-[56px] leading-none font-semibold tracking-[-0.03em] tabular-nums" data-testid="waiting-count">{waiting}</p>
              <p className="text-sm text-ink-3">{waiting === 1 ? 'post waits' : 'posts wait'} for your review</p>
            </div>
            {firstWaiting && <p className="mt-4 line-clamp-2 font-serif text-[19px] leading-snug font-semibold tracking-[-0.01em]" data-testid="first-waiting">{firstWaiting.title || firstWaiting.brief_id}</p>}
            <div className="mt-auto pt-5">
              {firstWaiting
                ? <Link to={`/approvals/${firstWaiting.brief_id}`} className="btn-primary w-full">Review it now <ArrowRight size={16} /></Link>
                : <Link to="/approvals" className="btn-secondary w-full">Open Approvals</Link>}
            </div>
          </section>

          <section className="tile" aria-label="At a glance">
            <p className="eyebrow mb-4">At a glance</p>
            <dl className="space-y-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-3">Last run</dt>
                <dd className="flex min-w-0 items-center gap-2">{lastRun ? <><StatusBadge status={lastRun.status} /><Link to={`/runs/${lastRun.run_id}`} className="link-quiet truncate">{fmtAgo(lastRun.started_at)}</Link></> : <span className="text-ink-3">none yet</span>}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-3">Recent posts</dt>
                <dd className="font-medium tabular-nums">{posts.data?.length ?? 0} <span className="font-normal text-ink-3">· {doneCount} done</span></dd>
              </div>
              {timelyOn && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink-3">News this week</dt>
                  <dd className="font-medium tabular-nums">{timely.data?.open ?? 0}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-3">Runs by default</dt>
                <dd className="font-medium">{settings.data ? (settings.data.runtime.dry_run ? 'dry run' : 'live') : '…'}</dd>
              </div>
            </dl>
          </section>
        </div>

        <section className="tile" data-testid="home-week" aria-label="This week">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
            <p className="eyebrow">This week · the editor’s decisions</p>
            <Link to="/week" className="text-sm link-quiet">Full page →</Link>
          </div>
          <p className="mb-6 max-w-2xl text-sm text-ink-2">Each run picks what is most useful now from real questions, this week’s news and what M91 can newly do. Never a repeat of a live guide.</p>
          {weekly.isPending ? <LoadingRows /> : weekly.data?.picks?.length ? (
            <ul className="stagger grid gap-4 md:grid-cols-2" aria-label="The editor's latest decisions">
              {weekly.data.picks.slice(0, 4).map((pk) => (
                <li key={pk.pick_id} className="flex flex-col rounded-2xl bg-surface-2 p-5">
                  <div className="flex items-center gap-2 text-xs text-ink-3"><span className="pill pill-blue">{FORMAT_LABEL[pk.pick.format] ?? pk.pick.format}</span><span>{pk.date}</span></div>
                  <h3 className="mt-3 font-serif text-[19px] leading-snug font-semibold tracking-[-0.01em]">{pk.pick.title}</h3>
                  <p className="mt-2 line-clamp-3 text-sm text-ink-2">{pk.reason}</p>
                  {pk.brief_id && <Link to={`/approvals/${pk.brief_id}`} className="mt-auto pt-4 text-sm link-quiet">Open the post →</Link>}
                </li>
              ))}
            </ul>
          ) : <EmptyState>No decisions yet. The next full run makes the first one.</EmptyState>}
        </section>

        {timelyOn && (timely.data?.open ?? 0) > 0 && <div className="tile [&>section]:border-t-0 [&>section]:pt-0"><TimelySection runBusy={Boolean(activeRun)} /></div>}

        <section className="tile" aria-label="Recent posts">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <p className="eyebrow">Recent posts</p>
            <Link to="/runs" className="text-sm link-quiet">All posts and runs →</Link>
          </div>
          {posts.data?.length ? (
            <ul className="stagger divide-y divide-line" data-testid="latest-posts">
              {posts.data.map((p) => {
                const line = journeyLine(p.stages)
                return (
                  <li key={p.brief_id} className="flex flex-col gap-2 py-3.5 md:flex-row md:items-center md:gap-6">
                    <Link to={`/approvals/${p.brief_id}`} className="min-w-0 flex-1 truncate font-serif text-[18px] font-semibold tracking-[-0.01em] underline-offset-[4px] hover:underline">{p.title || 'A post in the making'}</Link>
                    <div className="w-full md:w-72"><JourneyBar stages={p.stages} compact /></div>
                    <span className={`pill ${line.tone === 'green' ? 'pill-green' : line.tone === 'red' ? 'pill-red' : line.tone === 'gray' ? 'pill-gray' : line.tone === 'violet' ? 'pill-blue font-semibold' : 'pill-blue'} md:w-48 md:justify-center`}>{line.text}</span>
                  </li>
                )
              })}
            </ul>
          ) : null}
          {posts.data?.length ? null : !runs.data?.length ? (
            runs.isPending && online ? <LoadingRows rows={3} label="Loading the latest posts" /> : <EmptyState>No runs yet.</EmptyState>
          ) : (
            <ul className="stagger divide-y divide-line">
              {runs.data.map((r) => (
                <li key={r.run_id}>
                  <Link to={`/runs/${r.run_id}`} className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-ink/[0.03]">
                    <StatusBadge status={r.status} />
                    <span className="font-mono text-xs">{r.run_id}</span>
                    <span>{modeLabel(r.mode)}{r.dry_run ? ' (dry)' : ''}</span>
                    <span className="text-slate-500">{fmtDateTime(r.started_at)} · {fmtDuration(r.ms)} · {aiCalls(r)} AI calls</span>
                    <span className="w-full truncate text-slate-600 sm:w-auto sm:flex-1 dark:text-slate-300">{r.result_summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pt-4" aria-label="Run settings">
          <p className="eyebrow mb-4">Run settings and single agents</p>
          <div className="space-y-4">
            <details className="panel group" data-testid="run-options">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-5 text-sm font-semibold text-ink">
                Run options <span className="font-normal text-ink-3">· {dryRun ?? true ? 'dry run' : 'live'} · {lowCost ? PRESETS.lowcost.label : PRESETS.normal.label}</span>
                <ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-line p-5">
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
                            <span className="block text-xs text-slate-500">{PRESETS[p].text} Full run: {expectedCalls('full', p === 'lowcost')} AI calls · memory {expectedMem0('full', p === 'lowcost')}.</span>
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
              </div>
            </details>
            <details className="group" data-testid="run-one-agent">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm font-semibold text-ink">
                <ChevronDown size={16} className="-rotate-90 transition-transform group-open:rotate-0" /> Run one agent, or another action
                <span className="font-normal text-ink-3">(Scout, Strategist, Writer, Reviewer, export{flags.target !== 'none' ? ', publish' : ''})</span>
              </summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <RunButton title="Run Scout" description="Research: M91 facts, questions people ask, stories and tutorials." models={[['Scout', models?.scout]]} costKey="scout" lowCost={lowCost} built={isBuilt('scout')} disabledReason={busyReason}
                onRun={() => ask('scout', 'Scout', 'scout')} />
              <RunButton title="Run Strategist" description="Plan one brief from the latest Scout data." models={[['Strategist', models?.strategist]]} costKey="strategist" lowCost={lowCost} built={isBuilt('strategist')} disabledReason={busyReason}
                onRun={() => ask('strategist', 'Strategist', 'strategist')} />
              <RunButton title="Run Writer" description="Write a draft for a brief." models={[['Writer', models?.writer]]} costKey="writer" lowCost={lowCost} built={isBuilt('writer')} disabledReason={busyReason ?? (briefId ? null : 'Pick a brief')}
                onRun={() => ask('writer', 'Writer', 'writer', { brief_id: briefId }, [['Brief', briefId]])}>
                <select aria-label="Brief for the Writer" className="input py-1.5" value={briefId} onChange={(e) => setBriefId(e.target.value)}>
                  <option value="">Pick a brief…</option>
                  {(briefs.data ?? []).filter((b) => b.key_id).map((b) => <option key={b.id} value={b.key_id!}>{b.key_id} · {b.status} · {(b.title ?? '').slice(0, 60)}</option>)}
                </select>
              </RunButton>
              <RunButton title="Run Reviewer" description="Review one draft (optionally with the revision loop)." models={[['Reviewer', models?.reviewer]]} costKey={route ? routeCost : 'reviewer'} lowCost={lowCost} built={isBuilt('reviewer')} disabledReason={busyReason ?? (draftKey ? null : 'Pick a draft')}
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
              <RunButton title="Export Markdown" description="Save the final Markdown export of an approved post again (the memory and apps/engine/exports). Approving already does this." costKey="export_save" lowCost={lowCost} built={isBuilt('export')}
                disabledReason={busyReason ?? (exportBrief ? null : 'Pick an approved draft')}
                onRun={() => ask('export', 'Export Markdown', 'export_save', { brief_id: exportBrief, save: true }, [['Approved draft of', exportBrief]])}>
                <select aria-label="Approved draft to export" className="input py-1.5" value={exportBrief} onChange={(e) => setExportBrief(e.target.value)}>
                  <option value="">{approvedOptions.length ? 'Pick an approved draft…' : 'No approved drafts yet'}</option>
                  {approvedOptions.map((d) => <option key={d.id} value={d.brief_id!}>{d.brief_id} v{d.version} · {(d.title ?? '').slice(0, 50)}</option>)}
                </select>
              </RunButton>
              {flags.target !== 'none' && <RunButton title={publishTitle} description={flags.blogOn ? `Put an approved post on the blog: build, deploy, check it is live.${blog?.auto_publish ? ' (AUTO_PUBLISH is on: approving publishes too.)' : ''}` : flags.target === 'slack' ? 'Send an approved post to Slack again: its title, score and a link to download the .md.' : flags.target === 'email' ? 'Email an approved post again: its title, score and the .md attached (MAIL_TO).' : `Send an approved post's Markdown export to Docstar.${flags.docstarConfigured ? '' : ' Docstar is not configured yet (DOCSTAR_* keys): it answers "not configured".'}`} costKey="publish" lowCost={lowCost} built={isBuilt('publish')} comingIn="Phase 7"
                disabledReason={busyReason ?? (publishBrief ? (flags.blogOn ? tokenReason : null) : 'Pick an approved draft')}
                onRun={() => ask('publish', publishTitle, 'publish', { brief_id: publishBrief }, [['Approved draft of', publishBrief], ['Goes to', flags.blogOn ? blog?.base_url ?? '…' : flags.target === 'slack' ? 'Slack' : flags.target === 'email' ? 'Email (MAIL_TO)' : 'Docstar']])}>
                <select aria-label="Approved draft to publish" className="input py-1.5" value={publishBrief} onChange={(e) => setPublishBrief(e.target.value)}>
                  <option value="">{approvedOptions.length ? 'Pick an approved draft…' : 'No approved drafts yet'}</option>
                  {approvedOptions.map((d) => <option key={d.id} value={d.brief_id!}>{d.brief_id} v{d.version} · {(d.title ?? '').slice(0, 50)}</option>)}
                </select>
              </RunButton>}
              {flags.blogOn && <RunButton title="Rebuild blog" description="Rebuild and redeploy the blog from the published posts without changing any post (after a change to the blog's code or look)." costKey="rebuild_blog" lowCost={lowCost} built={isBuilt('rebuild_blog')} comingIn="Phase 7"
                disabledReason={busyReason ?? tokenReason}
                onRun={() => ask('rebuild_blog', 'Rebuild blog', 'rebuild_blog', {}, [['Deploys to', blog?.base_url ?? '…']])} />}
              </div>
            </details>
          </div>
        </section>
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
          <dt className="text-slate-500">Dry run</dt><dd>{dryRun ?? true ? 'yes: nothing is saved or sent (AI is still called)' : 'no: results are saved and emails, Slack and M91 may be sent'}</dd>
          <dt className="text-slate-500">Preset</dt><dd data-testid="run-preset">{pending && NO_AI_MODES.includes(pending.mode) ? 'not used (no AI)' : lowCost ? `${PRESETS.lowcost.label} (Scout group ${effectiveGroup})` : PRESETS.normal.label}</dd>
          {pending?.details.map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd>{v}</dd></Fragment>)}
        </dl>
      </ConfirmDialog>
    </>
  )
}
