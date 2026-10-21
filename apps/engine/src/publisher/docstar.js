// The Docstar target (Phase 11, PUBLISH_TARGET=docstar). The interface is final: create a page, update a page,
// unpublish a page. Until DOCSTAR_API_URL, DOCSTAR_API_KEY and DOCSTAR_COLLECTION_ID are set, every call answers
// { ok: false, status: "not_configured" } and nothing is sent.
//
// What Docstar documents publicly (docstar.io/help, read 2026-10-21): pages live in collections; the editor turns
// Markdown into blocks (headings, lists, quotes, fenced code with a language, tables, links, images; no general
// HTML); API tokens start with "hm_" and go in "Authorization: Bearer <token>". The REST paths and field names
// for pages are not in the public docs, so the transport below is a placeholder: once the API reference is
// available, implement `transport` (one function per operation) and nothing else changes. Until then a configured
// adapter answers "not_implemented". The token is never logged or returned.

export const DOCSTAR_KEYS = Object.freeze(['DOCSTAR_API_URL', 'DOCSTAR_API_KEY', 'DOCSTAR_COLLECTION_ID'])

/** The transport used until Docstar's page endpoints are known. */
export const PENDING_TRANSPORT = Object.freeze({
  async createPage() { return { ok: false, status: 'not_implemented' } },
  async updatePage() { return { ok: false, status: 'not_implemented' } },
  async unpublishPage() { return { ok: false, status: 'not_implemented' } }
})

const NOT_IMPLEMENTED = "Docstar's page endpoints are not in its public docs yet: fill in the transport in src/publisher/docstar.js when the API reference is available"

/**
 * @param {{ config, transport?: { createPage, updatePage, unpublishPage }, fetch? }} deps
 *   transport functions get ({ apiUrl, collectionId, headers, fetch }, input) and return { ok, status, page_id?, url?, error? }
 */
export function createDocstar({ config, transport = PENDING_TRANSPORT, fetch = globalThis.fetch } = {}) {
  const ds = config?.docstar ?? {}
  const missing = [['DOCSTAR_API_URL', ds.apiUrl], ['DOCSTAR_API_KEY', ds.apiKey], ['DOCSTAR_COLLECTION_ID', ds.collectionId]].filter(([, v]) => !v).map(([k]) => k)
  const configured = missing.length === 0
  const ctx = () => ({ apiUrl: ds.apiUrl, collectionId: ds.collectionId, headers: { Authorization: `Bearer ${ds.apiKey}`, 'Content-Type': 'application/json' }, fetch })
  const notConfigured = () => ({ ok: false, status: 'not_configured', missing, message: `Docstar is not configured: set ${missing.join(', ')} in .env` })

  async function call(op, input) {
    if (!configured) return notConfigured()
    try {
      const r = await transport[op](ctx(), input)
      if (r?.status === 'not_implemented') return { ok: false, status: 'not_implemented', message: NOT_IMPLEMENTED }
      return r
    } catch (error) {
      // Never echo the token: errors carry their message only.
      return { ok: false, status: 'error', error: String(error?.message ?? error).replaceAll(ds.apiKey, `${ds.apiKey.slice(0, 4)}…`) }
    }
  }

  return {
    configured,
    missing,
    /** A new page: { title, slug, markdown } (markdown without front matter). */
    createPage: (input) => call('createPage', input),
    /** An existing page: { page_id, title, slug, markdown }. */
    updatePage: (input) => call('updatePage', input),
    /** Takes a page off the public site: { page_id }. */
    unpublishPage: (input) => call('unpublishPage', input)
  }
}

/**
 * Publishes a brief's final Markdown export to Docstar (create, or update if the export already has a page id).
 * Saves the page id on the markdown_export record when Docstar answers ok. Returns a run result.
 */
export async function publishToDocstar({ store, docstar, exportRecord }) {
  if (!exportRecord) return { status: 'no_export', summary: 'no final Markdown export for this brief: approve it first', warnings: [] }
  const p = exportRecord.payload
  const input = { title: p.title, slug: p.slug, markdown: bodyOf(p.markdown) }
  const r = p.docstar_page_id ? await docstar.updatePage({ ...input, page_id: p.docstar_page_id }) : await docstar.createPage(input)
  if (!r.ok) return { status: r.status, summary: `Docstar: ${r.message ?? r.error ?? r.status} (the Markdown export is saved: ${p.filename})`, warnings: [r.message ?? r.error ?? r.status] }
  await store.updateRecord(exportRecord.id, { ...p, docstar_page_id: r.page_id ?? p.docstar_page_id ?? null, docstar_url: r.url ?? null, docstar_published_at: new Date().toISOString() }, { status: 'published' }, { known: exportRecord })
  return { status: 'published', summary: `Docstar page ${p.docstar_page_id ? 'updated' : 'created'}: ${r.url ?? r.page_id ?? p.slug}`, warnings: [] }
}

/** The file without its YAML front matter (Docstar documents none; title and slug go as fields). */
export const bodyOf = (markdown) => String(markdown ?? '').replace(/^---\n[\s\S]*?\n---\n+/, '')
