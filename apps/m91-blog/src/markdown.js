// A post's Markdown as the article's HTML. The engine's export is plain Markdown (no HTML), laid out as:
//   # Title · the intro · ## TL;DR · the sections · ## Sources · ## Try M91
// The title is shown by the page itself, the intro becomes the lead, TL;DR a highlighted box, Sources a quiet list
// and Try M91 the closing panel. Safety: raw HTML is never rendered, and a link or image is kept only when its
// address is http(s), mailto, a site path or an in-page anchor.

import { Marked } from 'marked'

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c])

/** The address a link may use, or null. */
export function safeHref(href) {
  const h = String(href ?? '').trim()
  if (/^#[\w-]*$/.test(h) || /^\/(?!\/)[^\s]*$/.test(h)) return h
  try {
    const u = new URL(h)
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null
  } catch {
    return null
  }
}

/** A heading's text as an id: lower case, letters and digits joined by dashes. */
export const slugify = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'section'

/** The plain text of inline tokens (for ids and the table of contents). */
function plainText(tokens = []) {
  return tokens.map((t) => (t.tokens ? plainText(t.tokens) : t.type === 'br' ? ' ' : (t.text ?? ''))).join('').replace(/\s+/g, ' ').trim()
}

const KIND = [
  [/^tl;?\s?dr:?$/i, 'tldr'],
  [/^sources?$/i, 'sources'],
  [/^try m91$/i, 'cta']
]
const kindOf = (title) => KIND.find(([re]) => re.test(title.trim()))?.[1] ?? 'section'

/**
 * Renders a post. `siteUrl` decides which links stay in the tab (this blog) and which open a new one.
 * Returns { title, html, toc: [{ id, text }] }.
 */
export function renderPost(markdown, { siteUrl = '' } = {}) {
  const ids = new Map()
  const uniqueId = (text) => {
    const base = slugify(text)
    const n = (ids.get(base) ?? 0) + 1
    ids.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  }
  const own = (href) => href.startsWith('/') || href.startsWith('#') || (siteUrl && href.startsWith(`${siteUrl}/`))

  const marked = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      html: () => '',
      heading({ tokens, depth }) {
        const text = plainText(tokens)
        const level = Math.min(6, Math.max(2, depth))
        return `<h${level} id="${uniqueId(text)}">${this.parser.parseInline(tokens)}</h${level}>\n`
      },
      link({ href, title, tokens }) {
        const url = safeHref(href)
        const inner = this.parser.parseInline(tokens)
        if (!url) return inner
        const t = title ? ` title="${escapeHtml(title)}"` : ''
        const out = own(url) || url.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener noreferrer"'
        return `<a href="${escapeHtml(url)}"${t}${out}>${inner}</a>`
      },
      image({ href, text }) {
        const url = safeHref(href)
        if (!url || !/^https:\/\//.test(url)) return escapeHtml(text)
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}" loading="lazy" decoding="async">`
      },
      table(token) {
        const cell = (c, tag) => `<${tag}${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`
        const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`
        const rows = token.rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('')
        return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`
      }
    }
  })

  const tokens = marked.lexer(String(markdown ?? ''))
  const links = tokens.links
  const part = (list) => marked.parser(Object.assign(list, { links }))

  // The title: the first H1 (the page shows it in its header).
  let title = ''
  const h1 = tokens.findIndex((t) => t.type === 'heading' && t.depth === 1)
  if (h1 >= 0) {
    title = plainText(tokens[h1].tokens)
    tokens.splice(h1, 1)
  }

  // The intro (before the first H2), then one part per H2.
  const intro = []
  const sections = []
  for (const t of tokens) {
    if (t.type === 'heading' && t.depth === 2) sections.push({ heading: t, body: [] })
    else if (sections.length) sections.at(-1).body.push(t)
    else intro.push(t)
  }

  const html = []
  const toc = []
  if (intro.some((t) => t.type !== 'space')) html.push(`<div class="lead">${part(intro)}</div>`)
  for (const s of sections) {
    const text = plainText(s.heading.tokens)
    const kind = kindOf(text)
    const id = uniqueId(text)
    const inner = part(s.body)
    if (kind === 'tldr') {
      html.push(`<aside class="tldr" id="${id}" aria-label="TL;DR"><p class="tldr-k">TL;DR</p>${inner}</aside>`)
    } else if (kind === 'sources') {
      toc.push({ id, text })
      html.push(`<section class="sources" id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">${escapeHtml(text)}</h2>${inner}</section>`)
    } else if (kind === 'cta') {
      html.push(`<section class="cta" id="${id}" aria-labelledby="${id}-h"><p class="cta-k" id="${id}-h">${escapeHtml(text)}</p><div class="cta-body">${inner}</div></section>`)
    } else {
      toc.push({ id, text })
      html.push(`<h2 id="${id}">${marked.parseInline(s.heading.text ?? text)}</h2>\n${inner}`)
    }
  }
  return { title, html: html.join('\n'), toc }
}
