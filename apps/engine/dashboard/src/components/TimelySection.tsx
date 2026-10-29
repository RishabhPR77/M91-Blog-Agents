// This week's news on the This week page: fresh events where M91 helps, found by the news check before each run.
// The weekly editor may open a post with one (a hook). Write now makes a card the next post; Dismiss drops it.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Newspaper, PenLine, X } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import { weeklyKey } from '../api/weekly'
import { timelyKey, useTimely, OPEN, type TimelyAction, type TimelyCard } from '../api/timely'
import { ConfirmDialog } from './ConfirmDialog'
import { Card } from './Page'
import { StatusBadge } from './StatusBadge'
import { toast } from './Toasts'
import { COSTS } from '../config/costs'

const URGENCY: Record<TimelyCard['urgency'], string> = { high: 'pill pill-red', medium: 'pill pill-amber', low: 'pill pill-gray' }
const STATUS_TONE: Record<string, string> = { proposed: 'open', write_now: 'running', added_to_roadmap: 'approved', dismissed: 'skipped', written: 'approved', expired: 'skipped' }
const STATUS_LABEL: Record<string, string> = { proposed: 'proposed', write_now: 'write now', added_to_roadmap: 'added to roadmap', dismissed: 'dismissed', written: 'written', expired: 'expired' }

export function TimelySection({ runBusy }: { runBusy: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useTimely()
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function act(card: TimelyCard, action: TimelyAction) {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/timely/${encodeURIComponent(card.opportunity_id)}`, { method: 'POST', body: { action } })
      void qc.invalidateQueries({ queryKey: timelyKey })
      void qc.invalidateQueries({ queryKey: weeklyKey })
      toast('success', action === 'write_now' ? `"${card.title}" will be written next` : 'Dismissed')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function startCheck() {
    setBusy(true)
    setError(null)
    try {
      const { run_id } = await api<{ run_id: string }>('/api/runs', { method: 'POST', body: { mode: 'timely_check', dry_run: false, params: {} } })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      toast('success', 'News check started')
      navigate(`/runs/${run_id}`)
    } catch (e) {
      setError(errorMessage(e))
      setCheck(false)
    } finally {
      setBusy(false)
    }
  }

  const data = q.data
  const cards = data?.opportunities ?? []
  const open = cards.filter((c) => OPEN.includes(c.status))
  const past = cards.filter((c) => !OPEN.includes(c.status))
  const disabled = busy || runBusy
  return (
    <Card title="This week's news" className="mb-4" actions={
      <button type="button" className="btn-secondary" disabled={disabled} onClick={() => setCheck(true)} data-testid="check-news">
        <Newspaper size={14} /> Check news · {COSTS.timely_check.normal} AI call · {COSTS.timely_check.mem0} memory
      </button>
    }>
      <div id="timely" data-testid="timely-section">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Fresh events where M91 helps{data?.settings ? ` (last ${data.settings.window_days} days; at most ${data.settings.max_per_week} timely post${data.settings.max_per_week === 1 ? '' : 's'} per 7 days)` : ''}. The weekly editor may open a post with one; Write now makes it the next post.
        </p>
        {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {data?.waiting && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" data-testid="timely-waiting">“{data.waiting.title}” waits: {data.waiting.reason}.</p>}
        {data?.next && <p className="mb-3 text-sm" data-testid="timely-next"><span className="font-medium">Written next:</span> {data.next.title}</p>}
        {q.isPending ? <p className="text-sm text-slate-500">Loading…</p> : open.length === 0 ? (
          <p className="text-sm text-slate-500" data-testid="timely-empty">No open opportunities. {data?.settings?.check_on_run ? 'Every full run checks the news first, or ' : ''}use Check news.</p>
        ) : (
          <ul className="space-y-3">
            {open.map((c) => (
              <li key={c.opportunity_id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid={`timely-card-${c.opportunity_id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={URGENCY[c.urgency]}>{c.urgency}</span>
                  <StatusBadge status={STATUS_TONE[c.status]} label={STATUS_LABEL[c.status]} />
                  <span className="text-xs text-slate-500">{c.published_date} · {c.outlet}</span>
                </div>
                <p className="mt-1 font-medium">{c.title}</p>
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{c.what_happened}</p>
                <p className="mt-1 text-sm"><span className="font-medium">Why M91:</span> {c.why_m91}</p>
                <p className="mt-1 text-xs text-slate-500">Urgency: {c.urgency_reason}</p>
                <a className="mt-1 inline-flex items-center gap-1 text-xs text-sky-700 underline dark:text-sky-300" href={c.source_url} target="_blank" rel="noopener noreferrer">Source: {c.outlet} <ExternalLink size={12} /></a>
                {c.brief_id ? <p className="mt-2 text-xs text-slate-500">Being written (brief {c.brief_id}).</p> : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {c.status === 'proposed' && <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={disabled} onClick={() => void act(c, 'write_now')}><PenLine size={12} /> Write now</button>}
                    <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={disabled} onClick={() => void act(c, 'dismiss')}><X size={12} /> Dismiss</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-slate-500">Earlier ({past.length})</summary>
            <ul className="mt-2 space-y-1">
              {past.map((c) => <li key={c.opportunity_id} className="flex flex-wrap gap-2"><StatusBadge status={STATUS_TONE[c.status]} label={STATUS_LABEL[c.status]} /><span>{c.title}</span><span className="text-xs text-slate-500">{c.published_date}</span></li>)}
            </ul>
          </details>
        )}
      </div>
      <ConfirmDialog open={check} title="Check the news?" expectedCalls={COSTS.timely_check.normal} expectedMem0={COSTS.timely_check.mem0} confirmLabel="Check news" busy={busy} onConfirm={startCheck} onCancel={() => setCheck(false)}>
        <p>One web search for real events of the last {data?.settings?.window_days ?? 7} days where M91 genuinely helps. Sources are checked, and known events are skipped.</p>
        <p>New events show up here as cards. Nothing is written until you click Write now. Each new card is one memory add.</p>
      </ConfirmDialog>
    </Card>
  )
}
