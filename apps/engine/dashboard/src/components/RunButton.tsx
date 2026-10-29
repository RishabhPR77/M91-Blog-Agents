// One run action on the Control page: what it does, its expected AI calls (normal / low-cost), optional
// pickers, and a button. Modes the engine has not built yet are shown disabled with their phase. The "hero"
// variant is the one big card on top of Control (Write the next post).
import type { ReactNode } from 'react'
import { Play, Sparkles } from 'lucide-react'
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
  /** The button's own text (default: the title). */
  buttonLabel?: string
  variant?: 'card' | 'hero'
  onRun: () => void
}

export function RunButton({ title, description, costKey, lowCost, built, comingIn, disabledReason, models, children, buttonLabel, variant = 'card', onRun }: Props) {
  const cost = costKey ? COSTS[costKey] : null
  const blocked = !built ? `Coming in ${comingIn ?? 'a later phase'}` : disabledReason
  const modelLine = models && models.length > 0 && (
    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300" data-testid="models">
      {models.length === 1 ? 'AI model: ' : 'AI models: '}
      {models.map(([label, m], i) => <span key={label}>{i > 0 && ' · '}{models.length > 1 && <span className="text-slate-500">{label} </span>}<strong>{m?.model ?? '—'}</strong>{m?.service ? <span className="text-slate-500"> ({m.service})</span> : null}</span>)}
    </p>
  )
  if (variant === 'hero') {
    return (
      <section className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-white p-6 shadow-sm dark:border-slate-700 dark:bg-none dark:bg-slate-900" data-testid={`run-card-${title}`}>
        <div className="flex flex-col gap-5 md:flex-row md:items-start">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Sparkles size={20} className="text-indigo-600 dark:text-slate-300" /> {title}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>
            {children && <div className="mt-4 space-y-2">{children}</div>}
            <div className="mt-4 border-t border-indigo-100 pt-3 dark:border-slate-800">
              {modelLine}
              {cost && (
                <p className="mt-1 text-xs text-slate-500" data-testid="cost">
                  Expected AI calls: <strong className="text-slate-800 dark:text-slate-100">{lowCost ? cost.lowCost : cost.normal}</strong>{lowCost ? ' (low-cost)' : ''} · <span data-testid="cost-mem0">memory calls {costKey ? expectedMem0(costKey, lowCost) : cost.mem0}</span>
                </p>
              )}
            </div>
          </div>
          <div className="md:w-56">
            <button type="button" className="btn-primary w-full py-3 text-base" disabled={Boolean(blocked)} onClick={onRun} title={blocked ?? undefined}>
              <Play size={16} /> {buttonLabel ?? title}
            </button>
            {blocked && <p className="mt-2 text-center text-xs text-slate-500">{blocked}</p>}
          </div>
        </div>
      </section>
    )
  }
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
      {modelLine}
      {children && <div className="mt-3 space-y-2">{children}</div>}
      <div className="mt-auto pt-3">
        <button type="button" className="btn-primary w-full" disabled={Boolean(blocked)} onClick={onRun} title={blocked ?? undefined}>
          <Play size={14} /> {buttonLabel ?? title}
        </button>
        {blocked && <p className="mt-1 text-center text-xs text-slate-500">{blocked}</p>}
      </div>
    </section>
  )
}
