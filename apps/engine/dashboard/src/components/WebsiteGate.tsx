// Your OK for the website (2026-11-24). Runs still approve and email each post automatically; an approved post then
// waits here until you put it on the website (the M91 blog and m91.msg91.com/guides) or keep it off. Asked on the
// dashboard only: a badge on "Write" in the menu, this list on the Write page and a banner on the post's own page.
// Never an M91 alert. Posts approved before 2026-11-24 count as on the website.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import { toast } from './Toasts'

export type WebsiteState = 'on' | 'waiting' | 'off'
export type EnginePost = { slug: string; title: string; description: string; date: string | null; topic: string | null; reading_minutes: number; brief_id: string; website: WebsiteState }
export type BlogPostSummary = {
  id: string
  status: 'draft' | 'published'
  title: string
  slug: string
  description: string
  topic: string | null
  tags: string[]
  cover: string | null
  created_at: string | null
  updated_at: string | null
  published_at: string | null
}
export type BlogList = { posts: BlogPostSummary[]; engine_posts: EnginePost[]; website_waiting: number; topics: string[]; blog_url: string }

/** The Write page's list (your posts, the engine's posts and how many wait for your OK); one cache for every user of it. */
export const useBlogPosts = (enabled = true) => useQuery({ queryKey: ['blog-posts'], queryFn: () => api<BlogList>('/api/blog/posts'), enabled, staleTime: 30_000, refetchInterval: 120_000 })

/** Puts an approved post on the website, or keeps it off. */
export function useWebsiteOk() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  async function set(post: Pick<EnginePost, 'brief_id' | 'title'>, on: boolean) {
    setBusy(post.brief_id)
    try {
      await api(`/api/blog/engine-posts/${post.brief_id}/website`, { method: 'POST', body: { on } })
      toast('success', on ? `"${post.title}" is going on the website (the blog within a minute, m91.msg91.com/guides within the hour).` : `"${post.title}" is kept off the website.`)
      await qc.invalidateQueries({ queryKey: ['blog-posts'] })
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  return { set, busy }
}

export function WebsitePill({ state }: { state: WebsiteState }) {
  if (state === 'on') return <span className="pill pill-green">On the website</span>
  if (state === 'waiting') return <span className="pill pill-amber">Waiting for your OK</span>
  return <span className="pill pill-gray">Kept off</span>
}

/** The Write page's "Waiting for your OK" section (nothing when no post waits). */
export function WebsiteWaitingList({ posts }: { posts: EnginePost[] }) {
  const { set, busy } = useWebsiteOk()
  const waiting = posts.filter((p) => p.website === 'waiting')
  if (!waiting.length) return null
  return (
    <section className="mb-14 rounded-3xl border border-lime-400/60 bg-hl-tint px-5 py-6 sm:px-7" aria-labelledby="website-waiting-h" data-testid="website-waiting">
      <p className="eyebrow mb-2">Waiting for your OK</p>
      <h2 id="website-waiting-h" className="font-serif text-[24px] leading-tight font-semibold text-ink">{waiting.length === 1 ? 'A new post is ready for the website' : `${waiting.length} new posts are ready for the website`}</h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">The engine approved {waiting.length === 1 ? 'it' : 'them'} and emailed {waiting.length === 1 ? 'it' : 'them'} to you. {waiting.length === 1 ? 'It goes' : 'They go'} on the blog and m91.msg91.com/guides only when you say so.</p>
      <ul className="mt-5 divide-y divide-lime-500/20">
        {waiting.map((p) => (
          <li key={p.brief_id} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
            <div className="min-w-0 flex-1">
              <Link to={`/approvals/${p.brief_id}`} className="font-serif text-[18px] leading-snug font-semibold text-ink hover:underline">{p.title}</Link>
              <p className="mt-1 text-xs text-ink-3">{[p.topic, p.date, `${p.reading_minutes} min read`].filter(Boolean).join(' · ')}</p>
            </div>
            <Link to={`/approvals/${p.brief_id}`} className="btn-ghost text-sm">Read it</Link>
            <button type="button" className="btn-secondary" disabled={busy === p.brief_id} onClick={() => void set(p, false)}>Keep off</button>
            <button type="button" className="btn-primary" disabled={busy === p.brief_id} onClick={() => void set(p, true)}>Put on the website</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Every approved post from the engine, with its place on the website and the switch. */
export function EnginePostsList({ posts, blogUrl }: { posts: EnginePost[]; blogUrl: string }) {
  const { set, busy } = useWebsiteOk()
  return (
    <ul className="divide-y divide-line" data-testid="engine-posts">
      {posts.map((p) => (
        <li key={p.brief_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <Link to={`/approvals/${p.brief_id}`} className="min-w-0 flex-1 text-[15px] text-ink hover:underline">{p.title}</Link>
          <span className="text-xs text-ink-3">{[p.topic, p.date].filter(Boolean).join(' · ')}</span>
          <WebsitePill state={p.website} />
          {p.website === 'on'
            ? <button type="button" className="btn-secondary" disabled={busy === p.brief_id} onClick={() => void set(p, false)}>Take off</button>
            : <button type="button" className="btn-secondary" disabled={busy === p.brief_id} onClick={() => void set(p, true)}>Put on the website</button>}
          {p.website === 'on' && <a className="btn-ghost" href={`${blogUrl}/posts/${p.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${p.title} on the blog`}><ExternalLink size={15} /></a>}
        </li>
      ))}
    </ul>
  )
}

/** On a post's own page: where it stands on the website, with the switch (nothing until the post is approved). */
export function WebsiteGateBanner({ briefId }: { briefId: string }) {
  const q = useBlogPosts()
  const { set, busy } = useWebsiteOk()
  const p = q.data?.engine_posts.find((x) => x.brief_id === briefId)
  if (!p) return null
  const tone = p.website === 'waiting' ? 'border-lime-400/60 bg-hl-tint' : 'border-line bg-surface'
  return (
    <div role="status" className={`mb-10 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${tone}`} data-testid="website-gate">
      <WebsitePill state={p.website} />
      <span className="min-w-0 flex-1 text-ink-2">
        {p.website === 'waiting' ? 'Approved and emailed. It goes on the blog and m91.msg91.com/guides only when you say so.' : p.website === 'on' ? 'Shown on the blog and m91.msg91.com/guides.' : 'Kept off the blog and m91.msg91.com/guides.'}
      </span>
      {p.website === 'waiting' && <button type="button" className="btn-secondary" disabled={busy === briefId} onClick={() => void set(p, false)}>Keep off</button>}
      {p.website === 'on'
        ? <button type="button" className="btn-secondary" disabled={busy === briefId} onClick={() => void set(p, false)}>Take off</button>
        : <button type="button" className="btn-primary" disabled={busy === briefId} onClick={() => void set(p, true)}>Put on the website</button>}
    </div>
  )
}
