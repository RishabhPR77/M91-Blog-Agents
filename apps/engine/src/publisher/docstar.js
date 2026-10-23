// The Docstar target (Phase 11, PUBLISH_TARGET=docstar): create a page, update a page, unpublish a page. Until
// DOCSTAR_API_URL, DOCSTAR_API_KEY, DOCSTAR_COLLECTION_ID and DOCSTAR_ORG_ID are set, every call answers
// { ok: false, status: "not_configured" } and nothing is sent.
//
// Docstar's API (developers.docstar.io, Pages, Page Content and Collections modules, read 2026-10-23). Base URL
// https://api.docstar.io; "Authorization: Bearer hm_…"; every path names the workspace: /orgs/<orgId>/…
// - GET   /orgs/:orgId/collections/:collectionId   → the collection; "pages.rootParentId" is its invisible top page
// - POST  /orgs/:orgId/pages/:parentId             → a new page under the parent { name, urlName, state: 1 } (draft)
// - POST  /orgs/:orgId/pages/:pageId/ydoc          → the page body { content: Markdown } (the draft; not the state)
// - PUT   /orgs/:orgId/pages/:pageId               → rename { name } or the body { contents: Markdown }; any edit
//                                                     moves the page back to draft
// - PATCH /orgs/:orgId/pages/:pageId/meta          → SEO { data: { title, description, tags } }
// - PATCH /orgs/:orgId/pages/:pageId/state         → { state: 2 } publishes (answers publicUrl), { state: 1 }
//                                                     unpublishes (back to draft; nothing is deleted)
// The token is never logged or returned: errors are masked.

export const DOCSTAR_KEYS = Object.freeze(['DOCSTAR_API_URL', 'DOCSTAR_API_KEY', 'DOCSTAR_COLLECTION_ID', 'DOCSTAR_ORG_ID'])

export const STATE_DRAFT = 1
export const STATE_PUBLISHED = 2

export class DocstarError extends Error {
  constructor(message, { status = null, pageId = null } = {}) {
    super(message)
    this.name = 'DocstarError'
    this.httpStatus = status
    this.pageId = pageId
  }
}

/** One request. Answers the JSON body (unwrapping a { data } envelope); throws DocstarError on a non-2xx answer. */
async function request(ctx, method, path, body) {
  const res = await ctx.fetch(`${ctx.apiUrl}${path}`, { method, headers: ctx.headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(ctx.timeoutMs ?? 30000) })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch {}
  if (!res.ok) throw new DocstarError(`${method} ${path.replace(/\/orgs\/[^/]+/, '/orgs/…')}: HTTP ${res.status}${json?.message ? ` (${json.message})` : text ? ` (${text.slice(0, 200)})` : ''}`, { status: res.status })
  return json && typeof json === 'object' && json.data !== undefined && !Array.isArray(json) && Object.keys(json).length <= 3 ? json.data : json
}

const org = (ctx) => `/orgs/${encodeURIComponent(ctx.orgId)}`

/**
 * The collection's invisible top page: new posts are created under it. Only the list of collections carries it
 * ("pages.rootParentId"); the single-collection answer does not (seen 2026-10-23).
 */
export async function rootParentId(ctx) {
  const list = await request(ctx, 'GET', `${org(ctx)}/collections`)
  const items = Array.isArray(list) ? list : list?.collections ?? list?.data ?? []
  const col = items.find((c) => c?.id === ctx.collectionId)
  if (!col) throw new DocstarError(`collection ${ctx.collectionId} is not in this workspace (is DOCSTAR_COLLECTION_ID right?)`)
  const id = col['pages.rootParentId'] ?? col.pages?.rootParentId ?? col.rootParentId
  if (!id) throw new DocstarError(`collection ${ctx.collectionId} has no rootParentId`)
  return id
}

/**
 * Writes the body. The realtime editor endpoint first; when the page has no editor document yet, the page's Markdown
 * "contents" instead. Docstar's docs say that case answers HTTP 200 without a success flag; a new page actually
 * answers HTTP 404 "Document not found in store" (seen 2026-10-23). Both fall back.
 */
