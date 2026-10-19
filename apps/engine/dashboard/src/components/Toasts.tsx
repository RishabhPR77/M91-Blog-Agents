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

const STYLE: Record<ToastKind, string> = {
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  info: 'border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
}

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
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-sm ${STYLE[t.kind]}`}>
          <span className="flex-1 break-words">{t.message}</span>
          <button type="button" aria-label="Dismiss" className="opacity-60 hover:opacity-100" onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
