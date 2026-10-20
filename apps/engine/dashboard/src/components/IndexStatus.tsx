// The engine's index (Phase 9 A4): its age in the header, and a banner with "Refresh from Mem0" when another
// process (a CLI command) changed Mem0 after it was loaded. A refresh costs one Mem0 read per record type.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import type { IndexStatus as Status } from '../api/types'
import { fmtAgo } from '../format'
import { useNow } from '../state/useRunView'
import { toast } from './Toasts'

function useRefresh() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  async function refresh() {
    setBusy(true)
    try {
      await api('/api/index/refresh', { method: 'POST' })
      await qc.invalidateQueries()
      toast('success', 'Reloaded from Mem0')
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return { refresh, busy }
}

/** "Data loaded 12 min ago" in the header. */
export function IndexAge({ index }: { index?: Status }) {
  const now = useNow(true, 60_000)
  if (!index?.loaded_at) return null
  return (
    <span className="pill pill-gray hidden sm:inline-flex" data-testid="index-age" title={`${index.records} records in memory (${index.types.join(', ')})`}>
      Data loaded {fmtAgo(index.loaded_at, now)}
    </span>
  )
}

/** The out-of-date banner. */
export function IndexBanner({ index, running }: { index?: Status; running: boolean }) {
  const { refresh, busy } = useRefresh()
  if (!index?.out_of_date) return null
  return (
    <div role="alert" data-testid="index-out-of-date" className="flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <span>Data may be out of date: a command outside the dashboard changed Mem0.</span>
      <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => void refresh()} disabled={busy || running} title={running ? 'Wait for the run to finish' : 'One Mem0 read per record type'}>
        <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> {busy ? 'Refreshing…' : 'Refresh from Mem0'}
      </button>
    </div>
  )
}