async function writeBody(ctx, pageId, markdown) {
  let r = null
  try {
    r = await request(ctx, 'POST', `${org(ctx)}/pages/${pageId}/ydoc`, { content: markdown })
  } catch (error) {
    if (error?.httpStatus !== 404) throw error
  }
  if (r?.success === true) return 'ydoc'
  await request(ctx, 'PUT', `${org(ctx)}/pages/${pageId}`, { contents: markdown })
  return 'contents'
}

const writeMeta = (ctx, pageId, { seo_title, description, tags }) =>
  request(ctx, 'PATCH', `${org(ctx)}/pages/${pageId}/meta`, { data: { title: seo_title, ...(description ? { description } : {}), ...(tags?.length ? { tags } : {}) } })

async function setState(ctx, pageId, state) {
  const r = await request(ctx, 'PATCH', `${org(ctx)}/pages/${pageId}/state`, { state })
  return { url: r?.publicUrl ?? null, published: r?.isPublished === true || r?.state === STATE_PUBLISHED }
}

/** The real transport. Each function gets (ctx, input) and answers { ok, status, page_id, url, steps }. */
export const DOCSTAR_TRANSPORT = Object.freeze({
  async createPage(ctx, input) {
    const parent = await rootParentId(ctx)
    const created = await request(ctx, 'POST', `${org(ctx)}/pages/${parent}`, { name: input.title, urlName: input.slug, state: STATE_DRAFT })
    const pageId = created?.page?.id ?? created?.id
    if (!pageId) throw new DocstarError('Docstar created the page but answered no page id')
    // From here on a failure still reports the page id, so the next try updates this page instead of a duplicate.
    try {
      const body = await writeBody(ctx, pageId, input.markdown)
      await writeMeta(ctx, pageId, input)
      if (input.draft) return { ok: true, status: 'draft', page_id: pageId, url: created?.publicUrl ?? null, steps: ['create', body, 'meta'] }
      const s = await setState(ctx, pageId, STATE_PUBLISHED)
      return { ok: true, status: 'published', page_id: pageId, url: s.url, steps: ['create', body, 'meta', 'publish'] }
    } catch (error) {
      error.pageId = pageId
      throw error
    }
  },

  async updatePage(ctx, input) {
    const pageId = input.page_id
    await request(ctx, 'PUT', `${org(ctx)}/pages/${pageId}`, { name: input.title })
    const body = await writeBody(ctx, pageId, input.markdown)
    await writeMeta(ctx, pageId, input)
    if (input.draft) return { ok: true, status: 'draft', page_id: pageId, url: null, steps: ['rename', body, 'meta'] }
    const s = await setState(ctx, pageId, STATE_PUBLISHED)
    return { ok: true, status: 'published', page_id: pageId, url: s.url, steps: ['rename', body, 'meta', 'publish'] }
  },

  async unpublishPage(ctx, input) {
    if (!input.page_id) return { ok: false, status: 'no_page', message: 'this post has no Docstar page' }
    await setState(ctx, input.page_id, STATE_DRAFT)
    return { ok: true, status: 'unpublished', page_id: input.page_id }
  }
})

/**
 * @param {{ config, transport?: { createPage, updatePage, unpublishPage }, fetch? }} deps
 *   transport functions get ({ apiUrl, orgId, collectionId, headers, fetch }, input) and return { ok, status, page_id?, url?, error? }
 */
