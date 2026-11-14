// The live preview beside a run (2026-11-14): what each agent has just produced, as it lands. viaSocket returns each
// answer whole, so the panel changes per answer (not per word) and animates the change: the Scout's findings, the
// Editor's candidates and scores, the Strategist's brief, each Writer pass with what changed, and the Reviewer reading
// the post, then its gates, area scores and a numbered box on every part it flagged. No AI calls: it only shows what
// the agents already produce. After the run (or a reload) it shows the saved draft and review.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { api } from '../api/client'
import { MarkdownPreview } from './MarkdownPreview'
import { subStepLabel } from './stepWords'
import { findQuote } from '../highlight'
import type { EditorPreview, FactCheckPreview, ReviewerPreview, RunView, ScoutPreview, StrategistPreview, WriterPass } from '../state/runEvents'

export const PREVIEW_AGENTS = ['scout', 'editor', 'strategist', 'writer', 'reviewer'] as const
export type PreviewAgent = (typeof PREVIEW_AGENTS)[number]
const NAME: Record<PreviewAgent, string> = { scout: 'Scout', editor: 'Editor', strategist: 'Strategist', writer: 'Writer', reviewer: 'Reviewer' }
const PASS: Record<string, string> = { new: 'Draft', revise: 'Rewrite', repair: 'Repair', polish: 'Polish', factfix: 'Fact-check fix', kept: 'Kept earlier', final: 'Saved draft' }
const SCORE_KEYS = ['demand', 'timeliness', 'm91_fit', 'gap', 'variety'] as const
const GATES = ['m91_claims_correct', 'no_invented_content', 'sources_support_claims', 'answers_main_question', 'no_legal_advice_framing']
const AREAS = ['answers_question', 'simplicity', 'accuracy', 'seo', 'structure', 'tone', 'originality', 'ai_answer_readiness', 'to_the_point', 'm91_fit_cta']
const words = (id: string) => id.replace(/_/g, ' ').replace(/\bm91\b/i, 'M91').replace(/\bseo\b/i, 'SEO').replace(/\bai\b/i, 'AI').replace(/\bcta\b/i, 'CTA')

/** The agent working now (the checks belong to the Writer; a Scout sub-step to the Scout). */
export function workingAgent(view: RunView): PreviewAgent | null {
  if (view.status !== 'running') return null
  if (view.steps.checks?.status === 'running') return 'writer'
  for (const a of [...PREVIEW_AGENTS].reverse()) if (view.steps[a]?.status === 'running') return a
  return null
}

/** Markdown in blocks (a blank line outside a code fence ends one), to mark the blocks a pass changed. */
export function splitBlocks(md: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  let fence = false
  for (const line of String(md ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && !line.trim()) {
      if (cur.length) out.push(cur.join('\n'))
      cur = []
    } else cur.push(line)
  }
  if (cur.length) out.push(cur.join('\n'))
  return out
}

/**
 * Boxes, numbered, the block (paragraph, list item, heading, cell) each quote is in, and underlines the quoted words
 * with a CSS highlight (ranges, not new elements: React keeps owning the post's DOM). Returns a clean-up.
 */
function boxQuotes(root: HTMLElement | null, quotes: { n: number; quote: string; severity: string }[]): () => void {
  if (!root) return () => {}
  for (const el of [...root.querySelectorAll('.preview-box')]) {
    el.classList.remove('preview-box', 'preview-box-must', 'preview-box-should')
    el.removeAttribute('data-n')
  }
  const ranges: Range[] = []
  for (const q of quotes) {
    const range = findQuote(root, q.quote)
    const hit = range?.startContainer.parentElement?.closest('p, li, h1, h2, h3, td, th, blockquote, pre')
    if (!range || !hit) continue
    ranges.push(range)
    if (hit.classList.contains('preview-box')) continue
    hit.classList.add('preview-box', q.severity === 'must' ? 'preview-box-must' : 'preview-box-should')
    hit.setAttribute('data-n', String(q.n))
  }
  const registry = typeof Highlight === 'function' && typeof CSS !== 'undefined' ? CSS.highlights : undefined
  registry?.set('preview-quote', new Highlight(...ranges))
  return () => registry?.delete('preview-quote')
}

