// /records/:memoryId — one record: a friendly view per type (brief, draft, review, promo pack, block doc; a readable
// field view for the others) and the raw JSON with copy.
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { api, errorMessage, isApiError } from '../api/client'
import { ChecksTable, type CheckResult } from '../components/ChecksTable'
import { FieldView, Value } from '../components/FieldView'
import { copyText, JsonView } from '../components/JsonView'
import { MarkdownPreview } from '../components/MarkdownPreview'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { StatusBadge } from '../components/StatusBadge'
import { VerdictPanel, type Review } from '../components/VerdictPanel'

export type FullRecord = { id: string; type: string; briefId: string | null; status: string | null; version: number | null; date: string | null; payload: unknown; metadata?: Record<string, unknown> }
// Payloads are JSON written by the agents; the views read them defensively.
type P = Record<string, any>

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mb-5">
    <h3 className="mb-1.5 text-xs font-semibold text-slate-500 uppercase">{title}</h3>
    <div className="text-sm">{children}</div>
  </section>
)
const List = ({ items }: { items?: ReactNode[] }) => (items?.length ? <ul className="list-disc space-y-1 pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="text-slate-400">none</span>)
const Ext = ({ url, children }: { url?: string; children?: ReactNode }) => (url ? <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline dark:text-sky-300">{children ?? url}</a> : null)

function BriefView({ p }: { p: P }) {
  return (
    <>
      <Section title="Titles"><List items={p.titles} /></Section>
      <Section title="Angle and reader">
        <p>{p.angle}</p>
        <p className="mt-1 text-slate-500">{[p.post_type, p.format, p.intent && `intent: ${p.intent}`, p.reader && `reader: ${p.reader}`, p.topic_group != null && `group ${p.topic_group}`].filter(Boolean).join(' · ')}</p>
        {p.why_today && <p className="mt-1"><span className="text-slate-500">Why today: </span>{p.why_today}</p>}
      </Section>
      <Section title="Keywords"><p><strong>{p.keyword}</strong></p><List items={p.supporting_keywords} /></Section>
      <Section title="Outline">
        <ol className="list-decimal space-y-2 pl-5">
          {(p.outline ?? []).map((o: P, i: number) => (
            <li key={i}><div className="font-medium">{o.heading}</div>{o.answer_first && <div className="text-slate-600 dark:text-slate-300">{o.answer_first}</div>}{o.points?.length ? <ul className="mt-0.5 list-[circle] pl-5 text-slate-500">{o.points.map((x: string, j: number) => <li key={j}>{x}</li>)}</ul> : null}</li>
          ))}
        </ol>
      </Section>
      <Section title="M91 facts to use"><List items={(p.m91_facts_to_use ?? []).map((f: P) => <>{f.fact} <Ext url={f.source_url}>source</Ext></>)} /></Section>
      <Section title="Claims to avoid"><List items={p.claims_to_avoid} /></Section>
      {p.story?.use && <Section title="Story"><p>{p.story.how_to_use}</p><p className="text-slate-500">{p.story.attribution_line} · <Ext url={p.story.source_url} /></p></Section>}
      {p.tutorial?.use && <Section title="Tutorial"><p>{p.tutorial.target} — {p.tutorial.reader_outcome}</p><List items={p.tutorial.steps?.map((s: unknown) => (typeof s === 'string' ? s : <Value v={s} />))} /></Section>}
      <Section title="Sources"><List items={(p.sources ?? []).map((s: P) => <><Ext url={s.url} />{s.what_it_supports && <div className="text-slate-500">{s.what_it_supports}</div>}</>)} /></Section>
      <Section title="Interactive ideas"><List items={(p.interactive_ideas ?? []).map((x: P) => <><span className="pill pill-gray">{x.block_type}</span> {x.why}</>)} /></Section>
      <Section title="Internal links"><List items={(p.internal_links ?? []).map((x: unknown) => <Value v={x} />)} /></Section>
      {p.cta && <Section title="CTA">{p.cta.text} <Ext url={p.cta.url} /></Section>}
      {p.notes_for_writer?.length ? <Section title="Notes for the Writer"><List items={p.notes_for_writer} /></Section> : null}
    </>
  )
}

function DraftView({ rec, p }: { rec: FullRecord; p: P }) {
  const checks: CheckResult[] = p.checks?.results ?? []
  return (
    <>
      <p className="mb-4 text-sm">
        {p.word_count?.toLocaleString('en-US')} words · reading grade {p.reading?.post_grade ?? '—'} (intro {p.reading?.intro_grade ?? '—'}) · {p.model_used}{' '}
        {rec.briefId && <>· <Link to={`/approvals/${rec.briefId}`} className="text-sky-700 underline dark:text-sky-300">approval screen</Link></>}
      </p>
      <Card title="Post" className="mb-4"><MarkdownPreview markdown={p.post_markdown ?? ''} /></Card>
      <Card title="Checks" className="mb-4"><ChecksTable checks={checks} /></Card>
      {p.context && <Card title="Context (from the Writer)" className="mb-4"><FieldView data={p.context} /></Card>}
      {p.revision_notes?.length ? (
        <Card title="Revision notes" className="mb-4"><List items={p.revision_notes.map((n: P) => <>{n.feedback_quote && <span className="italic text-slate-500">“{n.feedback_quote}” → </span>}{n.what_changed}</>)} /></Card>
      ) : null}
      {p.human_feedback && <Card title="Your counter prompt" className="mb-4"><p className="text-sm">{p.human_feedback.text}</p><List items={p.human_feedback.quotes} /></Card>}
    </>
  )
}

function PromoView({ p }: { p: P }) {
  const Text = ({ label, text, max }: { label: string; text?: string; max?: number }) => (
    <div className="mb-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800" data-testid={`promo-${label}`}>
      <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold uppercase">{label}</span>
        <span data-testid="char-count">{(text ?? '').length.toLocaleString('en-US')} chars{max ? ` / ${max}` : ''}</span>
        <button type="button" className="btn-secondary ml-auto px-2 py-0.5 text-xs" onClick={() => copyText(text ?? '', `${label} copied`)}><Copy size={12} /> Copy</button>
      </div>
      <p className="whitespace-pre-wrap text-sm">{text}</p>
    </div>
  )
  return (
    <>
      {p.checks && <p className="mb-3 text-sm">Checks: {p.checks.passed ? <span className="pill pill-green">passed</span> : <span className="pill pill-amber">{p.checks.problems?.length} problem(s)</span>}{p.checks.problems?.length ? <span className="ml-2 text-slate-500">{p.checks.problems.join(' · ')}</span> : null}</p>}
      <Text label="LinkedIn" text={p.linkedin_post} />
      {(p.x_thread ?? []).map((t: string, i: number) => <Text key={i} label={`X post ${i + 1}`} text={t} max={280} />)}
      <Text label="Newsletter" text={p.newsletter_blurb} />
      {p.community_question && <Text label="Community question" text={p.community_question} />}
      {p.video_script?.length ? (
        <Card title="Video script">
          <ol className="list-decimal space-y-2 pl-5 text-sm">{p.video_script.map((s: P, i: number) => <li key={i}><div className="font-medium">{s.on_screen_text}</div><div className="text-slate-600 dark:text-slate-300">{s.voiceover}</div></li>)}</ol>
        </Card>
      ) : null}
    </>
  )
}

/** block_doc (Phase 8): the Designer's result — kept and dropped segments, the blocks, the integrity check. */
function BlockDocView({ p }: { p: P }) {
  const preview = new Map<string, string>((p.parts ?? []).map((x: P) => [x.id, x.preview]))
  const parts = (ids?: string[]) => (ids ?? []).map((id) => <span key={id} className="mr-1 rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800" title={preview.get(id)}>{id}</span>)
  return (
    <>
      <p className="mb-4 text-sm" data-testid="block-doc-summary">{p.summary}</p>
      <p className="mb-4 text-xs text-slate-500">{[p.model_used, p.repairs_used != null && `${p.repairs_used} repair${p.repairs_used === 1 ? '' : 's'}`, p.ms != null && `${(p.ms / 1000).toFixed(1)} s`, p.brief_version != null && `brief v${p.brief_version}`, p.version != null && `draft v${p.version}`].filter(Boolean).join(' · ')}</p>
      {p.error && <Section title="Error"><p className="text-red-600 dark:text-red-400">{p.error}</p></Section>}
      <Section title="Integrity">
        {p.integrity ? <><span className={`pill ${p.integrity.passed ? 'pill-green' : 'pill-red'}`}>{p.integrity.passed ? 'passed' : 'failed'}</span><List items={p.integrity.details} /></> : <span className="text-slate-400">not checked</span>}
      </Section>
      <Section title="Kept segments">
        <List items={(p.kept_segments ?? []).map((k: P) => <><span className="pill pill-green">{k.block_type}</span> {parts(k.part_ids)} {k.why && <span className="text-slate-600 dark:text-slate-300">{k.why}</span>}</>)} />
      </Section>
      <Section title="Dropped segments">
        <List items={(p.dropped_segments ?? []).map((k: P) => <><span className="pill pill-amber">{k.block_type}</span> {parts(k.part_ids)} <span className="text-slate-600 dark:text-slate-300">{k.reason}</span></>)} />
      </Section>
      <Section title="Blocks (in order)">
        {p.blocks?.length ? (
          <ol className="list-decimal space-y-1 pl-5">{p.blocks.map((b: P, i: number) => <li key={b.id ?? i}><span className="font-mono text-xs">{b.id}</span> <span className={`pill ${b.type === 'rich_text' ? 'pill-gray' : 'pill-green'}`}>{b.type}</span> {parts((p.layout ?? []).find((l: P) => l.block_id === b.id)?.part_ids)}</li>)}</ol>
        ) : <span className="text-slate-400">none: the post is plain Markdown</span>}
      </Section>
      <Section title="Parts of the post"><List items={(p.parts ?? []).map((x: P) => <><span className="font-mono text-xs">{x.id}</span> <span className="text-slate-500">{x.type}</span> {x.preview}</>)} /></Section>
    </>
  )
}

export function FriendlyView({ rec }: { rec: FullRecord }) {
  const p = (rec.payload ?? {}) as P
  if (typeof rec.payload === 'string') return <p className="whitespace-pre-wrap text-sm">{rec.payload}</p>
  switch (rec.type) {
    case 'brief': return <BriefView p={p} />
    case 'draft': return <DraftView rec={rec} p={p} />
    case 'review': return <VerdictPanel review={p as Review} />
    case 'promo_pack': return <PromoView p={p} />
    case 'block_doc': return <BlockDocView p={p} />
    default: return <FieldView data={p} />
  }
}

export default function RecordDetail() {
  const { memoryId = '' } = useParams()
  const [tab, setTab] = useState<'view' | 'json'>('view')
  const q = useQuery({ queryKey: ['record', memoryId, 'full'], queryFn: async () => (await api<{ record: FullRecord }>(`/api/records/${memoryId}`)).record, retry: false })
  if (q.isPending) return <p className="text-sm text-slate-500">Loading…</p>
  if (!q.data) {
    return (
      <>
        <PageHeader title="Record not found" />
        <EmptyState>{isApiError(q.error) && q.error.status === 404 ? `There is no record ${memoryId}.` : errorMessage(q.error)} <Link to="/content" className="underline">Back to Content</Link></EmptyState>
      </>
    )
  }
  const rec = q.data
  const p = (rec.payload ?? {}) as P
  const typeName = rec.type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  const title = typeof rec.payload === 'string' ? 'Lesson' : p.titles?.[0] ?? p.title ?? p.main_question ?? p.topic ?? `${typeName}${rec.briefId ? ` · brief ${rec.briefId}` : ''}${rec.version != null ? ` v${rec.version}` : ''}`
  return (
    <>
      <PageHeader
        title={title}
        subtitle={<>{rec.type.replace(/_/g, ' ')}{rec.briefId ? <> · brief <span className="font-mono">{rec.briefId}</span></> : null}{rec.version != null ? ` · v${rec.version}` : ''}{rec.date ? ` · ${rec.date}` : ''} · <span className="font-mono text-xs">{rec.id}</span></>}
        actions={<StatusBadge status={rec.status} />}
      />
      <div className="mb-3 flex gap-1" role="tablist" aria-label="View">
        {(['view', 'json'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            {t === 'view' ? 'Friendly view' : 'Raw JSON'}
          </button>
        ))}
      </div>
      {tab === 'view' ? <Card><FriendlyView rec={rec} /></Card> : <JsonView value={rec} />}
    </>
  )
}
