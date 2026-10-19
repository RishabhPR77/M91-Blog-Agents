// The Reviewer's gates (AI and code) with pass/fail and evidence. Failed gates come first.
import { Check, X } from 'lucide-react'

export type Gate = { id: string; passed: boolean; evidence?: string; source?: string }

export function GatesList({ gates }: { gates: Gate[] }) {
  if (!gates.length) return <p className="text-sm text-slate-500">No gates recorded.</p>
  const sorted = [...gates].sort((a, b) => Number(a.passed) - Number(b.passed))
  return (
    <ul className="space-y-1" aria-label="Gates">
      {sorted.map((g) => (
        <li key={g.id}>
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
              <span className={g.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{g.passed ? <Check size={14} aria-label="passed" /> : <X size={14} aria-label="failed" />}</span>
              <span className="font-mono text-xs">{g.id}</span>
              {g.source && <span className="pill pill-gray py-0">{g.source}</span>}
            </summary>
            {g.evidence && <p className="mt-1 mb-2 ml-6 text-xs text-slate-600 dark:text-slate-400">{g.evidence}</p>}
          </details>
        </li>
      ))}
    </ul>
  )
}
