// The published guides on the Roadmap page: the list, the "newer than the roadmap" note, Sync guides (run mode guides,
// 0 AI calls), a covered slot with its guide and "Not covered", and "Covered by a guide…" on a planned slot.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import RoadmapPage from '../src/pages/Roadmap'
import { COSTS } from '../src/config/costs'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const S = { ...SETTINGS, built_modes: [...SETTINGS.built_modes, 'roadmap', 'guides'], roadmap: { enabled: true, rapid_response_enabled: false } }
const G1 = 'https://msg91.com/guide/what-happens-when-your-software-needs-a-human-approval-'
const G2 = 'https://msg91.com/guide/test-your-m91-alert-link'
const slot = (slot_id: string, title_idea: string, status = 'planned', extra = {}) => ({ slot_id, title_idea, question: `${title_idea}?`, teaches: ['x'], needs: [], status, brief_id: '', ...extra })
const ROADMAP = {
  version: 1, status: 'approved', generated_at: '2026-10-22T10:00:00+05:30', notes: 'none',
  stages: [{ number: 0, name: 'Starter', level: 'beginner', goal: 'g', slots: [slot('s0-1', 'What M91 is', 'covered', { covered_by: { url: G1, title: 'What Happens When Your Software Needs a Human Approval?' } }), slot('s0-2', 'How M91 works')] }]
}
const GUIDES = {
  guides: [
    { url: G2, title: 'How to Test Your M91 Alert Link Without Waking Anyone', published_at: '2026-10-27T10:00:00Z', summary: 's', headings: [], words: 2010, synced_at: '2026-10-28T06:00:00Z', covers: null },
    { url: G1, title: 'What Happens When Your Software Needs a Human Approval?', published_at: '2026-10-20T13:00:00Z', summary: 's', headings: [], words: 1478, synced_at: '2026-10-22T06:00:00Z', covers: 's0-1' }
  ],
  newer_than_roadmap: 1
}
const reply = (r: unknown) => ({ body: { roadmap: r, record_id: 'mem-rm' } })

function page(extra: Record<string, unknown> = {}) {
  const calls = mockFetch({
    'GET /api/settings': { body: S }, 'GET /api/runs?limit=5': { body: { runs: [] } },
    'GET /api/roadmap': { body: { roadmap: ROADMAP, record_id: 'mem-rm', next: { kind: 'slot', slot_id: 's0-2', title_idea: 'How M91 works', stage: { number: 0, name: 'Starter', level: 'beginner' } }, problems: [] } },
    'GET /api/guides': { body: GUIDES }, ...extra
  } as Parameters<typeof mockFetch>[0])
  renderApp(<Routes><Route path="/roadmap" element={<RoadmapPage />} /><Route path="/runs/:runId" element={<p>live page</p>} /></Routes>, { route: '/roadmap' })
  return calls
}
const posts = (calls: ReturnType<typeof mockFetch>) => calls.filter((c) => c.method === 'POST')

describe('Published guides on the Roadmap page', () => {
  it('lists the guides with the slot each covers, and says when guides are newer than the roadmap', async () => {
    page()
    const section = await screen.findByTestId('guides-section')
    await waitFor(() => expect(within(section).getAllByTestId('guide-row')).toHaveLength(2))
    expect(within(section).getByRole('link', { name: /How to Test Your M91 Alert Link/ })).toHaveAttribute('href', G2)
    expect(within(section).getByText('covers s0-1')).toBeInTheDocument()
    expect(within(section).getByText('2,010 words')).toBeInTheDocument()
    expect(screen.getByTestId('guides-newer')).toHaveTextContent('1 guide was published after the roadmap was made. Regenerate the roadmap')
  })

  it('Sync guides shows its cost (0 AI calls) and starts the guides run', async () => {
    const calls = page({ 'POST /api/runs': { status: 202, body: { run_id: 'R-261028-1200-ABCD' } } })
    await userEvent.click(await screen.findByRole('button', { name: /Sync guides · 0 AI calls/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent(COSTS.guides.normal)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sync' }))
    await screen.findByText('live page')
    expect(posts(calls)).toEqual([{ method: 'POST', path: '/api/runs', body: { mode: 'guides', dry_run: false, params: {} } }])
  })

  it('a covered slot shows its guide and can be put back; a planned slot can be marked covered by a guide', async () => {
    const calls = page({ 'POST /api/roadmap/slots/s0-1/cover': reply(ROADMAP), 'POST /api/roadmap/slots/s0-2/cover': reply(ROADMAP) })
    const covered = await screen.findByTestId('slot-s0-1')
    expect(within(covered).getByText('covered')).toBeInTheDocument()
    expect(within(covered).getByTestId('covered-by')).toHaveTextContent('Covered by the published guide What Happens When Your Software Needs a Human Approval?')
    expect(within(covered).queryByRole('button', { name: /Edit/ })).toBeNull()
    await userEvent.click(within(covered).getByRole('button', { name: 'Not covered' }))
    const select = await within(screen.getByTestId('slot-s0-2')).findByRole('combobox', { name: 'Covered by a guide (s0-2)' })
    await userEvent.selectOptions(select, G2)
    await waitFor(() => expect(posts(calls).map((c) => [c.path, c.body])).toEqual([
      ['/api/roadmap/slots/s0-1/cover', { guide_url: null }],
      ['/api/roadmap/slots/s0-2/cover', { guide_url: G2 }]
    ]))
  })
})

describe('Next up: the editor\'s reason', () => {
  it('shows why this topic and the topics left out as repeats', async () => {
    mockFetch({
      'GET /api/settings': { body: S }, 'GET /api/runs?limit=5': { body: { runs: [] } }, 'GET /api/guides': { body: GUIDES },
      'GET /api/roadmap': { body: { roadmap: ROADMAP, record_id: 'mem-rm', next: { kind: 'slot', slot_id: 's2-1', title_idea: 'Create a channel and send your first alert', stage: { number: 2, name: 'First steps', level: 'beginner' }, why: 'a tutorial: none of the last 2 posts was one', skipped: [{ id: 's0-2', title: 'How M91 works', why: 'close to a published guide "How the M91 Alert Flow"' }] }, problems: [] } }
    } as Parameters<typeof mockFetch>[0])
    renderApp(<Routes><Route path="/roadmap" element={<RoadmapPage />} /></Routes>, { route: '/roadmap' })
    expect(await screen.findByTestId('next-up-why')).toHaveTextContent('Why: a tutorial: none of the last 2 posts was one')
    expect(screen.getByTestId('next-up-skipped')).toHaveTextContent('Left out s0-2 "How M91 works": close to a published guide "How the M91 Alert Flow"')
  })
})
