// One run action on the Control page: what it does, its expected AI calls (normal / low-cost), optional
// pickers, and a button. Modes the engine has not built yet are shown disabled with their phase. The "hero"
// variant is the one big panel on top of Home (Write the next post): an ink panel with the lime button, in both
// themes (its "dark" class makes everything inside it use the dark colours).
import type { ReactNode } from 'react'
import { ArrowRight, Play } from 'lucide-react'
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
    <p className="text-xs text-ink-3" data-testid="models">
      {models.length === 1 ? 'AI model: ' : 'AI models: '}
      {models.map(([label, m], i) => <span key={label}>{i > 0 && ' · '}{models.length > 1 && <span>{label} </span>}<span className="font-medium text-ink-2">{m?.model ?? '—'}</span>{m?.service ? <span> ({m.service})</span> : null}</span>)}
    </p>
  )
  if (variant === 'hero') {
    return (
      <section className="dark relative overflow-hidden rounded-3xl bg-[#0b1119] p-6 text-ink ring-1 ring-white/[0.06] sm:p-8" data-testid={`run-card-${title}`}>
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-hl/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-start">
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-3 text-hl/80">Next post</p>
            <h2 className="font-display text-[26px] leading-tight font-semibold tracking-[-0.025em] text-white sm:text-[30px]">{title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">{description}</p>
            {children && <div className="mt-5 space-y-2 text-ink">{children}</div>}
            <div className="mt-6 space-y-1 border-t border-white/[0.08] pt-4">
              {modelLine}
              {cost && (
                <p className="text-xs text-ink-3" data-testid="cost">
                  Expected AI calls: <strong className="font-semibold text-ink">{lowCost ? cost.lowCost : cost.normal}</strong>{lowCost ? ' (low-cost)' : ''} · <span data-testid="cost-mem0">memory calls {costKey ? expectedMem0(costKey, lowCost) : cost.mem0}</span>
                </p>
              )}
            </div>
          </div>
          <div className="md:w-60">
            <button type="button" className="btn-primary group w-full py-3.5 text-[15px]" disabled={Boolean(blocked)} onClick={onRun} title={blocked ?? undefined}>
              <Play size={16} className="fill-current" /> {buttonLabel ?? title}
              <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
            {blocked && <p className="mt-2 text-center text-xs text-ink-3">{blocked}</p>}
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className={`panel flex flex-col p-5 transition-colors hover:border-line-strong ${!built ? 'opacity-60' : ''}`} data-testid={`run-card-${title}`}>
      <h3 className="text-sm font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">{description}</p>
      {cost && (
        <p className="mt-3 text-xs text-ink-3" data-testid="cost">
          Expected AI calls: <strong className={lowCost ? 'font-medium' : 'font-semibold text-ink'}>{cost.normal}</strong> normal ·{' '}
          <strong className={lowCost ? 'font-semibold text-ink' : 'font-medium'}>{cost.lowCost}</strong> low-cost
        </p>
      )}
      {cost && <p className="text-xs text-ink-3" data-testid="cost-mem0">Expected memory calls: {costKey ? expectedMem0(costKey, lowCost) : cost.mem0}</p>}
      {modelLine && <div className="mt-1">{modelLine}</div>}
      {children && <div className="mt-3 space-y-2">{children}</div>}
      <div className="mt-auto pt-4">
        <button type="button" className="btn-secondary w-full" disabled={Boolean(blocked)} onClick={onRun} title={blocked ?? undefined}>
          <Play size={14} /> {buttonLabel ?? title}
        </button>
        {blocked && <p className="mt-1.5 text-center text-xs text-ink-3">{blocked}</p>}
      </div>
    </section>
  )
}
