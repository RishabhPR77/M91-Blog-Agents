// The shared content checks (hard and soft). Failed ones first, hard before soft.
export type CheckResult = { id: string; passed: boolean; severity: 'hard' | 'soft' | string; value?: unknown; detail?: string }

export function sortChecks(checks: CheckResult[]): CheckResult[] {
  const rank = (c: CheckResult) => (c.passed ? 2 : 0) + (c.severity === 'hard' ? 0 : 1)
  return [...checks].sort((a, b) => rank(a) - rank(b))
}

export function ChecksTable({ checks }: { checks: CheckResult[] }) {
  if (!checks.length) return <p className="text-sm text-slate-500">No check results recorded.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label="Check results">
        <thead className="text-xs text-slate-500">
          <tr className="border-b border-slate-200 dark:border-slate-800">
            <th className="px-2 py-1.5 font-medium">Check</th><th className="px-2 py-1.5 font-medium">Kind</th><th className="px-2 py-1.5 font-medium">Result</th><th className="px-2 py-1.5 font-medium">Value</th><th className="px-2 py-1.5 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {sortChecks(checks).map((c) => (
            <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800/60" data-testid={`check-${c.id}`}>
              <td className="px-2 py-1.5 font-mono text-xs">{c.id}</td>
              <td className="px-2 py-1.5">{c.severity}</td>
              <td className="px-2 py-1.5">{c.passed ? <span className="text-emerald-700 dark:text-emerald-400">pass</span> : <span className={c.severity === 'hard' ? 'font-semibold text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}>fail</span>}</td>
              <td className="px-2 py-1.5 tabular-nums">{typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value ?? '')}</td>
              <td className="px-2 py-1.5 text-slate-600 dark:text-slate-400">{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
