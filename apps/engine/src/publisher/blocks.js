// Which blocks a post is published with (Phase 8, section 8). Pure: the draft's interactive flag, its newest
// block_doc and the body Markdown in; blocks (or null) and a short note out.
// The block_doc's integrity is checked again against the body being published now, so blocks never go out
// with text that differs from the approved post (for example if the draft changed after the Designer ran).

import { parseParts } from '../designer/parts.js'
import { checkIntegrity } from '../designer/integrity.js'

/**
 * @param {{ interactive: boolean, doc: object|null, markdown: string }} input  doc: the newest block_doc of the
 *   draft's version (or null); markdown: the post's body Markdown (no H1, no TL;DR).
 * @returns {{ blocks: object[]|null, note: string, warning?: string }}
 */
export function chooseBlocks({ interactive, doc, markdown }) {
  if (!interactive) return { blocks: null, note: 'plain Markdown (interactive off)' }
  if (!doc) return { blocks: null, note: 'plain Markdown (no Designer result for this version)' }
  if (doc.status !== 'ok') return { blocks: null, note: 'plain Markdown (Designer fallback)' }
  const blocks = doc.payload?.blocks
  if (!Array.isArray(blocks) || !blocks.length) return { blocks: null, note: 'plain Markdown (no interactive blocks chosen)' }
  const parsed = parseParts(markdown)
  const integrity = checkIntegrity({ markdown: parsed.markdown, parts: parsed.parts, blocks, layout: doc.payload?.layout ?? [] })
  if (!integrity.passed) {
    return {
      blocks: null,
      note: 'plain Markdown (integrity check failed)',
      warning: `blocks not used: they no longer match the post (${integrity.details.slice(0, 2).join('; ')})`
    }
  }
  const interactiveCount = blocks.filter((b) => b.type !== 'rich_text').length
  return { blocks, note: `${interactiveCount} interactive block${interactiveCount === 1 ? '' : 's'}` }
}
