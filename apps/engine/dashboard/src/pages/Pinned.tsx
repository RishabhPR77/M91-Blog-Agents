// /pinned — topics the Strategist must cover by a date: list, add, cancel. No AI calls.
import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorMessage } from '../api/client'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { StatusBadge } from '../components/StatusBadge'
import { toast } from '../components/Toasts'

export type Pin = { pinned_id: string; topic: string; target_date: string; priority: 'high' | 'normal'; notes: string; status: string; used_by: string | null }
export const TOPIC_MAX = 300
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** The same rules as the engine (pins.js); null when valid. */
export function pinError(topic: string, date: string): string | null {
  if (!topic.trim()) return 'Topic is required.'
  if (topic.trim().length > TOPIC_MAX) return `Topic must be at most ${TOPIC_MAX} characters.`
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return 'Date must be YYYY-MM-DD.'
  return null
}

export default function Pinned() {
  const qc = useQueryClient()
  const pins = useQuery({ queryKey: ['pinned'], queryFn: async () => (await api<{ pinned: Pin[] }>('/api/pinned')).pinned })
  const [topic, setTopic] = useState('')
  const [date, setDate] = useState('')
  const [priority, setPriority] = useState<'normal' | 'high'>('normal')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const [confirmAdd, setConfirmAdd] = useState(false)
  const [cancelPin, setCancelPin] = useState<Pin | null>(null)
  const [busy, setBusy] = useState(false)
  const invalid = pinError(topic, date)

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!invalid) setConfirmAdd(true)
  }

  async function add() {
    setBusy(true)
    try {
      const r = await api<{ pinned: Pin; saved: boolean }>('/api/pinned', { method: 'POST', body: { topic: topic.trim(), date, priority, ...(notes.trim() && { notes: notes.trim() }) } })
      toast(r.saved ? 'success' : 'info', r.saved ? `Pinned: ${r.pinned.topic}` : 'Dry run: the pin was checked but not saved')
      setTopic('')
      setDate('')
      setNotes('')
      setPriority('normal')
      setTouched(false)
      void qc.invalidateQueries({ queryKey: ['pinned'] })
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
      setConfirmAdd(false)
    }
  }

  async function cancel(pin: Pin) {
    setBusy(true)
    try {
      await api(`/api/pinned/${encodeURIComponent(pin.pinned_id)}`, { method: 'DELETE' })
      toast('success', `Cancelled: ${pin.topic}`)
      void qc.invalidateQueries({ queryKey: ['pinned'] })
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
      setCancelPin(null)
    }
  }

  const list = pins.data ?? []
  return (
    <>
      <PageHeader title="Pinned topics" subtitle="Topics the Strategist must pick by their date. High priority comes first." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Pinned" className="lg:col-span-2">
          {pins.isPending ? <p className="text-sm text-slate-500">Loading…</p> : !list.length ? <EmptyState>No pinned topics. Add one to make the Strategist cover it by a date.</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" aria-label="Pinned topics">
                <thead className="text-xs text-slate-500"><tr className="border-b border-slate-200 dark:border-slate-800">{['Topic', 'By', 'Priority', 'Status', 'Used by', ''].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.pinned_id} className="border-b border-slate-100 align-top dark:border-slate-800/60">
                      <td className="px-2 py-1.5"><div>{p.topic}</div>{p.notes && <div className="text-xs text-slate-500">{p.notes}</div>}<div className="font-mono text-xs text-slate-400">{p.pinned_id}</div></td>
                      <td className="whitespace-nowrap px-2 py-1.5">{p.target_date}</td>
                      <td className="px-2 py-1.5">{p.priority === 'high' ? <span className="pill pill-red">high</span> : 'normal'}</td>
                      <td className="px-2 py-1.5"><StatusBadge status={p.status} /></td>
                      <td className="px-2 py-1.5 font-mono text-xs">{p.used_by ?? ''}</td>
                      <td className="px-2 py-1.5 text-right">{p.status === 'open' && <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setCancelPin(p)}>Cancel</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Pin a topic">
          <form onSubmit={submit} noValidate className="space-y-3">
            <div>
              <label className="label" htmlFor="pin-topic">Topic</label>
              <textarea id="pin-topic" className="input min-h-20" value={topic} onChange={(e) => setTopic(e.target.value)} />
              <div className="text-right text-xs text-slate-500">{topic.trim().length} / {TOPIC_MAX}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="pin-date">By date</label><input id="pin-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div><label className="label" htmlFor="pin-priority">Priority</label><select id="pin-priority" className="input" value={priority} onChange={(e) => setPriority(e.target.value as 'normal' | 'high')}><option value="normal">normal</option><option value="high">high</option></select></div>
            </div>
            <div><label className="label" htmlFor="pin-notes">Notes (optional)</label><input id="pin-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            {touched && invalid && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{invalid}</p>}
            <button type="submit" className="btn-primary w-full">Pin topic</button>
          </form>
        </Card>
      </div>
      <ConfirmDialog open={confirmAdd} title="Pin this topic?" expectedCalls="0" confirmLabel="Pin" busy={busy} onConfirm={add} onCancel={() => setConfirmAdd(false)}>
        <p>“{topic.trim()}” by {date} ({priority} priority).</p>
      </ConfirmDialog>
      <ConfirmDialog open={Boolean(cancelPin)} title="Cancel this pinned topic?" expectedCalls="0" confirmLabel="Cancel the pin" danger busy={busy} onConfirm={() => (cancelPin ? cancel(cancelPin) : undefined)} onCancel={() => setCancelPin(null)}>
        <p>“{cancelPin?.topic}” will no longer be picked.</p>
      </ConfirmDialog>
    </>
  )
}
