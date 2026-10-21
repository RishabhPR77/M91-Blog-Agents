// Guide → what the components render (Phase 10, B3). Markdown fields become HTML through the post pipeline
// (raw HTML dropped, code highlighted); short labels stay plain text (Astro escapes them). Chapter headings,
// problems and questions get unique ids, so links to them work. If anything cannot be prepared, the page
// shows the post without its guide (never a half-built page).
import type { Guide, GuideState } from './posts'
import { renderMarkdown, renderInline } from './markdown'
import type { Chapter } from './chapters'

type Html = string
export type FilePrep = { filename: string; language: string; what: string; html: Html; code: string; lines: number; preview: number | null }
export type GuideItem =
  | { type: 'prose'; id: string; html: Html }
  | { type: 'journey_steps'; id: string; steps: { title: string; html: Html }[]; current: number }
  | { type: 'phone_ring_sim'; id: string; moments: { actor: 'agent' | 'm91' | 'phone' | 'human' | 'software'; html: Html; decision: 'approve' | 'reject' | null }[] }
  | { type: 'approve_demo'; id: string; request: string; context: string | null; approve: { label: string; html: Html }; reject: { label: string; html: Html } }
  | { type: 'route_compare'; id: string; caption: string; routes: { name: string; best_for: string | null; stops: string[]; highlight: boolean }[] }
  | { type: 'steps_checklist'; id: string; intro: string | null; steps: { title: string | null; html: Html; stuck: { cause: Html; fix: Html } | null }[] }
  | { type: 'tool_picker'; id: string; question: string; options: { id: string; label: string; steps: Html[]; file: FilePrep | null; done: Html | null }[] }
  | { type: 'file_card'; id: string; file: FilePrep }
  | { type: 'troubleshooting_picker'; id: string; question: string; items: { anchor: string; problem: Html; cause: Html; fix: Html }[] }
  | { type: 'comparison_table'; id: string; caption: string | null; html: Html }
  | { type: 'faq'; id: string; items: { anchor: string; question: Html; answer: Html }[] }
export type PreparedChapter = { id: string; anchor: string; number: number; label: string; heading: string; intro: Html | null; items: GuideItem[] }
export type PreparedGuide = { chapters: PreparedChapter[]; rail: Chapter[]; states: GuideState[]; stuck: Chapter | undefined; questions: number }

/** A heading-style id: lower case, letters and digits joined by dashes; unique within the page. */
export function slugger() {
  const seen = new Map<string, number>()
  return (text: string) => {
    const base = text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section'
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n ? `${base}-${n}` : base
  }
}

