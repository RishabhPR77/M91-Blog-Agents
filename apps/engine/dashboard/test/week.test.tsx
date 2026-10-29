// The This week page: what the next run writes about, the editor's decisions (why, the signals, the news hook,
// runners-up you can pin for next week), this week's news cards (Write now, Dismiss, Check news) and the live guides
// (Sync guides). Also "Why this post" on the post page and the topic line on Control.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import Week from '../src/pages/Week'
import Control from '../src/pages/Control'
import { nextRunText } from '../src/api/weekly'
import { COSTS } from '../src/config/costs'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const TIMELY = { enabled: true, check_on_run: true, window_days: 7, max_per_week: 1 }
const S = { ...SETTINGS, built_modes: [...SETTINGS.built_modes, 'export', 'timely_check', 'guides'], timely: TIMELY, weekly: { question_days: 21, questions_max: 12, candidates: 4, min_evidence: 2, similarity: 0.6 }, models: { ...SETTINGS.models, editor: { service: 'openai', model: 'gpt-5.5', delivery: 'sync' } }, publish: { target: 'none', docstar_configured: false, auto_publish: false }, designer: { enabled: false, max_repairs: 1, interactive_default: true, promo_enabled: false } }
export const PICK = {
  record_id: 'mem-w1', pick_id: 'W-261022-1130-PICK', date: '2026-10-22', chosen_at: '2026-10-22T11:30:00+05:30', chosen_by: 'editor', model: 'gpt-5.5', brief_id: '261022-1130-ABCD', status: 'written',
  reason: 'An agent deleted a production database this week, and 320 people asked how to stop it.',
  pick: {
    title: 'How to make Claude Code ask before rm -rf', question: 'How do I make Claude Code ask a person before rm -rf?', format: 'tutorial', angle: 'a phone call before destructive commands', why_now: 'this week’s incident', total: 23,
    hook: { title: 'An AI agent deleted a production database', outlet: 'Example News', published_date: '2026-10-21', source_url: 'https://news.example.com/db' },
    evidence: [{ id: 'q1', kind: 'question', text: 'How do I stop Claude Code from running rm -rf?', url: 'https://reddit.example.com/r1', where: 'Reddit r/ClaudeAI', demand: '320 upvotes' }, { id: 'n1', kind: 'news', text: 'An AI agent deleted a production database', url: 'https://news.example.com/db' }]
  },
  runners_up: [
    { title: 'What should wake an on-call engineer at night', question: 'What should wake an on-call engineer at night?', format: 'checklist', why_now: '40 replies on a forum', total: 19, hook: null },
    { title: 'What Is M91?', question: 'What is M91?', format: 'explainer', why_now: 'x', total: 10, hook: null, left_out: 'repeats a live guide "What Is M91?"' }
  ]
}
const CARD = (id: string, over = {}) => ({
  record_id: `mem-${id}`, opportunity_id: id, status: 'proposed', title: `Event ${id}`, what_happened: 'An AI agent sent refunds without a check.', source_url: `https://news.example.com/${id}`,
  outlet: 'Example News', published_date: '2026-10-20', why_m91: 'A person could approve each refund.', urgency: 'high', urgency_reason: 'Teams add agents now.', topic_group: 2,
  found_at: '2026-10-22T10:00:00+05:30', brief_id: null, written_at: null, ...over
})
const TIMELY_RES = (cards: unknown[], extra = {}) => ({ enabled: true, settings: { window_days: 7, max_per_week: 1, check_on_run: true }, open: cards.filter((c) => ['proposed', 'write_now'].includes((c as { status: string }).status)).length, next: null, waiting: null, opportunities: cards, ...extra })
const G1 = 'https://msg91.com/guide/what-is-m91'
const GUIDES = { guides: [{ url: G1, title: 'What Is M91?', published_at: '2026-10-20T13:00:00Z', summary: 's', headings: [], words: 1478, synced_at: '2026-10-22T06:00:00Z' }] }
const WEEKLY = (over = {}) => ({ next: { kind: 'editor' }, model: { service: 'openai', model: 'gpt-5.5' }, picks: [PICK], ...over })

