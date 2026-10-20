// Phase 9 A4: the index's age in the header and the "out of date" banner with Refresh from Mem0.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Layout } from '../src/components/Layout'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const index = (over = {}) => ({ loaded_at: new Date(Date.now() - 12 * 60_000).toISOString(), types: ['run', 'draft'], records: 7, out_of_date: false, ...over })
const routes = (health: unknown, extra = {}) => ({
  'GET /api/health': { body: health },
  'GET /api/settings': { body: SETTINGS },
  'GET /api/approvals': { body: { approvals: [] } },
  'GET /api/runs?limit=5': { body: { runs: [] } },
  ...extra
})

describe('engine index status', () => {
  it('shows how long ago the data was loaded; no banner while it is current', async () => {
    mockFetch(routes({ ok: true, version: '0.2.0', run_in_progress: false, index: index() }))
    renderApp(<Layout><p>page</p></Layout>)
    expect(await screen.findByTestId('index-age')).toHaveTextContent(/^Data loaded 12m/)
    expect(screen.queryByTestId('index-out-of-date')).not.toBeInTheDocument()
  })

  it('out of date → banner; Refresh from Mem0 posts /api/index/refresh', async () => {
    const calls = mockFetch(routes({ ok: true, version: '0.2.0', run_in_progress: false, index: index({ out_of_date: true }) }, {
      'POST /api/index/refresh': { body: { index: index() } }
    }))
    renderApp(<Layout><p>page</p></Layout>)
    expect(await screen.findByTestId('index-out-of-date')).toHaveTextContent('Data may be out of date')
    await userEvent.click(screen.getByRole('button', { name: /Refresh from Mem0/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/index/refresh')).toBe(true))
  })

  it('Refresh waits while a run is in progress', async () => {
    mockFetch(routes({ ok: true, version: '0.2.0', run_in_progress: true, index: index({ out_of_date: true }) }))
    renderApp(<Layout><p>page</p></Layout>)
    expect(await screen.findByRole('button', { name: /Refresh from Mem0/ })).toBeDisabled()
  })
})
