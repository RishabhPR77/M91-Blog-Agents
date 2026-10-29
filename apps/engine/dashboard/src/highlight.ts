// "Show in post": finds the sentence a review note quotes in the reading view, marks it and scrolls to it. The quote
// is Markdown (links, bold, code) and the page is rendered text, so both are compared without the Markdown marks and
// with spaces collapsed. A long quote that is not found whole is looked up by its start.

const MARK = 'review-mark'
const FLASH = 'review-flash'

/** The quote as rendered text: link text without the URL, no * _ ` marks, single spaces, lower case. */
export function plainQuote(quote: string): string {
  return quote.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function clear(root: HTMLElement) {
  for (const m of [...root.querySelectorAll(`mark.${MARK}`)]) m.replaceWith(...m.childNodes)
  for (const el of [...root.querySelectorAll(`.${FLASH}`)]) el.classList.remove(FLASH)
  root.normalize()
}

/** Marks the quoted sentence in root; true when found. */
export function showInPost(root: HTMLElement | null, quote: string): boolean {
  if (!root || !quote.trim()) return false
  clear(root)
  const nodes: { node: Text; start: number }[] = []
  let full = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: full.length })
    full += (n as Text).data
  }
  // The rendered text, spaces collapsed and lower case, with each character's place in the full text.
  let norm = ''
  const at: number[] = []
  for (let i = 0; i < full.length; i++) {
    const space = /\s/.test(full[i])
    if (space && norm.endsWith(' ')) continue
    norm += space ? ' ' : full[i].toLowerCase()
    at.push(i)
  }
  const q = plainQuote(quote)
  const tries = [q, q.slice(0, 80).replace(/\s\S*$/, ''), q.slice(0, 40).replace(/\s\S*$/, '')].filter((t) => t.length >= 12 || t === q)
  let pos = -1
  let len = 0
  for (const t of tries) {
    pos = norm.indexOf(t)
    if (pos >= 0) { len = t.length; break }
  }
  if (pos < 0) return false
  const start = at[pos]
  const end = at[pos + len - 1] + 1
  // The text node holding a place: a start sits before a character of its node, an end just after one.
  const place = (offset: number, isEnd: boolean) => {
    const n = nodes.find((x) => (isEnd ? offset > x.start && offset <= x.start + x.node.data.length : offset >= x.start && offset < x.start + x.node.data.length)) ?? nodes[0]
    return { node: n.node, offset: offset - n.start }
  }
  const a = place(start, false)
  const b = place(end, true)
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  let target: Element | null = null
  try {
    const mark = document.createElement('mark')
    mark.className = MARK
    range.surroundContents(mark)
    target = mark
  } catch {
    // The quote crosses inline markup (a link, bold): the whole paragraph is flashed instead.
    target = a.node.parentElement?.closest('p, li, td, th, h1, h2, h3, h4, blockquote') ?? a.node.parentElement
    target?.classList.add(FLASH)
  }
  target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  return true
}
