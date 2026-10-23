// /memory — everything the engine keeps in Mem0, with counts per type, filters, why a record may no longer be
// useful, and delete (one or a selection). Lists come from the engine's index (0 Mem0 requests); each delete is 1.
import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Trash2 } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { StatusBadge } from '../components/StatusBadge'
import { toast } from '../components/Toasts'

export const TYPE_LABELS: Record<string, string> = {
  brief: 'Briefs', draft: 'Drafts', review: 'Reviews', markdown_export: 'Exports', run: 'Runs', run_log: 'Run logs', lesson: 'Lessons',
  m91_facts: 'M91 facts', tone_profile: 'Style notes', question_cluster: 'Question clusters', story_lead: 'Stories', tutorial_lead: 'Tutorials',
  source_pack: 'Source packs', timely_opportunity: 'Timely opportunities', roadmap: 'Roadmap', pinned_topic: 'Pinned topics', knowledge: 'Knowledge',
  published_post: 'Blog posts', promo_pack: 'Promo packs', guide_doc: 'Guides', block_doc: 'Block docs', setting: 'Settings', lock: 'Locks', unknown: 'Unknown'
}
const label = (t: string) => TYPE_LABELS[t] ?? t

export type Reason = { code: string; text: string }
export type MemoryRow = {
  id: string; type: string; status: string | null; brief_id: string | null; date: string | null; version: number | null; key_id: string | null; title: string | null
  created_at: string | null; age_days: number | null; reasons: Reason[]; protection: 'never' | 'confirm' | null; protection_reason: string | null
}
export type MemoryList = {
  counts: Record<string, { total: number; not_useful: number; statuses: Record<string, number> }>
  total: number; not_useful: number; matched: number; records: MemoryRow[]; stale_days: number
  not_loaded: string[]; dry_run: boolean; mem0_requests: number
}