function page({ settings = S, cards = [CARD('O-1'), CARD('O-W', { status: 'write_now' }), CARD('O-B', { status: 'write_now', brief_id: '261022-1200-ABCD' }), CARD('O-OLD', { status: 'expired' })], weekly = WEEKLY(), extra = {} }: { settings?: unknown; cards?: unknown[]; weekly?: unknown; extra?: Record<string, unknown> } = {}) {
  const calls = mockFetch({
    'GET /api/settings': { body: settings }, 'GET /api/runs?limit=5': { body: { runs: [] } },
    'GET /api/weekly': { body: weekly }, 'GET /api/timely': { body: TIMELY_RES(cards) }, 'GET /api/guides': { body: GUIDES }, ...extra
  } as Parameters<typeof mockFetch>[0])
  renderApp(<Routes><Route path="/week" element={<Week />} /><Route path="/runs/:runId" element={<p>live page</p>} /></Routes>, { route: '/week' })
  return calls
}
const posts = (calls: ReturnType<typeof mockFetch>) => calls.filter((c) => c.method === 'POST')

describe('This week', () => {
  it('says what the next run writes about, and shows the editor’s decision: why, the signals, the hook, the runners-up', async () => {
    page()
    const pick = await screen.findByTestId('pick-W-261022-1130-PICK')
    expect(screen.getByTestId('week-next')).toHaveTextContent('The editor decides when the run starts, from this week\'s questions, news and M91 changes (gpt-5.5)')
    expect(within(pick).getByRole('link', { name: 'How to make Claude Code ask before rm -rf' })).toHaveAttribute('href', '/approvals/261022-1130-ABCD')
    expect(within(pick).getByTestId('pick-reason')).toHaveTextContent('Why this week: An agent deleted a production database this week, and 320 people asked how to stop it.')
    expect(within(pick).getByTestId('pick-hook')).toHaveTextContent('Opens with this week’s news: An AI agent deleted a production database (Example News, 2026-10-21)')
    const ev = within(pick).getByTestId('pick-evidence')
    expect(within(ev).getByRole('link', { name: 'How do I stop Claude Code from running rm -rf?' })).toHaveAttribute('href', 'https://reddit.example.com/r1')
    expect(ev).toHaveTextContent('People asked · Reddit r/ClaudeAI · 320 upvotes')
    const runners = within(pick).getByTestId('pick-runners-up')
    expect(runners).toHaveTextContent('Left out: repeats a live guide "What Is M91?"')
    expect(within(runners).getAllByRole('button', { name: /Pin for next week/ })).toHaveLength(1)
  })

  it('a runner-up can be pinned for next week (a pinned topic goes before the editor)', async () => {
    const calls = page({ extra: { 'POST /api/pinned': { status: 201, body: { pinned: {}, saved: true } } } })
    await userEvent.click(await screen.findByRole('button', { name: /Pin for next week/ }))
    await waitFor(() => expect(posts(calls)[0]?.path).toBe('/api/pinned'))
    const body = posts(calls)[0].body as { topic: string; date: string; notes: string }
    expect(body.topic).toBe('What should wake an on-call engineer at night?')
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(await screen.findByRole('button', { name: /Pinned/ })).toBeDisabled()
  })

  it('news cards: Write now and Dismiss (no Add to roadmap); a card being written has no buttons; Check news shows its cost', async () => {
    const calls = page({ extra: { 'POST /api/timely/O-1': { body: { opportunity: { status: 'write_now' } } }, 'POST /api/timely/O-W': { body: { opportunity: { status: 'dismissed' } } }, 'POST /api/runs': { status: 202, body: { run_id: 'R-261022-1200-ABCD' } } } })
    const one = await screen.findByTestId('timely-card-O-1')
    expect(one).toHaveTextContent('Why M91: A person could approve each refund.')
    expect(within(one).queryByRole('button', { name: /Add to roadmap/ })).not.toBeInTheDocument()
    await userEvent.click(within(one).getByRole('button', { name: /Write now/ }))
    await waitFor(() => expect(posts(calls)[0]).toEqual({ method: 'POST', path: '/api/timely/O-1', body: { action: 'write_now' } }))
    await userEvent.click(within(screen.getByTestId('timely-card-O-W')).getByRole('button', { name: /Dismiss/ }))
    await waitFor(() => expect(posts(calls)[1].body).toEqual({ action: 'dismiss' }))
    expect(within(screen.getByTestId('timely-card-O-B')).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Earlier (1)')).toBeInTheDocument()
    const check = screen.getByTestId('check-news')
    expect(check).toHaveTextContent(`Check news · ${COSTS.timely_check.normal} AI call · ${COSTS.timely_check.mem0} memory`)
    await userEvent.click(check)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Check news' }))
    await waitFor(() => expect(posts(calls)[2]).toEqual({ method: 'POST', path: '/api/runs', body: { mode: 'timely_check', dry_run: false, params: {} } }))
    expect(await screen.findByText('live page')).toBeInTheDocument()
  })

  it('the live guides and Sync guides (0 AI calls); the news section is hidden while the news check is off', async () => {
    const calls = page({ settings: { ...S, timely: { ...TIMELY, enabled: false } }, extra: { 'POST /api/runs': { status: 202, body: { run_id: 'R-261028-1200-ABCD' } } } })
    const section = await screen.findByTestId('guides-section')
    await waitFor(() => expect(within(section).getAllByTestId('guide-row')).toHaveLength(1))
    expect(within(section).getByRole('link', { name: /What Is M91\?/ })).toHaveAttribute('href', G1)
    expect(screen.queryByTestId('timely-section')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Sync guides · 0 AI calls/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(posts(calls)[0]).toEqual({ method: 'POST', path: '/api/runs', body: { mode: 'guides', dry_run: false, params: {} } }))
  })

  it('no decisions yet; a pinned topic or a Write now card goes first, with a waiting card and its reason', async () => {
    page({ weekly: WEEKLY({ picks: [], next: { kind: 'pinned', topic: 'Approvals for refunds', pinned_id: 'PIN-1', timely_waiting: { title: 'Event O-W', opportunity_id: 'O-W', reason: 'TIMELY_MAX_PER_WEEK (1) timely post already written in the last 7 days' } } }) })
    expect(await screen.findByText(/No decisions yet/)).toBeInTheDocument()
    expect(screen.getByTestId('week-next')).toHaveTextContent('Your pinned topic: Approvals for refunds')
    expect(screen.getByTestId('week-waiting')).toHaveTextContent('“Event O-W” (Write now) waits: TIMELY_MAX_PER_WEEK (1)')
    expect(nextRunText({ kind: 'timely', title: 'Event O-1', opportunity_id: 'O-1', outlet: 'Example News' })).toBe('The news you chose with Write now: Event O-1 (Example News)')
  })
})

describe('Control: the topic line on the big card', () => {
  it('says the editor decides, shows the last pick and the news badge', async () => {
    mockFetch({
      'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } }, 'GET /api/settings': { body: S }, 'GET /api/runs?limit=5': { body: { runs: [] } }, 'GET /api/approvals': { body: { approvals: [] } },
      'GET /api/records?type=brief&limit=30': { body: { records: [] } }, 'GET /api/records?type=draft&limit=60': { body: { records: [] } }, 'GET /api/records?type=draft&status=approved&limit=30': { body: { records: [] } },
      'GET /api/weekly': { body: WEEKLY() }, 'GET /api/timely': { body: TIMELY_RES([CARD('O-1'), CARD('O-2')]) }
    } as Parameters<typeof mockFetch>[0])
    renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    const card = await screen.findByTestId('run-card-Write the next post')
    await waitFor(() => expect(within(card).getByTestId('control-next-up')).toHaveTextContent('Topic: The editor decides when the run starts'))
    expect(within(card).getByTestId('control-last-pick')).toHaveTextContent('Last pick: How to make Claude Code ask before rm -rf (Tutorial, 2026-10-22)')
    expect(within(card).getByTestId('control-timely')).toHaveTextContent('2 news items this week')
    expect(within(card).getByTestId('models')).toHaveTextContent('Editor gpt-5.5 (openai)')
  })
})
