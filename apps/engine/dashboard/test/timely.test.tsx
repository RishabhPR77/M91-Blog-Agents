// The timely lane in the dashboard: the cards on the Roadmap page (Write now, Add to roadmap with a stage, Dismiss),
// Check news with its cost, the waiting reason, the badge on Control, the Settings rows.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import RoadmapPage from '../src/pages/Roadmap'
import Control from '../src/pages/Control'
import Settings from '../src/pages/Settings'
import { nextUpText } from '../src/api/roadmap'
import { COSTS } from '../src/config/costs'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const TIMELY = { enabled: true, check_on_run: true, window_days: 7, max_per_week: 1 }
const S = { ...SETTINGS, built_modes: [...SETTINGS.built_modes, 'roadmap', 'export', 'timely_check'], roadmap: { enabled: true, rapid_response_enabled: true }, timely: TIMELY, models: { ...SETTINGS.models, planner: { service: 'openai', model: 'gpt-5.6-luna', delivery: 'sync' } }, publish: { target: 'none', docstar_configured: false, auto_publish: false }, designer: { enabled: false, max_repairs: 1, interactive_default: true, promo_enabled: false } }
const ROADMAP = { version: 1, status: 'approved', stages: [{ number: 0, name: 'Starter', level: 'beginner', goal: 'g', slots: [{ slot_id: 's0-1', title_idea: 'What M91 is', question: 'q?', teaches: ['x'], needs: [], status: 'approved', brief_id: '' }] }] }
const NEXT = { kind: 'slot', slot_id: 's1-1', title_idea: 'What an approval step is', stage: { number: 1, name: 'Foundations', level: 'beginner' } }
const CARD = (id: string, over = {}) => ({
  record_id: `mem-${id}`, opportunity_id: id, status: 'proposed', title: `Event ${id}`, what_happened: 'An AI agent sent refunds without a check.', source_url: `https://news.example.com/${id}`,
  outlet: 'Example News', published_date: '2026-10-20', why_m91: 'A person could approve each refund.', urgency: 'high', urgency_reason: 'Teams add agents now.', topic_group: 2,
  found_at: '2026-10-22T10:00:00+05:30', brief_id: null, slot_id: null, written_at: null, ...over
})
const TIMELY_RES = (cards: unknown[], extra = {}) => ({ enabled: true, settings: { window_days: 7, max_per_week: 1, check_on_run: true }, open: cards.filter((c) => ['proposed', 'write_now'].includes((c as { status: string }).status)).length, next: null, waiting: null, opportunities: cards, ...extra })

function page(cards: unknown[], extra: Record<string, unknown> = {}, timelyExtra = {}) {
  const calls = mockFetch({
    'GET /api/settings': { body: S }, 'GET /api/runs?limit=5': { body: { runs: [] } },
    'GET /api/roadmap': { body: { roadmap: ROADMAP, record_id: 'mem-rm', next: NEXT, problems: [] } },
    'GET /api/timely': { body: TIMELY_RES(cards, timelyExtra) }, ...extra
  } as Parameters<typeof mockFetch>[0])
  renderApp(<Routes><Route path="/roadmap" element={<RoadmapPage />} /><Route path="/runs/:runId" element={<p>live page</p>} /></Routes>, { route: '/roadmap' })
  return calls
}
const posts = (calls: ReturnType<typeof mockFetch>) => calls.filter((c) => c.method === 'POST')

