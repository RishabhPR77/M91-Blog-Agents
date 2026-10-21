// The Markdown export on an approval (Phase 11): for any reviewed draft, the Docstar-ready file built now (no AI
// calls, nothing saved), with Copy and Download. After you approve, the final export is saved too (Mem0 and
// apps/engine/exports) and listed on the Exports page.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, errorMessage, isApiError } from '../api/client'
import { fmtDateTime } from '../format'
import { Card } from './Page'
import { MarkdownExportView } from './MarkdownExportView'

type ExportPreview = { version: number; filename: string; markdown: string; front_matter: Record<string, unknown>; warnings: string[] }
type FinalExport = { version: number; filename: string; exported_at: string | null }

export function ExportCard({ briefId, version, status }: { briefId: string; version: number; status: string }) {
  const [open, setOpen] = useState(false)
  const preview = useQuery({
    queryKey: ['export-preview', briefId, version],
    queryFn: () => api<ExportPreview>(`/api/approvals/${briefId}/markdown?version=${version}`),
    enabled: open,
    retry: false
  })
  const final = useQuery({
    queryKey: ['export', briefId],
    queryFn: async () => {
      try {
        return (await api<{ export: FinalExport }>(`/api/exports/${briefId}`)).export
      } catch (e) {
        if (isApiError(e) && e.status === 404) return null
        throw e
      }
    },
    retry: false
  })
  const saved = final.data
  return (
    <Card title="Markdown export" actions={saved ? <span className="pill pill-green">Final export saved</span> : undefined}>
      <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
        {saved
          ? <>Saved {saved.exported_at ? fmtDateTime(saved.exported_at) : ''} from v{saved.version} as <span className="font-mono text-xs">{saved.filename}</span>. See <Link className="underline" to="/exports">Exports</Link>.</>
          : status === 'approved' || status === 'published'
            ? 'Approved, but no final export is saved yet (it may have failed): see the run, or use npm run export -- --save.'
            : 'The Docstar-ready Markdown file of this version. Approving saves it as the final export.'}
      </p>
      {!open ? (
        <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)} data-testid="show-export">Show the Markdown · expected AI calls 0</button>
      ) : preview.isPending ? (
        <p className="text-sm text-slate-500">Building…</p>
      ) : preview.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{errorMessage(preview.error)}</p>
      ) : preview.data ? (
        <MarkdownExportView markdown={preview.data.markdown} filename={preview.data.filename} frontMatter={preview.data.front_matter} warnings={preview.data.warnings}
          downloadHref={`/api/approvals/${encodeURIComponent(briefId)}/markdown?version=${version}&format=md&download=1`} />
      ) : null}
    </Card>
  )
}