/** Scrolls the panel (when it scrolls on its own, not the page) so `el` is in view: the live preview follows the work. */
function follow(el: Element | null | undefined, page = false) {
  const box = el?.closest('[data-preview-scroll]') as HTMLElement | null
  if (!el || !box || box.scrollHeight <= box.clientHeight + 4) {
    if (page) el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    return
  }
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 48
  box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

function Post({ markdown, previous, boxes, scanning = false, followChanges = false }: { markdown: string; previous?: string; boxes?: { n: number; quote: string; severity: string }[]; scanning?: boolean; followChanges?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const blocks = useMemo(() => splitBlocks(markdown), [markdown])
  const before = useMemo(() => (previous === undefined ? null : new Set(splitBlocks(previous).map((b) => b.trim()))), [previous])
  useEffect(() => (boxes?.length ? boxQuotes(ref.current, boxes) : undefined), [markdown, boxes])
  useEffect(() => { if (followChanges) follow(ref.current?.querySelector('[data-changed]')) }, [markdown, followChanges])
  return (
    <div ref={ref} className={`article-compact relative pl-3 ${scanning ? 'preview-scan' : ''}`} data-testid="preview-post">
      {blocks.map((b, i) => (
        <div key={`${i}-${b.length}`} className={before && !before.has(b.trim()) ? 'preview-changed' : ''} data-changed={before && !before.has(b.trim()) ? 'true' : undefined}>
          <MarkdownPreview variant="article" markdown={b} />
        </div>
      ))}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-3">{children}</div>
}
function Working({ label, lines = true }: { label: string; lines?: boolean }) {
  return (
    <div className="space-y-2.5 py-1" aria-label={label}>
      <p className="flex items-center gap-2 text-sm font-medium text-ink"><span className="size-2 shrink-0 animate-signal rounded-full bg-lime-500 text-lime-500" />{label}</p>
      {lines && [92, 78, 85].map((w) => <div key={w} className="skeleton h-3 rounded-full" style={{ width: `${w}%` }} />)}
    </div>
  )
}

function ScoutView({ list, view }: { list: ScoutPreview[]; view: RunView }) {
  const running = Object.values(view.steps).find((s) => s.name.startsWith('scout.') && s.status === 'running')
  return (
    <div className="space-y-6">
      {list.map((g) => (
        <section key={g.seq} className="animate-enter">
          <p className="eyebrow mb-2">{subStepLabel(g.step)} <span className="font-normal normal-case tracking-normal text-ink-3">· {g.items.length} found</span></p>
          {g.items.length ? (
            <ol className="stagger space-y-1.5">
              {g.items.map((it, i) => (
                <li key={i} className="rounded-xl bg-surface-2 px-3 py-2 text-[13.5px] leading-snug">
                  <span className="text-ink">{it.text}</span>
                  {it.meta && <span className="block text-[11.5px] text-ink-3">{it.meta}</span>}
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-ink-3">Nothing new this time.</p>}
        </section>
      ))}
      {running && <Working label={`${subStepLabel(running.name)}: searching the web…`} />}
      {!list.length && !running && <Empty>The Scout's findings appear here as each search answers.</Empty>}
    </div>
  )
}

function EditorView({ p }: { p: EditorPreview | null }) {
  if (!p) return <Working label="The Editor is weighing this week's signals…" />
  return (
    <div className="space-y-3">
      {p.candidates.map((c, i) => (
        <div key={i} className={`animate-enter rounded-2xl border px-4 py-3 ${c.chosen ? 'border-transparent bg-hl-tint' : 'border-line bg-surface'}`} style={{ animationDelay: `${i * 90}ms` }} data-testid={c.chosen ? 'editor-chosen' : undefined}>
          <div className="flex items-start justify-between gap-3">
            <p className="font-serif text-[16px] leading-snug font-semibold text-ink">{c.title}</p>
            <span className="shrink-0 text-xs text-ink-3 tabular-nums">{c.total ?? '—'}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3"><span className="pill pill-gray">{c.format}</span>{c.chosen && <span className="pill pill-green">Chosen</span>}</div>
          {c.scores && (
            <dl className="mt-3 grid grid-cols-5 gap-2">
              {SCORE_KEYS.map((k) => (
                <div key={k} className="min-w-0">
                  <dt className="truncate text-[10.5px] text-ink-3">{words(k)}</dt>
                  <dd className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]"><span className="block h-full rounded-full bg-ink transition-[width] duration-700" style={{ width: `${((c.scores?.[k] ?? 0) / 5) * 100}%` }} /></dd>
                </div>
              ))}
            </dl>
          )}
          {c.leftOut && <p className="mt-2 text-xs text-red-700">Left out: {c.leftOut}</p>}
        </div>
      ))}
      {p.fallback && <p className="text-sm text-ink-2">Code's pick: {p.fallback.title} ({p.fallback.format})</p>}
      {p.reason && <p className="border-t border-line pt-3 text-sm text-ink-2"><span className="font-medium text-ink">Why: </span>{p.reason}</p>}
    </div>
  )
}

function StrategistView({ list }: { list: StrategistPreview[] }) {
  const b = list.at(-1)
  if (!b) return <Working label="The Strategist is planning the post…" />
  return (
    <div className="animate-enter space-y-4">
      {list.length > 1 && <p className="text-xs text-ink-3">{list.map((x) => (x.call === 'plan' ? 'Plan' : x.call === 'repair' ? 'Repair' : x.call)).join(' → ')}{b.problems ? ` · ${b.problems} problem(s) left for code to fix` : ''}</p>}
      <h3 className="font-serif text-[22px] leading-snug font-semibold tracking-[-0.01em]">{b.title}</h3>
      <div className="flex flex-wrap gap-2 text-xs"><span className="pill pill-blue">{b.keyword}</span>{b.format && <span className="pill pill-gray">{b.format}</span>}</div>
      {b.reader && <p className="text-sm text-ink-2"><span className="font-medium text-ink">Reader: </span>{b.reader}</p>}
      {b.angle && <p className="text-sm text-ink-2"><span className="font-medium text-ink">Angle: </span>{b.angle}</p>}
      <ol className="stagger space-y-2.5 border-t border-line pt-4" data-testid="preview-outline">
        {b.outline.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-[11px] font-semibold text-ink-2 tabular-nums">{i + 1}</span>
            <span className="min-w-0"><span className="block text-[14px] font-medium leading-snug text-ink">{s.heading}</span>{s.answer_first && <span className="block text-[12.5px] leading-snug text-ink-3">{s.answer_first}</span>}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function WriterView({ passes, checks }: { passes: WriterPass[]; checks: FactCheckPreview[] }) {
  const [sel, setSel] = useState(passes.length - 1)
  const newest = passes.at(-1)?.seq
  // A new pass shows at once (and the panel scrolls to its first change); a click shows an earlier one.
  useEffect(() => setSel(passes.length - 1), [newest, passes.length])
  const p = passes[sel]
  if (!p) return <Working label="The Writer is writing the draft…" />
  const prev = sel > 0 ? passes[sel - 1].markdown : undefined
  // The fact check that read this pass (it comes after it), or, on a fact-check fix, the one it corrected.
  const checked = checks.filter((c) => c.seq > p.seq && c.seq < (passes[sel + 1]?.seq ?? Infinity)).at(-1)
  const fixed = p.pass === 'factfix' && sel > 0 ? checks.filter((c) => c.seq > passes[sel - 1].seq && c.seq < p.seq).at(-1) : undefined
  const fc = checked ?? fixed
  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Writer passes">
        {passes.map((x, i) => (
          <li key={x.seq}>
            <button type="button" onClick={() => setSel(i)} className={`rounded-full px-2.5 py-1 text-xs transition-colors ${i === sel ? 'bg-ink text-white' : 'bg-ink/[0.05] text-ink-2 hover:bg-ink/[0.09]'}`} aria-pressed={i === sel}>
              {x.version ? `v${x.version} · ` : ''}{PASS[x.pass] ?? x.pass}
            </button>
          </li>
        ))}
      </ol>
      <p className="text-xs text-ink-3 tabular-nums">
        {p.words != null ? `${p.words.toLocaleString('en-US')} words` : ''}{p.grade != null ? ` · grade ${p.grade}` : ''}
        {p.hard.length ? <span className="text-red-700"> · fix: {p.hard.join(', ')}</span> : p.words != null ? ' · every hard check passed' : ''}
      </p>
      {p.fixes.length > 0 && (
        <div className="rounded-xl bg-surface-2 px-4 py-3 text-[12.5px] text-ink-2" data-testid="preview-fixes">
          <p className="mb-1 font-medium text-ink">This pass fixed</p>
          <ul className="list-disc space-y-0.5 pl-4">{p.fixes.slice(0, 4).map((f, i) => <li key={i}><span className="line-clamp-2">{f}</span></li>)}</ul>
          {p.fixes.length > 4 && <p className="mt-1 text-ink-3">+{p.fixes.length - 4} more</p>}
        </div>
      )}
      {fc && (
        <div className="rounded-xl border border-line px-4 py-3 text-[12.5px]" data-testid="preview-factcheck">
          <p className="font-medium text-ink">{!fc.issues.length ? 'Fact check: every claim is supported' : fc === checked ? `Fact check: ${fc.issues.length} sentence(s) to correct` : `This pass corrected ${fc.issues.length} sentence(s) from the fact check`}</p>
          {fc.issues.slice(0, 3).map((x, i) => <p key={i} className="mt-1.5 text-ink-2"><span className="text-ink-3 line-through">{x.quote}</span><br /><span className="text-ink">{x.fix === 'remove' ? '(removed)' : x.fix}</span></p>)}
          {fc.issues.length > 3 && <p className="mt-1 text-ink-3">+{fc.issues.length - 3} more</p>}
        </div>
      )}
      {prev !== undefined && <p className="flex items-center gap-2 text-[11.5px] text-ink-3"><span className="inline-block h-3 w-[3px] rounded-full bg-hl" /> marks what changed in this pass</p>}
      <Post markdown={p.markdown} previous={prev} followChanges={sel === passes.length - 1} />
    </div>
  )
}

function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700)
      setN(Math.round(value * (1 - (1 - k) ** 3) * 10) / 10)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{n}</>
}

function ReviewerView({ reviews, passes, reading }: { reviews: ReviewerPreview[]; passes: WriterPass[]; reading: boolean }) {
  const r = reading ? undefined : reviews.at(-1)
  // The draft it read: the last pass before its answer (the saved draft after the run).
  const draft = r ? (passes.filter((x) => x.seq < r.seq).at(-1) ?? passes.at(-1)) : passes.at(-1)
  const boxes = useMemo(() => (r?.feedback ?? []).filter((f) => f.quote).map((f, i) => ({ n: i + 1, quote: f.quote, severity: f.severity })), [r])
  if (!r) {
    return (
      <div className="space-y-5">
        <Working lines={false} label={`The Reviewer is reading${draft?.version ? ` v${draft.version}` : ''}: checking 5 gates and 10 areas…`} />
        <div className="grid grid-cols-2 gap-4 text-[12px] text-ink-3">
          {([['Gates', GATES], ['Areas', AREAS]] as const).map(([name, ids]) => (
            <div key={name}>
              <p className="eyebrow mb-1.5">{name}</p>
              <ol className="space-y-1">{ids.map((g, i) => <li key={g} className="flex items-center gap-1.5"><span className="size-1.5 shrink-0 animate-pulse rounded-full bg-ink/25" style={{ animationDelay: `${i * 120}ms` }} />{words(g)}</li>)}</ol>
            </div>
          ))}
        </div>
        {draft && <Post markdown={draft.markdown} scanning />}
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <div className="flex items-end gap-3">
        <p className="font-serif text-[52px] leading-none font-semibold tracking-[-0.03em] tabular-nums" data-testid="preview-total"><CountUp value={r.total ?? 0} /></p>
        <div className="pb-1.5 text-sm">
          <span className={`pill ${r.pass ? 'pill-green' : 'pill-red'}`}>{r.pass ? 'pass' : 'back to the Writer'}</span>
          <span className="ml-2 text-ink-3">/ 100{r.passMark != null ? ` · pass mark ${r.passMark}` : ''}{r.version ? ` · v${r.version}` : ''}</span>
        </div>
      </div>
      <section>
        <p className="eyebrow mb-2">Gates</p>
        <ul className="space-y-1.5" data-testid="preview-gates">
          {r.gates.map((g, i) => (
            <li key={g.id} className="flex animate-enter items-center gap-2 text-[13px]" style={{ animationDelay: `${i * 70}ms` }}>
              <span className={`flex size-5 items-center justify-center rounded-full ${g.passed ? 'bg-ink text-white' : 'bg-red-600 text-white'}`}>{g.passed ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}</span>
              <span className={g.passed ? 'text-ink-2' : 'font-medium text-red-700'}>{words(g.id)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <p className="eyebrow mb-2">Areas</p>
        <ul className="space-y-2" data-testid="preview-areas">
          {r.areas.map((a, i) => (
            <li key={a.id} className="grid grid-cols-[minmax(0,9rem)_1fr_2.2rem] items-center gap-3 text-[12.5px]">
              <span className="truncate text-ink-2">{words(a.id)}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-ink/[0.07]"><span className={`block h-full origin-left rounded-full ${a.score >= 8 ? 'bg-ink' : a.score >= 6 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${a.score * 10}%`, animation: `grow-x 700ms ${i * 60}ms both cubic-bezier(0.22,1,0.36,1)` }} /></span>
              <span className="text-right font-medium text-ink tabular-nums">{a.score}/10</span>
            </li>
          ))}
        </ul>
      </section>
      {r.feedback.length > 0 && (
        <section>
          <p className="eyebrow mb-2">What it flagged</p>
          <ol className="space-y-2.5" data-testid="preview-feedback">
            {r.feedback.map((f, i) => (
              <li key={i} className="animate-enter" style={{ animationDelay: `${i * 60}ms` }}>
                <button type="button" className="-mx-2 flex w-[calc(100%+1rem)] gap-2.5 rounded-xl px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-ink/[0.04]" title={f.quote ? 'Show it in the post' : undefined}
                  onClick={(e) => follow((e.currentTarget.closest('[data-testid="live-preview"]') ?? document).querySelector(`[data-testid="preview-post"] [data-n="${i + 1}"]`), true)}>
                  <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white ${f.severity === 'must' ? 'bg-red-600' : 'bg-amber-500'}`}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className="text-ink-3">{f.severity} · {words(f.area)}</span>
                    {f.quote && <span className="mt-0.5 block border-l-2 border-line-strong pl-2 text-ink-2 italic">“{f.quote}”</span>}
                    <span className="mt-0.5 block text-ink">{f.problem}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      {draft && <div><p className="eyebrow mb-2">The post, with what it flagged</p><Post markdown={draft.markdown} boxes={boxes} /></div>}
    </div>
  )
}

type Saved = { draft?: { post_markdown?: string; version?: number; title?: string; word_count?: number; reading?: { post_grade?: number } }; review?: { total?: number; pass?: boolean; version?: number; gates?: { id: string; passed: boolean }[]; areas?: { id: string; score: number }[]; feedback?: { severity: string; area: string; quote: string; problem: string; fix: string }[] } | null }

export function LivePreview({ view, briefId }: { view: RunView; briefId: string | null }) {
  const p = view.previews
  const working = workingAgent(view)
  // After the run (or a reload, when the live previews are gone): the saved draft and review.
  const needSaved = Boolean(briefId) && !p.writer.length && view.status !== 'running'
  const saved = useQuery({ queryKey: ['preview-saved', briefId], queryFn: () => api<Saved>(`/api/approvals/${briefId}`), enabled: needSaved, staleTime: 60_000, retry: false })
  const savedPass: WriterPass | undefined = needSaved && saved.data?.draft?.post_markdown
    ? { seq: 0, pass: 'final', version: saved.data.draft.version ?? null, title: saved.data.draft.title ?? '', markdown: saved.data.draft.post_markdown, words: saved.data.draft.word_count ?? null, grade: saved.data.draft.reading?.post_grade ?? null, hard: [], soft: [], fixes: [] }
    : undefined
  const sr = saved.data?.review
  const savedReview: ReviewerPreview | undefined = needSaved && sr && Array.isArray(sr.gates)
    ? { seq: 0, version: sr.version ?? null, total: sr.total ?? null, pass: sr.pass === true, passMark: null, gates: sr.gates.map(({ id, passed }) => ({ id, passed })), areas: (sr.areas ?? []).map(({ id, score }) => ({ id, score })), feedback: (sr.feedback ?? []).map(({ severity, area, quote, problem, fix }) => ({ severity, area, quote, problem, fix })) }
    : undefined
  const passes = p.writer.length ? p.writer : savedPass ? [savedPass] : []
  const reviews = p.reviewer.length ? p.reviewer : savedReview ? [savedReview] : []
  const has: Record<PreviewAgent, boolean> = { scout: p.scout.length > 0, editor: Boolean(p.editor), strategist: p.strategist.length > 0, writer: passes.length > 0, reviewer: reviews.length > 0 }
  const tabs = PREVIEW_AGENTS.filter((a) => has[a] || working === a)
  const [pinned, setPinned] = useState<PreviewAgent | null>(null)
  useEffect(() => setPinned(null), [working])
  const shown: PreviewAgent | null = (pinned && tabs.includes(pinned) ? pinned : null) ?? working ?? tabs.at(-1) ?? null
  const latestDraft = passes.at(-1)
  // The Reviewer is reading when it works on a draft it has not answered for yet.
  const reading = working === 'reviewer' && !(reviews.at(-1) && reviews.at(-1)!.seq > (latestDraft?.seq ?? 0))

  if (!shown) return <Empty>{view.status === 'running' ? 'The preview appears as soon as the first agent answers.' : 'No preview for this run.'}</Empty>
  return (
    <div data-testid="live-preview">
      <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Agents">
        {tabs.map((a) => (
          <button key={a} type="button" role="tab" aria-selected={a === shown} onClick={() => setPinned(a)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${a === shown ? 'bg-ink text-white' : 'bg-ink/[0.05] text-ink-2 hover:bg-ink/[0.09]'}`}>
            {a === working && <span className="size-1.5 animate-signal rounded-full bg-lime-400 text-lime-400" />}{NAME[a]}
          </button>
        ))}
      </div>
      <div key={shown} className="animate-fade">
        {shown === 'scout' && <ScoutView list={p.scout} view={view} />}
        {shown === 'editor' && <EditorView p={p.editor} />}
        {shown === 'strategist' && <StrategistView list={p.strategist} />}
        {shown === 'writer' && <WriterView passes={passes} checks={p.factcheck} />}
        {shown === 'reviewer' && <ReviewerView reviews={reviews} passes={passes} reading={reading} />}
      </div>
    </div>
  )
}
