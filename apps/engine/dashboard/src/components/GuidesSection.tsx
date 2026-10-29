// The M91 guides already live on msg91.com/guide (whoever wrote them), on the This week page. The engine reads them
// before each full run; "Sync guides" reads them now (0 AI calls, one memory add per new guide). The weekly editor
// never repeats them, and posts link to them.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import { useGuides } from '../api/weekly'
import { Card } from './Page'
import { ConfirmDialog } from './ConfirmDialog'
import { toast } from './Toasts'
import { COSTS } from '../config/costs'
import { fmtDateTime } from '../format'

export function GuidesSection({ runBusy }: { runBusy: boolean }) {
  const q = useGuides()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guides = q.data?.guides ?? []

  async function sync() {
    setBusy(true)
    setError(null)
    try {
      const { run_id } = await api<{ run_id: string }>('/api/runs', { method: 'POST', body: { mode: 'guides', dry_run: false, params: {} } })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      toast('success', 'Guide sync started')
      navigate(`/runs/${run_id}`)
    } catch (e) {
      setError(errorMessage(e))
      setConfirm(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      className="mb-4"
      title="Published guides"
      actions={<button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy || runBusy} title={runBusy ? 'A run is in progress' : undefined} onClick={() => setConfirm(true)}><RefreshCw size={12} /> Sync guides · {COSTS.guides.normal} AI calls</button>}
    >
      <div data-testid="guides-section">
        <p className="mb-2 text-xs text-slate-500">The M91 guides already live on msg91.com/guide. The agents link them and never re-explain them, and the weekly editor never writes them again. They are read before each full run.</p>
        {error && <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
        {q.isPending ? <p className="text-sm text-slate-500">Loading…</p> : guides.length === 0 ? <p className="text-sm text-slate-500">No guides known yet. Sync them, or start a full run (it reads them first).</p> : (
          <ul className="space-y-1.5 text-sm">
            {guides.map((g) => (
              <li key={g.url} className="flex flex-wrap items-center gap-2" data-testid="guide-row">
                <a className="inline-flex items-center gap-1 text-sky-700 underline dark:text-sky-300" href={g.url} target="_blank" rel="noreferrer">{g.title} <ExternalLink size={11} /></a>
                {g.published_at && <span className="text-xs text-slate-500">{fmtDateTime(g.published_at)}</span>}
                {g.words ? <span className="text-xs text-slate-500">{g.words.toLocaleString('en-US')} words</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog open={confirm} title="Sync the published guides?" expectedCalls={COSTS.guides.normal} expectedMem0={COSTS.guides.mem0} confirmLabel="Sync" busy={busy} onConfirm={sync} onCancel={() => setConfirm(false)}>
        <p>Reads msg91.com/guide and saves each new M91 guide (no AI; one memory add per new guide). Posts about other MSG91 products are ignored.</p>
      </ConfirmDialog>
    </Card>
  )
}