export function createDocstar({ config, transport = DOCSTAR_TRANSPORT, fetch = globalThis.fetch } = {}) {
  const ds = config?.docstar ?? {}
  const missing = [['DOCSTAR_API_URL', ds.apiUrl], ['DOCSTAR_API_KEY', ds.apiKey], ['DOCSTAR_COLLECTION_ID', ds.collectionId], ['DOCSTAR_ORG_ID', ds.orgId]].filter(([, v]) => !v).map(([k]) => k)
  const configured = missing.length === 0
  const ctx = () => ({ apiUrl: ds.apiUrl, orgId: ds.orgId, collectionId: ds.collectionId, headers: { Authorization: `Bearer ${ds.apiKey}`, 'Content-Type': 'application/json' }, fetch })
  const notConfigured = () => ({ ok: false, status: 'not_configured', missing, message: `Docstar is not configured: set ${missing.join(', ')} in .env` })
  const masked = (s) => (ds.apiKey ? String(s).replaceAll(ds.apiKey, `${ds.apiKey.slice(0, 4)}…`) : String(s))

  async function call(op, input) {
    if (!configured) return notConfigured()
    try {
      return await transport[op](ctx(), input)
    } catch (error) {
      // Never echo the token: errors carry their message only. A page made before the failure keeps its id.
      return { ok: false, status: 'error', error: masked(error?.message ?? error), page_id: error?.pageId ?? null }
    }
  }

  return {
    configured,
    missing,
    /** A new page: { title, slug, markdown, seo_title?, description?, tags?, draft? } (markdown without front matter). */
    createPage: (input) => call('createPage', input),
    /** An existing page: { page_id, title, markdown, seo_title?, description?, tags?, draft? }. The slug stays. */
    updatePage: (input) => call('updatePage', input),
    /** Takes a page off the public site (back to draft; nothing deleted): { page_id }. */
    unpublishPage: (input) => call('unpublishPage', input)
  }
}

/**
 * Publishes a brief's final Markdown export to Docstar (create, or update if the export already has a page id).
 * draft: true sends it as a draft only (nothing public). Saves the page id on the markdown_export record, also when
 * a later step failed after the page was created. Returns a run result.
 */
export async function publishToDocstar({ store, docstar, exportRecord, draft = false, now = Date.now }) {
  if (!exportRecord) return { status: 'no_export', summary: 'no final Markdown export for this brief: approve it first', warnings: [] }
  const p = exportRecord.payload
  const fm = p.front_matter ?? {}
  const input = { title: p.title, slug: p.slug, markdown: docstarBody(p.markdown), seo_title: p.title, description: fm.description ?? '', tags: fm.tags ?? [], draft }
  const r = p.docstar_page_id ? await docstar.updatePage({ ...input, page_id: p.docstar_page_id }) : await docstar.createPage(input)
  const at = new Date(now()).toISOString()
  if (!r.ok) {
    if (r.page_id && !p.docstar_page_id) await store.updateRecord(exportRecord.id, { ...p, docstar_page_id: r.page_id, docstar_state: 'draft' }, {}, { known: exportRecord })
    return { status: r.status, summary: `Docstar: ${r.message ?? r.error ?? r.status} (the Markdown export is saved: ${p.filename})${r.page_id ? `; page ${r.page_id} was kept as a draft and is updated on the next try` : ''}`, warnings: [r.message ?? r.error ?? r.status] }
  }
  const live = r.status !== 'draft'
  await store.updateRecord(exportRecord.id, { ...p, docstar_page_id: r.page_id ?? p.docstar_page_id ?? null, docstar_url: r.url ?? p.docstar_url ?? null, docstar_state: live ? 'published' : 'draft', ...(live ? { docstar_published_at: at } : { docstar_draft_at: at }) }, live ? { status: 'published' } : {}, { known: exportRecord })
  const verb = p.docstar_page_id ? 'updated' : 'created'
  return { status: live ? 'published' : 'draft', summary: live ? `Docstar page ${verb} and published: ${r.url ?? r.page_id}` : `Docstar page ${verb} as a draft (not public): ${r.page_id}`, warnings: [] }
}

/** The file without its YAML front matter (Docstar documents none; title and slug go as fields). */
export const bodyOf = (markdown) => String(markdown ?? '').replace(/^---\n[\s\S]*?\n---\n+/, '')

/** What Docstar gets as the page body: no front matter and no leading "# Title" (Docstar shows the page name). */
export const docstarBody = (markdown) => bodyOf(markdown).replace(/^#[ \t]+[^\n]*\n+/, '')
