// Agents: what each agent does, the model it runs on, every setting that shapes it, and its instructions word for word,
// exactly as the engine sends them (GET /api/agents builds them with the engine's own prompt builders). Values known
// only during a run are shown as ‹…›.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Copy } from 'lucide-react'
import { api } from '../api/client'
import { EmptyState, PageHeader, PageSkeleton } from '../components/Page'

type Setting = { label: string; value: string; note?: string }
type Prompt = { title: string; text: string }
type Model = { service: string | null; model: string | null; delivery: string | null } | null
export type AgentInfo = { id: string; name: string; role: string; gets: string; gives: string; model: Model; enabled: boolean; settings: Setting[]; prompts: Prompt[] }
type AgentsResponse = { agents: AgentInfo[]; pipeline: { order: string[]; settings: Setting[] } }

export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api<AgentsResponse>('/api/agents'), staleTime: 60_000 })

function Settings({ items }: { items: Setting[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {items.map((s) => (
        <div key={s.label} className="min-w-0">
          <dt className="text-xs text-ink-3">{s.label}</dt>
          <dd className="text-sm font-medium break-words text-ink">{s.value}{s.note && <span className="block text-xs font-normal text-ink-3">{s.note}</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

function PromptBlock({ p }: { p: Prompt }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // The clipboard is not available here: the text can still be selected.
    }
  }
  return (
    <details className="group rounded-xl border border-line bg-surface-2/60 open:bg-surface" data-testid="agent-prompt">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm">
        <span className="font-medium text-ink">{p.title}</span>
        <span className="text-xs text-ink-3 tabular-nums">{p.text.length.toLocaleString('en-US')} characters · <span className="group-open:hidden">show</span><span className="hidden group-open:inline">hide</span></span>
      </summary>
      <div className="border-t border-line px-4 pt-3 pb-4">
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={copy} className="btn-ghost text-xs" aria-label={`Copy ${p.title}`}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
        </div>
        <pre className="max-h-[32rem] overflow-auto font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-ink-2">{p.text}</pre>
      </div>
    </details>
  )
}

function AgentCard({ a }: { a: AgentInfo }) {
  return (
    <section id={`agent-${a.id}`} className={`tile scroll-mt-24 ${a.enabled ? '' : 'opacity-80'}`} data-testid={`agent-${a.id}`} aria-label={a.name}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-[24px] leading-tight font-semibold tracking-[-0.015em]">{a.name}</h2>
        {a.model?.model && <span className="rounded-md bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[12px] text-ink-2" data-testid={`agent-model-${a.id}`}>{a.model.model}{a.model.service ? <span className="text-ink-3"> · {a.model.service}</span> : null}</span>}
        {!a.enabled && <span className="pill pill-gray">off</span>}
      </div>
      <p className="mt-2 max-w-3xl text-[15px] text-ink-2">{a.role}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-surface-2 p-4"><p className="eyebrow mb-1.5">Gets</p><p className="text-sm text-ink-2">{a.gets}</p></div>
        <div className="rounded-xl bg-surface-2 p-4"><p className="eyebrow mb-1.5">Gives</p><p className="text-sm text-ink-2">{a.gives}</p></div>
      </div>
      <div className="mt-6"><p className="eyebrow mb-3">Settings</p><Settings items={a.settings} /></div>
      <div className="mt-6"><p className="eyebrow mb-3">Instructions, word for word</p>
        <div className="space-y-2">{a.prompts.map((p) => <PromptBlock key={p.title} p={p} />)}</div>
      </div>
    </section>
  )
}

export default function Agents() {
  const q = useAgents()
  if (q.isPending) return <PageSkeleton />
  if (q.isError || !q.data) return <EmptyState>The agents could not be loaded: {(q.error as Error | null)?.message ?? 'no answer'}</EmptyState>
  const { agents, pipeline } = q.data
  return (
    <>
      <PageHeader eyebrow="How the engine works" title="Agents" subtitle="What each agent does, the model it runs on, the settings that shape it, and its instructions word for word, exactly as the engine sends them. ‹…› marks what is filled in during a run." />
      <section className="tile mb-8" aria-label="Pipeline" data-testid="agents-pipeline">
        <p className="eyebrow mb-4">The pipeline</p>
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
          {pipeline.order.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className="rounded-full bg-ink/[0.05] px-3 py-1 font-medium text-ink">{s}</span>
              {i < pipeline.order.length - 1 && <ArrowRight size={14} className="text-ink-3" aria-hidden />}
            </li>
          ))}
        </ol>
        <div className="mt-6"><Settings items={pipeline.settings} /></div>
      </section>
      <nav className="mb-8 flex flex-wrap gap-2" aria-label="Jump to an agent">
        {agents.map((a) => <a key={a.id} href={`#agent-${a.id}`} className="pill pill-gray hover:bg-ink/[0.08]">{a.name}{a.enabled ? '' : ' (off)'}</a>)}
      </nav>
      <div className="space-y-8">{agents.map((a) => <AgentCard key={a.id} a={a} />)}</div>
    </>
  )
}
