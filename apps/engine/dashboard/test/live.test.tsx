import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import fixture from './fixtures/events.json'
import type { EngineEvent } from '../src/api/sse'
import { PipelineTracker } from '../src/components/PipelineTracker'
import { initialRunView, runReducer, type RunRecord } from '../src/state/runEvents'
import RunLive from '../src/pages/RunLive'
import Runs from '../src/pages/Runs'
import { FakeEventSource, mockFetch, renderApp } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const play = (events: EngineEvent[]) => events.reduce((s, e) => runReducer(s, { type: 'event', event: e }), initialRunView(events[0].run_id))
const livePage = (runId: string) => renderApp(<Routes><Route path="/runs/:runId" element={<RunLive />} /></Routes>, { route: `/runs/${runId}` })

describe('PipelineTracker', () => {
  it('nests Scout sub-steps under Scout', () => {
    render(<PipelineTracker view={play(fixture.full_run as EngineEvent[])} />)
    const scout = screen.getByTestId('step-scout')
    expect(scout).toHaveAttribute('data-status', 'done')
    const subs = within(scout).getByRole('list', { name: 'Scout sub-steps' })
    expect(within(subs).getByTestId('substep-scout.facts')).toHaveTextContent('facts · 59s · 1 call · 2 retries')
    expect(within(subs).getByTestId('substep-scout.questions.g1')).toHaveTextContent('questions.g1')
    expect(screen.getByTestId('step-promo')).toHaveAttribute('data-status', 'skipped')
  })

  it('shows the Designer and Publisher placeholders as "not built yet"', () => {
    render(<PipelineTracker view={play(fixture.approve as EngineEvent[])} />)
    expect(screen.getByTestId('step-designer')).toHaveTextContent('not built yet')
    expect(screen.getByTestId('step-publisher')).toHaveTextContent('not built yet')
    expect(screen.getByTestId('step-promo')).toHaveTextContent('1 AI call')
  })
})

describe('Live run page', () => {
  const full = fixture.full_run as EngineEvent[]
  const runId = full[0].run_id

  it('streams events, deduplicates a replay after a reconnect, and shows routes, banner, outputs and log', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetch({ [`GET /api/runs/${runId}`]: { body: { run: { run_id: runId, mode: 'full', trigger: 'manual', dry_run: true, status: 'running', steps: [] }, records: [] } } })
    livePage(runId)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const first = FakeEventSource.instances[0]
    expect(first.url).toBe(`/api/runs/${runId}/events`)
    act(() => {
      first.open()
      for (const e of full.slice(0, 20)) first.emit(e)
    })
    expect(await screen.findByTestId('step-scout')).toHaveAttribute('data-status', 'done')
    expect(screen.getByTestId('step-writer')).toHaveAttribute('data-status', 'running')
    // The connection drops while the run is active: the page reconnects and the replay is not applied twice.
    act(() => first.fail(0))
    expect(await screen.findByText(/reconnecting/)).toBeInTheDocument()
    expect(first.closed).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2))
    const second = FakeEventSource.instances[1]
    act(() => {
      second.open()
      for (const e of full) second.emit(e)
    })
    vi.useRealTimers()
    expect(await screen.findByTestId('approval-waiting')).toHaveTextContent('awaiting human approval (v2, score 86)')
    expect(screen.getByRole('link', { name: 'Open the approval screen' })).toHaveAttribute('href', '/approvals/261019-0900-ABCD')
    expect(screen.getByTestId('run-ai-calls')).toHaveTextContent('7 (+3 retries)')
    expect(screen.getByText('Reviewer → Writer: simplicity 6, seo 6')).toBeInTheDocument()
    expect(screen.getByText('Reviewer → waiting for you (score 86)')).toBeInTheDocument()
    expect(within(screen.getByTestId('event-log')).getAllByRole('row')).toHaveLength(full.length)
    expect(second.closed).toBe(true)
    expect(screen.queryByTestId('source-note')).not.toBeInTheDocument()
  })

  it('a run from before Phase 6 (no buffer, no timeline) is rebuilt from its record, with the note', async () => {
    const r = fixture.qhvg.run as RunRecord
    mockFetch({ [`GET /api/runs/${r.run_id}`]: { body: fixture.qhvg } })
    livePage(r.run_id)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    await screen.findByText('hit MAX_WRITER_REVISIONS (1)')
    act(() => FakeEventSource.instances[0].fail(0))
    expect(await screen.findByTestId('source-note')).toHaveTextContent('Info-level log lines are kept only while the engine runs.')
    expect(screen.getByTestId('source-note')).toHaveTextContent('no saved timeline')
    expect(screen.getByTestId('step-scout')).toHaveTextContent('5 AI calls')
    expect(screen.getByTestId('run-ai-calls')).toHaveTextContent('11')
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('when the stream closes before the (slow) record arrives, it waits for the record instead of reconnecting', async () => {
    const r = fixture.qhvg.run as RunRecord
    let release: () => void = () => {}
    const gate = new Promise<void>((ok) => { release = ok })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate
      return new Response(JSON.stringify(fixture.qhvg), { status: 200 })
    }))
    livePage(r.run_id)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => FakeEventSource.instances[0].fail(0))
    expect(screen.queryByText(/reconnecting/)).not.toBeInTheDocument()
    await new Promise((ok) => setTimeout(ok, 1200))
    expect(FakeEventSource.instances).toHaveLength(1)
    await act(async () => release())
    expect(await screen.findByTestId('source-note')).toHaveTextContent('no saved timeline')
    expect(screen.getByTestId('step-writer')).toHaveTextContent('3 AI calls')
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('a finished run with a saved timeline is rebuilt from it', async () => {
    const rec = fixture.full_run_record as RunRecord
    mockFetch({ [`GET /api/runs/${rec.run_id}`]: { body: { run: rec, records: [] } } })
    livePage(rec.run_id)
    await screen.findByText('awaiting human approval (v2, score 86)')
    act(() => FakeEventSource.instances[0].fail(0))
    expect(await screen.findByTestId('source-note')).toHaveTextContent('rebuilt from the run’s saved timeline')
    expect(screen.getByTestId('approval-waiting')).toBeInTheDocument()
    expect(screen.getByText('Reviewer → Writer: simplicity 6, seo 6')).toBeInTheDocument()
  })

  it('Stop asks first (0 AI calls) and then cancels the run', async () => {
    const calls = mockFetch({
      [`GET /api/runs/${runId}`]: { body: { run: { run_id: runId, mode: 'full', status: 'running', steps: [] }, records: [] } },
      [`POST /api/runs/${runId}/cancel`]: { status: 202, body: { run_id: runId, cancelling: true } }
    })
    livePage(runId)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => {
      FakeEventSource.instances[0].open()
      FakeEventSource.instances[0].emit(full[0])
    })
    await userEvent.click(await screen.findByRole('button', { name: /Stop/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent('Expected AI calls: 0')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop the run' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === `/api/runs/${runId}/cancel`)).toBe(true))
  })
})

