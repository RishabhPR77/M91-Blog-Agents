// /approvals/:briefId — the post page. On top, the post's journey (Topic → … → Published, whichever runs did it).
// Left, the post as readers will see it (with Compare versions); right, the AI review next to it (notes with "Show
// in post") and your decision: "Approve and publish" (one run: approval, Markdown export, publish), approve only,
// ask for a review, request changes, reject the topic. Approving stays on this page (the journey shows each step);
// the other actions open the live run.
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BookOpenText, CheckCircle2, GitCompare, MessageSquareQuote, Send, ShieldQuestion, Sparkles, Trash2, X } from 'lucide-react'
import { api, errorMessage, isApiError } from '../api/client'
import { useSettings } from '../api/queries'
import type { CheckResult } from '../components/ChecksTable'
import { AiReviewPanel } from '../components/AiReviewPanel'
import { JourneyCard } from '../components/JourneyCard'
import { journeyKeys, usePostJourney } from '../api/journey'
import { showInPost } from '../highlight'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { MarkdownPreview } from '../components/MarkdownPreview'
import { PublishCard } from '../components/PublishCard'
import { InteractiveCard, type InteractiveInfo } from '../components/InteractiveCard'
import { PreviewCard, type PreviewInfo } from '../components/PreviewCard'
import { PickCard } from '../components/PickCard'
import type { WeeklyPick } from '../api/weekly'
import { ExportCard } from '../components/ExportCard'
import { flagsOf } from '../config/flags'
import { Card, EmptyState, PageHeader } from '../components/Page'
import type { Review } from '../components/VerdictPanel'
import { StatusBadge } from '../components/StatusBadge'
import { toast } from '../components/Toasts'
import { VersionDiff } from '../components/VersionDiff'
import { COSTS } from '../config/costs'
import { fmtDateTime } from '../format'
import { findExactQuote, NO_MATCH_MESSAGE } from '../quote'

export const FEEDBACK_MIN = 5
export const FEEDBACK_MAX = 2000

type HumanFeedback = { text: string; quotes: string[]; at: string } | null
export type ApprovalDetailData = {
  brief_id: string
  draft: {
    record_id: string; version: number; brief_version: number; status: string; waiting_since: string | null; title: string
    tldr?: string[]; seo?: { title_tag?: string; meta_description?: string; slug_suggestion?: string }; post_markdown: string; word_count?: number
    reading?: { intro_grade?: number; post_grade?: number }; revision_notes?: { feedback_quote?: string; what_changed?: string }[]; model_used?: string | null
    reviewed?: boolean; hard_passed?: boolean; approved_unreviewed?: boolean | null
  }
  review: Review | null
  checks: CheckResult[]
  /** Phase 10: the interactive guide (null or missing from older engines). */
  interactive?: InteractiveInfo | null
  /** Why this post: the weekly editor's decision (null for a pinned topic or a Write now card; missing: older engine). */
  pick?: WeeklyPick | null
  /** Phase 10 D1: the page preview built for this brief (null: none yet; missing: older engine). */
  preview?: PreviewInfo | null
  /** Counter prompts used for this brief (writing and design); older engines: counted from earlier versions. */
  revisions_used?: number
  earlier: { version: number; brief_version: number; status: string; title: string; score: number | null; total?: number | null; human_feedback: HumanFeedback; record_id?: string }[]
}

/** reviewed / hard_passed come from the engine; older engines don't send them, so they are derived. */
export function approvalFlags(d: ApprovalDetailData) {
  const reviewed = d.draft.reviewed ?? d.review?.pass === true
  const failedHard = d.checks.filter((c) => c.severity === 'hard' && !c.passed)
  const hardPassed = d.draft.hard_passed ?? (d.checks.length > 0 && failedHard.length === 0)
  return { reviewed, hardPassed, failedHard }
}

type Action = { kind: 'approve' | 'force' | 'review' | 'revise' | 'reject'; path: string; body: Record<string, unknown>; label: string }

function ActionError({ error, onClose }: { error: string; onClose: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">{error}</span>
      <button type="button" aria-label="Dismiss" onClick={onClose}><X size={14} /></button>
    </div>
  )
}

