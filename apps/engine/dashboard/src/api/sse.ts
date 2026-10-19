// Server-sent events from the engine. The engine names every event (`event: <type>`), and EventSource only
// delivers named events to listeners registered for that name, so every known type is registered here.
// Keep EVENT_TYPES in sync with apps/engine/src/events.js (a node test checks this).

export const EVENT_TYPES = [
  'run.started', 'run.finished', 'run.failed', 'run.cancelled',
  'step.started', 'step.finished', 'step.failed', 'step.cancelled', 'step.output',
  'ai.call', 'loop.route', 'log',
  'approval.waiting', 'approval.approved', 'approval.changes_requested', 'approval.rejected', 'approval.reviewed'
] as const

export type EngineEvent = {
  run_id: string
  seq: number
  ts: string
  type: string
  agent?: string
  step?: string
  level?: string
  message?: string
  data?: Record<string, unknown>
}

export type StreamHandlers = {
  onEvent: (e: EngineEvent) => void
  onOpen?: () => void
  onError?: (readyState: number) => void
}

/** Opens an EventSource on a same-origin /api/* stream. Returns a close function. */
export function openEventStream(url: string, { onEvent, onOpen, onError }: StreamHandlers): () => void {
  if (!url.startsWith('/api/')) throw new Error('only /api/* streams are allowed')
  const es = new EventSource(url, { withCredentials: true })
  const handler = (ev: MessageEvent) => {
    try {
      onEvent(JSON.parse(ev.data) as EngineEvent)
    } catch {
      // A malformed event is skipped, never fatal.
    }
  }
  for (const t of EVENT_TYPES) es.addEventListener(t, handler as EventListener)
  es.onmessage = handler
  es.onopen = () => onOpen?.()
  es.onerror = () => onError?.(es.readyState)
  return () => es.close()
}
