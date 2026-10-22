// Phase 12 Task 7: the Roadmap page (stages, slots, Next up, approve, generate with its cost, edit / move / skip /
// accept / reject), "Next up" on Control, the slot on the approval screen, the Settings card.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import RoadmapPage from '../src/pages/Roadmap'
import Control from '../src/pages/Control'
import Settings from '../src/pages/Settings'
import ApprovalDetail, { type ApprovalDetailData } from '../src/pages/ApprovalDetail'
import { nextUpText } from '../src/api/roadmap'
import { COSTS } from '../src/config/costs'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const S = { ...SETTINGS, built_modes: [...SETTINGS.built_modes, 'roadmap', 'export'], roadmap: { enabled: true, rapid_response_enabled: false }, models: { ...SETTINGS.models, planner: { service: 'openai', model: 'gpt-5.6-luna', delivery: 'sync' } }, publish: { target: 'none', docstar_configured: false, auto_publish: false }, designer: { enabled: false, max_repairs: 1, interactive_default: true, promo_enabled: false } }
const slot = (slot_id: string, title_idea: string, status = 'planned', needs: string[] = [], extra = {}) => ({ slot_id, title_idea, question: `${title_idea}?`, teaches: ['x'], needs, status, brief_id: '', ...extra })
const stage = (number: number, name: string, slots: unknown[]) => ({ number, name, level: number < 3 ? 'beginner' : 'intermediate', goal: `Goal of ${name}.`, slots })
const ROADMAP = (status: 'draft' | 'approved' = 'draft') => ({
  version: 1, status, generated_at: '2026-10-22T10:00:00+05:30', model_used: 'gpt-5.6-luna', notes: 'none',
  stages: [
    stage(0, 'Starter', [slot('s0-1', 'What M91 is', 'approved', [], { brief_id: '261022-1000-ABCD' }), slot('s0-2', 'How M91 works', 'planned', ['s0-1'])]),
    stage(1, 'Foundations', [slot('s1-1', 'What an approval step is'), slot('s1-2', 'Why a phone rings'), slot('s1-3', 'One owner')]),
    stage(3, 'Use cases', [slot('s3-1', 'Agents'), slot('s3-2', 'Refunds'), slot('s3-3', 'On-call'), slot('s3-4', 'Database changes', 'proposed', [], { demand_evidence: '300 upvotes' })])
  ]
})
const NEXT = { kind: 'slot', slot_id: 's0-2', title_idea: 'How M91 works', stage: { number: 0, name: 'Starter', level: 'beginner' } }
const page = (data: unknown, extra: Record<string, unknown> = {}) => {
  const calls = mockFetch({ 'GET /api/settings': { body: S }, 'GET /api/roadmap': { body: data }, ...extra } as Parameters<typeof mockFetch>[0])
  renderApp(<Routes><Route path="/roadmap" element={<RoadmapPage />} /><Route path="/runs/:runId" element={<p>live page</p>} /></Routes>, { route: '/roadmap' })
  return calls
}
const posts = (calls: ReturnType<typeof mockFetch>) => calls.filter((c) => c.method === 'POST')