describe('Runs page', () => {
  it('lists runs with summed AI calls and filters by status', async () => {
    const steps = (n: number[]) => n.map((c, i) => ({ name: `s${i}`, status: 'succeeded', ms: 1, ai_calls: c }))
    mockFetch({
      'GET /api/runs?limit=50': {
        body: {
          runs: [
            { run_id: 'R-261019-1136-UQ7F', mode: 'approve', trigger: 'manual', dry_run: false, status: 'succeeded', started_at: '2026-10-19T11:36:07+05:30', ms: 29217, brief_id: '261019-1055-BZ89', result_summary: 'approved by you (v3)', steps: steps([1, 0, 0]) },
            { run_id: 'R-261019-1055-QHVG', mode: 'full', trigger: 'manual', dry_run: false, status: 'failed', started_at: '2026-10-19T10:55:22+05:30', ms: 751616, brief_id: '261019-1055-BZ89', result_summary: 'hit MAX_WRITER_REVISIONS (1)', steps: steps([5, 1, 1, 0, 1, 2, 0, 0, 1]) }
          ]
        }
      }
    })
    renderApp(<Runs />)
    await userEvent.click(screen.getByRole('tab', { name: 'All runs' }))
    const row = (await screen.findByText('R-261019-1055-QHVG')).closest('tr')!
    expect(within(row).getByText('11')).toBeInTheDocument()
    expect(within(row).getByText('12m 32s')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'succeeded')
    expect(screen.queryByText('R-261019-1055-QHVG')).not.toBeInTheDocument()
    expect(screen.getByText('R-261019-1136-UQ7F')).toBeInTheDocument()
  })
})

describe('Runs by post', () => {
  it('one row per post with its journey; runs without a post are listed apart', async () => {
    const stage = (id: string, label: string, state: string) => ({ id, label, state, detail: '', run_id: null, at: null })
    mockFetch({
      'GET /api/journeys?limit=30': { body: { posts: [{ brief_id: '261019-1055-BZ89', title: 'How to Gate Destructive AI Agent Actions', status: 'approved', runs: 2, active_run_id: null, updated_at: '2026-10-19T11:36:07+05:30',
        stages: [stage('topic', 'Topic', 'done'), stage('research', 'Research', 'done'), stage('plan', 'Plan', 'done'), stage('draft', 'Draft', 'done'), stage('review', 'AI review', 'done'), stage('you', 'You', 'done'), stage('export', 'Export', 'done'), stage('published', 'Published', 'done')] }] } },
      'GET /api/runs?limit=20': { body: { runs: [{ run_id: 'R-261019-0900-GGGG', mode: 'guides', trigger: 'manual', dry_run: false, status: 'succeeded', started_at: '2026-10-19T09:00:00+05:30', ms: 1, brief_id: null, result_summary: '12 guides', steps: [] }] } }
    })
    renderApp(<Runs />)
    const post = await screen.findByTestId('post-261019-1055-BZ89')
    expect(within(post).getByRole('link', { name: 'How to Gate Destructive AI Agent Actions' })).toHaveAttribute('href', '/approvals/261019-1055-BZ89')
    expect(post).toHaveTextContent('Published')
    expect(post).toHaveTextContent('2 runs')
    expect(await screen.findByRole('link', { name: 'Read published guides' })).toHaveAttribute('href', '/runs/R-261019-0900-GGGG')
  })
})

describe('PipelineTracker (Phase 10)', () => {
  it('runs in the new order and hides an unused promo step while the promo pack is off', () => {
    render(<PipelineTracker view={play(fixture.full_run as EngineEvent[])} hidePromo />)
    const names = screen.getAllByRole('listitem').filter((li) => li.dataset.testid?.startsWith('step-')).map((li) => li.dataset.testid)
    expect(names).toEqual(['step-scout', 'step-strategist', 'step-writer', 'step-checks', 'step-designer', 'step-reviewer', 'step-publisher'])
    expect(screen.getByTestId('step-designer')).toHaveTextContent('Experience Designer')
  })
})
