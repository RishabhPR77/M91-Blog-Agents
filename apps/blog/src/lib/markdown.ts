// Post Markdown → HTML. Raw HTML in the Markdown is never rendered: remark-rehype drops it
// (allowDangerousHtml stays false), so a <script> or <b> in a post simply disappears.
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

/** Collects H2/H3 headings (after rehype-slug gave them ids) and wraps tables so they scroll sideways on phones. */
function collect(headings: Heading[]) {
  return () => (tree: Node) => {
    const walk = (node: Node) => {
      node.children = (node.children ?? []).map((child) => {
        if (child.type === 'element' && (child.tagName === 'h2' || child.tagName === 'h3')) {
          headings.push({ depth: child.tagName === 'h2' ? 2 : 3, id: String(child.properties?.id ?? ''), text: textOf(child).trim() })
        }
        if (child.type === 'element' && child.tagName === 'table') {
          return { type: 'element', tagName: 'div', properties: { className: ['table-wrap'], tabIndex: 0, role: 'region', ariaLabel: 'Table' }, children: [child] }
        }
        walk(child)
        return child
      })
    }
    walk(tree)
  }
}

const ownHost = new URL(SITE_URL).host

export async function renderMarkdown(markdown: string): Promise<{ html: string; headings: Heading[] }> {
  const headings: Heading[] = []
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(collect(headings))
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
