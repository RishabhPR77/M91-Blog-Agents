// The Publish card on an approval (Phase 7). With AUTO_PUBLISH=false an approved draft gets a Publish button
// (no AI calls); with AUTO_PUBLISH=true approving publishes it, so the card only says so.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSettings } from '../api/queries'
import { usePublishRun } from '../api/publishRun'
import { ConfirmDialog } from './ConfirmDialog'
import { Card } from './Page'
import { COSTS } from '../config/costs'

export function PublishCard({ briefId, status, version, title }: { briefId: string; status: string; version: number; title: string }) {
  const settings = useSettings()
  const pub = usePublishRun()
  const [open, setOpen] = useState(false)
  const s = settings.data
  if (!s?.built_modes?.includes('publish') || !s.blog) return null
  const auto = s.blog.auto_publish
  const dry = s.runtime.dry_run
  const tokenMissing = !s.blog.deploy_token_set && !dry
  if (status === 'awaiting_human') {
    return auto ? <Card title="Publishing"><p className="text-sm text-slate-600 dark:text-slate-300" data-testid="auto-publish-note">AUTO_PUBLISH is on: approving this version will publish it automatically.</p></Card> : null
  }
  if (status !== 'approved' && status !== 'published') return null
  const again = status === 'published'
  return (
    <Card title="Publishing">
      {pub.error && <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">{pub.error}</p>}
      {again ? (
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">This version is on the blog. Manage it on the <Link className="underline" to="/posts">Posts</Link> page, or publish it again.</p>
      ) : (
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">{auto ? 'AUTO_PUBLISH is on, but this version is not on the blog yet (the publish may have failed).' : 'Approved and ready. Publishing is manual (AUTO_PUBLISH=false).'}</p>
      )}
      <button type="button" className="btn-primary w-full" disabled={pub.busy || tokenMissing} onClick={() => { pub.clearError(); setOpen(true) }}>
        {again ? 'Republish' : 'Publish'} · expected AI calls 0
      </button>
      {tokenMissing && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300" data-testid="publish-token-missing">The deploy token is not set (EMBARKO_DEPLOY_TOKEN). Use a dry run from Control or Posts.</p>}
      <ConfirmDialog open={open} title={`${again ? 'Republish' : 'Publish'} v${version}?`} expectedCalls="0" expectedMem0={COSTS.publish.mem0} confirmLabel={again ? 'Republish' : 'Publish'} busy={pub.busy}
        onConfirm={async () => { if (!(await pub.start('publish', { brief_id: briefId }, dry))) setOpen(false) }} onCancel={() => setOpen(false)}>
        <p>“{title}” is turned into a blog post, the blog is rebuilt and deployed to {s.blog.base_url}, and the live page is checked.</p>
        <p>{dry ? 'The engine default is a dry run: the blog is built locally only, and nothing is deployed.' : 'This deploys the live blog and tells Slack.'}</p>
      </ConfirmDialog>
    </Card>
  )
}
