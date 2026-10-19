// Test helpers: a fetch mock routed by "METHOD /path", a fake EventSource, and a render wrapper.
import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import { makeQueryClient } from '../src/App'

type ReplyValue = { status?: number; body?: unknown }
type Reply = ReplyValue | ((init?: RequestInit) => ReplyValue)

/** Mocks fetch: routes like { 'GET /api/health': { body: {...} } }. Unrouted calls → 404. Returns the call list. */
export function mockFetch(routes: Record<string, Reply>) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const r = routes[`${method} ${url}`]
    const reply = typeof r === 'function' ? r(init) : r
    if (!reply) return new Response(JSON.stringify({ error: { code: 'not_found', message: `no route ${method} ${url}` } }), { status: 404 })
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), { status: reply.status ?? 200 })
  }))
  return calls
}

/** A controllable EventSource stand-in. */
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  listeners = new Map<string, ((e: MessageEvent) => void)[]>()
  closed = false
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  emit(event: { type: string } & Record<string, unknown>) {
    const msg = new MessageEvent(event.type, { data: JSON.stringify(event) })
    for (const fn of this.listeners.get(event.type) ?? []) fn(msg)
  }
  fail(readyState = 0) {
    this.readyState = readyState
    this.onerror?.()
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
}

export function renderApp(ui: ReactNode, { route = '/' } = {}) {
  const client = makeQueryClient()
  client.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } })
  return { client, ...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>) }
}

export const SETTINGS = {
  version: '0.2.0',
  models: { writer: { service: 'gemini', model: 'gemini-2.5-flash', delivery: 'sync' } },
  scout: { question_groups: [1, 2, 3, 4, 5], max_calls: 10 },
  strategist: {},
  gates: { pass_score_min: 80, pass_area_min: 6 },
  limits: { max_writer_revisions: 2 },
  content: {},
  runtime: { dry_run: true, auto_publish: false, log_level: 'info' },
  dashboard: { auth: false, port: 5173 },
  approval: { max_human_revisions: 5, rereview_after_human: true, m91_notify_on_awaiting: false },
  built_modes: ['full', 'scout', 'strategist', 'writer', 'reviewer', 'promo', 'approve', 'human_revise', 'reject_topic', 'approval_review'],
  decision_modes: ['approve', 'human_revise', 'reject_topic', 'approval_review']
}
