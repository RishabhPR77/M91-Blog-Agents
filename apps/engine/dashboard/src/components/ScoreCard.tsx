// The Reviewer's total (big number), pass/fail, and the 10 area scores as bars with their evidence.
export type Area = { id: string; score: number; evidence?: string }

const AREA_LABEL: Record<string, string> = {
  answers_question: 'Answers the question', simplicity: 'Simplicity', accuracy: 'Accuracy', seo: 'SEO', structure: 'Structure',
  tone: 'Tone', originality: 'Originality', ai_answer_readiness: 'AI-answer readiness', to_the_point: 'To the point', m91_fit_cta: 'M91 fit and CTA'
}

export function ScoreCard({ total, pass, notes = false, passMin, areaMin, areas = [], hideTotal = false }: { total: number | null; pass: boolean | null; notes?: boolean; passMin?: number; areaMin?: number; areas?: Area[]; hideTotal?: boolean }) {
  return (
    <div>
      {!hideTotal && <div className="flex items-end gap-3">
        <span className="text-5xl font-semibold tabular-nums" data-testid="score-total">{total ?? '—'}</span>
        <span className="pb-1.5 text-sm text-slate-500">/ 100{passMin != null ? ` · pass ≥ ${passMin}` : ''}</span>
        {pass != null && <span className={`mb-1.5 pill ${pass ? (notes ? 'pill-amber' : 'pill-green') : 'pill-red'}`} data-testid="score-verdict">{pass ? (notes ? 'pass with notes' : 'pass') : 'fail'}</span>}
      </div>}
      {pass && notes && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400" data-testid="score-notes">Only minor problems: not sent back to the Writer. The should-fix items are listed below.</p>}
      {areas.length > 0 && (
        <ul className={`${hideTotal ? '' : 'mt-4 '}space-y-1.5`} aria-label="Area scores">
          {areas.map((a) => {
            const low = areaMin != null && a.score < areaMin
            return (
              <li key={a.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                    <span className="w-40 shrink-0 truncate">{AREA_LABEL[a.id] ?? a.id}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
                      <span className={`block h-full rounded-full ${low ? 'bg-red-500' : a.score >= 8 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.max(0, Math.min(10, a.score)) * 10}%` }} />
                    </span>
                    <span className={`w-10 text-right tabular-nums ${low ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{a.score}/10</span>
                  </summary>
                  {a.evidence && <p className="mt-1 mb-2 ml-1 text-xs text-slate-600 dark:text-slate-400">{a.evidence}</p>}
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
