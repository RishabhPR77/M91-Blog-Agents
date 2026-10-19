// /lessons — what the Reviewer (and your topic rejections) taught the agents, newest first, with delete.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { toast } from '../components/Toasts'
import type { TrimmedRecord } from './Content'

export default function Lessons() {
  const qc = useQueryClient()
  const lessons = useQuery({ queryKey: ['records', 'type=lesson&limit=200'], queryFn: async () => (await api<{ records: TrimmedRecord[] }>('/api/records?type=lesson&limit=200')).records })
  const [del, setDel] = useState<TrimmedRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const list = [...(lessons.data ?? [])].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))

  async function remove(l: TrimmedRecord) {
    setBusy(true)
    try {
      await api(`/api/lessons/${encodeURIComponent(l.id)}`, { method: 'DELETE' })
      toast('success', 'Lesson deleted')
      void qc.invalidateQueries({ queryKey: ['records', 'type=lesson&limit=200'] })
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
      setDel(null)
    }
  }

  return (
    <>
      <PageHeader title="Lessons" subtitle="The Strategist and Writer read the newest lessons on every run." />
      <Card>
        {lessons.isPending ? <p className="text-sm text-slate-500">Loading…</p> : !list.length ? <EmptyState>No lessons yet. The Reviewer saves lessons as it reviews drafts.</EmptyState> : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" aria-label="Lessons">
            {list.map((l) => (
              <li key={l.id} className="flex items-start gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div>{l.title ?? <span className="text-slate-400">(text not in the list: restart the engine, or <Link to={`/records/${l.id}`} className="underline">open it</Link>)</span>}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{l.date ?? ''}{l.brief_id ? <> · brief <span className="font-mono">{l.brief_id}</span></> : null}</div>
                </div>
                <button type="button" className="btn-ghost text-red-600 dark:text-red-400" aria-label="Delete lesson" onClick={() => setDel(l)}><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog open={Boolean(del)} title="Delete this lesson?" expectedCalls="0" confirmLabel="Delete" danger busy={busy} onConfirm={() => (del ? remove(del) : undefined)} onCancel={() => setDel(null)}>
        <p>“{del?.title ?? del?.id}” is removed from memory, so the agents stop reading it. This cannot be undone.</p>
      </ConfirmDialog>
    </>
  )
}
