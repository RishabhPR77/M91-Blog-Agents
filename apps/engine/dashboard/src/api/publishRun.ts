// Starting a Publisher run (Phase 7): publish, unpublish, set_index, rebuild_blog, plus a Designer re-run
// (Phase 8, the only one with AI calls: 1–2). The Publisher modes use no AI; every run
// takes the engine's run lock like any other run, so a 409 means another run is in progress.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorMessage, isApiError } from './client'
import { toast } from '../components/Toasts'

export type PublishMode = 'publish' | 'unpublish' | 'set_index' | 'rebuild_blog' | 'designer'

export const PUBLISH_LABEL: Record<PublishMode, string> = { publish: 'Publish', unpublish: 'Unpublish', set_index: 'Search visibility', rebuild_blog: 'Rebuild blog', designer: 'Designer' }

/** start(mode, params, dryRun) posts /api/runs and opens the live run page; errors become a message. */
export function usePublishRun() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function start(mode: PublishMode, params: Record<string, unknown>, dryRun: boolean) {
    setBusy(true)
    setError(null)
    try {
      const { run_id } = await api<{ run_id: string }>('/api/runs', { method: 'POST', body: { mode, dry_run: dryRun, params } })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      void qc.invalidateQueries({ queryKey: ['health'] })
      toast('success', `${PUBLISH_LABEL[mode]} started`)
      navigate(`/runs/${run_id}`)
      return true
    } catch (e) {
      setError(isApiError(e) ? e.message : errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { start, busy, error, clearError: () => setError(null) }
}
