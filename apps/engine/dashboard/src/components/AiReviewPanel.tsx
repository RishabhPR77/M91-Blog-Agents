// The AI review next to the post: the score and verdict, what the Reviewer says in a line, its notes (each with
// "Show in post"), the area scores, and the content checks as one line (the table opens on demand). Gates and the
// sources it checked are under "More from the review".
import { CheckCircle2, ChevronDown, XCircle } from 'lucide-react'
import { useSettings } from '../api/queries'
import { ChecksTable, type CheckResult } from './ChecksTable'
import { FeedbackList } from './FeedbackList'
import { GatesList } from './GatesList'
import { ScoreCard } from './ScoreCard'
import type { Review } from './VerdictPanel'

/** The content checks in one line: "All 9 hard checks passed · 2 soft notes" or the failed hard ones by name. */
export function checksLine(checks: CheckResult[]): { ok: boolean; text: string } {
  const hard = checks.filter((c) => c.severity === 'hard')
  const hardFailed = hard.filter((c) => !c.passed)
  const softFailed = checks.filter((c) => c.severity !== 'hard' && !c.passed)
  if (!checks.length) return { ok: false, text: 'No check results recorded' }
  const soft = softFailed.length ? ` · ${softFailed.length} soft note${softFailed.length === 1 ? '' : 's'}` : ''
  if (hardFailed.length) return { ok: false, text: `${hardFailed.length} hard check${hardFailed.length === 1 ? '' : 's'} failed: ${hardFailed.map((c) => c.id).join(', ')}${soft}` }
  return { ok: true, text: `All ${hard.length} hard checks passed${soft}` }
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
    <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
    {children}
  </div>
)

export function AiReviewPanel({ review, checks, onShow, notReviewedText }: { review: Review | null; checks: CheckResult[]; onShow?: (quote: string) => boolean; notReviewedText?: string }) {
  const settings = useSettings()
  const line = checksLine(checks)
  const must = review?.feedback?.filter((f) => f.severity === 'must').length ?? 0
  return (
    <div className="space-y-4" data-testid="ai-review">
      {review ? (
        <>
          <ScoreCard total={review.total} pass={review.pass} notes={review.outcome === 'notes'} passMin={settings.data?.gates.pass_score_min} areaMin={settings.data?.gates.pass_area_min} />
          {review.summary && <p className="text-[15px] leading-6 text-slate-700 dark:text-slate-200" data-testid="review-summary">{review.summary}</p>}
        </>
      ) : (
        <p className="text-sm text-slate-500">{notReviewedText ?? 'This version has no AI review yet.'}</p>
      )}

      <details className="group rounded-lg border border-slate-200 dark:border-slate-800" data-testid="checks-line">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
          {line.ok ? <CheckCircle2 size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" /> : <XCircle size={16} className="shrink-0 text-red-600 dark:text-red-400" />}
          <span className="flex-1">{line.text}</span>
          <ChevronDown size={14} className="text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-slate-200 p-2 dark:border-slate-800"><ChecksTable checks={checks} /></div>
      </details>

      {review && (
        <>
          <Section title={`Notes for the writer${review.feedback?.length ? ` (${review.feedback.length}${must ? `, ${must} must fix` : ''})` : ''}`}>
            <FeedbackList items={review.feedback ?? []} onShow={onShow} />
          </Section>
          {review.areas?.length ? (
            <Section title="Scores by area">
              <ScoreCard total={null} pass={null} areaMin={settings.data?.gates.pass_area_min} areas={review.areas} hideTotal />
            </Section>
          ) : null}
          <details className="group border-t border-slate-100 pt-3 dark:border-slate-800">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              More from the review <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 space-y-4">
              <div><h4 className="mb-1 text-xs font-medium text-slate-500">Gates</h4><GatesList gates={review.gates ?? []} /></div>
              {review.sources_checked?.length ? (
                <div>
                  <h4 className="mb-1 text-xs font-medium text-slate-500">Sources the Reviewer checked</h4>
                  <ul className="space-y-1 text-sm">
                    {review.sources_checked.map((s, i) => (
                      <li key={i}>
                        <span className={`pill ${s.verdict === 'supports' ? 'pill-green' : s.verdict === 'contradicts' ? 'pill-red' : 'pill-gray'}`}>{s.verdict ?? '?'}</span>{' '}
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline dark:text-sky-300">{s.url}</a>
                        {s.claim && <div className="text-xs text-slate-500">{s.claim}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {review.fixed_previous?.length ? (
                <div>
                  <h4 className="mb-1 text-xs font-medium text-slate-500">Earlier feedback: fixed?</h4>
                  <ul className="space-y-1 text-sm">
                    {review.fixed_previous.map((f, i) => (
                      <li key={i}><span className={`pill ${f.fixed ? 'pill-green' : 'pill-amber'}`}>{f.fixed ? 'fixed' : 'not fixed'}</span> <span className="text-slate-600 italic dark:text-slate-400">“{f.previous_quote}”</span>{f.note && <div className="text-xs text-slate-500">{f.note}</div>}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>
        </>
      )}
    </div>
  )
}
