// The Publisher's six sub-steps on the live run page (Phase 7). They arrive as step.output events of the
// "publisher" step with messages "n/6 name: text"; the last one may carry the live URL.
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import type { Output } from '../state/runEvents'

export const PUBLISHER_SUBSTEPS = ['build post', 'export', 'build blog', 'deploy', 'verify', 'mark published'] as const
const SUB = /^(\d)\/6 ([^:]+): (.*)$/s

export function publisherProgress(outputs: Output[]) {
  const done = new Map<number, { text: string; url?: string }>()
  for (const o of outputs) {
    if (o.step !== 'publisher') continue
    const m = SUB.exec(o.message)
    if (m) done.set(Number(m[1]), { text: m[3], url: typeof o.data?.url === 'string' ? o.data.url : undefined })
  }
  return done
}

export function PublisherSteps({ outputs, stepStatus }: { outputs: Output[]; stepStatus: string | null }) {
  const done = publisherProgress(outputs)
  if (!done.size) return null
  const last = Math.max(...done.keys())
  const url = [...done.values()].reverse().find((d) => d.url)?.url
  return (
    <div>
      <ol className="space-y-1.5 text-sm" aria-label="Publisher steps">
        {PUBLISHER_SUBSTEPS.map((name, i) => {
          const n = i + 1
          const item = done.get(n)
          const failedHere = !item && n === last + 1 && stepStatus === 'failed'
          const runningHere = !item && n === last + 1 && stepStatus === 'running'
          const icon = item ? <CheckCircle2 size={16} className="text-emerald-600" /> : failedHere ? <XCircle size={16} className="text-red-600" /> : runningHere ? <Loader2 size={16} className="animate-spin text-sky-600" /> : <Circle size={16} className="text-slate-300 dark:text-slate-600" />
          return (
            <li key={name} className="flex items-start gap-2" data-testid={`publisher-substep-${n}`}>
              <span className="mt-0.5">{icon}</span>
              <span><span className="font-medium">{n}. {name}</span>{item && <span className="text-slate-600 dark:text-slate-300">: {item.text}</span>}{failedHere && <span className="text-red-600 dark:text-red-400">: failed (see the event log)</span>}</span>
            </li>
          )
        })}
      </ol>
      {url && <a className="btn-secondary mt-3" href={url} target="_blank" rel="noreferrer">Open the live post</a>}
    </div>
  )
}
