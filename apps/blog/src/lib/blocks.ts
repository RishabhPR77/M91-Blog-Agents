// Interactive blocks (Phase 8): their Markdown → HTML, prepared once at build time for the components.
// Every text field went through the engine's integrity check; here it goes through the same Markdown pipeline
// as a normal post (no raw HTML, safe external links, Shiki). Labels and button text live in the components.
//
// prepareBlocks never half-renders: an unknown or not-yet-built block type, bad data, a rendering error or
// heading ids that don't line up → { ok: false, reason } and the page shows the whole post's Markdown.
import { BUILT_BLOCK_TYPES } from '@m91/content/blocks'
import { renderMarkdown, renderInline, dedent } from './markdown'

export type Block = { type: string; id: string; data: Record<string, unknown> }
export type Prepared =
  | { type: 'rich_text'; id: string; html: string }
  | { type: 'callout'; id: string; tone: 'info' | 'tip' | 'warning'; html: string }
  | { type: 'steps_checklist'; id: string; steps: string[] }
  | { type: 'code_tabs'; id: string; tabs: { label: string; language: string; html: string }[] }
  | { type: 'comparison_table'; id: string; html: string }
  | { type: 'faq_accordion'; id: string; items: { anchor: string; question: string; answer: string }[] }
  | { type: 'phone_ring_sim'; id: string; moments: { actor: Actor; html: string; decision: 'approve' | 'reject' | null }[] }
  | { type: 'escalation_timeline'; id: string; steps: string[] }
  | { type: 'agent_terminal_replay'; id: string; language: string; lines: string[] }
  | { type: 'choice_explorer'; id: string; options: { choice: string; outcome: string }[] }
  | { type: 'troubleshooting_picker'; id: string; items: { anchor: string; problem: string; cause: string; fix: string }[] }
export type Actor = 'agent' | 'm91' | 'phone' | 'human' | 'software'

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !v) throw new Error(`${what} is missing`)
  return v
}
const list = (v: unknown, what: string): Record<string, unknown>[] => {
  if (!Array.isArray(v) || !v.length) throw new Error(`${what} is missing`)
  return v as Record<string, unknown>[]
}

/** A fence longer than any backtick run inside the code, so the code is shown exactly as written. */
function fenced(language: string, code: string): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((s) => s.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${code}\n${fence}`
}

const REJECTS = /\b(reject|rejects|rejected|deny|denies|denied|decline|declines|declined)\b/i

/**
 * @param blocks the post's blocks (validated with @m91/content when the post was loaded)
 * @param headingIds the ids of every heading of the whole post, in order (from rendering post.markdown)
 */
export async function prepareBlocks(blocks: Block[], headingIds: string[]): Promise<{ ok: true; items: Prepared[] } | { ok: false; reason: string }> {
  const ids = [...headingIds]
  const items: Prepared[] = []
  try {
    for (const b of blocks) {
      if (!BUILT_BLOCK_TYPES.includes(b.type)) return { ok: false, reason: `block ${b.id}: "${b.type}" is not built yet` }
      const d = b.data
      const md = async (s: unknown, what: string) => (await renderMarkdown(str(s, what), { ids })).html
      const nextId = () => {
        const id = ids.shift()
        if (!id) throw new Error('heading ids do not line up with the blocks')
        return id
      }
      switch (b.type) {
        case 'rich_text':
          items.push({ type: 'rich_text', id: b.id, html: await md(d.markdown, 'markdown') })
          break
        case 'callout':
          if (!['info', 'tip', 'warning'].includes(String(d.tone))) throw new Error('callout tone is not valid')
          items.push({ type: 'callout', id: b.id, tone: d.tone as 'info' | 'tip' | 'warning', html: await md(d.markdown, 'markdown') })
          break
        case 'steps_checklist':
        case 'escalation_timeline': {
          const steps = []
          for (const s of list(d.steps, 'steps')) steps.push(await md(dedent(str(s.markdown, 'step')), 'step'))
          items.push({ type: b.type, id: b.id, steps })
          break
        }
        case 'code_tabs': {
          const tabs = []
          for (const t of list(d.tabs, 'tabs')) {
            const language = String(t.language ?? 'text')
            tabs.push({ label: str(t.label, 'tab label'), language, html: (await renderMarkdown(fenced(language === 'text' ? '' : language, str(t.code, 'code')), { ids: [] })).html })
          }
          items.push({ type: 'code_tabs', id: b.id, tabs })
          break
        }
        case 'comparison_table':
          items.push({ type: 'comparison_table', id: b.id, html: await md(d.markdown, 'table') })
          break
        case 'faq_accordion': {
          const out = []
          for (const it of list(d.items, 'questions')) {
            const anchor = nextId() // the question is an H3 in the post: it keeps that heading's id
            out.push({ anchor, question: await renderInline(str(it.question_markdown, 'question')), answer: await md(it.answer_markdown, 'answer') })
          }
          items.push({ type: 'faq_accordion', id: b.id, items: out })
          break
        }
        case 'phone_ring_sim': {
          const moments = []
          for (const m of list(d.moments, 'moments')) {
            const actor = String(m.actor) as Actor
            if (!['agent', 'm91', 'phone', 'human', 'software'].includes(actor)) throw new Error('unknown actor')
            const text = dedent(str(m.markdown, 'moment'))
            moments.push({ actor, html: await md(text, 'moment'), decision: actor === 'human' ? (REJECTS.test(text) ? 'reject' as const : 'approve' as const) : null })
          }
          items.push({ type: 'phone_ring_sim', id: b.id, moments })
          break
        }
        case 'agent_terminal_replay': {
          const lines = list(d.lines as unknown as Record<string, unknown>[], 'lines').map((l) => String(l))
          items.push({ type: 'agent_terminal_replay', id: b.id, language: String(d.language ?? 'text'), lines })
          break
        }
        case 'choice_explorer': {
          const options = []
          for (const o of list(d.options, 'choices')) options.push({ choice: await renderInline(str(o.choice_markdown, 'choice')), outcome: await md(o.outcome_markdown, 'outcome') })
          items.push({ type: 'choice_explorer', id: b.id, options })
          break
        }
        case 'troubleshooting_picker': {
          const out = []
          for (const it of list(d.items, 'problems')) {
            const anchor = nextId()
            out.push({ anchor, problem: await renderInline(str(it.problem_markdown, 'problem')), cause: await md(it.cause_markdown, 'cause'), fix: await md(it.fix_markdown, 'fix') })
          }
          items.push({ type: 'troubleshooting_picker', id: b.id, items: out })
          break
        }
        default:
          return { ok: false, reason: `block ${b.id}: no component for "${b.type}"` }
      }
    }
  } catch (error) {
    return { ok: false, reason: (error as Error).message }
  }
  if (ids.length) return { ok: false, reason: `heading ids do not line up with the blocks (${ids.length} left over)` }
  return { ok: true, items }
}