export default function ApprovalDetail() {
  const { briefId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const settings = useSettings()
  const detail = useQuery({ queryKey: ['approval', briefId], queryFn: () => api<ApprovalDetailData>(`/api/approvals/${briefId}`), retry: false })
  const preview = useRef<HTMLDivElement>(null)

  const [approveOpen, setApproveOpen] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [confirm, setConfirm] = useState<{ action: Action; calls: string; title: string; danger?: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [quotes, setQuotes] = useState<string[]>([])
  const [quoteMsg, setQuoteMsg] = useState<string | null>(null)
  const [rereview, setRereview] = useState<boolean | null>(null)
  const [target, setTarget] = useState<'writing' | 'design'>('writing')
  const [reason, setReason] = useState('')
  const [compare, setCompare] = useState<{ a: number; b: number } | null>(null)
  const [compareOn, setCompareOn] = useState(false)
  // true: "Approve and publish"; false: approve only.
  const [approvePublish, setApprovePublish] = useState(true)
  const journey = usePostJourney(briefId)

  const d = detail.data
  const rereviewDefault = settings.data?.approval?.rereview_after_human ?? true
  const rereviewOn = rereview ?? rereviewDefault
  const maxRevisions = settings.data?.approval?.max_human_revisions ?? null
  const versions = useMemo(() => {
    if (!d) return []
    return [{ version: d.draft.version, status: d.draft.status, title: d.draft.title, total: d.review?.total ?? null, human_feedback: null as HumanFeedback, record_id: d.draft.record_id, current: true },
      ...d.earlier.map((e) => ({ version: e.version, status: e.status, title: e.title, total: e.total ?? e.score, human_feedback: e.human_feedback, record_id: e.record_id, current: false }))]
  }, [d])

  if (detail.isPending) return <p className="text-sm text-slate-500">Loading…</p>
  if (!d) {
    const notFound = isApiError(detail.error) && detail.error.status === 404
    if (notFound && journey.data) {
      return (
        <>
          <PageHeader title={journey.data.title || 'A post in the making'} subtitle={<span className="font-mono text-xs">{briefId}</span>} />
          <JourneyCard journey={journey.data} />
          <EmptyState>No draft yet: the post appears here as soon as the Writer has written it.</EmptyState>
        </>
      )
    }
    return (
      <>
        <PageHeader title={notFound ? 'No draft for this brief' : 'Could not load the approval'} />
        <EmptyState>{notFound ? `Brief ${briefId} has no draft.` : errorMessage(detail.error)} <Link to="/approvals" className="underline">Back to Approvals</Link></EmptyState>
      </>
    )
  }

  const { reviewed, hardPassed, failedHard } = approvalFlags(d)
  const waiting = d.draft.status === 'awaiting_human'
  // Phase 10: approving makes no AI call (the guide is built before the review), unless the promo pack is on.
  const promoOn = settings.data?.designer?.promo_enabled === true
  const approveCost = promoOn ? COSTS.approve_promo : COSTS.approve
  const approveCalls = approveCost.normal
  // Phase 11: EXPERIENCE_ENABLED=false hides the guide and "Change the design"; PUBLISH_TARGET decides the
  // page preview and the Publish card (only with the blog).
  const flags = flagsOf(settings.data)
  // C5: a counter prompt changes the writing (Writer, then the Experience Designer) or only the design.
  const hasGuide = flags.experienceOn && d.interactive?.guide_doc?.status === 'ok'
  const design = target === 'design' && hasGuide
  const reviseCost = design ? (rereviewOn ? COSTS.human_design_rereview : COSTS.human_design_no_rereview)
    : flags.experienceOn ? (rereviewOn ? COSTS.human_revise_rereview : COSTS.human_revise_no_rereview)
    : (rereviewOn ? COSTS.human_revise_rereview_plain : COSTS.human_revise_no_rereview_plain)
  const needsReview = !reviewed && rereviewDefault
  const usedRevisions = d.revisions_used ?? d.earlier.filter((e) => e.human_feedback).length
  const revisionsLeft = maxRevisions == null ? null : maxRevisions - usedRevisions
  const fbLen = feedback.trim().length
  const fbValid = fbLen >= FEEDBACK_MIN && feedback.length <= FEEDBACK_MAX
  // "Approve and publish" while there is somewhere to publish (Docstar or the blog); with PUBLISH_TARGET=none the
  // Markdown export is the output and the button is "Approve".
  const publishOn = flags.target !== 'none'
  const openApprove = (publish: boolean) => {
    setApprovePublish(publish)
    setUnderstood(false)
    setApproveOpen(true)
  }

  async function run(action: Action) {
    setBusy(true)
    setError(null)
    try {
      const { run_id } = await api<{ run_id: string }>(action.path, { method: 'POST', body: action.body })
      void qc.invalidateQueries({ queryKey: ['approvals'] })
      void qc.invalidateQueries({ queryKey: ['approval', briefId] })
      void qc.invalidateQueries({ queryKey: journeyKeys.one(briefId) })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      setConfirm(null)
      setApproveOpen(false)
      toast('success', `${action.label} started`)
      // Approving is quick and has no AI: it stays here, and the journey turns green step by step.
      if (action.kind === 'approve' || action.kind === 'force') window.scrollTo?.({ top: 0, behavior: 'smooth' })
      else navigate(`/runs/${run_id}`)
    } catch (e) {
      setConfirm(null)
      setApproveOpen(false)
      setError(isApiError(e) ? `${e.message}${e.status === 409 ? ' (refresh to see the current state)' : ''}` : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const base = `/api/approvals/${briefId}`
  const publishBody = approvePublish && publishOn ? { publish: true } : {}
  const approveAction: Action = { kind: 'approve', path: `${base}/approve`, body: publishBody, label: approvePublish && publishOn ? 'Approve and publish' : 'Approval' }
  const forceAction: Action = { kind: 'force', path: `${base}/approve`, body: { force_unreviewed: true, ...publishBody }, label: 'Approval without review' }
  const reviewAction: Action = { kind: 'review', path: `${base}/review`, body: {}, label: 'Review' }

  function quoteSelection() {
    setQuoteMsg(null)
    const sel = window.getSelection()
    const text = sel?.toString() ?? ''
    const inside = sel && sel.rangeCount > 0 && preview.current?.contains(sel.getRangeAt(0).commonAncestorContainer)
    if (!text.trim() || !inside) {
      setQuoteMsg('Select a sentence in the draft preview first.')
      return
    }
    const exact = findExactQuote(d!.draft.post_markdown, text)
    if (!exact) {
      setQuoteMsg(NO_MATCH_MESSAGE)
      return
    }
    setQuotes((q) => (q.includes(exact) ? q : [...q, exact]))
    sel?.removeAllRanges()
  }

  const review = d.review
  const compareA = compare ? versions.find((v) => v.version === compare.a) : null
  const compareB = compare ? versions.find((v) => v.version === compare.b) : null
  const words = d.draft.word_count ?? null
  const showInArticle = (quote: string) => {
    setCompareOn(false)
    const ok = showInPost(preview.current, quote)
    if (!ok) toast('info', 'That sentence is not in this version any more.')
    return ok
  }

  return (
    <>
      <PageHeader
        title={d.draft.title || '(untitled draft)'}
        subtitle={<>v{d.draft.version}{d.draft.waiting_since && waiting ? ` · waiting for you since ${fmtDateTime(d.draft.waiting_since)}` : ''} · <span className="font-mono text-xs">{d.brief_id}</span></>}
        actions={<><StatusBadge status={d.draft.status} label={waiting ? 'waiting for you' : undefined} />{!reviewed && <span className="pill pill-amber" data-testid="not-reviewed">Not reviewed</span>}</>}
      />
      <JourneyCard journey={journey.data} />
      {d.pick && (
        <Card className="mb-4" title="Why this post">
          <PickCard pick={d.pick} canPin={waiting} />
        </Card>
      )}
      {!waiting && <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">This version is <strong>{d.draft.status.replace(/_/g, ' ')}</strong>. The decision buttons are only for a draft that waits for you.{d.draft.approved_unreviewed ? ' It was approved without a Reviewer pass.' : ''}</div>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          <Card className="overflow-hidden p-0!">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-5 py-3 text-sm dark:border-slate-800">
              <span className="flex items-center gap-1.5 font-medium"><BookOpenText size={16} /> {compareOn ? 'Compare versions' : 'The post, as readers will see it'}</span>
              <span className="text-slate-500 dark:text-slate-400" data-testid="reading">{words?.toLocaleString('en-US') ?? '—'} words · {words ? `${Math.max(1, Math.round(words / 230))} min read · ` : ''}reading grade {d.draft.reading?.post_grade ?? '—'} (intro {d.draft.reading?.intro_grade ?? '—'})</span>
              {versions.length > 1 && (
                <button type="button" className="btn-secondary ml-auto py-1 text-xs" aria-pressed={compareOn} onClick={() => setCompareOn((o) => !o)}>
                  <GitCompare size={14} /> {compareOn ? 'Back to the post' : 'Compare versions'}
                </button>
              )}
            </div>
            <div className="px-5 py-6 sm:px-8 sm:py-8">
              {compareOn ? (
                <>
                  <CompareControls versions={versions.map((v) => v.version)} onCompare={(a, b) => setCompare({ a, b })} />
                  {compareA && compareB && <ComparePanel a={compareA} b={compareB} currentMarkdown={d.draft.post_markdown} currentVersion={d.draft.version} />}
                </>
              ) : (
                <>
                  {d.draft.tldr?.length ? (
                    <div className="mx-auto mb-8 max-w-[70ch] rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-[15px] dark:border-slate-700 dark:bg-slate-800/60">
                      <div className="mb-1 text-xs font-semibold tracking-wide text-indigo-700 uppercase dark:text-slate-300">TL;DR</div>
                      <ul className="list-disc space-y-1 pl-5">{d.draft.tldr.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </div>
                  ) : null}
                  <MarkdownPreview ref={preview} variant="article" markdown={d.draft.post_markdown ?? ''} />
                </>
              )}
            </div>
            <details className="border-t border-slate-200 px-5 py-3 text-sm dark:border-slate-800">
              <summary className="cursor-pointer text-slate-600 dark:text-slate-300">Search result preview (SEO title, description, slug)</summary>
              <div className="mt-3 max-w-xl rounded-lg border border-slate-200 p-3 dark:border-slate-800" data-testid="seo">
                <div className="truncate text-[17px] text-indigo-800 dark:text-sky-300">{d.draft.seo?.title_tag ?? '—'}</div>
                <div className="truncate font-mono text-xs text-emerald-700 dark:text-emerald-400">msg91.com/guide/{d.draft.seo?.slug_suggestion ?? '—'}</div>
                <p className="mt-1 text-slate-600 dark:text-slate-400">{d.draft.seo?.meta_description ?? '—'}</p>
              </div>
            </details>
          </Card>
          {d.draft.revision_notes?.length ? (
            <Card title="What the Writer changed in this version">
              <ul className="space-y-2 text-sm">
                {d.draft.revision_notes.map((n, i) => (
                  <li key={i}>{n.feedback_quote && <div className="text-slate-500 italic">“{n.feedback_quote}”</div>}<div>{n.what_changed}</div></li>
                ))}
              </ul>
            </Card>
          ) : null}
          {flags.blogOn && <PreviewCard briefId={d.brief_id} version={d.draft.version} preview={d.preview} />}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:pr-1" aria-label="Review and decision">
          <Card title="Your decision">
            <div className="space-y-2">
              {error && <ActionError error={error} onClose={() => setError(null)} />}
              <button type="button" className="btn-primary w-full py-2.5" disabled={!waiting || !hardPassed} onClick={() => openApprove(publishOn)}>
                {publishOn ? <Send size={16} /> : <CheckCircle2 size={16} />} {publishOn ? 'Approve and publish' : 'Approve'}
              </button>
              {publishOn && (
                <button type="button" className="btn-secondary w-full py-1.5 text-xs" disabled={!waiting || !hardPassed} onClick={() => openApprove(false)}>
                  Approve only (publish later)
                </button>
              )}
              <p className="text-xs text-slate-500" data-testid="approve-explain">{publishOn ? `One run: approve, save the Markdown export, then ${flags.target === 'docstar' ? 'send it to Docstar' : 'publish it to the blog'}. No AI calls.` : 'Approving saves the final Markdown export (the output while publishing is off). No AI calls.'}</p>
              {!hardPassed && (
                <p className="text-xs text-red-600 dark:text-red-400" data-testid="approve-blocked">
                  Approve is off: the hard content checks did not pass{failedHard.length ? ` (${failedHard.map((c) => c.id).join(', ')})` : ' (no check results)'}. Send a counter prompt or reject the topic.
                </p>
              )}
              {!reviewed && waiting && (
                <button type="button" className="btn-secondary w-full" onClick={() => setConfirm({ action: reviewAction, calls: COSTS.approval_review.normal, title: 'Ask the Reviewer to check this version?', text: 'One Reviewer call (no revision loop). The draft keeps waiting for you, pass or fail.' })}>
                  <ShieldQuestion size={16} /> Review this version
                </button>
              )}
            </div>
          </Card>

          <Card title={<span className="flex items-center gap-1.5"><Sparkles size={15} /> AI review</span>} actions={!reviewed ? <span className="pill pill-amber">Not reviewed</span> : undefined}>
            <AiReviewPanel review={review} checks={d.checks} onShow={showInArticle} notReviewedText={`This version has no review.${waiting ? ' Use “Review this version” to ask the Reviewer.' : ''}`} />
          </Card>

          <Card title="Request changes">
            <p className="mb-2 text-xs text-slate-500">Tell the Writer what to change.{revisionsLeft != null ? ` ${Math.max(0, revisionsLeft)} of ${maxRevisions} left for this post.` : ''}</p>
            <fieldset className="mb-2 space-y-1 text-sm" disabled={!waiting}>
              <legend className="sr-only">What to change</legend>
              <label className="flex items-start gap-2"><input type="radio" name="revise-target" className="mt-1" checked={!design} onChange={() => setTarget('writing')} /> <span><strong>Change the writing</strong> <span className="block text-xs text-slate-500">{flags.experienceOn ? 'The Writer revises the post, then the Experience Designer builds its guide again.' : 'The Writer revises the post.'}</span></span></label>
              {flags.experienceOn && <label className="flex items-start gap-2"><input type="radio" name="revise-target" className="mt-1" checked={design} disabled={!hasGuide} onChange={() => setTarget('design')} /> <span><strong>Change the design</strong> <span className="block text-xs text-slate-500">{hasGuide ? 'Only the Experience Designer runs again (cheaper). The post’s text stays as it is.' : 'This version has no guide to change.'}</span></span></label>}
            </fieldset>
            <label className="label" htmlFor="feedback">Your feedback</label>
            <textarea id="feedback" className="input min-h-28" maxLength={FEEDBACK_MAX + 200} value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={!waiting} placeholder="e.g. Make the first paragraph shorter and explain 'webhook' in plain words." />
            <div className={`mt-0.5 text-right text-xs ${fbValid || fbLen === 0 ? 'text-slate-500' : 'text-red-600 dark:text-red-400'}`} data-testid="feedback-counter">
              {feedback.length.toLocaleString('en-US')} / {FEEDBACK_MAX.toLocaleString('en-US')}{fbLen > 0 && fbLen < FEEDBACK_MIN ? ` · at least ${FEEDBACK_MIN} characters` : ''}{feedback.length > FEEDBACK_MAX ? ' · too long' : ''}
            </div>
            <button type="button" className="btn-secondary mt-1 py-1.5 text-xs" onClick={quoteSelection} disabled={!waiting} onMouseDown={(e) => e.preventDefault()}>
              <MessageSquareQuote size={14} /> Quote selected text
            </button>
            {quoteMsg && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300" role="status">{quoteMsg}</p>}
            {quotes.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Quotes">
                {quotes.map((q) => (
                  <li key={q} className="flex max-w-full items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-2.5 text-xs dark:bg-slate-800">
                    <span className="truncate" title={q}>“{q}”</span>
                    <button type="button" aria-label={`Remove quote ${q.slice(0, 30)}`} onClick={() => setQuotes((all) => all.filter((x) => x !== q))}><X size={12} /></button>
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rereviewOn} onChange={(e) => setRereview(e.target.checked)} disabled={!waiting} /> Re-review after the change
            </label>
            <p className="text-xs text-slate-500" data-testid="revise-cost">Expected AI calls: {reviseCost.normal} ({reviseCost.note})</p>
            <button type="button" className="btn-secondary mt-2 w-full" disabled={!waiting || !fbValid || revisionsLeft === 0}
              onClick={() => setConfirm({
                action: { kind: 'revise', path: `${base}/revise`, body: { feedback, ...(quotes.length && { quotes }), target: design ? 'design' : 'writing', params: { rereview_after_human: rereviewOn } }, label: design ? 'Design change' : 'Counter prompt' },
                calls: reviseCost.normal,
                title: design ? 'Change the design?' : 'Send this counter prompt?',
                text: `${design ? `The Experience Designer builds the guide of v${d.draft.version} again` : `The Writer revises v${d.draft.version}, then the Experience Designer builds its guide`} with your feedback${quotes.length ? ` and ${quotes.length} quote${quotes.length === 1 ? '' : 's'}` : ''}${rereviewOn ? ', then the Reviewer checks it' : '; the Reviewer is skipped'}.`
              })}>
              Send counter prompt
            </button>
            {revisionsLeft === 0 && <p className="mt-1 text-xs text-red-600 dark:text-red-400">No counter prompts left (MAX_HUMAN_REVISIONS): approve or reject the topic.</p>}
          </Card>

          <Card title="Reject the topic">
            <label className="label" htmlFor="reason">Reason (optional, saved as a lesson)</label>
            <textarea id="reason" className="input min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!waiting} maxLength={FEEDBACK_MAX} />
            <button type="button" className="btn-danger mt-2 w-full" disabled={!waiting}
              onClick={() => setConfirm({ action: { kind: 'reject', path: `${base}/reject`, body: reason.trim() ? { reason: reason.trim() } : {}, label: 'Reject' }, calls: COSTS.reject_topic.normal, title: 'Reject this topic?', danger: true, text: 'The brief and this draft become rejected, and the topic is never picked again.' })}>
              <Trash2 size={16} /> Reject topic
            </button>
          </Card>
        </aside>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">More about this post</h2>
      <div className="grid items-start gap-4 md:grid-cols-2">
        <ExportCard briefId={d.brief_id} version={d.draft.version} status={d.draft.status} />
        {flags.blogOn && <PublishCard briefId={d.brief_id} status={d.draft.status} version={d.draft.version} title={d.draft.title} />}
        {flags.experienceOn && <InteractiveCard briefId={d.brief_id} status={d.draft.status} version={d.draft.version} info={d.interactive} />}
      </div>

      <Card title="Versions" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500"><tr className="border-b border-slate-200 dark:border-slate-800"><th className="px-2 py-1.5 font-medium">Version</th><th className="px-2 py-1.5 font-medium">Status</th><th className="px-2 py-1.5 font-medium">Score</th><th className="px-2 py-1.5 font-medium">Title</th><th className="px-2 py-1.5 font-medium">Your counter prompt</th></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version} className="border-b border-slate-100 align-top dark:border-slate-800/60">
                  <td className="px-2 py-1.5">v{v.version}{v.current ? ' (this one)' : ''}</td>
                  <td className="px-2 py-1.5"><StatusBadge status={v.status} /></td>
                  <td className="px-2 py-1.5 tabular-nums">{v.total ?? '—'}</td>
                  <td className="px-2 py-1.5">{v.title}</td>
                  <td className="px-2 py-1.5 text-slate-600 dark:text-slate-400">{v.human_feedback?.text ?? ''}{v.human_feedback?.quotes?.length ? ` (${v.human_feedback.quotes.length} quote${v.human_feedback.quotes.length === 1 ? '' : 's'})` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Approve: the Reviewer-pass rule (REREVIEW_AFTER_HUMAN) — review first, or approve without review with a tick. */}
      {approveOpen && (needsReview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !busy && setApproveOpen(false)} />
          <div role="dialog" aria-modal="true" aria-labelledby="approve-title" className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h2 id="approve-title" className="text-base font-semibold">This version was not checked by the Reviewer</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Review it first (recommended), or approve it without a review.</p>
            <button type="button" className="btn-primary mt-4 w-full" disabled={busy} onClick={() => void run(reviewAction)}>Review it first · expected AI calls {COSTS.approval_review.normal}</button>
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand this version was not checked by the Reviewer</label>
              <button type="button" className="btn-danger mt-2 w-full" disabled={busy || !understood} onClick={() => void run(forceAction)}>{approvePublish ? 'Approve and publish' : 'Approve'} without review · expected AI calls {approveCalls}</button>
            </div>
            <div className="mt-4 flex justify-end"><button type="button" className="btn-secondary" disabled={busy} onClick={() => setApproveOpen(false)}>Cancel</button></div>
          </div>
        </div>
      ) : (
        <ConfirmDialog open title={`${approvePublish ? 'Approve and publish' : 'Approve'} v${d.draft.version}?`} expectedCalls={approveCalls} expectedMem0={approveCost.mem0} confirmLabel={approvePublish ? 'Approve and publish' : 'Approve'} busy={busy} onConfirm={() => run(approveAction)} onCancel={() => setApproveOpen(false)}>
          <p>{promoOn ? 'The promo pack is created, then the' : 'No AI call. One run:'} approval, the Markdown export{approvePublish ? `, then ${flags.target === 'docstar' ? 'the post goes to Docstar' : 'the post is published to the blog'}` : publishOn ? ' (publish it later with Publish)' : ''}. You see each step on this page.{!reviewed ? ' This version has no Reviewer pass (re-review is off).' : ''}</p>
        </ConfirmDialog>
      ))}

      <ConfirmDialog open={Boolean(confirm)} title={confirm?.title ?? ''} expectedCalls={confirm?.calls ?? ''} expectedMem0={confirm ? { review: COSTS.approval_review.mem0, revise: reviseCost.mem0, reject: COSTS.reject_topic.mem0, approve: COSTS.approve.mem0, force: COSTS.approve.mem0 }[confirm.action.kind] : undefined} confirmLabel={confirm?.action.kind === 'reject' ? 'Reject the topic' : 'Start'} danger={confirm?.danger} busy={busy} onConfirm={() => (confirm ? run(confirm.action) : undefined)} onCancel={() => setConfirm(null)}>
        <p>{confirm?.text}</p>
      </ConfirmDialog>
    </>
  )
}

function CompareControls({ versions, onCompare }: { versions: number[]; onCompare: (a: number, b: number) => void }) {
  const [a, setA] = useState(versions[1])
  const [b, setB] = useState(versions[0])
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      Compare
      <select aria-label="Compare from" className="input w-auto py-1" value={a} onChange={(e) => setA(Number(e.target.value))}>{versions.map((v) => <option key={v} value={v}>v{v}</option>)}</select>
      with
      <select aria-label="Compare with" className="input w-auto py-1" value={b} onChange={(e) => setB(Number(e.target.value))}>{versions.map((v) => <option key={v} value={v}>v{v}</option>)}</select>
      <button type="button" className="btn-secondary py-1.5" disabled={a === b} onClick={() => onCompare(a, b)}>Compare</button>
    </div>
  )
}

type VersionRow = { version: number; record_id?: string }

/** The Markdown of one version: the current draft is in the detail; earlier ones are loaded by record id. */
function useVersionMarkdown(v: VersionRow, currentVersion: number, currentMarkdown: string) {
  const isCurrent = v.version === currentVersion
  const q = useQuery({
    queryKey: ['record', v.record_id],
    queryFn: async () => (await api<{ record: { payload?: { post_markdown?: string } } }>(`/api/records/${v.record_id}`)).record.payload?.post_markdown ?? '',
    enabled: !isCurrent && Boolean(v.record_id),
    staleTime: Infinity
  })
  if (isCurrent) return { markdown: currentMarkdown, loading: false, missing: false }
  return { markdown: q.data ?? '', loading: q.isPending && Boolean(v.record_id), missing: !v.record_id }
}

function ComparePanel({ a, b, currentMarkdown, currentVersion }: { a: VersionRow; b: VersionRow; currentMarkdown: string; currentVersion: number }) {
  const ma = useVersionMarkdown(a, currentVersion, currentMarkdown)
  const mb = useVersionMarkdown(b, currentVersion, currentMarkdown)
  if (ma.missing || mb.missing) return <p className="mt-3 text-sm text-slate-500">This engine does not send record ids for earlier versions: restart it to compare.</p>
  if (ma.loading || mb.loading) return <p className="mt-3 text-sm text-slate-500">Loading versions…</p>
  return <div className="mt-3"><VersionDiff before={ma.markdown} after={mb.markdown} beforeLabel={`v${a.version}`} afterLabel={`v${b.version}`} /></div>
}