const html = async (md: string) => (await renderMarkdown(md, { ids: [] })).html
const plain = (md: string) => md.replace(/[`*_]/g, '').trim()

function fenced(language: string, code: string): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((s) => s.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language === 'text' ? '' : language}\n${code}\n${fence}`
}

async function file(d: Record<string, any>): Promise<FilePrep> {
  const lines = String(d.code).split('\n').length
  const preview = typeof d.preview_lines === 'number' && d.preview_lines < lines ? d.preview_lines : null
  return { filename: d.filename, language: d.language, what: d.what, code: d.code, lines, preview, html: await html(fenced(d.language, d.code)) }
}

const ACTOR_DECISION = { approved: 'approve', rejected: 'reject' } as const

export async function prepareGuide(guide: Guide): Promise<{ ok: true; guide: PreparedGuide } | { ok: false; reason: string }> {
  const slug = slugger()
  try {
    const chapters: PreparedChapter[] = []
    for (const c of guide.chapters) {
      const anchor = slug(c.heading)
      const items: GuideItem[] = []
      for (const { type, id, data: d } of c.components) {
        switch (type) {
          case 'prose':
            items.push({ type, id, html: await html(d.markdown) })
            break
          case 'journey_steps': {
            const steps = []
            for (const s of d.steps) steps.push({ title: s.title, html: await renderInline(s.text_markdown) })
            items.push({ type, id, steps, current: d.current })
            break
          }
          case 'phone_ring_sim': {
            const moments = []
            for (const m of d.moments) moments.push({ actor: m.actor, html: await html(m.markdown), decision: (ACTOR_DECISION as Record<string, 'approve' | 'reject'>)[m.state] ?? null })
            items.push({ type, id, moments })
            break
          }
          case 'approve_demo':
            items.push({ type, id, request: d.request, context: d.context ?? null, approve: { label: d.approve.label, html: await html(d.approve.outcome_markdown) }, reject: { label: d.reject.label, html: await html(d.reject.outcome_markdown) } })
            break
          case 'route_compare':
            items.push({ type, id, caption: d.caption, routes: d.routes.map((r: Record<string, any>) => ({ name: r.name, best_for: r.best_for ?? null, stops: r.stops, highlight: Boolean(r.highlight) })) })
            break
          case 'steps_checklist': {
            const steps = []
            for (const s of d.steps) steps.push({ title: s.title ?? null, html: await html(s.markdown), stuck: s.stuck ? { cause: await html(s.stuck.cause_markdown), fix: await html(s.stuck.fix_markdown) } : null })
            items.push({ type, id, intro: d.intro ?? null, steps })
            break
          }
          case 'tool_picker': {
            const options = []
            for (const o of d.options) {
              const steps = []
              for (const s of o.steps) steps.push(await renderInline(s.markdown))
              options.push({ id: o.id, label: o.label, steps, file: o.file ? await file(o.file) : null, done: o.done_markdown ? await renderInline(o.done_markdown) : null })
            }
            items.push({ type, id, question: d.question, options })
            break
          }
          case 'file_card':
            items.push({ type, id, file: await file(d) })
            break
          case 'troubleshooting_picker': {
            const out = []
            for (const it of d.items) out.push({ anchor: slug(plain(it.problem_markdown)), problem: await renderInline(it.problem_markdown), cause: await html(it.cause_markdown), fix: await html(it.fix_markdown) })
            items.push({ type, id, question: d.question ?? 'What are you seeing?', items: out })
            break
          }
          case 'comparison_table':
            items.push({ type, id, caption: d.caption ?? null, html: await html(d.markdown) })
            break
          case 'faq': {
            const out = []
            for (const it of d.items) out.push({ anchor: slug(plain(it.question_markdown)), question: await renderInline(it.question_markdown), answer: await html(it.answer_markdown) })
            items.push({ type, id, items: out })
            break
          }
          default:
            return { ok: false, reason: `component ${id}: no renderer for "${type}"` }
        }
      }
      chapters.push({ id: c.id, anchor, number: c.number, label: c.label, heading: c.heading, intro: c.intro_markdown ? await html(c.intro_markdown) : null, items })
    }
    // Each chapter takes the newest status state that starts at or before it (the first state before that).
    const states = guide.status_states.map((s) => s.state)
    const rail: Chapter[] = chapters.map((c, i) => {
      const at = guide.status_states.filter((s) => guide.chapters.findIndex((x) => x.id === s.chapter) <= i).at(-1)
      return { id: c.anchor, text: c.heading, state: (at ?? guide.status_states[0]).state }
    })
    const stuckAt = chapters.findIndex((c) => c.items.some((x) => x.type === 'troubleshooting_picker'))
    const stuck = stuckAt >= 0 ? rail[stuckAt] : rail.find((c, i) => /stuck|troubleshoot|went wrong|fix/i.test(`${chapters[i].label} ${c.text}`))
    const questions = chapters.flatMap((c) => c.items).reduce((n, x) => n + (x.type === 'faq' ? x.items.length : 0), 0) + chapters.filter((c) => c.heading.trim().endsWith('?')).length
    return { ok: true, guide: { chapters, rail, states, stuck, questions } }
  } catch (error) {
    return { ok: false, reason: (error as Error).message }
  }
}
