// A readable view of any JSON payload: labels from keys, lists as bullets, URLs as safe links, nested
// objects indented. Used for record types without a dedicated view (clusters, leads, style notes, facts…).
import type { ReactNode } from 'react'

export const labelOf = (key: string) => key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s)

export function Value({ v }: { v: unknown }): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-slate-400">—</span>
  if (typeof v === 'boolean') return <span>{v ? 'yes' : 'no'}</span>
  if (typeof v === 'number') return <span className="tabular-nums">{v}</span>
  if (typeof v === 'string') {
    return isUrl(v) ? <a href={v} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline dark:text-sky-300">{v}</a> : <span className="whitespace-pre-wrap">{v}</span>
  }
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-slate-400">none</span>
    return (
      <ul className="list-disc space-y-1 pl-5">
        {v.map((x, i) => <li key={i}>{x && typeof x === 'object' && !Array.isArray(x) ? <FieldView data={x as Record<string, unknown>} compact /> : <Value v={x} />}</li>)}
      </ul>
    )
  }
  return <FieldView data={v as Record<string, unknown>} compact />
}

export function FieldView({ data, compact = false, skip = [] }: { data: Record<string, unknown>; compact?: boolean; skip?: string[] }) {
  const entries = Object.entries(data ?? {}).filter(([k]) => !skip.includes(k))
  return (
    <dl className={compact ? 'space-y-0.5 text-sm' : 'grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]'}>
      {entries.map(([k, v]) => (
        compact ? (
          <div key={k}><dt className="inline text-slate-500">{labelOf(k)}: </dt><dd className="inline"><Value v={v} /></dd></div>
        ) : (
          <div key={k} className="contents">
            <dt className="text-slate-500">{labelOf(k)}</dt>
            <dd className="min-w-0"><Value v={v} /></dd>
          </div>
        )
      ))}
    </dl>
  )
}
