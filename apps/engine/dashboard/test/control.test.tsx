import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import Control from '../src/pages/Control'
import { buildRunRequest, leastUsedGroup, lowCostParams } from '../src/config/runOptions'
import { COSTS } from '../src/config/costs'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const BRIEFS = [
  { id: 'm1', type: 'brief', status: 'approved', brief_id: '261019-1055-BZ89', topic_group: '1', version: 1, key_id: '261019-1055-BZ89', title: 'How to Gate Destructive AI Agent Actions' },
  { id: 'm2', type: 'brief', status: 'drafted', brief_id: '261017-2301-L6GD', topic_group: '4', version: 1, key_id: '261017-2301-L6GD', title: 'How M91 Rings Through Silent Mode' },
  { id: 'm3', type: 'brief', status: 'drafted', brief_id: '261017-2258-8CDR', topic_group: '3', version: 2, key_id: '261017-2258-8CDR', title: 'Send a One-Person Approval Alert' },
  { id: 'm4', type: 'brief', status: 'new', brief_id: '261017-2257-3MMH', topic_group: '1', version: 1, key_id: '261017-2257-3MMH', title: 'x' }
]

function routes(extra: Record<string, unknown> = {}, settings: unknown = SETTINGS) {
  return {
    'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } },
    'GET /api/settings': { body: settings },
    'GET /api/runs?limit=5': { body: { runs: [] } },
    'GET /api/approvals': { body: { approvals: [] } },
    'GET /api/records?type=brief&limit=30': { body: { records: BRIEFS } },
    'GET /api/records?type=draft&limit=60': { body: { records: [{ id: 'd3', type: 'draft', status: 'approved', brief_id: '261019-1055-BZ89', version: 3, key_id: null, title: 'How to Gate' }] } },
    'GET /api/records?type=draft&status=approved&limit=30': { body: { records: [{ id: 'd3', type: 'draft', status: 'approved', brief_id: '261019-1055-BZ89', version: 3, key_id: null, title: 'How to Gate' }] } },
    ...extra
  } as Parameters<typeof mockFetch>[0]
}

const page = () => renderApp(<Routes><Route path="/" element={<Control />} /><Route path="/runs/:runId" element={<p>live page</p>} /></Routes>)
const card = (title: string) => screen.getByTestId(`run-card-${title}`)
/** The run button of a card, once it is enabled (settings load first). */
async function runButton(title: string) {
  const b = within(card(title)).getByRole('button')
  await waitFor(() => expect(b).toBeEnabled())
  return b
}

describe('low-cost params', () => {
  it('are exactly the params configForRun accepts (snapshot)', () => {
    expect(lowCostParams(3)).toMatchInlineSnapshot(`
      {
        "ai_max_retries": 1,
        "max_ai_rounds_per_post": 2,
        "max_writer_revisions": 1,
        "reviewer_max_source_checks": 1,
        "scout": {
          "docs_max_chars": 15000,
          "docs_max_pages": 5,
          "max_calls": 6,
          "question_groups": [
            3,
          ],
          "questions_per_group": 3,
        },
      }
    `)
    expect(() => lowCostParams(6)).toThrow()
    expect(buildRunRequest('scout', { dryRun: false, lowCost: false, group: 2 })).toEqual({ mode: 'scout', dry_run: false, params: {} })
    expect(buildRunRequest('writer', { dryRun: true, lowCost: true, group: 2, params: { brief_id: 'B' } }).params).toMatchObject({ brief_id: 'B', scout: { question_groups: [2] } })
  })

  it('the default group is the least-used topic group of recent briefs (strings or numbers; ties → lowest)', () => {
    expect(leastUsedGroup(['1', '4', '3', '1'])).toBe(2)
    expect(leastUsedGroup([1, 2, 3, 4, 5, 1, 2, 3, 5])).toBe(4)
    expect(leastUsedGroup([])).toBe(1)
  })
})

