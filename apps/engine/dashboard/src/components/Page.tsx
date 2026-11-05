// Shared page pieces: header, panel, empty state, and the loading shapes (skeletons) shown while data comes in.
import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="font-display text-[28px] leading-[1.15] font-semibold tracking-[-0.025em] text-ink sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function Card({ title, children, className = '', actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`panel p-5 sm:p-6 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center text-sm text-ink-3">{children}</div>
}

/** One grey shape with a light passing over it. Size it with classes (h-4 w-40, …). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />
}

/** Rows of text to come, inside a panel or a list. */
export function LoadingRows({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-3 py-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className={`h-3.5 ${i % 2 ? 'w-16' : 'w-24'}`} />
        </div>
      ))}
    </div>
  )
}

/** A whole page to come: its header and two panels. Shown while a page's code or first data loads. */
export function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the page" className="animate-fade">
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="mb-3 h-8 w-72 max-w-full" />
      <Skeleton className="mb-10 h-4 w-[28rem] max-w-full" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel space-y-4 p-6 lg:col-span-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
        <div className="panel space-y-4 p-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-9 w-full rounded-[10px]" />
        </div>
      </div>
    </div>
  )
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
