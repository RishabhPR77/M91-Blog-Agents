// Word-level comparison of two Markdown versions, inline or side by side.
import { useMemo, useState } from 'react'
import { diffWords } from 'diff'

export type Part = { value: string; added?: boolean; removed?: boolean }

export function wordDiff(a: string, b: string): Part[] {
  return diffWords(a, b).map((p) => ({ value: p.value, added: p.added, removed: p.removed }))
}

export function diffStats(parts: Part[]) {
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length
  return { added: parts.filter((p) => p.added).reduce((n, p) => n + words(p.value), 0), removed: parts.filter((p) => p.removed).reduce((n, p) => n + words(p.value), 0) }
}

const ADD = 'rounded-sm bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100'
const DEL = 'rounded-sm bg-red-100 text-red-900 line-through dark:bg-red-900/60 dark:text-red-100'

export function VersionDiff({ before, after, beforeLabel, afterLabel }: { before: string; after: string; beforeLabel: string; afterLabel: string }) {
  const [mode, setMode] = useState<'inline' | 'side'>('inline')
  const parts = useMemo(() => wordDiff(before, after), [before, after])
  const stats = diffStats(parts)
  const box = 'max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 dark:border-slate-800 dark:bg-slate-950'
  return (
    <div data-testid="version-diff">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span>{beforeLabel} → {afterLabel}:</span>
        <span className="text-emerald-700 dark:text-emerald-400" data-testid="diff-added">+{stats.added} words</span>
        <span className="text-red-700 dark:text-red-400" data-testid="diff-removed">−{stats.removed} words</span>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700" role="group" aria-label="Diff view">
          {(['inline', 'side'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`px-2.5 py-1 text-xs ${mode === m ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''}`}>
              {m === 'inline' ? 'Inline' : 'Side by side'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'inline' ? (
        <div className={box}>
          {parts.map((p, i) => <span key={i} className={p.added ? ADD : p.removed ? DEL : ''}>{p.value}</span>)}
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          <div className={box} aria-label={beforeLabel}>{parts.filter((p) => !p.added).map((p, i) => <span key={i} className={p.removed ? DEL : ''}>{p.value}</span>)}</div>
          <div className={box} aria-label={afterLabel}>{parts.filter((p) => !p.removed).map((p, i) => <span key={i} className={p.added ? ADD : ''}>{p.value}</span>)}</div>
        </div>
      )}
    </div>
  )
}
