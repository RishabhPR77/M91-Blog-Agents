// /approvals/:briefId — the draft (rendered), the verdict panel, the version history with Compare, and the
// human's actions: approve (with the Reviewer-pass rule), ask for a review, request changes, reject the topic.
// Every action starts a run after a confirm dialog that shows its expected AI calls, then opens the live run.
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, MessageSquareQuote, ShieldQuestion, Trash2, X } from 'lucide-react'
import { api, errorMessage, isApiError } from '../api/client'
import { useSettings } from '../api/queries'
import { ChecksTable, type CheckResult } from '../components/ChecksTable'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { MarkdownPreview } from '../components/MarkdownPreview'
import { PublishCard } from '../components/PublishCard'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { VerdictPanel, type Review } from '../components/VerdictPanel'
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
  const [reason, setReason] = useState('')
  const [compare, setCompare] = useState<{ a: number; b: number } | null>(null)

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
    return (
      <>
        <PageHeader title={notFound ? 'No draft for this brief' : 'Could not load the approval'} />
        <EmptyState>{notFound ? `Brief ${briefId} has no draft.` : errorMessage(detail.error)} <Link to="/approvals" className="underline">Back to Approvals</Link></EmptyState>
      </>
    )
  }

  const { reviewed, hardPassed, failedHard } = approvalFlags(d)
  const waiting = d.draft.status === 'awaiting_human'
  const needsReview = !reviewed && rereviewDefault
  const usedRevisions = d.earlier.filter((e) => e.human_feedback).length
  const revisionsLeft = maxRevisions == null ? null : maxRevisions - usedRevisions
  const fbLen = feedback.trim().length
  const fbValid = fbLen >= FEEDBACK_MIN && feedback.length <= FEEDBACK_MAX

  async function run(action: Action) {
    setBusy(true)
    setError(null)
    try {
      const { run_id } = await api<{ run_id: string }>(action.path, { method: 'POST', body: action.body })
      void qc.invalidateQueries({ queryKey: ['approvals'] })
      void qc.invalidateQueries({ queryKey: ['approval', briefId] })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      setConfirm(null)
      setApproveOpen(false)
      toast('success', `${action.label} started`)
      navigate(`/runs/${run_id}`)
    } catch (e) {
      setConfirm(null)
      setApproveOpen(false)
      setError(isApiError(e) ? `${e.message}${e.status === 409 ? ' (refresh to see the current state)' : ''}` : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const base = `/api/approvals/${briefId}`
  const approveAction: Action = { kind: 'approve', path: `${base}/approve`, body: {}, label: 'Approval' }
  const forceAction: Action = { kind: 'force', path: `${base}/approve`, body: { force_unreviewed: true }, label: 'Approval without review' }
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

  return (
    <>
      <PageHeader
        title={d.draft.title || '(untitled draft)'}
        subtitle={<>brief <span className="font-mono">{d.brief_id}</span> · v{d.draft.version} (brief v{d.draft.brief_version}){d.draft.waiting_since ? ` · waiting since ${fmtDateTime(d.draft.waiting_since)}` : ''}</>}
        actions={<><StatusBadge status={d.draft.status} />{!reviewed && <span className="pill pill-amber" data-testid="not-reviewed">Not reviewed</span>}</>}
      />
      {!waiting && <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">This version is <strong>{d.draft.status.replace(/_/g, ' ')}</strong>. Actions are only for a draft that waits for you.{d.draft.approved_unreviewed ? ' It was approved without a Reviewer pass.' : ''}</div>}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card title="Draft">
            <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><dt className="text-xs text-slate-500">SEO title</dt><dd>{d.draft.seo?.title_tag ?? '—'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Meta description</dt><dd>{d.draft.seo?.meta_description ?? '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Slug</dt><dd className="font-mono text-xs">{d.draft.seo?.slug_suggestion ?? '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Words · reading grade (post / intro)</dt><dd data-testid="reading">{d.draft.word_count?.toLocaleString('en-US') ?? '—'} · {d.draft.reading?.post_grade ?? '—'} / {d.draft.reading?.intro_grade ?? '—'}</dd></div>
            </dl>
            {d.draft.tldr?.length ? (
              <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
                <div className="mb-1 text-xs font-medium text-slate-500">TL;DR</div>
                <ul className="list-disc space-y-0.5 pl-5">{d.draft.tldr.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ) : null}
            <div className="border-t border-slate-200 pt-2 dark:border-slate-800">
              <MarkdownPreview ref={preview} markdown={d.draft.post_markdown ?? ''} />
            </div>
          </Card>
          {d.draft.revision_notes?.length ? (
            <Card title="Revision notes (what the Writer changed)">
              <ul className="space-y-2 text-sm">
                {d.draft.revision_notes.map((n, i) => (
                  <li key={i}>{n.feedback_quote && <div className="text-slate-500 italic">“{n.feedback_quote}”</div>}<div>{n.what_changed}</div></li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <PublishCard briefId={d.brief_id} status={d.draft.status} version={d.draft.version} title={d.draft.title} />
          <Card title="Your decision">
            <div className="space-y-4">
              {error && <ActionError error={error} onClose={() => setError(null)} />}
              <div>
                <button type="button" className="btn-primary w-full" disabled={!waiting || !hardPassed} onClick={() => { setUnderstood(false); setApproveOpen(true) }}>
                  <CheckCircle2 size={16} /> Approve
                </button>
                {!hardPassed && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400" data-testid="approve-blocked">
                    Approve is off: the hard content checks did not pass{failedHard.length ? ` (${failedHard.map((c) => c.id).join(', ')})` : ' (no check results)'}. Send a counter prompt or reject the topic.
                  </p>
                )}
                {!reviewed && waiting && (
                  <button type="button" className="btn-secondary mt-2 w-full" onClick={() => setConfirm({ action: reviewAction, calls: COSTS.approval_review.normal, title: 'Ask the Reviewer to check this version?', text: 'One Reviewer call (no revision loop). The draft keeps waiting for you, pass or fail.' })}>
                    <ShieldQuestion size={16} /> Review this version
                  </button>
                )}
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="mb-1 text-sm font-semibold">Request changes</h3>
                <p className="mb-2 text-xs text-slate-500">A counter prompt for the Writer.{revisionsLeft != null ? ` ${Math.max(0, revisionsLeft)} of ${maxRevisions} left for this brief.` : ''}</p>
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
                <p className="text-xs text-slate-500">Expected AI calls: {rereviewOn ? COSTS.human_revise_rereview.normal : COSTS.human_revise_no_rereview.normal}</p>
                <button type="button" className="btn-secondary mt-2 w-full" disabled={!waiting || !fbValid || revisionsLeft === 0}
                  onClick={() => setConfirm({
                    action: { kind: 'revise', path: `${base}/revise`, body: { feedback, ...(quotes.length && { quotes }), params: { rereview_after_human: rereviewOn } }, label: 'Counter prompt' },
                    calls: rereviewOn ? COSTS.human_revise_rereview.normal : COSTS.human_revise_no_rereview.normal,
                    title: 'Send this counter prompt?',
                    text: `The Writer revises v${d.draft.version} with your feedback${quotes.length ? ` and ${quotes.length} quote${quotes.length === 1 ? '' : 's'}` : ''}${rereviewOn ? ', then the Reviewer checks it' : '; the Reviewer is skipped'}.`
                  })}>
                  Send counter prompt
                </button>
                {revisionsLeft === 0 && <p className="mt-1 text-xs text-red-600 dark:text-red-400">No counter prompts left (MAX_HUMAN_REVISIONS): approve or reject the topic.</p>}
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="mb-1 text-sm font-semibold">Reject the topic</h3>
                <label className="label" htmlFor="reason">Reason (optional, saved as a lesson)</label>
                <textarea id="reason" className="input min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!waiting} maxLength={FEEDBACK_MAX} />
                <button type="button" className="btn-danger mt-2 w-full" disabled={!waiting}
                  onClick={() => setConfirm({ action: { kind: 'reject', path: `${base}/reject`, body: reason.trim() ? { reason: reason.trim() } : {}, label: 'Reject' }, calls: COSTS.reject_topic.normal, title: 'Reject this topic?', danger: true, text: 'The brief and this draft become rejected, and the topic is never picked again.' })}>
                  <Trash2 size={16} /> Reject topic
                </button>
              </div>
            </div>
          </Card>

          <Card title="Verdict" actions={!reviewed ? <span className="pill pill-amber">Not reviewed</span> : undefined}>
            {review ? (
              <VerdictPanel review={review} />
            ) : (
              <p className="text-sm text-slate-500">This version has no review. {waiting ? 'Use “Review this version” to ask the Reviewer.' : ''}</p>
            )}
          </Card>
          <Card title="Checks"><ChecksTable checks={d.checks} /></Card>
        </div>
      </div>

      <Card title="History" className="mt-4">
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
        {versions.length > 1 && (
          <CompareControls versions={versions.map((v) => v.version)} onCompare={(a, b) => setCompare({ a, b })} />
        )}
        {compareA && compareB && <ComparePanel a={compareA} b={compareB} currentMarkdown={d.draft.post_markdown} currentVersion={d.draft.version} />}
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
              <button type="button" className="btn-danger mt-2 w-full" disabled={busy || !understood} onClick={() => void run(forceAction)}>Approve without review · expected AI calls {COSTS.approve.normal}</button>
            </div>
            <div className="mt-4 flex justify-end"><button type="button" className="btn-secondary" disabled={busy} onClick={() => setApproveOpen(false)}>Cancel</button></div>
          </div>
        </div>
      ) : (
        <ConfirmDialog open title={`Approve v${d.draft.version}?`} expectedCalls={COSTS.approve.normal} confirmLabel="Approve" busy={busy} onConfirm={() => run(approveAction)} onCancel={() => setApproveOpen(false)}>
          <p>The promo pack is created, then the Designer step (a placeholder until Phase 8) and the Publisher step ({settings.data?.blog?.auto_publish ? 'AUTO_PUBLISH is on: the post is published to the blog, no AI calls' : 'AUTO_PUBLISH is off: publish it afterwards with Publish'}).{!reviewed ? ' This version has no Reviewer pass (re-review is off).' : ''}</p>
        </ConfirmDialog>
      ))}

      <ConfirmDialog open={Boolean(confirm)} title={confirm?.title ?? ''} expectedCalls={confirm?.calls ?? ''} confirmLabel={confirm?.action.kind === 'reject' ? 'Reject the topic' : 'Start'} danger={confirm?.danger} busy={busy} onConfirm={() => (confirm ? run(confirm.action) : undefined)} onCancel={() => setConfirm(null)}>
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
