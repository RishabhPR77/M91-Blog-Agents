// Automatic fix (code, 0 AI): a paragraph over PARAGRAPH_MAX_SENTENCES is split into shorter paragraphs at sentence
// ends. No word changes: the same sentences, in the same order, with a blank line between the groups. Only plain prose
// paragraphs are touched (not headings, lists, tables, quotes or code), and a split that would not leave every part
// within the limit, or that loses text, is not made.
import { sentences } from '../checks/readability.js'

const sentenceCount = (p) => sentences(p.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).length
const isProse = (l) => l.trim() !== '' && !/^\s*([-*+]|\d+[.)])\s+/.test(l) && !/^\s*\|/.test(l) && !/^\s*#/.test(l) && !/^\s*>/.test(l) && !/^\s*(`{3,}|~{3,})/.test(l)
// A sentence end: . ! ? (with closing quotes, brackets or emphasis), then a space. Inside a link's (url) there are no
// spaces, so a URL never splits.
const SPLIT_RE = /(?<=[.!?]["'”’)\]*_]*)\s+/

/** Splits one paragraph's text into groups of at most `max` sentences, as even as possible. null: leave it. */
export function splitParagraph(text, max) {
  const pieces = text.split(SPLIT_RE).filter((s) => s.trim())
  if (pieces.length <= max) return null
  // k groups, sizes differing by at most one, larger ones first (7 sentences, max 3 → 3, 2, 2).
  const k = Math.ceil(pieces.length / max)
  const groups = []
  for (let g = 0, i = 0; g < k; g++) {
    const size = Math.floor(pieces.length / k) + (g < pieces.length % k ? 1 : 0)
    groups.push(pieces.slice(i, i + size).join(' '))
    i += size
  }
  const same = groups.join(' ').replace(/\s+/g, ' ') === text.replace(/\s+/g, ' ').trim()
  if (!same || groups.some((g) => sentenceCount(g) > max) || groups.reduce((n, g) => n + sentenceCount(g), 0) !== sentenceCount(text)) return null
  return groups
}

/** Splits every prose paragraph over `max` sentences. Returns { markdown, fixes }. */
export function splitLongParagraphs(markdown, max = 3) {
  const lines = String(markdown ?? '').split('\n')
  const out = []
  let fence = null
  let block = []
  let split = 0
  const flush = () => {
    if (!block.length) return
    const text = block.join(' ').trim()
    const groups = sentenceCount(text) > max ? splitParagraph(text, max) : null
    if (groups) {
      out.push(groups.join('\n\n'))
      split++
    } else out.push(...block)
    block = []
  }
  for (const line of lines) {
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (f) {
      flush()
      fence = fence ? (f[1][0] === fence ? null : fence) : f[1][0]
      out.push(line)
    } else if (!fence && isProse(line)) block.push(line)
    else {
      flush()
      out.push(line)
    }
  }
  flush()
  return { markdown: out.join('\n'), fixes: split ? [`split ${split} paragraph(s) over ${max} sentences`] : [] }
}
