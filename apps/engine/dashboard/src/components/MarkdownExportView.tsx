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
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-2"><FileText size={14} />{filename}</span>
        <span className="text-xs text-ink-3">{markdown.length.toLocaleString('en-US')} characters</span>
        <span className="flex-1" />
        <div className="inline-flex rounded-full bg-ink/[0.05] p-1 text-xs font-medium" role="group" aria-label="View">
          <button type="button" className={`rounded-full px-3 py-1.5 transition-all ${!raw ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`} aria-pressed={!raw} onClick={() => setRaw(false)}>Read</button>
          <button type="button" className={`rounded-full px-3 py-1.5 transition-all ${raw ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`} aria-pressed={raw} onClick={() => setRaw(true)}>Markdown</button>
        </div>
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => void copy()} data-testid="copy-markdown">
          <Copy size={14} /> {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy Markdown'}
        </button>
        <a className="btn-primary px-3.5 py-1.5 text-xs" href={downloadHref} download={filename} data-testid="download-markdown"><Download size={14} /> Download .md</a>
      </div>
      {warnings.length > 0 && (
        <ul className="mb-3 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      {frontMatter && (
        <dl className="mx-auto mb-12 grid max-w-[680px] grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 border-y border-line py-4 text-xs" data-testid="front-matter">
          {Object.entries(frontMatter).map(([k, v]) => (
            <div key={k} className="contents"><dt className="font-mono text-ink-3">{k}</dt><dd className="break-words text-ink-2">{Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '—' : String(v)}</dd></div>
          ))}
        </dl>
      )}
      {raw
        ? <pre className="mx-auto max-h-[75vh] max-w-[760px] animate-fade overflow-auto rounded-2xl bg-[#0b0e12] p-6 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-[#e8eaed]" data-testid="raw-markdown">{markdown}</pre>
        : <MarkdownPreview variant="article" className="mx-auto max-w-[680px] animate-fade" markdown={bodyOf(markdown)} />}
    </div>
  )
}