describe('Roadmap page', () => {
  it('no roadmap: Generate with its cost (1–2 AI calls) starts the roadmap run', async () => {
    const calls = page({ roadmap: null, record_id: null, next: { kind: 'none', reason: 'there is no roadmap yet: generate it' }, problems: [] }, { 'POST /api/runs': { status: 202, body: { run_id: 'R-261022-1400-ABCD' } } })
    expect(await screen.findByText(/No roadmap yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Generate · 1–2 AI calls/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent(COSTS.roadmap.normal)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate' }))
    await screen.findByText('live page')
    expect(posts(calls)[0]).toEqual({ method: 'POST', path: '/api/runs', body: { mode: 'roadmap', dry_run: false, params: {} } })
  })

  it('a draft: stages and slots with status, Next up highlighted, Approve roadmap', async () => {
    const calls = page({ roadmap: ROADMAP('draft'), record_id: 'mem-rm', next: { kind: 'none', reason: 'Approve the roadmap first' }, problems: [] }, { 'POST /api/roadmap/approve': { body: { roadmap: ROADMAP('approved'), record_id: 'mem-rm' } } })
    expect(await screen.findByTestId('roadmap-status')).toHaveTextContent('draft')
    expect(screen.getByTestId('next-up')).toHaveTextContent('Next up: Approve the roadmap first')
    expect(screen.getByText(/Stage 0 · Starter/)).toBeInTheDocument()
    expect(within(screen.getByTestId('slot-s0-1')).getByText('approved')).toBeInTheDocument()
    expect(within(screen.getByTestId('slot-s0-1')).getByRole('link', { name: '261022-1000-ABCD' })).toHaveAttribute('href', '/approvals/261022-1000-ABCD')
    await userEvent.click(screen.getByRole('button', { name: /Approve roadmap/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(posts(calls)).toEqual([{ method: 'POST', path: '/api/roadmap/approve', body: {} }]))
  })

  it('approved: Next up badge on its slot; edit, move, skip, accept and reject send their actions', async () => {
    const reply = { body: { roadmap: ROADMAP('approved'), record_id: 'mem-rm' } }
    const calls = page({ roadmap: ROADMAP('approved'), record_id: 'mem-rm', next: NEXT, problems: [] }, {
      'POST /api/roadmap/slots/s1-2': reply, 'POST /api/roadmap/slots/s1-2/move': reply, 'POST /api/roadmap/slots/s1-3/skip': reply,
      'POST /api/roadmap/slots/s3-4/accept': reply, 'POST /api/roadmap/slots/s3-4/reject': reply
    })
    const next = await screen.findByTestId('slot-s0-2')
    expect(within(next).getByTestId('next-up-badge')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve roadmap/ })).toBeNull()
    expect(within(screen.getByTestId('slot-s0-1')).queryByRole('button', { name: /Edit/ })).toBeNull()
    const s12 = screen.getByTestId('slot-s1-2')
    await userEvent.click(within(s12).getByRole('button', { name: /Edit/ }))
    const title = screen.getByLabelText('Title idea')
    await userEvent.clear(title)
    await userEvent.type(title, 'Why a ringing phone works')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts(calls)[0]).toEqual({ method: 'POST', path: '/api/roadmap/slots/s1-2', body: { title_idea: 'Why a ringing phone works', question: 'Why a phone rings?', teaches: ['x'], needs: [] } }))
    await userEvent.click(within(screen.getByTestId('slot-s1-2')).getByRole('button', { name: 'Move s1-2 up' }))
    await userEvent.click(within(screen.getByTestId('slot-s1-3')).getByRole('button', { name: 'Skip' }))
    const proposed = screen.getByTestId('slot-s3-4')
    expect(proposed).toHaveTextContent('demand: 300 upvotes')
    await userEvent.click(within(proposed).getByRole('button', { name: /Accept/ }))
    await userEvent.click(within(screen.getByTestId('slot-s3-4')).getByRole('button', { name: /Reject/ }))
    await waitFor(() => expect(posts(calls).map((c) => [c.path, c.body])).toEqual([
      ['/api/roadmap/slots/s1-2', { title_idea: 'Why a ringing phone works', question: 'Why a phone rings?', teaches: ['x'], needs: [] }],
      ['/api/roadmap/slots/s1-2/move', { direction: 'up' }],
      ['/api/roadmap/slots/s1-3/skip', { skipped: true }],
      ['/api/roadmap/slots/s3-4/accept', {}],
      ['/api/roadmap/slots/s3-4/reject', {}]
    ]))
  })

  it('problems block the approval and are listed; an engine error is shown', async () => {
    page({ roadmap: ROADMAP('draft'), record_id: 'mem-rm', next: { kind: 'none', reason: 'Approve the roadmap first' }, problems: ['stage 2 (First steps) must appear exactly once'] })
    expect(await screen.findByTestId('roadmap-problems')).toHaveTextContent('stage 2 (First steps) must appear exactly once')
    expect(screen.getByRole('button', { name: /Approve roadmap/ })).toBeDisabled()
  })
})

