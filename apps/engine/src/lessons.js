// Lessons from past reviews (Phase 5 C3): saved by the Reviewer, read by the Strategist and the Writer.

const byDateDesc = (a, b) => String(b ?? '').localeCompare(String(a ?? ''))

/** A lesson memory's text (Mem0 stores inferred lessons as plain text). */
export const lessonText = (r) => (typeof r.payload === 'string' ? r.payload : r.payload?.text ?? JSON.stringify(r.payload))

/** The latest `limit` lessons as text, newest first. */
export async function latestLessons(store, limit) {
  if (!(limit > 0)) return []
  return (await store.getRecords({ type: 'lesson' }))
    .sort((a, b) => byDateDesc(a.date ?? a.createdAt, b.date ?? b.createdAt))
    .slice(0, limit)
    .map(lessonText)
}
