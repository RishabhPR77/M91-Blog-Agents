// The knowledge map (Phase 12, Task 5): one short `knowledge` record per approved post, saved by code when the
// person approves it (one write, no AI). The Strategist reads them all, so a new post never re-explains what an
// earlier post taught: it points to that post instead.

/** The knowledge record's payload from the approved brief, draft, slot and export. */
export function knowledgeOf({ briefId, brief = {}, draft = {}, slot = null, stage = null, exportInfo = null }) {
  const firstTldr = Array.isArray(draft.tldr) && draft.tldr.length ? String(draft.tldr[0]) : ''
  return {
    brief_id: briefId,
    title: draft.title ?? brief.titles?.[0] ?? '',
    slot_id: slot?.slot_id ?? brief.slot_id ?? null,
    stage: stage?.number ?? null,
    stage_name: stage?.name ?? null,
    concepts: slot?.teaches ?? [],
    terms_defined: brief.terms_to_define ?? [],
    summary: firstTldr.slice(0, 200),
    link: exportInfo?.url ?? null,
    export_slug: exportInfo?.slug ?? null,
    approved_at: null
  }
}

// The Strategist's message carries at most the last 40 entries, newest first, each summary at most 200 characters.
export const KNOWLEDGE_MAX = 40
export const KNOWLEDGE_SUMMARY_MAX = 200

/** All knowledge records, oldest first (the order the reader met them). */
export async function knowledgeMap(store) {
  return (await store.getRecords({ type: 'knowledge' }))
    .map((r) => r.payload)
    .filter(Boolean)
    .sort((a, b) => String(a.approved_at ?? '').localeCompare(String(b.approved_at ?? '')))
}

/** Saves the knowledge record of an approved post (replacing an earlier one of the same brief). */
export async function saveKnowledge(store, payload) {
  const old = (await store.getRecords({ type: 'knowledge' })).find((r) => r.payload?.brief_id === payload.brief_id)
  if (old) {
    await store.updateRecord(old.id, payload, { status: 'current' }, { known: old })
    return { ...old, payload }
  }
  return store.createRecord({ type: 'knowledge', briefId: payload.brief_id, payload, status: 'current' })
}

/** The compact list for the Strategist's message. */
export const compactKnowledge = (k) => ({
  title: k.title, slot_id: k.slot_id, stage: k.stage, concepts: k.concepts, terms_defined: k.terms_defined, summary: String(k.summary ?? '').slice(0, KNOWLEDGE_SUMMARY_MAX), ...(k.link && { link: k.link }), ...(k.export_slug && { export_slug: k.export_slug })
})

/** The knowledge map as the Strategist gets it: the last `max` entries (from the oldest-first map), newest first, compact. */
export const knowledgeForPrompt = (entries, max = KNOWLEDGE_MAX) => entries.slice(-max).reverse().map(compactKnowledge)
