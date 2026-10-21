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
            {o.step === 'designer' && o.data && <DesignerPills data={o.data} />}
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

/**
 * The Designer's step output. Phase 10 (Experience Designer): guide or not, chapters, the components chosen, what
 * was dropped (with reasons), coverage, the no-new-facts checks (first answer → final) and repairs. Phase 8 runs
 * (blocks, integrity) still show the old way.
 */
function DesignerPills({ data }: { data: Record<string, unknown> }) {
  const n = (v: unknown) => (typeof v === 'number' ? v : null)
  const components = Array.isArray(data.components) ? (data.components as string[]) : null
  const dropped = Array.isArray(data.dropped) ? (data.dropped as { type?: string | null; chapter?: number; reason?: string }[]) : null
  const coverage = typeof data.coverage === 'boolean' ? data.coverage : null
  const checks = data.checks as { first?: number; final?: number } | undefined
  const integrity = data.integrity as { passed?: boolean } | boolean | null | undefined
  const passed = typeof integrity === 'boolean' ? integrity : integrity?.passed
  const guide = components !== null
  return (
    <div className="mt-1 text-xs" data-testid="designer-pills">
      <div className="flex flex-wrap gap-1.5">
        {typeof data.status === 'string' && <span className={`pill ${data.status === 'ok' ? 'pill-green' : 'pill-amber'}`}>{guide ? (data.status === 'ok' ? 'guide' : 'no guide') : data.status}</span>}
        {n(data.chapters) ? <span className="pill pill-gray">{n(data.chapters)} chapters</span> : null}
        {components && components.length > 0 && <span className="pill pill-gray" title={components.join(', ')}>{components.length} components</span>}
        {n(data.blocks) !== null && <span className="pill pill-gray">{n(data.blocks)} blocks</span>}
        {dropped?.length ? <span className="pill pill-amber">{dropped.length} dropped</span> : n(data.dropped) ? <span className="pill pill-amber">{n(data.dropped)} dropped</span> : null}
        {coverage !== null && <span className={`pill ${coverage ? 'pill-green' : 'pill-red'}`}>coverage {coverage ? 'passed' : 'failed'}</span>}
        {checks && (checks.first || checks.final) ? <span className={`pill ${checks.final ? 'pill-amber' : 'pill-green'}`} title="no-new-facts problems: first answer → after the repair and drops">checks {checks.first ?? 0} → {checks.final ?? 0}</span> : null}
        {passed !== undefined && passed !== null && <span className={`pill ${passed ? 'pill-green' : 'pill-red'}`}>integrity {passed ? 'passed' : 'failed'}</span>}
        {n(data.repairs_used) ? <span className="pill pill-gray">{n(data.repairs_used)} repair</span> : null}
      </div>
      {components && components.length > 0 && <p className="mt-1 text-slate-500" data-testid="designer-components">{[...new Set(components)].join(' · ')}</p>}
      {dropped && dropped.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-amber-800 dark:text-amber-200" aria-label="Dropped components">
          {dropped.map((d, i) => <li key={i}>{d.type ?? 'component'}{d.chapter ? ` (chapter ${d.chapter})` : ''}: {d.reason}</li>)}
        </ul>
      )}
    </div>
  )
}
