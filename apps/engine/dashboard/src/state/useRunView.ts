// The Live run page's data: the run record (GET /api/runs/:id) plus its event stream
// (GET /api/runs/:id/events: replay, then live, then closed on a terminal event).
//  - Reconnects with back-off if the stream drops while the run is still active; replays are deduplicated
//    by seq in the reducer.
//  - If the stream ends without any event, the page waits for the run record instead of reconnecting
//    (each reconnect costs the engine a Mem0 lookup). A finished run is then rebuilt from its saved
//    timeline, or from its steps for runs from before Phase 6; a running one is reconnected.
import { useEffect, useReducer, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, isApiError } from '../api/client'
import { openEventStream } from '../api/sse'
import { initialRunView, runReducer, type RunRecord, type RunView } from './runEvents'

export type TrimmedRecord = { id: string; type: string; status: string | null; brief_id: string | null; version: number | null; key_id: string | null; title: string | null }
export type RunDetail = { run: RunRecord & { record_id?: string; warnings?: string[]; approved_unreviewed?: boolean }; records: TrimmedRecord[] }
export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'waiting' | 'ended'

const TERMINAL = new Set(['run.finished', 'run.failed', 'run.cancelled'])
export const RECONNECT_DELAYS = [1000, 2000, 5000, 10000]

export function useRunView(runId: string): { view: RunView; detail: RunDetail | undefined; stream: StreamState; error: unknown } {
  const [view, dispatch] = useReducer(runReducer, runId, initialRunView)
  const [stream, setStream] = useState<StreamState>('connecting')
  const [emptyEnd, setEmptyEnd] = useState(false)
  const qc = useQueryClient()
  const recordStatus = useRef<string | undefined>(undefined)
  const terminalSeen = useRef(false)
  const reconnect = useRef<() => void>(() => {})

  const runQuery = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api<RunDetail>(`/api/runs/${runId}`),
    // Right after POST /api/runs the record may not be saved yet: retry a 404 a few times.
    retry: (n, e) => isApiError(e) && (e.status === 404 || e.status === 0) && n < 4,
    retryDelay: 1000
    // No polling (Phase 9 A4): live events refresh the run detail (served from the engine's index).
  })
  recordStatus.current = runQuery.data?.run?.status

  useEffect(() => {
    dispatch({ type: 'reset', runId })
    setStream('connecting')
    setEmptyEnd(false)
    terminalSeen.current = false
    let stopped = false
    let attempt = 0
    let received = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let close: () => void = () => {}

    const connect = () => {
      close = openEventStream(`/api/runs/${runId}/events`, {
        onOpen: () => {
          attempt = 0
          setStream('live')
        },
        onEvent: (event) => {
          received++
          dispatch({ type: 'event', event })
          // A finished step may have produced records: refresh the run detail (0 Mem0 requests: the index).
          if (event.type === 'step.finished' || event.type === 'approval.waiting') void qc.invalidateQueries({ queryKey: ['run', runId] })
          if (TERMINAL.has(event.type)) {
            terminalSeen.current = true
            close()
            setStream('ended')
            void qc.invalidateQueries({ queryKey: ['run', runId] })
            void qc.invalidateQueries({ queryKey: ['runs'] })
          }
        },
        onError: () => {
          // The engine closes the stream after replaying a finished run; EventSource would reconnect forever.
          close()
          if (stopped || terminalSeen.current) return
          const status = recordStatus.current
          if (received === 0) {
            if (status === undefined) {
              setStream('waiting') // decided when the record arrives (effect below)
              return
            }
            if (status !== 'running') {
              setStream('ended')
              setEmptyEnd(true)
              return
            }
          } else if (status && status !== 'running' && attempt > 0) {
            setStream('ended')
            return
          }
          setStream('reconnecting')
          const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]
          attempt++
          timer = setTimeout(() => {
            if (!stopped) connect()
          }, delay)
        }
      })
    }
    reconnect.current = () => {
      if (!stopped) connect()
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      close()
      reconnect.current = () => {}
    }
  }, [runId, qc])

  // Run-level fields from the record; a rebuild when no live event ever arrived.
  const data = runQuery.data
  useEffect(() => {
    if (!data?.run) return
    if (stream === 'waiting') {
      if (data.run.status === 'running') {
        setStream('reconnecting')
        reconnect.current()
      } else {
        setStream('ended')
        setEmptyEnd(true)
      }
    }
  }, [data, stream])
  useEffect(() => {
    if (!data?.run) return
    dispatch(emptyEnd ? { type: 'rebuild', record: data.run } : { type: 'record', record: data.run })
  }, [data, emptyEnd])

  return { view, detail: data, stream, error: runQuery.error }
}

/** Re-renders every `ms` while active (for elapsed times). */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}
