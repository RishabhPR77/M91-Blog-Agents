import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import Memory, { type MemoryList, type MemoryRow } from '../src/pages/Memory'
import { Toasts } from '../src/components/Toasts'
import { FakeEventSource, mockFetch, renderApp } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const row = (id: string, type: string, extra: Partial<MemoryRow> = {}): MemoryRow => ({
  id, type, status: null, brief_id: null, date: '2026-10-01', version: null, key_id: null, title: null, created_at: '2026-10-01T00:00:00.000Z', age_days: 22,
  reasons: [], protection: null, protection_reason: null, ...extra
})
const STALE = row('m1', 'story_lead', { status: 'expired', title: 'Old story', reasons: [{ code: 'status', text: 'status "expired"' }] })
const LESSON = row('m2', 'lesson', { title: 'Keep it short.', protection: 'confirm', protection_reason: 'a lesson the agents learn from' })
const POST = row('m3', 'published_post', { status: 'published', title: 'Live post', protection: 'never', protection_reason: 'a published post' })
const list = (records: MemoryRow[], extra: Partial<MemoryList> = {}): MemoryList => ({
  counts: { story_lead: { total: 1, not_useful: 1, statuses: { expired: 1 } }, lesson: { total: 1, not_useful: 0, statuses: {} }, published_post: { total: 1, not_useful: 0, statuses: { published: 1 } } },
  total: 3, not_useful: 1, matched: records.length, records, stale_days: 30, not_loaded: [], dry_run: false, mem0_requests: 0, ...extra
})
const page = () => renderApp(<><Toasts /><Routes><Route path="/memory" element={<Memory />} /><Route path="/records/:memoryId" element={<p>record page</p>} /></Routes></>, { route: '/memory' })

describe('Memory', () => {
  it('counts per type, reasons, cost line, protected rows locked; filters go to the API', async () => {
    const calls = mockFetch({
      'GET /api/memory': { body: list([STALE, LESSON, POST]) },
      'GET /api/memory?type=story_lead': { body: list([STALE]) },
      'GET /api/memory?type=story_lead&not_useful=true': { body: list([STALE]) },
      'GET /api/memory?type=story_lead&not_useful=true&stale_days=90': { body: list([]) }
    })
    page()
    expect(await screen.findByText('Old story')).toBeInTheDocument()
    expect(screen.getByText('status "expired"')).toBeInTheDocument()
    expect(screen.getByTestId('memory-cost')).toHaveTextContent('0 Mem0 requests')
    expect(screen.getByRole('button', { name: /Stories 1/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select Live post' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Live post' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Stories 1/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Probably not useful' }))
    await userEvent.selectOptions(screen.getByLabelText('Old after days'), '90')
    expect(await screen.findByText('Nothing here looks unused. 🎉')).toBeInTheDocument()
    expect(calls.map((c) => c.path)).toEqual(['/api/memory', '/api/memory?type=story_lead', '/api/memory?type=story_lead&not_useful=true', '/api/memory?type=story_lead&not_useful=true&stale_days=90'])
  })

  it('delete a selection: the dialog lists the records, the Mem0 cost and needs the tick for protected ones', async () => {
    let deleted = false
    const calls = mockFetch({
      'GET /api/memory': () => ({ body: list(deleted ? [POST] : [STALE, LESSON, POST]) }),
      'DELETE /api/records': () => {
        deleted = true
        return { body: { deleted: ['m1', 'm2'], failed: [], mem0_requests: 2 } }
      }
    })
    page()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select all shown' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete 2 records from Mem0?')).toBeInTheDocument()
    expect(within(dialog).getByTestId('expected-mem0')).toHaveTextContent('2 (1 delete each; no reads)')
    expect(within(dialog).getByRole('list', { name: 'Records to delete' })).toHaveTextContent('Old story')
    expect(within(dialog).getByRole('list', { name: 'Records to delete' })).toHaveTextContent('protected: a lesson the agents learn from')
    const confirm = within(dialog).getByRole('button', { name: 'Delete' })
    expect(confirm).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('checkbox'))
    await userEvent.click(confirm)
    await waitFor(() => expect(screen.queryByText('Old story')).not.toBeInTheDocument())
    const del = calls.find((c) => c.method === 'DELETE')
    expect(del?.body).toEqual({ ids: ['m1', 'm2'], confirm_protected: true })
    expect(await screen.findByText(/Deleted 2 records · 2 Mem0 requests/)).toBeInTheDocument()
  })

  it('one record: no tick needed when not protected; types not loaded offer Load all with its cost', async () => {
    const calls = mockFetch({
      'GET /api/memory': { body: list([STALE], { not_loaded: ['question_cluster', 'roadmap'] }) },
      'POST /api/memory/load-all': { body: { index: {}, mem0_requests: 3 } },
      'DELETE /api/records': { body: { deleted: ['m1'], failed: [], mem0_requests: 1 } }
    })
    page()
    expect(await screen.findByTestId('not-loaded')).toHaveTextContent('Question clusters, Roadmap')
    await userEvent.click(screen.getByRole('button', { name: 'Load all types' }))
    expect(screen.getByTestId('expected-mem0')).toHaveTextContent('about 1 per 100 records')
    await userEvent.click(screen.getByRole('button', { name: 'Load all' }))
    expect(await screen.findByText(/Every type loaded · 3 Mem0 requests/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Old story' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({ ids: ['m1'], confirm_protected: false }))
  })
})
