// The Markdown export (Phase 11): which draft is exported, the preview (nothing saved) and the final export
// (saved on Approve: one markdown_export record per brief in Mem0, and apps/engine/exports/<slug>.md).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBrief } from '../writer/inputs.js'
import { draftsOf, draftVersion, draftBriefVersion } from '../writer/save.js'
import { istIso } from '../util/time.js'
import { buildMarkdownExport } from './markdown.js'

export const DEFAULT_EXPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'exports')
export const exportDir = (config) => (config?.publish?.exportDir ? resolve(config.publish.exportDir) : DEFAULT_EXPORT_DIR)

export class ExportError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ExportError'
    this.code = code
    this.status = status
  }
}

/** The newest review of a draft version (and brief version), or null. */
export async function reviewFor(store, briefId, d) {
  const reviews = await store.getRecords({ type: 'review', brief_id: briefId })
  return reviews
    .filter((r) => Number(r.payload?.version ?? r.version) === draftVersion(d) && Number(r.payload?.brief_version ?? r.metadata?.brief_version ?? 1) === draftBriefVersion(d))
    .sort((a, b) => String(b.createdAt ?? b.date).localeCompare(String(a.createdAt ?? a.date)))[0] ?? null
}

/**
 * The draft to export: the given version, else the newest draft that has a review (an approved or published
 * draft counts as reviewed: you approved it). Throws 404/409 when there is none.
 */
export async function exportableDraft(store, briefId, { version } = {}) {
  const drafts = await draftsOf(store, briefId)
  if (!drafts.length) throw new ExportError('unknown_brief', `brief ${briefId} has no draft`, 404)
  for (const d of drafts) {
    if (version != null && draftVersion(d) !== Number(version)) continue
    const review = await reviewFor(store, briefId, d)
    if (review || ['approved', 'published'].includes(d.status)) return { draft: d, review: review?.payload ?? null }
  }
  throw new ExportError('not_reviewed', `brief ${briefId} has no reviewed draft${version != null ? ` v${version}` : ''} to export`, 409)
}

/** The export of a reviewed draft, built in memory (nothing saved). 0 AI calls. */
export async function previewExport({ store, config, briefId, version, now = Date.now }) {
  const { draft, review } = await exportableDraft(store, briefId, { version })
  const brief = (await loadBrief(store, briefId, draftBriefVersion(draft)))?.payload ?? {}
  const published = await store.getRecords({ type: 'published_post' })
  const built = buildMarkdownExport({ draft, brief, review, briefId, published, config, now })
  return { ...built, brief_id: briefId, version: draftVersion(draft), brief_version: draftBriefVersion(draft), draft_status: draft.status ?? null }
}

/** The brief's markdown_export record, or null. */
export async function latestExport(store, briefId) {
  const recs = await store.getRecords({ type: 'markdown_export', brief_id: briefId })
  return recs.sort((a, b) => String(b.payload?.exported_at ?? '').localeCompare(String(a.payload?.exported_at ?? '')))[0] ?? null
}

/**
 * The final export (on Approve, or `npm run export -- --save`): the markdown_export record of the brief is
 * created or replaced (one per brief), and the file is written to the exports folder. DRY_RUN writes the file
 * only. Returns { record_id, path, slug, filename, markdown, … }.
 */
export async function saveFinalExport({ store, config, briefId, version, now = Date.now, dir = exportDir(config) }) {
  const built = await previewExport({ store, config, briefId, version, now })
  // The hard check on the export: a file that still links to M91's docs is never written.
  if (built.docs_links?.length) throw new ExportError('docs_links', `the export still links to M91's docs: ${built.docs_links.slice(0, 3).join(', ')}`, 409)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, built.filename)
  writeFileSync(path, built.markdown, 'utf8')
  const payload = {
    brief_id: briefId, version: built.version, brief_version: built.brief_version, slug: built.slug, filename: built.filename,
    title: built.title, front_matter: built.front_matter, markdown: built.markdown, warnings: built.warnings,
    exported_at: istIso(new Date(now()))
  }
  const existing = await latestExport(store, briefId)
  const record = existing
    ? { id: existing.id, ...(await store.updateRecord(existing.id, payload, { status: 'final', slug: built.slug }, { known: existing })) }
    : await store.createRecord({ type: 'markdown_export', briefId, payload, status: 'final', version: built.version, meta: { slug: built.slug, brief_version: built.brief_version } })
  return { ...built, record_id: record?.id ?? existing?.id ?? null, path, exported_at: payload.exported_at, replaced: Boolean(existing) }
}

/**
 * Re-exports every approved (or published) post with the current export rules, e.g. no M91 docs links (0 AI
 * calls): for each brief, the newest approved draft gets its final export again (record replaced, file rewritten).
 * A post that fails is listed and the others go on. Returns { exported: [...], failed: [...] }.
 */
export async function reexportApproved({ store, config, now = Date.now, dir = exportDir(config) }) {
  const newest = new Map()
  for (const status of ['approved', 'published']) {
    for (const d of await store.getRecords({ type: 'draft', status })) {
      const briefId = d.briefId ?? d.payload?.brief_id
      if (!briefId || draftVersion(d) === null) continue
      const best = newest.get(briefId)
      if (!best || draftBriefVersion(d) > draftBriefVersion(best) || (draftBriefVersion(d) === draftBriefVersion(best) && draftVersion(d) > draftVersion(best))) newest.set(briefId, d)
    }
  }
  const exported = []
  const failed = []
  for (const [briefId, d] of newest) {
    try {
      const out = await saveFinalExport({ store, config, briefId, version: draftVersion(d), now, dir })
      exported.push({ brief_id: briefId, version: out.version, filename: out.filename, path: out.path, replaced: out.replaced, warnings: out.warnings })
    } catch (error) {
      failed.push({ brief_id: briefId, version: draftVersion(d), error: error.message })
    }
  }
  return { exported, failed }
}
