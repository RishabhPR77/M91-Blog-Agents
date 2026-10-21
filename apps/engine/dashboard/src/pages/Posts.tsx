// /posts — the blog's posts (Phase 7): status, search visibility, live link, and the Publisher actions
// (Republish, Unpublish, Hide / Show in search) and Re-run Experience Designer (Phase 10). Every action asks first; only the
// Designer uses AI (1–2 calls).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { usePosts, useSettings } from '../api/queries'
import type { PostItem } from '../api/types'
import { usePublishRun, type PublishMode } from '../api/publishRun'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { StatusBadge } from '../components/StatusBadge'
import { fmtDateTime } from '../format'
import { COSTS } from '../config/costs'

type Pending = { mode: PublishMode; post: PostItem; params: Record<string, unknown>; title: string; text: string; danger?: boolean; calls?: string }

export default function Posts() {
  const posts = usePosts()
  const settings = useSettings()
  const pub = usePublishRun()
  const [pending, setPending] = useState<Pending | null>(null)
  const [dryRun, setDryRun] = useState<boolean | null>(null)
  useEffect(() => {
    if (dryRun === null && settings.data) setDryRun(settings.data.runtime.dry_run)
  }, [settings.data, dryRun])
  const blog = settings.data?.blog
  const built = new Set(settings.data?.built_modes ?? [])
  const canRun = built.has('publish')
  const tokenMissing = blog && !blog.deploy_token_set && !(dryRun ?? true)

  const ask = (p: Pending) => {
    pub.clearError()
    setPending(p)
  }
  async function confirm() {
    if (!pending) return
    const ok = await pub.start(pending.mode, pending.params, dryRun ?? true)
    if (!ok) setPending(null)
  }

  const rows = posts.data ?? []
  return (
    <>
      <PageHeader
        title="Posts"
        subtitle={<>Posts on the blog{blog ? <> at <a className="text-sky-700 hover:underline dark:text-sky-300" href={blog.base_url} target="_blank" rel="noreferrer">{blog.base_url.replace(/^https:\/\//, '')}</a></> : ''}. Publishing uses no AI calls; the Experience Designer uses {COSTS.designer.normal}.</>}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={dryRun ?? true} onChange={(e) => setDryRun(e.target.checked)} />
            Dry run (build locally, deploy nothing)
          </label>
        }
      />
      {pub.error && <div role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{pub.error}</div>}
      {tokenMissing && <div role="alert" data-testid="token-missing" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">The deploy token is not set (EMBARKO_DEPLOY_TOKEN): only dry runs can start.</div>}
      {settings.data && !canRun && <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">This engine has no Publisher yet: restart it to enable the buttons.</div>}
      <Card>
        {!rows.length ? (
          <EmptyState>{posts.isPending ? 'Loading…' : <>No posts yet. Approve a draft, then publish it from <Link className="underline" to="/approvals">Approvals</Link> or Control.</>}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Posts">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-2 py-1.5 font-medium">Post</th><th className="px-2 py-1.5 font-medium">Status</th><th className="px-2 py-1.5 font-medium">Search</th><th className="px-2 py-1.5 font-medium">Deployed</th><th className="px-2 py-1.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const live = p.status === 'published'
                  const disabled = !canRun || pub.busy || Boolean(tokenMissing)
                  return (
                    <tr key={p.record_id} className="border-b border-slate-100 align-top dark:border-slate-800/60" data-testid={`post-${p.slug}`}>
                      <td className="px-2 py-2">
                        <div className="font-medium">{p.title}</div>
                        <div className="font-mono text-xs text-slate-500">{p.slug}{p.version ? ` · v${p.version}` : ''}{p.brief_id ? <> · <Link className="text-sky-700 hover:underline dark:text-sky-300" to={`/approvals/${p.brief_id}`}>{p.brief_id}</Link></> : ''}</div>
                        {p.blocks !== undefined && <div className="mt-0.5 text-xs text-slate-500" data-testid="post-blocks">{p.blocks ? `${p.blocks} interactive blocks` : 'plain Markdown'}</div>}
                        {p.last_error && <div className="mt-1 text-xs text-red-600 dark:text-red-400">Last error: {p.last_error}</div>}
                      </td>
                      <td className="px-2 py-2"><StatusBadge status={p.status} /></td>
                      <td className="px-2 py-2">{p.noindex ? <span className="pill pill-amber">hidden (noindex)</span> : <span className="text-slate-600 dark:text-slate-300">shown</span>}</td>
                      <td className="px-2 py-2 text-xs text-slate-500">{fmtDateTime(p.deployed_at ?? p.published_at)}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {live && p.url && <a className="btn-secondary px-2 py-1 text-xs" href={p.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open live</a>}
                          {p.brief_id && p.status !== 'publishing' && (
                            <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={disabled}
                              onClick={() => ask({ mode: 'publish', post: p, params: { brief_id: p.brief_id }, title: `${live ? 'Republish' : 'Publish'} “${p.title}”?`, text: 'The approved draft is turned into the post again, the blog is rebuilt and deployed, and the live page is checked. The slug and first publish date stay the same.' })}>
                              {live ? 'Republish' : 'Publish again'}
                            </button>
                          )}
                          {p.brief_id && p.status !== 'publishing' && built.has('designer') && (
                            <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={pub.busy}
                              onClick={() => ask({ mode: 'designer', post: p, params: { brief_id: p.brief_id }, calls: COSTS.designer.normal, title: `Re-run the Experience Designer for “${p.title}”?`, text: 'The Experience Designer turns the post into a guide; code places the Writer’s exact text and checks that the design adds no new facts. The live post changes only after Republish.' })}>
                              Re-run Experience Designer
                            </button>
                          )}
                          {live && (
                            <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={disabled}
                              onClick={() => ask({ mode: 'set_index', post: p, params: { slug: p.slug, noindex: !p.noindex }, title: p.noindex ? `Show “${p.title}” in search?` : `Hide “${p.title}” from search?`, text: p.noindex ? 'The noindex tag is removed and the post is listed on the home page, topic pages, RSS and the sitemap.' : 'The post gets a noindex tag and leaves the lists, RSS and the sitemap. Its URL keeps working.' })}>
                              {p.noindex ? 'Show in search' : 'Hide from search'}
                            </button>
                          )}
                          {live && (
                            <button type="button" className="btn-danger px-2 py-1 text-xs" disabled={disabled}
                              onClick={() => ask({ mode: 'unpublish', post: p, params: { slug: p.slug }, danger: true, title: `Unpublish “${p.title}”?`, text: 'The blog is rebuilt without this post and deployed; its URL stops working. The draft goes back to approved, so you can publish it again later.' })}>
                              Unpublish
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ConfirmDialog open={Boolean(pending)} title={pending?.title ?? ''} expectedCalls={pending?.calls ?? '0'} expectedMem0={pending ? COSTS[pending.mode].mem0 : undefined} confirmLabel={pending?.mode === 'unpublish' ? 'Unpublish' : 'Start'} danger={pending?.danger} busy={pub.busy} onConfirm={confirm} onCancel={() => setPending(null)}>
        <p>{pending?.text}</p>
        <p data-testid="publish-dry">{pending?.mode === 'designer'
          ? (dryRun ?? true ? 'Dry run: the plan is made (AI calls), but nothing is saved.' : 'The result is saved as a new block_doc. Nothing is deployed.')
          : (dryRun ?? true ? 'Dry run: the blog is built locally only; nothing is deployed, saved or sent.' : 'Live: the blog is deployed to Embarko and Slack is told.')}</p>
      </ConfirmDialog>
    </>
  )
}