describe('Timely opportunities on the Roadmap page', () => {
  it('shows each card (urgency, source, why M91) with Write now, Add to roadmap and Dismiss', async () => {
    const calls = page([CARD('O-1'), CARD('O-2', { urgency: 'low' }), CARD('O-OLD', { status: 'expired' })], {
      'POST /api/timely/O-1': { body: { opportunity: { status: 'write_now' } } },
      'POST /api/timely/O-2': { body: { opportunity: { status: 'added_to_roadmap', slot_id: 's4-5' } } }
    })
    const one = await screen.findByTestId('timely-card-O-1')
    expect(one).toHaveTextContent('Event O-1')
    expect(one).toHaveTextContent('Why M91: A person could approve each refund.')
    expect(within(one).getByRole('link', { name: /Source: Example News/ })).toHaveAttribute('href', 'https://news.example.com/O-1')
    expect(screen.queryByTestId('timely-card-O-OLD')).not.toBeInTheDocument()
    expect(screen.getByText('Earlier (1)')).toBeInTheDocument()
    await userEvent.click(within(one).getByRole('button', { name: /Write now/ }))
    await waitFor(() => expect(posts(calls)[0]).toEqual({ method: 'POST', path: '/api/timely/O-1', body: { action: 'write_now' } }))
    const two = screen.getByTestId('timely-card-O-2')
    await userEvent.selectOptions(within(two).getByLabelText('Stage for Event O-2'), '4')
    await userEvent.click(within(two).getByRole('button', { name: 'Add to roadmap' }))
    await waitFor(() => expect(posts(calls)[1]).toEqual({ method: 'POST', path: '/api/timely/O-2', body: { action: 'add_to_roadmap', stage: 4 } }))
  })

  it('Dismiss; a card being written has no buttons; a write_now card has no Write now', async () => {
    const calls = page([CARD('O-1'), CARD('O-W', { status: 'write_now' }), CARD('O-B', { status: 'write_now', brief_id: '261022-1200-ABCD' })], { 'POST /api/timely/O-1': { body: { opportunity: { status: 'dismissed' } } } })
    const one = await screen.findByTestId('timely-card-O-1')
    await userEvent.click(within(one).getByRole('button', { name: /Dismiss/ }))
    await waitFor(() => expect(posts(calls)[0].body).toEqual({ action: 'dismiss' }))
    expect(within(screen.getByTestId('timely-card-O-W')).queryByRole('button', { name: /Write now/ })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('timely-card-O-B')).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByTestId('timely-card-O-B')).toHaveTextContent('Being written (brief 261022-1200-ABCD).')
  })

  it('Check news shows its cost and starts the timely_check run after the confirm', async () => {
    const calls = page([], { 'POST /api/runs': { status: 202, body: { run_id: 'R-261022-1200-ABCD' } } })
    expect(await screen.findByTestId('timely-empty')).toBeInTheDocument()
    const btn = screen.getByTestId('check-news')
    expect(btn).toHaveTextContent(`Check news · ${COSTS.timely_check.normal} AI call · ${COSTS.timely_check.mem0} Mem0`)
    await userEvent.click(btn)
    await userEvent.click(await screen.findByRole('button', { name: 'Check news' }))
    await waitFor(() => expect(posts(calls)[0]).toEqual({ method: 'POST', path: '/api/runs', body: { mode: 'timely_check', dry_run: false, params: {} } }))
    expect(await screen.findByText('live page')).toBeInTheDocument()
  })

  it('a Write now card that waits shows why (Starter rule or weekly cap); Next up names a timely post', async () => {
    page([CARD('O-1', { status: 'write_now' })], {}, { waiting: { opportunity_id: 'O-1', title: 'Event O-1', reason: 'TIMELY_MAX_PER_WEEK (1) timely post already written in the last 7 days' } })
    expect(await screen.findByTestId('timely-waiting')).toHaveTextContent('“Event O-1” waits: TIMELY_MAX_PER_WEEK (1) timely post already written in the last 7 days.')
    expect(nextUpText({ kind: 'timely', title: 'Event O-1', opportunity_id: 'O-1', outlet: 'Example News' })).toBe('Timely post: Event O-1 (reported by Example News)')
  })

  it('the section is hidden while the timely lane is off', async () => {
    mockFetch({ 'GET /api/settings': { body: { ...S, timely: { ...TIMELY, enabled: false } } }, 'GET /api/runs?limit=5': { body: { runs: [] } }, 'GET /api/roadmap': { body: { roadmap: ROADMAP, record_id: 'mem-rm', next: NEXT, problems: [] } } } as Parameters<typeof mockFetch>[0])
    renderApp(<Routes><Route path="/roadmap" element={<RoadmapPage />} /></Routes>, { route: '/roadmap' })
    expect(await screen.findByTestId('next-up')).toBeInTheDocument()
    expect(screen.queryByTestId('timely-section')).not.toBeInTheDocument()
  })
})

describe('the badge on Control and the Settings rows', () => {
  it('Control: open cards as a badge, with the waiting reason', async () => {
    mockFetch({
      'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } }, 'GET /api/settings': { body: S }, 'GET /api/runs?limit=5': { body: { runs: [] } }, 'GET /api/approvals': { body: { approvals: [] } },
      'GET /api/records?type=brief&limit=30': { body: { records: [] } }, 'GET /api/records?type=draft&limit=60': { body: { records: [] } }, 'GET /api/records?type=draft&status=approved&limit=30': { body: { records: [] } },
      'GET /api/roadmap': { body: { roadmap: ROADMAP, record_id: 'mem-rm', next: NEXT, problems: [] } },
      'GET /api/timely': { body: TIMELY_RES([CARD('O-1'), CARD('O-2', { status: 'write_now' })], { waiting: { opportunity_id: 'O-2', title: 'Event O-2', reason: 'Timely posts start once the Starter (stage 0) has an approved post' } }) }
    } as Parameters<typeof mockFetch>[0])
    renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    const badge = await screen.findByTestId('control-timely')
    expect(badge).toHaveTextContent('2 timely opportunities')
    expect(badge).toHaveTextContent('“Event O-2” waits: Timely posts start once the Starter (stage 0) has an approved post')
    expect(within(badge).getByRole('link')).toHaveAttribute('href', '/roadmap#timely')
  })

  it('Settings: the timely lane, the news check on every run, the window and the weekly cap', async () => {
    mockFetch({ 'GET /api/settings': { body: S } } as Parameters<typeof mockFetch>[0])
    renderApp(<Settings />)
    expect(await screen.findByTestId('setting-timely')).toHaveTextContent('on (RAPID_RESPONSE_ENABLED)')
    expect(screen.getByText('7 days (TIMELY_WINDOW_DAYS)')).toBeInTheDocument()
    expect(screen.getByText('at most 1 (TIMELY_MAX_PER_WEEK)')).toBeInTheDocument()
  })
})
