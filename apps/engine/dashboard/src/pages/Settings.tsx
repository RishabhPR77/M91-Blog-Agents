// /settings — read-only view of the engine's non-secret settings (GET /api/settings).
import { useSettings } from '../api/queries'
import { FieldView } from '../components/FieldView'
import { Card, PageHeader } from '../components/Page'
import { flagsOf } from '../config/flags'

const yes = (b: boolean | undefined) => (b === undefined ? 'not reported' : b ? 'on' : 'off')

export default function Settings() {
  const s = useSettings()
  if (s.isPending) return <p className="text-sm text-slate-500">Loading…</p>
  if (!s.data) return <p className="text-sm text-red-600">Could not load the settings.</p>
  const d = s.data
  const { blogOn } = flagsOf(d)
  // The blog's run modes are not listed while the blog is not the publish target.
  const BLOG_MODES = ['publish', 'unpublish', 'set_index', 'rebuild_blog']
  const modes = d.publish?.target === 'none' ? d.built_modes?.filter((m) => !BLOG_MODES.includes(m)) : d.built_modes
  return (
    <>
      <PageHeader title="Settings" subtitle={<>Change these in <code>.env</code> and restart the engine. Secrets are never shown here.</>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Run defaults">
          <dl className="grid grid-cols-[12rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Dry run by default</dt><dd data-testid="setting-dry-run">{yes(d.runtime.dry_run)}</dd>
            <dt className="text-slate-500">Auto-publish</dt><dd>{yes(d.runtime.auto_publish)}</dd>
            <dt className="text-slate-500">Log level</dt><dd>{d.runtime.log_level}</dd>
            <dt className="text-slate-500">Engine version</dt><dd>{d.version}</dd>
            <dt className="text-slate-500">Built run modes</dt><dd data-testid="setting-built-modes">{modes?.join(', ') ?? 'not reported (restart the engine)'}</dd>
          </dl>
        </Card>
        <Card title="Approval">
          {d.approval ? (
            <dl className="grid grid-cols-[12rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Max counter prompts</dt><dd data-testid="setting-max-revisions">{d.approval.max_human_revisions} per brief</dd>
              <dt className="text-slate-500">Re-review after a change</dt><dd>{yes(d.approval.rereview_after_human)}</dd>
              <dt className="text-slate-500">M91 alert when waiting</dt><dd>{yes(d.approval.m91_notify_on_awaiting)}</dd>
            </dl>
          ) : <p className="text-sm text-slate-500">Not reported by this engine (restart it).</p>}
        </Card>
        <Card title="Output and publishing">
          {d.publish ? (
            <dl className="grid grid-cols-[12rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Publish target</dt><dd data-testid="setting-publish-target">{d.publish.target === 'none' ? 'none: the Markdown export is the output' : d.publish.target === 'docstar' ? 'Docstar' : 'the blog (Embarko)'} (PUBLISH_TARGET)</dd>
              <dt className="text-slate-500">Markdown export</dt><dd>saved on every approval (Exports page)</dd>
              <dt className="text-slate-500">Docstar keys set</dt><dd data-testid="setting-docstar">{d.publish.docstar_configured ? 'yes' : 'no (DOCSTAR_API_URL, DOCSTAR_API_KEY, DOCSTAR_COLLECTION_ID)'}</dd>
            </dl>
          ) : <p className="text-sm text-slate-500">Not reported by this engine (it predates Phase 11: restart it).</p>}
        </Card>
        {blogOn && (
          <Card title="Blog and publishing">
            {d.blog ? (
              <dl className="grid grid-cols-[12rem_1fr] gap-y-2 text-sm">
                <dt className="text-slate-500">Auto-publish on approve</dt><dd data-testid="setting-auto-publish">{yes(d.blog.auto_publish)}</dd>
                <dt className="text-slate-500">Blog app (Embarko)</dt><dd className="font-mono text-xs">{d.blog.app_name}</dd>
                <dt className="text-slate-500">Blog URL</dt><dd><a className="text-sky-700 hover:underline dark:text-sky-300" href={d.blog.base_url} target="_blank" rel="noreferrer">{d.blog.base_url}</a></dd>
                <dt className="text-slate-500">noindex for the first</dt><dd>{d.blog.noindex_first_n_posts} posts</dd>
                <dt className="text-slate-500">Deploy token set</dt><dd data-testid="setting-deploy-token">{d.blog.deploy_token_set ? 'yes' : 'no (only dry runs can publish)'}</dd>
              </dl>
            ) : <p className="text-sm text-slate-500">No blog settings from this engine (it predates Phase 7: restart it).</p>}
          </Card>
        )}
        <Card title="Interactive guides">
          {d.designer ? (
            <dl className="grid grid-cols-[12rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Experience Designer</dt><dd data-testid="setting-experience">{d.designer.enabled === false ? 'off (EXPERIENCE_ENABLED=false): no guides, the pre-Phase-10 review' : 'on'}</dd>
              <dt className="text-slate-500">New posts get a guide</dt><dd data-testid="setting-interactive-default">{yes(d.designer.interactive_default)} (INTERACTIVE_DEFAULT)</dd>
              <dt className="text-slate-500">Experience Designer model</dt><dd className="font-mono text-xs" data-testid="setting-designer-model">{d.models.designer ? `${d.models.designer.service} · ${d.models.designer.model} · ${d.models.designer.delivery}` : 'not reported'}</dd>
              <dt className="text-slate-500">Max components per guide</dt><dd>{d.designer.max_components ?? 'not reported'}</dd>
              <dt className="text-slate-500">Max repairs</dt><dd>{d.designer.max_repairs}</dd>
              <dt className="text-slate-500">Design-only re-runs</dt><dd>{d.designer.max_designer_revisions ?? 'not reported'} per post (MAX_DESIGNER_REVISIONS)</dd>
              <dt className="text-slate-500">Promo pack</dt><dd data-testid="setting-promo">{d.designer.promo_enabled ? 'on' : 'off'} (PROMO_ENABLED)</dd>
            </dl>
          ) : <p className="text-sm text-slate-500">Not reported by this engine (it predates Phase 10: restart it).</p>}
        </Card>
        <Card title="Models per agent" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Models">
              <thead className="text-xs text-slate-500"><tr className="border-b border-slate-200 dark:border-slate-800"><th className="px-2 py-1.5 font-medium">Agent</th><th className="px-2 py-1.5 font-medium">Service</th><th className="px-2 py-1.5 font-medium">Model</th><th className="px-2 py-1.5 font-medium">Delivery</th></tr></thead>
              <tbody>
                {Object.entries(d.models).map(([agent, m]) => (
                  <tr key={agent} className="border-b border-slate-100 dark:border-slate-800/60"><td className="px-2 py-1.5 capitalize">{agent}</td><td className="px-2 py-1.5">{m.service}</td><td className="px-2 py-1.5 font-mono text-xs">{m.model}</td><td className="px-2 py-1.5">{m.delivery}{m.research_delivery ? ` (research: ${m.research_delivery})` : ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Reviewer gates"><FieldView data={d.gates} /></Card>
        <Card title="Limits"><FieldView data={d.limits} /></Card>
        <Card title="Scout"><FieldView data={d.scout} /></Card>
        <Card title="Strategist"><FieldView data={d.strategist} /></Card>
        <Card title="Content"><FieldView data={d.content} /></Card>
        <Card title="Dashboard"><FieldView data={d.dashboard} /></Card>
      </div>
    </>
  )
}
