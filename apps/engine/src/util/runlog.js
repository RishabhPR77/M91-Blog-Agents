// run_log records (Phase 9 A2): only errors are saved. Every AI call is already in the run record's timeline
// (ai.call entries) and in the logs, so a successful call costs no Mem0 request.
const ERROR_STATUSES = new Set(['error', 'failed'])

/** Whether a run_log entry is worth a Mem0 record: an error message, or an error / failed result. */
export const isErrorEntry = (payload, status) => Boolean(payload?.error) || ERROR_STATUSES.has(status) || ERROR_STATUSES.has(payload?.result)

/** Saves the entry as a run_log record when it is an error; returns the record, or null when skipped. */
export async function saveRunLog(store, { briefId, payload, status, version = null }) {
  if (!isErrorEntry(payload, status)) return null
  return store.createRecord({ type: 'run_log', briefId, payload, status, ...(version !== null && { version }) })
}