describe('Next up on Control, the slot on the approval screen, Settings', () => {
  it('nextUpText', () => {
    expect(nextUpText(NEXT as never)).toBe('Stage 0 · Starter · s0-2 How M91 works')
    expect(nextUpText({ kind: 'pinned', topic: 'Refund approvals', pinned_id: 'PIN-1' })).toBe('Pinned topic: Refund approvals')
    expect(nextUpText({ kind: 'none', reason: 'Approve the roadmap first' })).toBe('Approve the roadmap first')
  })

  it('Control shows "Next up" above the Run button with the roadmap cost; with nothing to write the button is blocked with the reason', async () => {
    const base = {
      'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } }, 'GET /api/settings': { body: S }, 'GET /api/runs?limit=5': { body: { runs: [] } }, 'GET /api/approvals': { body: { approvals: [] } },
      'GET /api/records?type=brief&limit=30': { body: { records: [] } }, 'GET /api/records?type=draft&limit=60': { body: { records: [] } }, 'GET /api/records?type=draft&status=approved&limit=30': { body: { records: [] } }
    }
    mockFetch({ ...base, 'GET /api/roadmap': { body: { roadmap: ROADMAP('approved'), record_id: 'mem-rm', next: NEXT, problems: [] } } } as Parameters<typeof mockFetch>[0])
    const { unmount } = renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    const card = await screen.findByTestId('run-card-Run full pipeline')
    await waitFor(() => expect(within(card).getByTestId('control-next-up')).toHaveTextContent('Next up: Stage 0 · Starter · s0-2 How M91 works'))
    expect(within(card).getByTestId('cost')).toHaveTextContent(`Expected AI calls: ${COSTS.full_roadmap.normal}`)
    unmount()
    mockFetch({ ...base, 'GET /api/roadmap': { body: { roadmap: ROADMAP('draft'), record_id: 'mem-rm', next: { kind: 'none', reason: 'Approve the roadmap first' }, problems: [] } } } as Parameters<typeof mockFetch>[0])
    renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    const card2 = await screen.findByTestId('run-card-Run full pipeline')
    await waitFor(() => expect(card2).toHaveTextContent('Approve the roadmap first'))
    expect(within(card2).getByRole('button', { name: /Run full pipeline/ })).toBeDisabled()
  })

  it('the approval screen shows the slot, its stage and what it builds on', async () => {
    const B = '261022-1300-ABCD'
    const d: ApprovalDetailData = {
      brief_id: B, draft: { record_id: 'mem-d', version: 1, brief_version: 1, status: 'awaiting_human', waiting_since: null, title: 'How M91 works', post_markdown: '# How M91 works\n\nText.', reviewed: true, hard_passed: true },
      review: null, checks: [], earlier: [], interactive: null,
      slot: { slot_id: 's0-2', title_idea: 'How M91 works in 5 minutes', question: 'How does M91 work?', teaches: ['alert', 'channel'], status: 'in_review', stage: { number: 0, name: 'Starter', level: 'beginner' }, builds_on: [{ slot_id: 's0-1', title: 'What M91 is, in plain words', status: 'approved', brief_id: '261022-1000-ABCD' }], why_today: 'Builds on "What M91 is".', terms_to_define: ['channel'] }
    }
    mockFetch({ 'GET /api/settings': { body: S }, [`GET /api/approvals/${B}`]: { body: d } } as Parameters<typeof mockFetch>[0])
    renderApp(<Routes><Route path="/approvals/:briefId" element={<ApprovalDetail />} /></Routes>, { route: `/approvals/${B}` })
    const card = await screen.findByTestId('slot-card')
    expect(card).toHaveTextContent('Stage 0 · Starter (beginner) · s0-2 How M91 works in 5 minutes')
    expect(card).toHaveTextContent('explains: channel')
    expect(within(screen.getByTestId('builds-on')).getByRole('link', { name: 'What M91 is, in plain words' })).toHaveAttribute('href', '/approvals/261022-1000-ABCD')
    expect(card).toHaveTextContent('How it builds on them: Builds on "What M91 is".')
  })

  it('Settings: the roadmap card', async () => {
    mockFetch({ 'GET /api/settings': { body: S } })
    renderApp(<Settings />)
    expect(await screen.findByTestId('setting-roadmap')).toHaveTextContent('on (ROADMAP_ENABLED)')
    expect(screen.getByText('openai · gpt-5.6-luna · sync')).toBeInTheDocument()
  })
})
