// /exports — the final Markdown exports (Phase 11): one per approved brief, saved on Approve (Mem0 and
// apps/engine/exports/<slug>.md). Pick one to see it rendered, copy it or download the .md file. No AI calls.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, errorMessage } from '../api/client'
import { useSettings } from '../api/queries'
import { flagsOf } from '../config/flags'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { MarkdownExportView } from '../components/MarkdownExportView'
import { fmtDateTime } from '../format'

export type ExportItem = {
  record_id: string; brief_id: string; version: number | null; slug: string; filename: string; title: string; exported_at: string | null
  chars: number; review_score: number | null; status: string | null; docstar_page_id: string | null; docstar_url: string | null
}
type ExportDetail = ExportItem & { markdown: string; front_matter: Record<string, unknown>; warnings: string[] }

const TARGET_TEXT = {
  none: 'Publishing is off (PUBLISH_TARGET=none): these files are the output.',
  embarko: 'Approved posts also go to the blog (PUBLISH_TARGET=embarko).',
  docstar: 'Approved posts go to Docstar (PUBLISH_TARGET=docstar).',
  slack: 'Approved posts go to Slack with a link to download their .md (PUBLISH_TARGET=slack).'
} as const

export default function Exports() {
  const settings = useSettings()
  const flags = flagsOf(settings.data)
  const list = useQuery({ queryKey: ['exports'], queryFn: async () => (await api<{ exports: ExportItem[] }>('/api/exports')).exports })
  const [selected, setSelected] = useState<string | null>(null)
  const chosen = selected ?? list.data?.[0]?.brief_id ?? null
  const detail = useQuery({
    queryKey: ['export', chosen, 'full'],
    queryFn: async () => (await api<{ export: ExportDetail }>(`/api/exports/${chosen}`)).export,
    enabled: Boolean(chosen),
    retry: false
  })
  return (
    <>
      <PageHeader title="Exports" subtitle={<>The final Markdown file of every approved post, ready for Docstar. {settings.data ? TARGET_TEXT[flags.target] : ''}{flags.target === 'docstar' && !flags.docstarConfigured ? ' Docstar is not configured yet (DOCSTAR_* keys).' : ''}</>} />
      {list.error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{errorMessage(list.error)}</p>}
      {list.data && list.data.length === 0 ? (
        <EmptyState>No exports yet. Approve a draft on <Link className="underline" to="/approvals">Approvals</Link>: approving saves its Markdown export. Any reviewed draft's file can also be previewed there.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card title="Approved posts" className="lg:col-span-2">
            <ul className="divide-y divide-slate-200 dark:divide-slate-800" data-testid="export-list">
              {(list.data ?? []).map((e) => (
                <li key={e.brief_id}>
                  <button type="button" onClick={() => setSelected(e.brief_id)} aria-current={e.brief_id === chosen ? 'true' : undefined}
                    className={`w-full px-2 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${e.brief_id === chosen ? 'bg-slate-100 dark:bg-slate-800' : ''}`}>
                    <span className="block font-medium">{e.title}</span>
                    <span className="block text-xs text-slate-500">
                      v{e.version} · {e.review_score != null ? `score ${e.review_score} · ` : ''}{e.exported_at ? fmtDateTime(e.exported_at) : ''}{e.docstar_page_id ? ' · on Docstar' : ''}
                    </span>
                    <span className="block font-mono text-xs text-slate-500">{e.filename}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={detail.data?.title ?? 'Export'} className="lg:col-span-3">
            {detail.isPending && chosen ? <p className="text-sm text-slate-500">Loading…</p>
              : detail.error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{errorMessage(detail.error)}</p>
              : detail.data ? (
                <>
                  <p className="mb-3 text-xs text-slate-500">Brief <Link className="underline" to={`/approvals/${detail.data.brief_id}`}>{detail.data.brief_id}</Link></p>
                  <MarkdownExportView markdown={detail.data.markdown} filename={detail.data.filename} frontMatter={detail.data.front_matter} warnings={detail.data.warnings}
                    downloadHref={`/api/exports/${encodeURIComponent(detail.data.brief_id)}/download`} />
                </>
              ) : null}
          </Card>
        </div>
      )}
    </>
  )
}
