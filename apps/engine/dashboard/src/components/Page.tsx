// Shared page pieces: header, panel, empty state, and the loading shapes (skeletons) shown while data comes in.
import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-12 flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0 animate-rise">
        {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
        <h1 className="font-serif text-[38px] leading-[1.08] font-semibold tracking-[-0.025em] text-ink sm:text-[46px]">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  )
}

/** A section of a page: a hairline on top, a small serif title, no box. */
export function Card({ title, children, className = '', actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`border-t border-line pt-6 pb-2 ${className}`}>
      {(title || actions) && (
        <div className="mb-5 flex items-center justify-between gap-3">
          {title && <h2 className="font-serif text-[21px] font-semibold tracking-[-0.01em] text-ink [&_svg]:hidden">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-surface-2/70 px-6 py-10 text-center text-[15px] text-ink-2">{children}</div>
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
      <Skeleton className="mb-4 h-3 w-28" />
      <Skeleton className="mb-4 h-11 w-[26rem] max-w-full" />
      <Skeleton className="mb-14 h-4 w-[30rem] max-w-full" />
      <div className="space-y-5 border-t border-line pt-8">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/6" />
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
