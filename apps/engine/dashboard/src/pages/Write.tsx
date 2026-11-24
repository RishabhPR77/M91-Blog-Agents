// /write — posts you write yourself for the M91 blog (2026-11-24): start one (or drop a .md file), open your drafts and
// published posts. And the engine's approved posts: each new one waits here for your OK before it goes on the website
// (the blog and m91.msg91.com/guides), and any of them can be taken off or put back (components/WebsiteGate.tsx).
import { useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ExternalLink, FileUp, PenLine, Plus } from 'lucide-react'
import { Card, EmptyState, PageHeader, PageSkeleton } from '../components/Page'
import { EnginePostsList, WebsiteWaitingList, useBlogPosts } from '../components/WebsiteGate'
import { toast } from '../components/Toasts'
import { fmtDateTime } from '../format'
import { isMarkdownFile } from '../write/edit'

export { useBlogPosts } from '../components/WebsiteGate'
export type { BlogPostSummary, BlogList, EnginePost } from '../components/WebsiteGate'

/** A dropped or chosen .md file opens a new post with it (the editor reads it from the navigation state). */
export function useMarkdownFileOpener() {
  const navigate = useNavigate()
  return async (file: File | undefined) => {
    if (!file) return
    if (!isMarkdownFile(file)) return toast('error', `${file.name} is not a Markdown file (.md)`)
    if (file.size > 400_000) return toast('error', `${file.name} is too large for one post`)
    navigate('/write/new', { state: { import: { name: file.name, text: await file.text() } } })
  }
}

export function StatusPill({ status }: { status: 'draft' | 'published' }) {
  return status === 'published' ? <span className="pill pill-green">On the blog</span> : <span className="pill pill-gray">Draft</span>
}

export default function Write() {
  const q = useBlogPosts()
  const open = useMarkdownFileOpener()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    void open(e.dataTransfer.files[0])
  }

  if (q.isPending) return <PageSkeleton />
  const data = q.data
  const blogUrl = data?.blog_url ?? 'https://m91-blog.embarko.app'
  return (
    <>
      <PageHeader
        eyebrow="M91 blog"
        title="Write"
        subtitle={<>Paste or upload a Markdown post, add images, see the blog page as you type, and publish it to <a className="link" href={blogUrl} target="_blank" rel="noopener noreferrer">{blogUrl.replace('https://', '')}</a>.</>}
        actions={<Link to="/write/new" className="btn-primary"><Plus size={15} /> New post</Link>}
      />

      {data && <WebsiteWaitingList posts={data.engine_posts} />}

      <div
        className={`mb-14 flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors ${over ? 'border-lime-500 bg-hl-tint' : 'border-line-strong bg-surface/60'}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        data-testid="write-drop"
      >
        <FileUp size={26} className="text-ink-3" />
        <p className="font-serif text-[20px] font-semibold text-ink">Drop a .md file here to start a post</p>
        <p className="max-w-md text-sm text-ink-2">Its front matter (title, description, tags) fills the post’s details. Or start empty and paste your Markdown.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => input.current?.click()}><FileUp size={15} /> Choose a .md file</button>
          <Link to="/write/new" className="btn-secondary"><PenLine size={15} /> Start empty</Link>
        </div>
        <input ref={input} type="file" accept=".md,.markdown,.mdx,.txt,text/markdown" className="hidden" onChange={(e) => { void open(e.target.files?.[0]); e.target.value = '' }} aria-label="Choose a Markdown file" />
      </div>

      <Card title="Your posts">
        {q.isError ? <EmptyState>The posts could not be loaded. Try again in a moment.</EmptyState> : !data?.posts.length ? (
          <EmptyState>No posts yet. Start one above.</EmptyState>
        ) : (
          <ul className="divide-y divide-line" data-testid="write-list">
            {data.posts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                <div className="min-w-0 flex-1">
                  <Link to={`/write/${p.id}`} className="font-serif text-[18px] leading-snug font-semibold text-ink hover:underline">{p.title || 'Untitled post'}</Link>
                  <p className="mt-1 text-xs text-ink-3">{[p.topic, p.updated_at ? `edited ${fmtDateTime(p.updated_at)}` : null].filter(Boolean).join(' · ')}</p>
                </div>
                <StatusPill status={p.status} />
                <Link to={`/write/${p.id}`} className="btn-secondary">Edit</Link>
                {p.status === 'published' && <a className="btn-ghost" href={`${blogUrl}/posts/${p.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${p.title} on the blog`}><ExternalLink size={15} /></a>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data?.engine_posts.length ? (
        <Card title="From the engine" className="mt-12">
          <p className="-mt-2 mb-4 text-sm text-ink-2">Posts the engine’s runs approved. Each new one waits for your OK before it goes on the blog and m91.msg91.com/guides; you can take any of them off. Their text is edited on the Review page, not here.</p>
          <EnginePostsList posts={data.engine_posts} blogUrl={blogUrl} />
        </Card>
      ) : null}
    </>
  )
}
