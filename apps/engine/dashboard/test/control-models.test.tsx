// Control: each run card shows the AI model its agent uses now; "Run full pipeline" lists every step's model, and with
// no roadmap yet it is still one click (the run plans and approves the roadmap itself).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import Control from '../src/pages/Control'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const S = {
  ...SETTINGS, built_modes: [...SETTINGS.built_modes, 'roadmap'], roadmap: { enabled: true, rapid_response_enabled: false },
  // The Experience Designer off (the current setting): no Designer step, so no Designer model.
  designer: { enabled: false, max_repairs: 1, interactive_default: true, promo_enabled: false },
  models: { scout: { service: 'openai', model: 'gpt-5.6-luna', delivery: 'sync' }, strategist: { service: 'anthropic', model: 'claude-sonnet-4-6', delivery: 'rtlayer' }, writer: { service: 'anthropic', model: 'claude-opus-4-7', delivery: 'rtlayer' }, reviewer: { service: 'openai', model: 'gpt-5.5', delivery: 'sync' }, planner: { service: 'openai', model: 'gpt-5.6-luna', delivery: 'sync' } }
}
const routes = (next: unknown) => ({
  'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } }, 'GET /api/settings': { body: S }, 'GET /api/runs?limit=5': { body: { runs: [] } }, 'GET /api/approvals': { body: { approvals: [] } },
  'GET /api/records?type=brief&limit=30': { body: { records: [] } }, 'GET /api/records?type=draft&limit=60': { body: { records: [] } }, 'GET /api/records?type=draft&status=approved&limit=30': { body: { records: [] } },
  'GET /api/roadmap': { body: { roadmap: null, record_id: null, next, problems: [] } }
}) as Parameters<typeof mockFetch>[0]

describe('Control: models and one click', () => {
  it('each card names its model; the full pipeline names every step\'s model', async () => {
    mockFetch(routes({ kind: 'plan', reason: 'the run plans the roadmap first (1–2 more AI calls), approves it, then writes the first post' }))
    renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    const scout = await screen.findByTestId('run-card-Run Scout')
    await waitFor(() => expect(within(scout).getByTestId('models')).toHaveTextContent('AI model: gpt-5.6-luna (openai)'))
    expect(within(screen.getByTestId('run-card-Run Writer')).getByTestId('models')).toHaveTextContent('AI model: claude-opus-4-7 (anthropic)')
    expect(within(screen.getByTestId('run-card-Run Reviewer')).getByTestId('models')).toHaveTextContent('AI model: gpt-5.5 (openai)')
    expect(within(screen.getByTestId('run-card-Run full pipeline')).getByTestId('models')).toHaveTextContent('AI models: Planner gpt-5.6-luna (openai) · Scout gpt-5.6-luna (openai) · Strategist claude-sonnet-4-6 (anthropic) · Writer claude-opus-4-7 (anthropic) · Reviewer gpt-5.5 (openai)')
  })

  it('no roadmap yet: Next up says the run plans it, and the button stays enabled', async () => {
    mockFetch(routes({ kind: 'plan', reason: 'the run plans the roadmap first (1–2 more AI calls), approves it, then writes the first post' }))
    renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    const card = await screen.findByTestId('run-card-Run full pipeline')
    await waitFor(() => expect(within(card).getByTestId('control-next-up')).toHaveTextContent('Next up: First run: the run plans the roadmap first (1–2 more AI calls), approves it, then writes the first post'))
    expect(within(card).getByRole('button', { name: /Run full pipeline/ })).toBeEnabled()
  })

  it('nothing to write: the button is blocked with the reason', async () => {
    mockFetch(routes({ kind: 'none', reason: 'every stage of the roadmap is finished' }))
    renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    const card = await screen.findByTestId('run-card-Run full pipeline')
    await waitFor(() => expect(card).toHaveTextContent('every stage of the roadmap is finished'))
    expect(within(card).getByRole('button', { name: /Run full pipeline/ })).toBeDisabled()
  })
})
