import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import Agents from '../src/pages/Agents'
import { mockFetch, renderApp } from './helpers'

const agent = (id: string, name: string, over = {}) => ({
  id, name, role: `${name} role.`, gets: `${name} gets.`, gives: `${name} gives.`, model: { service: 'openai', model: `model-${id}`, delivery: 'sync' }, enabled: true,
  settings: [{ label: 'Repairs', value: '1' }, { label: 'Word target', value: '1800–2500', note: 'aims for about 1800–2150, never pads' }],
  prompts: [{ title: 'Instructions', text: `You are the ${name}.\n=== RULES ===\nWrite only from the inputs.` }],
  ...over
})

describe('Agents page', () => {
  it('shows the pipeline, each agent with its model and settings, and its instructions word for word', async () => {
    mockFetch({
      'GET /api/agents': { body: {
        agents: [agent('writer', 'Writer'), agent('factcheck', 'Fact check', { enabled: false }), agent('reviewer', 'Reviewer')],
        pipeline: { order: ['Writer', 'Fact check', 'Reviewer'], settings: [{ label: 'Rewrites after a review', value: '2' }] }
      } }
    })
    renderApp(<Routes><Route path="/agents" element={<Agents />} /></Routes>, { route: '/agents' })
    const writer = await screen.findByTestId('agent-writer')
    expect(within(writer).getByText('Writer role.')).toBeInTheDocument()
    expect(screen.getByTestId('agent-model-writer')).toHaveTextContent('model-writer · openai')
    expect(within(writer).getByText('aims for about 1800–2150, never pads')).toBeInTheDocument()
    expect(within(screen.getByTestId('agent-factcheck')).getByText('off')).toBeInTheDocument()
    expect(screen.getByTestId('agents-pipeline')).toHaveTextContent('WriterFact checkReviewer')
    const prompt = within(writer).getByTestId('agent-prompt')
    await userEvent.click(within(prompt).getByText('Instructions'))
    expect(prompt).toHaveAttribute('open')
    expect(within(prompt).getByText(/=== RULES ===/)).toBeInTheDocument()
  })
})
