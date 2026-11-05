// Toast messages. A tiny bus so non-React code (the query cache) can show them too.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

export type ToastKind = 'error' | 'success' | 'info'
type Toast = { id: number; kind: ToastKind; message: string }

let nextId = 1
const listeners = new Set<(t: Toast) => void>()

export function toast(kind: ToastKind, message: string) {
  const t = { id: nextId++, kind, message }
  for (const l of listeners) l(t)
}

// Ink toasts (lighter at night) with a coloured dot for the kind.
const DOT: Record<ToastKind, string> = { error: 'bg-red-500', success: 'bg-emerald-400', info: 'bg-hl' }

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    const add = (t: Toast) => {
      setItems((cur) => [...cur.filter((x) => x.message !== t.message), t].slice(-4))
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), t.kind === 'error' ? 8000 : 4000)
    }
    listeners.add(add)
    return () => {
      listeners.delete(add)
    }
  }, [])
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex animate-slide-in items-start gap-2.5 rounded-xl bg-[#0b0e12] px-4 py-3 text-sm text-white shadow-(--shadow-float) dark:bg-[#1f2a38]">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[t.kind]}`} />
          <span className="flex-1 break-words">{t.message}</span>
          <button type="button" aria-label="Dismiss" className="opacity-60 hover:opacity-100" onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
