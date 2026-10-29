// One run action on the Control page: what it does, its expected AI calls (normal / low-cost), optional
// pickers, and a button. Modes the engine has not built yet are shown disabled with their phase.
import type { ReactNode } from 'react'
import { Play } from 'lucide-react'
import { COSTS, expectedMem0, type CostKey } from '../config/costs'

type Props = {
  /** The AI model of each agent this button runs: [label, { service, model }]. */
  models?: [string, { service?: string; model?: string } | undefined][]
  title: string
  description: string
  costKey?: CostKey
  lowCost: boolean
  built: boolean
  comingIn?: string
  disabledReason?: string | null
  children?: ReactNode
  onRun: () => void
}

export function RunButton({ title, description, costKey, lowCost, built, comingIn, disabledReason, models, children, onRun }: Props) {
  const cost = costKey ? COSTS[costKey] : null
  const blocked = !built ? `Coming in ${comingIn ?? 'a later phase'}` : disabledReason
  return (
    <section className={`flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${!built ? 'opacity-60' : ''}`} data-testid={`run-card-${title}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>
      {cost && (
        <p className="mt-2 text-xs" data-testid="cost">
          Expected AI calls: <strong className={lowCost ? '' : 'text-slate-900 dark:text-white'}>{cost.normal}</strong> normal ·{' '}
          <strong className={lowCost ? 'text-slate-900 dark:text-white' : ''}>{cost.lowCost}</strong> low-cost
        </p>
      )}
      {cost && <p className="text-xs text-slate-500" data-testid="cost-mem0">Expected memory calls: {costKey ? expectedMem0(costKey, lowCost) : cost.mem0}</p>}
      {models && models.length > 0 && (
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300" data-testid="models">
          {models.length === 1 ? 'AI model: ' : 'AI models: '}
          {models.map(([label, m], i) => <span key={label}>{i > 0 && ' · '}{models.length > 1 && <span className="text-slate-500">{label} </span>}<strong>{m?.model ?? '—'}</strong>{m?.service ? <span className="text-slate-500"> ({m.service})</span> : null}</span>)}
        </p>
      )}
      {children && <div className="mt-3 space-y-2">{children}</div>}
      <div className="mt-auto pt-3">
        <button type="button" className="btn-primary w-full" disabled={Boolean(blocked)} onClick={onRun} title={blocked ?? undefined}>
          <Play size={14} /> {title}
        </button>
        {blocked && <p className="mt-1 text-center text-xs text-slate-500">{blocked}</p>}
      </div>
    </section>
  )
}