describe('Control page', () => {
  it('shows expected calls; with the low-cost preset, Run Scout asks first and sends the low-cost params with the default dry-run', async () => {
    const calls = mockFetch(routes({ 'POST /api/runs': { status: 202, body: { run_id: 'R-261019-1300-ABCD' } } }))
    page()
    await screen.findByRole('option', { name: /2 \(least used\)/ }, { timeout: 5000 })
    await userEvent.click(screen.getByRole('radio', { name: /Low-cost test run/ }))
    expect(within(card('Run Scout')).getByTestId('cost')).toHaveTextContent(`Expected AI calls: ${COSTS.scout.normal} normal · ${COSTS.scout.lowCost} low-cost`)
    await userEvent.click(await runButton('Run Scout'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent('Expected AI calls: 5–6')
    expect(within(dialog).getByTestId('run-preset')).toHaveTextContent('Low-cost test run (Scout group 2)')
    expect(within(dialog).getByTestId('expected-mem0')).toHaveTextContent(COSTS.scout.mem0LowCost!)
    expect(within(dialog).getByTestId('run-summary')).toHaveTextContent('Dry runyes')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start the run' }))
    expect(await screen.findByText('live page')).toBeInTheDocument()
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({ mode: 'scout', dry_run: true, params: lowCostParams(2) })
  })

  it('the Normal run preset is the default; with dry run off: no extra params, normal estimate', async () => {
    const calls = mockFetch(routes({ 'POST /api/runs': { status: 202, body: { run_id: 'R-261019-1300-ABCD' } } }))
    page()
    await screen.findByRole('option', { name: /least used/ }, { timeout: 5000 })
    expect(screen.getByRole('radio', { name: /Normal run/ })).toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Dry run' }))
    await userEvent.click(await runButton('Run full pipeline'))
    expect(within(screen.getByRole('dialog')).getByTestId('expected-calls')).toHaveTextContent(COSTS.full.normal)
    expect(within(screen.getByRole('dialog')).getByTestId('expected-mem0')).toHaveTextContent(COSTS.full.mem0)
    expect(within(screen.getByRole('dialog')).getByTestId('run-preset')).toHaveTextContent('Normal run')
    await userEvent.click(screen.getByRole('button', { name: 'Start the run' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ mode: 'full', dry_run: false, params: {} }))
  })

  it('Writer and Reviewer send the picked brief / draft (and the routing loop flag)', async () => {
    const calls = mockFetch(routes({ 'POST /api/runs': { status: 202, body: { run_id: 'R-261019-1300-ABCD' } } }))
    page()
    await screen.findByRole('option', { name: /261017-2301-L6GD/ })
    expect(within(card('Run Reviewer')).getByRole('button', { name: /Run Reviewer/ })).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Draft for the Reviewer'), '261019-1055-BZ89|3')
    await userEvent.click(screen.getByLabelText('Also run the routing loop'))
    expect(within(card('Run Reviewer')).getByTestId('cost')).toHaveTextContent(COSTS.reviewer_route.normal)
    await userEvent.click(await runButton('Run Reviewer'))
    await userEvent.click(screen.getByRole('button', { name: 'Start the run' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ mode: 'reviewer', params: { brief_id: '261019-1055-BZ89', version: 3, route: true } }))
  })

  it('409: a clear message with a link to the running run', async () => {
    mockFetch(routes({ 'POST /api/runs': { status: 409, body: { error: { code: 'run_in_progress', message: 'run R-261019-1250-WXYZ is in progress' } } } }))
    page()
    await screen.findByRole('option', { name: /least used/ }, { timeout: 5000 })
    await userEvent.click(await runButton('Run Strategist'))
    await userEvent.click(screen.getByRole('button', { name: 'Start the run' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('A run is already in progress: run R-261019-1250-WXYZ is in progress')
    expect(within(alert).getByRole('link', { name: 'Open R-261019-1250-WXYZ' })).toHaveAttribute('href', '/runs/R-261019-1250-WXYZ')
  })

  it('run buttons are disabled for modes not in built_modes; the Experience Designer needs its mode; Publish says when it comes', async () => {
    mockFetch(routes({}, { ...SETTINGS, built_modes: ['full', 'strategist', 'writer', 'reviewer', 'promo'] }))
    page()
    await screen.findByRole('option', { name: /least used/ }, { timeout: 5000 })
    await waitFor(() => expect(within(card('Run full pipeline')).getByRole('button', { name: /Run full pipeline/ })).toBeEnabled())
    expect(within(card('Run Scout')).getByRole('button')).toBeDisabled()
    expect(within(card('Experience Designer')).getByRole('button')).toBeDisabled()
    expect(card('Experience Designer')).toHaveTextContent('Expected AI calls: 1–2')
    expect(card('Publish')).toHaveTextContent('Coming in Phase 7')
  })

  it('an engine that does not report built_modes (started before Phase 6): restart message, buttons disabled', async () => {
    const { built_modes: _b, decision_modes: _d, ...old } = SETTINGS
    mockFetch(routes({}, old))
    page()
    expect(await screen.findByTestId('engine-outdated')).toHaveTextContent('Restart it with npm run dev:engine')
    expect(within(card('Run Scout')).getByRole('button')).toBeDisabled()
    expect(card('Run Scout')).toHaveTextContent('Restart the engine first')
    expect(card('Run Scout')).not.toHaveTextContent('Coming in')
  })

  it('a running run: its card with Stop, and run buttons disabled', async () => {
    mockFetch(routes({ 'GET /api/runs?limit=5': { body: { runs: [{ run_id: 'R-261019-1250-WXYZ', mode: 'scout', trigger: 'manual', dry_run: true, status: 'running', started_at: new Date(Date.now() - 65_000).toISOString(), ms: null, brief_id: null, result_summary: '', steps: [{ name: 'scout', status: 'running', ms: null, ai_calls: 2 }] }] } } }))
    page()
    expect(await screen.findByText('Current run')).toBeInTheDocument()
    expect(screen.getByText('scout · 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument()
    expect(within(card('Run Scout')).getByRole('button')).toBeDisabled()
    expect(card('Run Scout')).toHaveTextContent('A run is in progress')
  })
})

describe('Phase 10: the promo pack is hidden while PROMO_ENABLED=false', () => {
  it('no promo card once the engine reports promo off', async () => {
    mockFetch(routes({}, { ...SETTINGS, designer: { max_components: 10, max_repairs: 1, interactive_default: true, max_designer_revisions: 2, promo_enabled: false } }))
    page()
    await screen.findByTestId('run-card-Experience Designer')
    await waitFor(() => expect(screen.queryByTestId('run-card-Create promo pack')).toBeNull())
  })
  it('the promo card is back with PROMO_ENABLED=true', async () => {
    mockFetch(routes({}, { ...SETTINGS, designer: { max_components: 10, max_repairs: 1, interactive_default: true, max_designer_revisions: 2, promo_enabled: true } }))
    page()
    expect(await screen.findByTestId('run-card-Create promo pack')).toBeInTheDocument()
  })
})
