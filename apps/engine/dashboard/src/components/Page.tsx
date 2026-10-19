// Shared page pieces: header, card, empty state.
import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, children, className = '', actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{children}</div>
}

/** Placeholder for pages built in a later Phase 6 task. */
export function NotYet({ title, task }: { title: string; task: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState>This page is built in {task}.</EmptyState>
    </>
  )
}