export default function Memory() {
  const qc = useQueryClient()
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [briefId, setBriefId] = useState('')
  const [after, setAfter] = useState('')
  const [before, setBefore] = useState('')
  const [q, setQ] = useState('')
  const [notUseful, setNotUseful] = useState(false)
  const [staleDays, setStaleDays] = useState('30')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toDelete, setToDelete] = useState<MemoryRow[] | null>(null)
  const [loadAllOpen, setLoadAllOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const query = useDeferredValue(q.trim())

  const qs = new URLSearchParams(Object.entries({ type, status, brief_id: briefId.trim(), after, before, q: query, not_useful: notUseful ? 'true' : '', stale_days: staleDays === '30' ? '' : staleDays }).filter(([, v]) => v)).toString()
  const list = useQuery({ queryKey: ['memory', qs], queryFn: () => api<MemoryList>(`/api/memory${qs ? `?${qs}` : ''}`), placeholderData: (prev) => prev })
  const data = list.data
  const rows = data?.records ?? []
  const types = useMemo(() => Object.entries(data?.counts ?? {}).sort((a, b) => b[1].total - a[1].total), [data])
  const statuses = type ? Object.keys(data?.counts[type]?.statuses ?? {}) : []
  const deletable = rows.filter((r) => r.protection !== 'never')
  const allChosen = deletable.length > 0 && deletable.every((r) => selected.has(r.id))

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function pickType(t: string) {
    setType(t === type ? '' : t)
    setStatus('')
  }

  async function remove(items: MemoryRow[]) {
    setBusy(true)
    try {
      const res = await api<{ deleted: string[]; failed: { id: string; error: string }[]; mem0_requests: number }>('/api/records', {
        method: 'DELETE', body: { ids: items.map((r) => r.id), confirm_protected: items.some((r) => r.protection === 'confirm') }
      })
      toast(res.failed.length ? 'error' : 'success', `Deleted ${res.deleted.length} record${res.deleted.length === 1 ? '' : 's'}${res.failed.length ? `, ${res.failed.length} failed` : ''} · ${res.mem0_requests} Mem0 request${res.mem0_requests === 1 ? '' : 's'}`)
      setSelected((s) => new Set([...s].filter((id) => !res.deleted.includes(id))))
      void qc.invalidateQueries({ queryKey: ['memory'] })
      void qc.invalidateQueries({ queryKey: ['records'] })
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
      setToDelete(null)
    }
  }

  async function loadAll() {
    setBusy(true)
    try {
      const res = await api<{ mem0_requests: number }>('/api/memory/load-all', { method: 'POST' })
      toast('success', `Every type loaded · ${res.mem0_requests} Mem0 request${res.mem0_requests === 1 ? '' : 's'}`)
      void qc.invalidateQueries({ queryKey: ['memory'] })
      void qc.invalidateQueries({ queryKey: ['health'] })
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
      setLoadAllOpen(false)
    }
  }

  const protectedCount = toDelete?.filter((r) => r.protection === 'confirm').length ?? 0

  return (
    <>
      <PageHeader title="Memory" subtitle="What the engine keeps in Mem0, why a record may no longer be useful, and clean-up." />
      <p className="mb-3 text-xs text-slate-500" data-testid="memory-cost">
        This list: 0 Mem0 requests (served from the engine's index). Each delete: 1 Mem0 request.
      </p>
      {data?.not_loaded.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40" data-testid="not-loaded">
          <span>{data.not_loaded.length} type{data.not_loaded.length === 1 ? ' is' : 's are'} not loaded yet: {data.not_loaded.map(label).join(', ')}.</span>
          <button type="button" className="btn-secondary py-1" onClick={() => setLoadAllOpen(true)}>Load all types</button>
        </div>
      ) : null}
      {data?.dry_run && <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">DRY_RUN is on: deletes are refused (Mem0 writes are skipped).</p>}

      <div className="mb-4 flex flex-wrap gap-1" aria-label="Record types">
        <button type="button" aria-pressed={!type} onClick={() => pickType('')} className={`rounded-lg px-3 py-1.5 text-sm ${!type ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
          All <span className="opacity-70">{data?.total ?? ''}</span>
        </button>
        {types.map(([t, c]) => (
          <button key={t} type="button" aria-pressed={t === type} onClick={() => pickType(t)}
            className={`rounded-lg px-3 py-1.5 text-sm ${t === type ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            {label(t)} <span className="opacity-70">{c.total}</span>{c.not_useful ? <span className="ml-1 text-amber-600 dark:text-amber-400" title="probably not useful">·{c.not_useful}</span> : null}
          </button>
        ))}
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input aria-label="Search titles" className="input w-56 py-1.5" placeholder="Search title or id" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Status" className="input w-auto py-1.5" value={status} onChange={(e) => setStatus(e.target.value)} disabled={!type}>
            <option value="">Status: all</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input aria-label="Brief id" className="input w-48 py-1.5" placeholder="Brief id (exact)" value={briefId} onChange={(e) => setBriefId(e.target.value)} />
          <label className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">After <input aria-label="Created after" type="date" className="input w-auto py-1" value={after} onChange={(e) => setAfter(e.target.value)} /></label>
          <label className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">Before <input aria-label="Created before" type="date" className="input w-auto py-1" value={before} onChange={(e) => setBefore(e.target.value)} /></label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={notUseful} onChange={(e) => setNotUseful(e.target.checked)} /> Probably not useful
          </label>
          <label className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
            Old after
            <select aria-label="Old after days" className="input w-auto py-1" value={staleDays} onChange={(e) => setStaleDays(e.target.value)}>
              {['7', '14', '30', '60', '90'].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-500">{data ? `Showing ${rows.length} of ${data.matched}` : ''}</span>
          <button type="button" className="btn-danger py-1" disabled={!selected.size || busy} onClick={() => setToDelete(rows.filter((r) => selected.has(r.id)))}>
            Delete selected ({selected.size})
          </button>
          {selected.size > 0 && <button type="button" className="text-slate-500 underline" onClick={() => setSelected(new Set())}>Clear selection</button>}
        </div>

        {list.isPending ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : list.isError ? (
          <p role="alert" className="text-sm text-red-600">{errorMessage(list.error)}</p>
        ) : !rows.length ? (
          <EmptyState>{notUseful ? 'Nothing here looks unused. 🎉' : 'Nothing matches these filters.'}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Memory records">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-2 py-1.5"><input type="checkbox" aria-label="Select all shown" checked={allChosen} onChange={() => setSelected(allChosen ? new Set() : new Set(deletable.map((r) => r.id)))} /></th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium">Title / text</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 font-medium">Brief</th>
                  <th className="px-2 py-1.5 font-medium">Created</th>
                  <th className="px-2 py-1.5 font-medium">Why it may not be useful</th>
                  <th className="px-2 py-1.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top dark:border-slate-800/60">
                    <td className="px-2 py-1.5">
                      {r.protection === 'never'
                        ? <span title={`Protected: ${r.protection_reason}`}><Lock size={14} className="text-slate-400" aria-label={`Protected: ${r.protection_reason}`} /></span>
                        : <input type="checkbox" aria-label={`Select ${r.title ?? r.id}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{label(r.type)}{r.version != null ? <span className="text-slate-500"> v{r.version}</span> : null}</td>
                    <td className="px-2 py-1.5">
                      <Link to={`/records/${r.id}`} className="hover:underline">{r.title || <span className="font-mono text-xs text-slate-400">{r.key_id ?? r.id.slice(0, 8)}</span>}</Link>
                      {r.protection === 'confirm' && <div className="text-xs text-slate-500"><Lock size={11} className="inline" /> {r.protection_reason} (extra confirm)</div>}
                    </td>
                    <td className="px-2 py-1.5"><StatusBadge status={r.status} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{r.brief_id ?? ''}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{r.created_at?.slice(0, 10) ?? r.date ?? ''}{r.age_days != null && <div className="text-xs text-slate-500">{r.age_days} d ago</div>}</td>
                    <td className="px-2 py-1.5">
                      {r.reasons.length ? <ul className="space-y-0.5">{r.reasons.map((x) => <li key={x.code} className="text-xs text-amber-700 dark:text-amber-300">{x.text}</li>)}</ul> : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.protection !== 'never' && (
                        <button type="button" aria-label={`Delete ${r.title ?? r.id}`} className="text-slate-400 hover:text-red-600" onClick={() => setToDelete([r])}><Trash2 size={15} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={`Delete ${toDelete?.length ?? 0} record${toDelete?.length === 1 ? '' : 's'} from Mem0?`}
        expectedCalls="0"
        expectedMem0={`${toDelete?.length ?? 0} (1 delete each; no reads)`}
        confirmLabel="Delete"
        danger
        busy={busy}
        requireTick={protectedCount ? `I understand ${protectedCount} protected record${protectedCount === 1 ? '' : 's'} will be deleted too.` : undefined}
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
        onCancel={() => setToDelete(null)}
      >
        <p>This cannot be undone.</p>
        <ul className="max-h-60 space-y-1 overflow-y-auto" aria-label="Records to delete">
          {toDelete?.map((r) => (
            <li key={r.id} className="text-xs">
              <strong>{label(r.type)}</strong> {r.title || r.key_id || r.id.slice(0, 8)}
              {r.protection === 'confirm' && <span className="text-red-600"> · protected: {r.protection_reason}</span>}
              {r.reasons.length ? <span className="text-slate-500"> · {r.reasons.map((x) => x.text).join('; ')}</span> : null}
            </li>
          ))}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={loadAllOpen}
        title="Load every record type from Mem0?"
        expectedCalls="0"
        expectedMem0="about 1 per 100 records (one paged list of the whole agent)"
        confirmLabel="Load all"
        busy={busy}
        onConfirm={loadAll}
        onCancel={() => setLoadAllOpen(false)}
      >
        <p>Loads clusters, stories, tutorials, facts, style notes, source packs, guides, the roadmap and every other type into the engine's index. After this, every view here costs 0 requests.</p>
      </ConfirmDialog>
    </>
  )
}
