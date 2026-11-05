// A modal that confirms an action that starts a run or changes state. It always shows the expected AI calls
// (pass "0" for actions without AI) and can require a tick box before Confirm is enabled.
import { useEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  open: boolean
  title: string
  children?: ReactNode
  expectedCalls: string
  /** Phase 9: expected Mem0 requests (shown when given). */
  expectedMem0?: string
  confirmLabel?: string
  danger?: boolean
  requireTick?: string
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmDialog({ open, title, children, expectedCalls, expectedMem0, confirmLabel = 'Confirm', danger, requireTick, busy, onConfirm, onCancel }: Props) {
  const [ticked, setTicked] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // The latest props for the Escape handler, so re-renders of the page never re-run the open-time setup.
  const latest = useRef({ busy, onCancel })
  latest.current = { busy, onCancel }
  useEffect(() => {
    if (!open) return
    setTicked(false)
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !latest.current.busy) latest.current.onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade bg-[#0b0e12]/40 backdrop-blur-[2px]" onClick={() => !busy && onCancel()} />
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="relative w-full max-w-md animate-pop rounded-2xl border border-line bg-surface p-6 shadow-(--shadow-float)">
        <h2 id="confirm-title" className="font-display text-lg font-semibold tracking-[-0.01em]">{title}</h2>
        {children && <div className="mt-3 space-y-2 text-sm text-ink-2">{children}</div>}
        <p className="mt-4 rounded-xl bg-ink/[0.04] px-3.5 py-2.5 text-sm" data-testid="expected-calls">
          Expected AI calls: <strong>{expectedCalls}</strong>
        </p>
        {expectedMem0 && <p className="mt-1.5 px-3.5 text-xs text-ink-3" data-testid="expected-mem0">Expected memory calls: {expectedMem0}</p>}
        {requireTick && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
            <span>{requireTick}</span>
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={() => void onConfirm()} disabled={busy || (Boolean(requireTick) && !ticked)}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
