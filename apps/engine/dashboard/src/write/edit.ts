// The Write page's text helpers (2026-11-24): importing a .md file (front matter into the post's fields), the
// formatting buttons, inserting an image at the cursor, and the blog page the preview shows. Pure functions.
import { renderPost } from '../blogpreview/markdown.js'
import { postPage } from '../blogpreview/pages.js'

export type Fields = { title: string; slug: string; description: string; topic: string; tags: string; cover: string | null; markdown: string }
export type Edit = { value: string; start: number; end: number }

export const emptyFields = (): Fields => ({ title: '', slug: '', description: '', topic: '', tags: '', cover: null, markdown: '' })

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '')

/** The first "# Title" line, without Markdown marks. */
export const firstHeading = (md: string) => (md.match(/^#[ \t]+(.+?)[ \t#]*$/m)?.[1] ?? '').replace(/[*_`]/g, '').trim()

export const wordCount = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
export const readingMinutes = (md: string) => Math.max(1, Math.round(wordCount(md) / 230))

const unquote = (v: string) => v.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim()

/** YAML front matter (simple "key: value" lines and [a, b] lists) and the text after it. */
export function parseFrontMatter(text: string): { meta: Record<string, string | string[]>; body: string } {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!m) return { meta: {}, body: src }
  const meta: Record<string, string | string[]> = {}
  let listKey: string | null = null
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && listKey) {
      const list = Array.isArray(meta[listKey]) ? (meta[listKey] as string[]) : []
      meta[listKey] = [...list, unquote(item[1])]
      continue
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const [, key, raw] = kv
    listKey = raw.trim() ? null : key
    meta[key] = raw.trim().startsWith('[') ? raw.trim().replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean) : unquote(raw)
  }
  return { meta, body: src.slice(m[0].length).replace(/^\n+/, '') }
}

/** A .md file or pasted text into the post: its front matter fills the empty fields; the title falls back to "# Title". */
export function importMarkdown(text: string, current: Fields): Fields {
  const { meta, body } = parseFrontMatter(text)
  const one = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string) : '')
  const list = (k: string) => (Array.isArray(meta[k]) ? (meta[k] as string[]).join(', ') : one(k))
  const title = current.title || one('title') || firstHeading(body)
  return {
    ...current,
    markdown: body.trim() ? `${body.trim()}\n` : '',
    title,
    description: current.description || one('description') || one('summary') || one('excerpt'),
    topic: current.topic || one('topic') || one('category'),
    tags: current.tags || list('tags') || list('keywords'),
    slug: current.slug || (/^[a-z0-9-]+$/.test(one('slug')) ? one('slug') : '')
  }
}

/** Puts text in place of the selection; the caret ends after it (or selects the part given). */
export function replaceSelection(value: string, start: number, end: number, text: string, select?: [number, number]): Edit {
  const next = value.slice(0, start) + text + value.slice(end)
  return select ? { value: next, start: start + select[0], end: start + select[1] } : { value: next, start: start + text.length, end: start + text.length }
}

/** **bold**, _italic_, `code`: wraps the selection (or a placeholder, selected). Again on wrapped text unwraps it. */
export function wrap(value: string, start: number, end: number, mark: string, placeholder: string): Edit {
  const sel = value.slice(start, end)
  if (sel && value.slice(start - mark.length, start) === mark && value.slice(end, end + mark.length) === mark) {
    const next = value.slice(0, start - mark.length) + sel + value.slice(end + mark.length)
    return { value: next, start: start - mark.length, end: end - mark.length }
  }
  const inner = sel || placeholder
  return replaceSelection(value, start, end, `${mark}${inner}${mark}`, [mark.length, mark.length + inner.length])
}

/** ## Heading, > quote, - list, 1. list: on every line the selection touches (the same prefix again removes it). */
export function prefixLines(value: string, start: number, end: number, kind: 'h2' | 'h3' | 'quote' | 'bullet' | 'number'): Edit {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = value.indexOf('\n', end)
  const to = lineEnd === -1 ? value.length : lineEnd
  const lines = value.slice(from, to).split('\n')
  const marks = { h2: '## ', h3: '### ', quote: '> ', bullet: '- ', number: '' }
  const strip = (l: string) => l.replace(/^(#{1,6} |> |[-*+] |\d+\. )/, '')
  const has = (l: string) => (kind === 'number' ? /^\d+\. /.test(l) : l.startsWith(marks[kind]))
  const all = lines.every((l) => !l.trim() || has(l))
  let n = 0
  const out = lines.map((l) => {
    if (!l.trim()) return l
    if (all) return strip(l)
    n += 1
    return `${kind === 'number' ? `${n}. ` : marks[kind]}${strip(l)}`
  }).join('\n')
  return { value: value.slice(0, from) + out + value.slice(to), start: from, end: from + out.length }
}

/** [text](https://) with the address selected, ready to type. */
export function link(value: string, start: number, end: number): Edit {
  const text = value.slice(start, end) || 'link text'
  const piece = `[${text}](https://)`
  return replaceSelection(value, start, end, piece, [text.length + 3, piece.length - 1])
}

/** A block (an image, a divider) on its own lines at the caret. */
export function insertBlock(value: string, start: number, end: number, block: string): Edit {
  const before = value.slice(0, start)
  const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const after = value.slice(end)
  const trail = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const piece = `${lead}${block}${trail}`
  return replaceSelection(value, start, end, piece, [lead.length + block.length, lead.length + block.length])
}

/** "Lock screen alert.png" → "Lock screen alert". */
export const altFromFile = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/[[\]()]/g, '').trim().slice(0, 120) || 'Image'

export const isImageFile = (f: File) => /^image\/(png|jpeg|gif|webp)$/.test(f.type)
export const isMarkdownFile = (f: File) => /\.(md|markdown|mdx|txt)$/i.test(f.name) || f.type === 'text/markdown'

export const M91_URL = 'https://m91.msg91.com'

/**
 * The blog page for the preview: the blog's own renderer and template (copies of apps/m91-blog's), its stylesheet
 * inline, uploaded images from the engine, outside links inert and no script (the preview is for looking).
 */
export function previewHtml(f: Fields, { blogUrl, css, date }: { blogUrl: string; css: string; date: string | null }): string {
  const post = {
    slug: f.slug || slugify(f.title) || 'your-post',
    title: f.title || firstHeading(f.markdown) || 'Untitled post',
    description: f.description,
    topic: f.topic || null,
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    date,
    updated_at: null,
    reading_minutes: readingMinutes(f.markdown),
    cover: f.cover
  }
  const html = postPage({ siteUrl: blogUrl, m91Url: M91_URL }, { post, rendered: renderPost(f.markdown, { siteUrl: blogUrl }), more: [], assets: { css: '' } })
  const style = `<style>${css.replace(/<\/style/gi, '<\\/style')}\na:not([href^="#"]){pointer-events:none}</style>`
  return html
    .replace(/<link rel="stylesheet" href="[^"]*">/, () => style)
    .replace(/<script src="[^"]*" defer><\/script>/g, '')
    .replace(/(src=")\/images\//g, '$1/api/public/images/')
}
