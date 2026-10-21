// Which blocks a post is published with (Phase 8, section 8). Pure: the draft's interactive flag, its newest
// block_doc and the body Markdown in; blocks (or null) and a short note out.
// The block_doc's integrity is checked again against the body being published now, so blocks never go out
// with text that differs from the approved post (for example if the draft changed after the Designer ran).

import { createHash } from 'node:crypto'
import { parseParts } from '../designer/parts.js'
import { checkIntegrity } from '../designer/integrity.js'

/** The body a guide was built from, as a hash (CRLF counted as LF). */
export const bodyHash = (markdown) => createHash('sha256').update(String(markdown ?? '').replace(/\r\n/g, '\n')).digest('hex')

/** The newest block_doc (Phase 8) of a brief's draft version, or null. */
export async function latestBlockDoc(store, briefId, version) {
  const docs = await store.getRecords({ type: 'block_doc', brief_id: briefId })
  return docs
    .filter((d) => Number(d.payload?.version ?? d.version) === Number(version))
    .sort((a, b) => String(b.payload?.created_at ?? b.createdAt ?? b.date).localeCompare(String(a.payload?.created_at ?? a.createdAt ?? a.date)))[0] ?? null
}

/**
 * Phase 10: the guide a post is published with. Pure: the interactive flag, the newest guide_doc of the draft's
 * version and the body Markdown in. The guide is used only if it was built from exactly this body (its hash);
 * otherwise the post goes out without it (blocks or Markdown), with a warning.
 * @returns {{ guide: object|null, note: string, warning?: string }}
 */
export function chooseGuide({ interactive, doc, markdown }) {
  if (!interactive) return { guide: null, note: 'no guide (interactive off)' }
  if (!doc) return { guide: null, note: 'no guide (no Experience Designer result for this version)' }
  if (doc.status !== 'ok' || !doc.payload?.guide) return { guide: null, note: 'no guide (Experience Designer fallback)' }
  if (doc.payload.body_sha256 !== bodyHash(markdown)) {
    return { guide: null, note: 'no guide (the post changed)', warning: 'guide not used: it was built from a different version of the post text' }
  }
  const g = doc.payload.guide
  const n = g.chapters.flatMap((c) => c.components).filter((x) => x.type !== 'prose').length
  return { guide: g, note: `guide: ${g.chapters.length} chapters, ${n} components` }
}

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
