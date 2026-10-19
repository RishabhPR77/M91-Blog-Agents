// Every event of a run in order, with filters (type, step, level), search, auto-scroll (with pause) and copy.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Pause, Play } from 'lucide-react'
import { fmtDuration, fmtTime } from '../format'
import type { LogLine } from '../state/runEvents'
import { toast } from './Toasts'

const MAX_SHOWN = 2000

const LEVEL_STYLE: Record<string, string> = {
  error: 'text-red-700 dark:text-red-300',
  warn: 'text-amber-700 dark:text-amber-300',
  info: '',
  debug: 'text-slate-400'
}

function detail(l: LogLine): string {
  const d = l.data ?? {}
  if (l.type === 'ai.call') {
    return [d.call ? `call ${d.call}` : null, d.model, d.delivery, typeof d.ms === 'number' ? fmtDuration(d.ms) : null, `retries ${d.retries ?? 0}`, d.finish_reason ? `finish ${d.finish_reason}` : null].filter(Boolean).join(' · ')
  }
  return l.message
}

export function EventLog({ lines, dropped = 0 }: { lines: LogLine[]; dropped?: number }) {
  const [type, setType] = useState('')
  const [step, setStep] = useState('')
  const [level, setLevel] = useState('')
  const [q, setQ] = useState('')
  const [paused, setPaused] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const types = useMemo(() => [...new Set(lines.map((l) => l.type))].sort(), [lines])
  const steps = useMemo(() => [...new Set(lines.map((l) => l.step).filter((s): s is string => Boolean(s)))].sort(), [lines])
  const levels = useMemo(() => [...new Set(lines.map((l) => l.level))].sort(), [lines])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = lines.filter((l) => (!type || l.type === type) && (!step || l.step === step) && (!level || l.level === level) && (!needle || `${l.type} ${l.step ?? ''} ${detail(l)} ${JSON.stringify(l.data ?? {})}`.toLowerCase().includes(needle)))
    return out.length > MAX_SHOWN ? out.slice(out.length - MAX_SHOWN) : out
  }, [lines, type, step, level, q])

  useEffect(() => {
    if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [shown, paused])

  async function copy() {
    const text = shown.map((l) => JSON.stringify(l)).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast('success', `Copied ${shown.length} log line${shown.length === 1 ? '' : 's'}`)
    } catch {
      toast('error', 'Could not copy (the browser blocked the clipboard)')
    }
  }

  const select = (label: string, value: string, set: (v: string) => void, options: string[]) => (
    <select aria-label={label} className="input w-auto py-1.5" value={value} onChange={(e) => set(e.target.value)}>
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {select('Type', type, setType, types)}
        {select('Step', step, setStep, steps)}
        {select('Level', level, setLevel, levels)}
        <input aria-label="Search the log" placeholder="Search…" className="input w-44 py-1.5" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-slate-500">{shown.length} of {lines.length}{dropped ? ` (+${dropped} older lines dropped)` : ''}</span>
        <div className="ml-auto flex gap-1">
          <button type="button" className="btn-secondary py-1.5" onClick={() => setPaused((p) => !p)} aria-pressed={paused} title={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}>
            {paused ? <Play size={14} /> : <Pause size={14} />} {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="btn-secondary py-1.5" onClick={copy} title="Copy the shown lines as JSON"><Copy size={14} /> Copy</button>
        </div>
      </div>
      <div ref={box} className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200 bg-slate-50 font-mono text-xs dark:border-slate-800 dark:bg-slate-950" data-testid="event-log">
        {shown.length === 0 ? (
          <div className="p-4 text-center text-slate-500">No log lines{lines.length ? ' match the filters' : ' yet'}.</div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {shown.map((l) => (
                <tr key={`${l.seq}-${l.type}`} className={`border-b border-slate-100 align-top dark:border-slate-900 ${LEVEL_STYLE[l.level] ?? ''}`}>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-400">{fmtTime(l.ts)}</td>
                  <td className="whitespace-nowrap px-2 py-1">{l.type}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-500">{l.step ?? ''}</td>
                  <td className="whitespace-nowrap px-2 py-1">{l.level !== 'info' ? l.level : ''}</td>
                  <td className="w-full break-all px-2 py-1">{detail(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
