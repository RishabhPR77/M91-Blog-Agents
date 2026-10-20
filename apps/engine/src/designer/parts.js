// The approved post as numbered parts (Phase 8, section 6.1): its top-level Markdown nodes in order, each with
// an exact source slice (from the parser's offsets), a short preview for the Designer and pattern flags.
// The body is the same Markdown the Publisher puts in a post's `markdown` (no H1, no TL;DR).

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { stripTitleAndTldr } from '../publisher/post.js'

export const PREVIEW_MAX = 160
const ITEM_WORDS = 8

const parser = unified().use(remarkParse).use(remarkGfm)

/** The body Markdown of a draft, exactly as the Publisher builds it. */
export function bodyMarkdown(postMarkdown) {
  return stripTitleAndTldr(postMarkdown).markdown
}

/** Plain text of an mdast node (what a reader sees). */
export function textOf(node) {
  if (!node) return ''
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
  if (node.type === 'code' || node.type === 'html') return node.value ?? ''
  if (node.type === 'break') return ' '
  return (node.children ?? []).map(textOf).join(node.type === 'list' || node.type === 'listItem' || node.type === 'tableRow' ? ' ' : '')
}

const squash = (s) => String(s).replace(/\s+/g, ' ').trim()
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
const firstWords = (s, n) => {
  const w = squash(s).split(' ')
  return w.length > n ? `${w.slice(0, n).join(' ')}…` : w.join(' ')
}

const FLOW_WORDS = /\b(agent|phone|rings?|ringing|approve[sd]?|approval|reject(s|ed)?|continue[sd]?|resumes?|decides?|answers?)\b/i

function flagsOf(node, text) {
  const flags = {}
  if (node.type === 'paragraph') {
    if (node.children?.[0]?.type === 'strong') flags.starts_with_bold = true
    if (/^likely cause\s*:/i.test(text)) flags.starts_with_likely_cause = true
    if (/^fix\s*:/i.test(text)) flags.starts_with_fix = true
  }
  if (node.type === 'heading' && /\?\s*$/.test(text)) flags.is_question = true
  if (node.type === 'list' && node.ordered) {
    const items = node.children ?? []
    const hits = items.filter((it) => FLOW_WORDS.test(textOf(it))).length
    if (items.length >= 3 && hits >= Math.ceil(items.length / 2)) flags.looks_like_flow = true
  }
  return flags
}

function previewOf(node, text) {
  switch (node.type) {
    case 'list':
      return cut((node.children ?? []).map((it, i) => `${node.ordered ? `${(node.start ?? 1) + i}.` : '-'} ${firstWords(textOf(it), ITEM_WORDS)}`).join(' | '), PREVIEW_MAX)
    case 'table':
      return cut(`columns: ${(node.children?.[0]?.children ?? []).map((c) => squash(textOf(c))).join(' | ')} · ${Math.max(0, (node.children?.length ?? 1) - 1)} rows`, PREVIEW_MAX)
    case 'code':
      return `${node.lang || 'text'} code · ${String(node.value ?? '').split('\n').length} lines`
    case 'thematicBreak':
      return '---'
    default:
      return cut(squash(text), PREVIEW_MAX)
  }
}

const TYPE_OF = { heading: 'heading', paragraph: 'paragraph', list: 'list', table: 'table', code: 'code', blockquote: 'blockquote', thematicBreak: 'thematicBreak' }

/**
 * Parses body Markdown into numbered parts.
 * @returns {{ markdown: string, parts: Part[] }}  Part: { id, type, depth?, ordered?, items?, lang?, lines?, preview,
 *   flags, start, end, source, node }. `node` (the mdast node, with offsets) is for the block builders only and is
 *   never sent to the AI. Unknown node types (html, definitions, footnotes) are listed as type "html" (plain text).
 */
export function parseParts(body) {
  const markdown = String(body ?? '').replace(/\r\n/g, '\n')
  const tree = parser.parse(markdown)
  const parts = (tree.children ?? []).map((node, i) => {
    const start = node.position.start.offset
    const end = node.position.end.offset
    const text = textOf(node)
    const type = TYPE_OF[node.type] ?? 'html'
    const part = { id: `N${i + 1}`, type, preview: previewOf(node, text), flags: flagsOf(node, squash(text)), start, end, source: markdown.slice(start, end) }
    if (node.type === 'heading') part.depth = node.depth
    if (node.type === 'list') Object.assign(part, { ordered: Boolean(node.ordered), items: node.children?.length ?? 0 })
    if (node.type === 'code') Object.assign(part, { lang: node.lang || '', lines: String(node.value ?? '').split('\n').length })
    Object.defineProperty(part, 'node', { value: node, enumerable: false })
    return part
  })
  return { markdown, parts }
}

/** What the Designer sees of a part: id, type, a few facts, the preview and the flags (never the full text). */
export function partForPrompt(p) {
  const facts = {}
  if (p.depth) facts.depth = p.depth
  if (p.type === 'list') Object.assign(facts, { ordered: p.ordered, items: p.items })
  if (p.type === 'code') Object.assign(facts, { lang: p.lang || 'text', lines: p.lines })
  return { id: p.id, type: p.type, ...facts, preview: p.preview, ...(Object.keys(p.flags).length && { flags: Object.keys(p.flags) }) }
}
