// A Markdown export (Phase 11): its front matter as a small table, the file rendered (the same safe renderer as
// the drafts: no raw HTML), and the two actions — Copy Markdown and Download .md. The file is copied and
// downloaded exactly as the engine built it.
import { useState } from 'react'
import { Copy, Download, FileText } from 'lucide-react'
import { MarkdownPreview } from './MarkdownPreview'

/** The file without its YAML front matter (what a reader sees). */
export const bodyOf = (markdown: string) => markdown.replace(/^---\n[\s\S]*?\n---\n+/, '')

export function MarkdownExportView({ markdown, filename, frontMatter, downloadHref, warnings = [] }: {
  markdown: string
  filename: string
  frontMatter?: Record<string, unknown>
  downloadHref: string
  warnings?: string[]
}) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const [raw, setRaw] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied('done')
    } catch {
      setCopied('failed')
    }
    setTimeout(() => setCopied('idle'), 2000)
  }
  return (
    <div data-testid="markdown-export">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 dark:text-slate-300"><FileText size={14} />{filename}</span>
        <span className="text-xs text-slate-500">{markdown.length.toLocaleString('en-US')} characters</span>
        <span className="flex-1" />
        <button type="button" className="btn-secondary py-1.5 text-xs" onClick={() => setRaw((r) => !r)}>{raw ? 'Show rendered' : 'Show Markdown'}</button>
        <button type="button" className="btn-secondary py-1.5 text-xs" onClick={() => void copy()} data-testid="copy-markdown">
          <Copy size={14} /> {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy Markdown'}
        </button>
        <a className="btn-primary py-1.5 text-xs" href={downloadHref} download={filename} data-testid="download-markdown"><Download size={14} /> Download .md</a>
      </div>
      {warnings.length > 0 && (
        <ul className="mb-3 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      {frontMatter && (
        <dl className="mb-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700" data-testid="front-matter">
          {Object.entries(frontMatter).map(([k, v]) => (
            <div key={k} className="contents"><dt className="font-mono text-slate-500">{k}</dt><dd className="break-words">{Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '—' : String(v)}</dd></div>
          ))}
        </dl>
      )}
      {raw
        ? <pre className="max-h-[70vh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100" data-testid="raw-markdown">{markdown}</pre>
        : <MarkdownPreview markdown={bodyOf(markdown)} />}
    </div>
  )
}
