// Each step.output summary with links to the records it produced. Runs mention records by memory id or by
// their own id (C-…, S-…, T-…, P-…, brief ids); the run's produced records map those to memory ids.
import { Link } from 'react-router-dom'
import { fmtTime } from '../format'
import { outputRecordIds, type Output } from '../state/runEvents'
import type { TrimmedRecord } from '../state/useRunView'

export function StepOutputs({ outputs, records = [] }: { outputs: Output[]; records?: TrimmedRecord[] }) {
  const byKey = new Map<string, TrimmedRecord>()
  for (const r of records) {
    byKey.set(r.id, r)
    if (r.key_id) byKey.set(r.key_id, r)
  }
  if (!outputs.length) return <p className="text-sm text-slate-500">No step outputs yet.</p>
  return (
    <ul className="space-y-2">
      {outputs.map((o, i) => {
        const ids = outputRecordIds(o)
        return (
          <li key={`${o.seq}-${i}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{o.step}</span>
              {o.ts && <span className="text-xs text-slate-400">{fmtTime(o.ts)}</span>}
            </div>
            <div className="text-slate-700 dark:text-slate-300">{o.message}</div>
            {ids.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {ids.map((id) => {
                  const rec = byKey.get(id)
                  return rec ? (
                    <Link key={id} to={`/records/${rec.id}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-sky-700 hover:underline dark:bg-slate-800 dark:text-sky-300" title={rec.title ?? rec.type}>
                      {rec.type}: {rec.key_id ?? rec.id.slice(0, 8)}
                    </Link>
                  ) : (
                    <span key={id} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-500 dark:bg-slate-800" title="Not among this run's saved records">{id}</span>
                  )
                })}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
