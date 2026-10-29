// Control: each run card shows the AI model its agent uses now; "Write the next post" lists every step's model
// (the weekly editor first), and its topic line says the editor decides when the run starts.
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
  ...SETTINGS,
  // The Experience Designer off (the current setting): no Designer step, so no Designer model.
  designer: { enabled: false, max_repairs: 1, interactive_default: true, promo_enabled: false },
  models: { scout: { service: 'openai', model: 'gpt-5.6-luna', delivery: 'sync' }, strategist: { service: 'anthropic', model: 'claude-sonnet-4-6', delivery: 'rtlayer' }, writer: { service: 'anthropic', model: 'claude-opus-4-7', delivery: 'rtlayer' }, reviewer: { service: 'openai', model: 'gpt-5.5', delivery: 'sync' }, editor: { service: 'openai', model: 'gpt-5.5', delivery: 'sync' } }
}
const routes = (weekly: unknown) => ({
  'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } }, 'GET /api/settings': { body: S }, 'GET /api/runs?limit=5': { body: { runs: [] } }, 'GET /api/approvals': { body: { approvals: [] } },
  'GET /api/records?type=brief&limit=30': { body: { records: [] } }, 'GET /api/records?type=draft&limit=60': { body: { records: [] } }, 'GET /api/records?type=draft&status=approved&limit=30': { body: { records: [] } },
  'GET /api/weekly': { body: weekly }
}) as Parameters<typeof mockFetch>[0]

const WEEKLY = { next: { kind: 'editor' }, model: { service: 'openai', model: 'gpt-5.5' }, picks: [] }

describe('Control: models and the weekly editor', () => {
  it('each card names its model; Write the next post names every step’s model, the editor first', async () => {
    mockFetch(routes(WEEKLY))
    renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    const scout = await screen.findByTestId('run-card-Run Scout')
    await waitFor(() => expect(within(scout).getByTestId('models')).toHaveTextContent('AI model: gpt-5.6-luna (openai)'))
    expect(within(screen.getByTestId('run-card-Run Writer')).getByTestId('models')).toHaveTextContent('AI model: claude-opus-4-7 (anthropic)')
    expect(within(screen.getByTestId('run-card-Run Reviewer')).getByTestId('models')).toHaveTextContent('AI model: gpt-5.5 (openai)')
    expect(within(screen.getByTestId('run-card-Write the next post')).getByTestId('models')).toHaveTextContent('AI models: Editor gpt-5.5 (openai) · Scout gpt-5.6-luna (openai) · Strategist claude-sonnet-4-6 (anthropic) · Writer claude-opus-4-7 (anthropic) · Reviewer gpt-5.5 (openai)')
  })

  it('no decision yet: the topic line says the editor decides, and the button is enabled (no roadmap to approve)', async () => {
    mockFetch(routes(WEEKLY))
    renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    const card = await screen.findByTestId('run-card-Write the next post')
    await waitFor(() => expect(within(card).getByTestId('control-next-up')).toHaveTextContent("Topic: The editor decides when the run starts, from this week's questions, news and M91 changes (gpt-5.5)"))
    expect(within(card).queryByTestId('control-last-pick')).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Write the next post/ })).toBeEnabled()
  })

  it('a due pinned topic goes first: the topic line names it', async () => {
    mockFetch(routes({ ...WEEKLY, next: { kind: 'pinned', topic: 'Approvals for refunds', pinned_id: 'PIN-1' } }))
    renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    const card = await screen.findByTestId('run-card-Write the next post')
    await waitFor(() => expect(within(card).getByTestId('control-next-up')).toHaveTextContent('Topic: Your pinned topic: Approvals for refunds'))
  })
})
