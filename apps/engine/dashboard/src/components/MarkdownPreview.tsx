// Renders a post's Markdown. Raw HTML is never rendered (skipHtml, no rehype-raw), unsafe URLs are dropped
// by react-markdown's default urlTransform, and links open in a new tab with rel="noopener noreferrer".
import { forwardRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline underline-offset-2 dark:text-sky-300" />,
  h1: ({ node: _n, ...props }) => <h1 {...props} className="mt-2 mb-4 text-2xl font-semibold tracking-tight" />,
  h2: ({ node: _n, ...props }) => <h2 {...props} className="mt-8 mb-3 text-xl font-semibold" />,
  h3: ({ node: _n, ...props }) => <h3 {...props} className="mt-6 mb-2 text-lg font-semibold" />,
  p: ({ node: _n, ...props }) => <p {...props} className="my-3 leading-7" />,
  ul: ({ node: _n, ...props }) => <ul {...props} className="my-3 list-disc space-y-1 pl-6" />,
  ol: ({ node: _n, ...props }) => <ol {...props} className="my-3 list-decimal space-y-1 pl-6" />,
  blockquote: ({ node: _n, ...props }) => <blockquote {...props} className="my-4 border-l-4 border-slate-300 pl-4 text-slate-600 dark:border-slate-600 dark:text-slate-300" />,
  code: ({ node: _n, className, ...props }) => <code {...props} className={`rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-800 ${className ?? ''}`} />,
  pre: ({ node: _n, ...props }) => <pre {...props} className="my-4 overflow-x-auto rounded-lg bg-slate-950 p-4 text-sm text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit" />,
  table: ({ node: _n, ...props }) => <div className="my-4 overflow-x-auto"><table {...props} className="w-full border-collapse text-sm" /></div>,
  th: ({ node: _n, ...props }) => <th {...props} className="border border-slate-200 bg-slate-50 px-2 py-1 text-left dark:border-slate-700 dark:bg-slate-800" />,
  td: ({ node: _n, ...props }) => <td {...props} className="border border-slate-200 px-2 py-1 align-top dark:border-slate-700" />,
  hr: () => <hr className="my-6 border-slate-200 dark:border-slate-700" />,
  img: ({ node: _n, alt }) => <span className="text-slate-500">[image: {alt}]</span>
}

export const MarkdownPreview = forwardRef<HTMLDivElement, { markdown: string; className?: string }>(function MarkdownPreview({ markdown, className = '' }, ref) {
  return (
    <div ref={ref} className={`text-[15px] text-slate-800 dark:text-slate-200 ${className}`} data-testid="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>{markdown}</ReactMarkdown>
    </div>
  )
})
