// Post Markdown → HTML. Raw HTML in the Markdown is never rendered: remark-rehype drops it
// (allowDangerousHtml stays false), so a <script> or <b> in a post simply disappears.
// Interactive blocks (Phase 8) render their Markdown through this same pipeline.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeExternalLinks from 'rehype-external-links'
import rehypeShiki from '@shikijs/rehype'
import rehypeStringify from 'rehype-stringify'
import { SITE_URL } from '../config/site'

export type Heading = { depth: number; id: string; text: string }

type Node = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[]; value?: string }

const textOf = (n: Node): string => (n.type === 'text' ? n.value ?? '' : (n.children ?? []).map(textOf).join(''))
const HEADING = /^h[1-6]$/

/**
 * Collects headings (after their ids are set) and wraps tables so they scroll sideways on phones; each table
 * cell gets the column name as data-label, so a comparison table can become cards on narrow screens (CSS).
 * ids: a queue of heading ids to use instead of rehype-slug's (blocks take the ids the whole post would get).
 */
function collect(headings: Heading[], ids?: string[]) {
  return () => (tree: Node) => {
    const walk = (node: Node) => {
      node.children = (node.children ?? []).map((child) => {
        if (child.type === 'element' && HEADING.test(child.tagName ?? '')) {
          if (ids) child.properties = { ...child.properties, id: ids.shift() ?? '' }
          headings.push({ depth: Number(child.tagName!.slice(1)), id: String(child.properties?.id ?? ''), text: textOf(child).trim() })
        }
        if (child.type === 'element' && child.tagName === 'table') {
          labelCells(child)
          return { type: 'element', tagName: 'div', properties: { className: ['table-wrap'], tabIndex: 0, role: 'region', ariaLabel: 'Table' }, children: [child] }
        }
        walk(child)
        return child
      })
    }
    walk(tree)
  }
}

function labelCells(table: Node) {
  const rows: Node[] = []
  const gather = (n: Node) => (n.children ?? []).forEach((c) => (c.tagName === 'tr' ? rows.push(c) : gather(c)))
  gather(table)
  const head = rows.find((r) => (r.children ?? []).some((c) => c.tagName === 'th'))
  const names = (head?.children ?? []).filter((c) => c.tagName === 'th').map((c) => textOf(c).trim())
  for (const r of rows) {
    ;(r.children ?? []).filter((c) => c.tagName === 'td').forEach((c, i) => {
      if (names[i]) c.properties = { ...c.properties, dataLabel: names[i] }
    })
  }
}

const ownHost = new URL(SITE_URL).host

/**
 * @param markdown the Markdown to render
 * @param options.ids a shared queue of heading ids (blocks): each heading takes the next one
 */
export async function renderMarkdown(markdown: string, options: { ids?: string[] } = {}): Promise<{ html: string; headings: Heading[] }> {
  const headings: Heading[] = []
  let pipeline = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)
  if (!options.ids) pipeline = pipeline.use(rehypeSlug)
  const file = await pipeline
    .use(collect(headings, options.ids))
    .use(rehypeAutolinkHeadings, {
      behavior: 'append',
      properties: { className: ['heading-anchor'], ariaHidden: 'true', tabIndex: -1 },
      content: { type: 'text', value: '#' }
    })
    .use(rehypeExternalLinks, {
      target: '_blank',
      rel: ['noopener', 'noreferrer'],
      test: (el: Node) => {
        const href = String(el.properties?.href ?? '')
        return /^https?:\/\//.test(href) && new URL(href).host !== ownHost
      }
    })
    .use(rehypeShiki, { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: 'light' })
    .use(rehypeStringify)
    .process(markdown)
  return { html: String(file), headings }
}

/** Markdown that is one short line (a question, a choice, a problem) → HTML without its <p> wrapper. */
export async function renderInline(markdown: string): Promise<string> {
  const { html } = await renderMarkdown(markdown, { ids: [] })
  const m = html.trim().match(/^<p>([\s\S]*)<\/p>$/)
  return m && !m[1].includes('<p>') ? m[1] : html
}

/**
 * A list item's Markdown is sliced from the post as is, so its later lines keep the item's indentation
 * ("1. Step\n   What you should see: …"). Remove that shared indentation before rendering it on its own.
 */
export function dedent(markdown: string): string {
  const lines = markdown.split('\n')
  const rest = lines.slice(1).filter((l) => l.trim())
  if (!rest.length) return markdown
  const cut = Math.min(...rest.map((l) => l.match(/^ */)![0].length))
  return cut ? [lines[0], ...lines.slice(1).map((l) => l.slice(Math.min(cut, l.match(/^ */)![0].length)))].join('\n') : markdown
}
