// The integrity check (Phase 8, section 6.3): blocks must carry exactly the approved post, nothing more,
// nothing less, nothing moved. If it fails, the post publishes as plain Markdown (blocks: null).
//
// 1. Coverage and order: every part is in exactly one block, in the original order.
// 2. Exactness: the blocks' source ranges, in order, rebuild the body Markdown (only the blank lines between
//    top-level parts may differ); a rich_text block's Markdown is exactly its range.
// 3. No new text: every text string in block data is a slice of its own block's range, in order, without
//    overlaps; and whatever the strings leave out of the range is only Markdown markup (list markers, heading
//    marks, code fences, quote marks), so no sentence is dropped either.

import { validateBlock } from '@m91/content'

/** Code-generated fields (never text from the post): skipped by the no-new-text check. */
const FIXED_FIELDS = new Set(['tone', 'actor', 'label', 'language'])

/** The text strings of a block's data, in source order (object keys are built in source order). */
export function textStrings(data) {
  const out = []
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (!FIXED_FIELDS.has(key)) out.push(v)
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k)
  }
  walk(data, null)
  return out
}

/** What may remain of a range once its text strings are taken out: Markdown markup and whitespace only. */
export function onlyMarkup(residue) {
  return residue
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*$/gm, '') // code fences with their language
    .replace(/^[ \t]*(\d{1,9}[.)]|[-*+])(?=\s)/gm, '') // list markers
    .replace(/^[ \t]*#{1,6}(?=\s|$)/gm, '') // heading marks
    .replace(/^[ \t]*>/gm, '') // quote marks
    .replace(/[:–—-]/g, '') // a colon or dash between a bold choice and its outcome
    .trim() === ''
}

/**
 * @param {{ markdown: string, parts: object[], blocks: object[], layout: { block_id, part_ids }[] }} input
 * @returns {{ passed: boolean, details: string[] }}  details: one line per problem (empty when it passes)
 */
export function checkIntegrity({ markdown: md, parts, blocks, layout }) {
  const details = []
  const byId = new Map(parts.map((p) => [p.id, p]))

  // 1. coverage and order
  if (!Array.isArray(blocks) || !Array.isArray(layout) || blocks.length !== layout.length) {
    return { passed: false, details: ['blocks and layout do not match'] }
  }
  const covered = layout.flatMap((l) => l.part_ids)
  const expected = parts.map((p) => p.id)
  if (covered.join(',') !== expected.join(',')) {
    const missing = expected.filter((id) => !covered.includes(id))
    const twice = covered.filter((id, i) => covered.indexOf(id) !== i)
    details.push(`coverage: parts must appear once each, in order${missing.length ? `; missing ${missing.join(', ')}` : ''}${twice.length ? `; used twice ${twice.join(', ')}` : ''}${!missing.length && !twice.length ? '; the order differs' : ''}`)
  }

  // 2. exactness: ranges in order, only whitespace between them, and they rebuild the body
  const ranges = layout.map((l) => {
    const first = byId.get(l.part_ids[0])
    const last = byId.get(l.part_ids.at(-1))
    return first && last ? { start: first.start, end: last.end } : null
  })
  if (ranges.some((r) => !r)) details.push('exactness: a block refers to an unknown part')
  else {
    let cursor = 0
    ranges.forEach((r, i) => {
      if (r.start < cursor) details.push(`exactness: block ${blocks[i].id} starts before the previous one ends`)
      else if (md.slice(cursor, r.start).trim() !== '') details.push(`exactness: text before block ${blocks[i].id} is in no block`)
      cursor = Math.max(cursor, r.end)
    })
    if (md.slice(cursor).trim() !== '') details.push('exactness: text after the last block is in no block')
  }

  // 3. each block: ids, schema, rich_text exact, no new text, nothing dropped
  blocks.forEach((b, i) => {
    if (b.id !== `b${i + 1}`) details.push(`ids: block ${i + 1} has id "${b.id}", expected b${i + 1}`)
    const schemaErrors = validateBlock(b, `/blocks/${i}`)
    if (schemaErrors.length) details.push(`schema: ${schemaErrors[0]}`)
    const r = ranges[i]
    if (!r) return
    const range = md.slice(r.start, r.end)
    if (b.type === 'rich_text') {
      if (b.data?.markdown !== range) details.push(`exactness: rich_text ${b.id} differs from its parts`)
      return
    }
    let cursor = 0
    let residue = ''
    for (const s of textStrings(b.data)) {
      const at = s === '' ? cursor : range.indexOf(s, cursor)
      if (at < 0) {
        details.push(`no new text: ${b.type} ${b.id} has text that is not in its parts (in order): "${s.slice(0, 60)}"`)
        return
      }
      residue += range.slice(cursor, at)
      cursor = at + s.length
    }
    residue += range.slice(cursor)
    if (!onlyMarkup(residue)) details.push(`no new text: ${b.type} ${b.id} leaves out text from its parts: "${residue.replace(/\s+/g, ' ').trim().slice(0, 60)}"`)
  })

  return { passed: details.length === 0, details }
}
