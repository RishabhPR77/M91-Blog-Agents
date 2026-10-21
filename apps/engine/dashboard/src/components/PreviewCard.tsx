// The page preview on an approval (Phase 10 D1): the engine builds the blog with this draft (and its guide) under
// /preview/<brief_id>/ and the page is shown here, exactly as it will look. No AI calls, nothing saved or deployed.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Monitor, Smartphone, RefreshCw } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import { fmtDateTime } from '../format'
import { Card } from './Page'

export type PreviewInfo = {
  brief_id: string
  version: number
  status: string
  slug: string
  url: string
  guide: boolean
  note: string
  built_at: string
  ms: number | null
  warnings: string[]
}

export function PreviewCard({ briefId, version, preview }: { briefId: string; version: number; preview: PreviewInfo | null | undefined }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phone, setPhone] = useState(false)
  // Older engines don't send a preview field: no card.
  if (preview === undefined) return null
  const outdated = preview && preview.version !== version

  async function build() {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/approvals/${briefId}/preview`, { method: 'POST' })
      await qc.invalidateQueries({ queryKey: ['approval', briefId] })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const label = busy ? 'Building the page… (about 20 s)' : preview ? 'Build the preview again' : 'Preview the page'
  return (
    <Card
      title="Page preview"
      actions={preview && (
        <div className="flex items-center gap-1">
          <button type="button" className={`rounded p-1 ${!phone ? 'bg-slate-100 dark:bg-slate-800' : ''}`} aria-label="Desktop width" aria-pressed={!phone} onClick={() => setPhone(false)}><Monitor size={14} /></button>
          <button type="button" className={`rounded p-1 ${phone ? 'bg-slate-100 dark:bg-slate-800' : ''}`} aria-label="Phone width" aria-pressed={phone} onClick={() => setPhone(true)}><Smartphone size={14} /></button>
          <a className="btn-secondary px-2 py-1 text-xs" href={preview.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open in a new tab</a>
        </div>
      )}
    >
      <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">The post as the blog will show it{preview?.guide === false ? '' : ', with its interactive guide'}. Built on this machine only: no AI calls, nothing is saved or published.</p>
      {error && <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {preview && (
        <p className="mb-2 text-xs text-slate-500" data-testid="preview-meta">
          v{preview.version} · {preview.note} · built {fmtDateTime(preview.built_at)}
          {outdated && <span className="ml-1 pill pill-amber" data-testid="preview-outdated">older version: build it again</span>}
        </p>
      )}
      {preview?.warnings?.length ? <ul className="mb-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
      <button type="button" className={`${preview && !outdated ? 'btn-secondary' : 'btn-primary'} w-full`} disabled={busy} onClick={() => void build()}>
        <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {label} · expected AI calls 0
      </button>
      {preview && (
        <div className="mt-3 flex justify-center rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950">
          <iframe key={preview.built_at} title="Page preview" src={preview.url} className="h-[720px] rounded bg-white" style={{ width: phone ? 390 : '100%' }} data-testid="preview-frame" />
        </div>
      )}
    </Card>
  )
}
