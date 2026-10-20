// Phase 8 Task 6: interactive blocks in the dashboard — the switch and Re-run Designer on an approval, the
// Designer on Posts, the block_doc view, the Designer step output, the settings and the approve estimate.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ApprovalDetail, { type ApprovalDetailData } from '../src/pages/ApprovalDetail'
import Posts from '../src/pages/Posts'
import RecordDetail from '../src/pages/RecordDetail'
import Settings from '../src/pages/Settings'
import { StepOutputs } from '../src/components/StepOutputs'
import { COSTS } from '../src/config/costs'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const B = '261019-1622-Q8C4'
const S = {
  ...SETTINGS,
  models: { ...SETTINGS.models, designer: { service: 'openai', model: 'gpt-5.6-luna', delivery: 'sync' } },
  built_modes: [...SETTINGS.built_modes, 'designer', 'publish'],
  designer: { max_interactive_blocks: 6, max_repairs: 1, interactive_default: true }
}
const DOC = { record_id: 'mem-bd1', status: 'ok', summary: '2 blocks: steps_checklist, phone_ring_sim · 1 dropped · integrity passed', blocks: 5, dropped: 1, integrity_passed: true, created_at: '2026-10-20T10:00:00+05:30' }

function detail(status: string, interactive: ApprovalDetailData['interactive']): ApprovalDetailData {
  return {
    brief_id: B,
    draft: { record_id: 'mem-v3', version: 3, brief_version: 1, status, waiting_since: null, title: 'Bind every AI approval to one tool call', post_markdown: '# T\n\nText.', reviewed: true, hard_passed: true },
    review: null, checks: [], earlier: [], interactive
  }
}
const page = (d: ApprovalDetailData, extra: Record<string, unknown> = {}) => {
  const calls = mockFetch({ 'GET /api/settings': { body: S }, [`GET /api/approvals/${B}`]: { body: d }, ...extra } as Parameters<typeof mockFetch>[0])
  renderApp(<Routes><Route path="/approvals/:briefId" element={<ApprovalDetail />} /><Route path="/runs/:runId" element={<p>live page</p>} /></Routes>, { route: `/approvals/${B}` })
  return calls
}

describe('Interactive blocks card on an approval', () => {
  it('shows the switch, the newest Designer result with a record link, and Re-run Designer with 1–2 AI calls', async () => {
    const calls = page(detail('published', { on: true, default: true, set: false, block_doc: DOC }), { 'POST /api/runs': { status: 202, body: { run_id: 'R-261020-1000-ABCD' } } })
    expect(await screen.findByTestId('interactive-state')).toHaveTextContent('on')
    expect(screen.getByTestId('interactive-source')).toHaveTextContent('From INTERACTIVE_DEFAULT (on).')
    const result = screen.getByTestId('designer-result')
    expect(result).toHaveTextContent('2 blocks: steps_checklist, phone_ring_sim')
    expect(result).toHaveTextContent('integrity passed')
    expect(within(result).getByRole('link', { name: 'plan, blocks and integrity' })).toHaveAttribute('href', '/records/mem-bd1')
    expect(screen.getByTestId('republish-hint')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Re-run Designer · expected AI calls 1–2/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent('1–2')
    expect(dialog).toHaveTextContent('dry run')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Run the Designer' }))
    await screen.findByText('live page')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ mode: 'designer', dry_run: true, params: { brief_id: B } })
  })

  it('the switch posts on/off for the draft; Re-run Designer is disabled while blocks are off', async () => {
    const calls = page(detail('approved', { on: false, default: true, set: true, block_doc: null }), { [`POST /api/drafts/${B}/interactive`]: { body: { brief_id: B, version: 3, on: true, saved: true } } })
    expect(await screen.findByTestId('interactive-state')).toHaveTextContent('off')
    expect(screen.getByTestId('interactive-source')).toHaveTextContent('Set for this post.')
    expect(screen.getByRole('button', { name: /Re-run Designer/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Interactive blocks for this post' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')).toEqual({ method: 'POST', path: `/api/drafts/${B}/interactive`, body: { on: true } })
  })

  it('a draft waiting for approval: no Re-run button, and Approve expects the Designer calls too', async () => {
    page(detail('awaiting_human', { on: true, default: true, set: false, block_doc: null }))
    expect(await screen.findByTestId('designer-result')).toHaveTextContent('It runs when the post is approved.')
    expect(screen.queryByRole('button', { name: /Re-run Designer/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Approve/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent(COSTS.approve_interactive.normal)
    expect(dialog).toHaveTextContent('interactive blocks are on')
  })

  it('older engines without interactive info show no card', async () => {
    page(detail('approved', undefined))
    await screen.findByRole('heading', { name: 'Bind every AI approval to one tool call', level: 1 })
    expect(screen.queryByText('Interactive blocks')).toBeNull()
  })
})

describe('Posts page: blocks and Re-run Designer', () => {
  it('shows the block count and asks before a Designer run with 1–2 AI calls', async () => {
    const post = { record_id: 'pp1', slug: 'bind-every-ai-approval-to-one-tool-call', title: 'Bind every AI approval', status: 'published', noindex: false, url: 'https://m91-blog.embarko.app/posts/x/', brief_id: B, version: 3, topic_group: 1, published_at: null, updated_at: null, deployed_at: null, last_error: null, blocks: 0 }
    const calls = mockFetch({ 'GET /api/settings': { body: { ...S, blog: { auto_publish: false, app_name: 'm91-blog', base_url: 'https://m91-blog.embarko.app', noindex_first_n_posts: 10, deploy_token_set: true } } }, 'GET /api/posts': { body: { posts: [post] } }, 'POST /api/runs': { status: 202, body: { run_id: 'R-261020-1000-ABCD' } } })
    renderApp(<Routes><Route path="/posts" element={<Posts />} /><Route path="/runs/:runId" element={<p>live page</p>} /></Routes>, { route: '/posts' })
    const row = await screen.findByTestId(`post-${post.slug}`)
    expect(within(row).getByTestId('post-blocks')).toHaveTextContent('plain Markdown')
    await userEvent.click(within(row).getByRole('button', { name: 'Re-run Designer' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent('1–2')
    expect(within(dialog).getByTestId('publish-dry')).toHaveTextContent('nothing is saved')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    await screen.findByText('live page')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ mode: 'designer', dry_run: true, params: { brief_id: B } })
  })
})

describe('block_doc record view', () => {
  it('shows the summary, integrity, kept and dropped segments, and the blocks in order', async () => {
    const record = {
      id: 'mem-bd1', type: 'block_doc', briefId: B, status: 'ok', version: 3, date: '2026-10-20',
      payload: {
        summary: '1 block: steps_checklist · 1 dropped · integrity passed', model_used: 'gpt-5.6-luna', repairs_used: 0, ms: 4200, version: 3, brief_version: 1,
        integrity: { passed: true, details: ['coverage: 4 parts in order'] },
        kept_segments: [{ index: 1, block_type: 'steps_checklist', part_ids: ['N3'], why: 'numbered setup steps' }],
        dropped_segments: [{ index: 2, block_type: 'faq_accordion', part_ids: ['N4'], reason: 'N4 is not a question heading' }],
        blocks: [{ id: 'b1', type: 'rich_text' }, { id: 'b2', type: 'steps_checklist' }],
        layout: [{ block_id: 'b1', part_ids: ['N1', 'N2'] }, { block_id: 'b2', part_ids: ['N3'] }],
        parts: [{ id: 'N3', type: 'list', preview: '1. Create a channel' }]
      }
    }
    mockFetch({ 'GET /api/records/mem-bd1': { body: { record } } })
    renderApp(<Routes><Route path="/records/:memoryId" element={<RecordDetail />} /></Routes>, { route: '/records/mem-bd1' })
    expect(await screen.findByTestId('block-doc-summary')).toHaveTextContent('1 block: steps_checklist')
    expect(screen.getByText('numbered setup steps')).toBeInTheDocument()
    expect(screen.getByText('N4 is not a question heading')).toBeInTheDocument()
    expect(screen.getByText('coverage: 4 parts in order')).toBeInTheDocument()
    expect(screen.getByText(/gpt-5\.6-luna · 0 repairs · 4\.2 s/)).toBeInTheDocument()
    expect(screen.getAllByText('steps_checklist').length).toBeGreaterThanOrEqual(2)
  })
})

describe('Designer step output and settings', () => {
  it('the live run shows the Designer status, block count, dropped segments and integrity', () => {
    render(<MemoryRouter><StepOutputs outputs={[{ seq: 5, ts: '2026-10-20T10:00:00+05:30', step: 'designer', message: '2 blocks: steps_checklist, phone_ring_sim · 1 dropped · integrity passed', data: { record_id: 'mem-bd1', status: 'ok', blocks: 2, dropped: 1, integrity: true, repairs_used: 0 } }]} /></MemoryRouter>)
    const pills = screen.getByTestId('designer-pills')
    expect(pills).toHaveTextContent('ok')
    expect(pills).toHaveTextContent('2 blocks')
    expect(pills).toHaveTextContent('1 dropped')
    expect(pills).toHaveTextContent('integrity passed')
  })

  it('Settings shows INTERACTIVE_DEFAULT and the Designer model', async () => {
    mockFetch({ 'GET /api/settings': { body: S } })
    renderApp(<Settings />)
    expect(await screen.findByTestId('setting-interactive-default')).toHaveTextContent('on (INTERACTIVE_DEFAULT)')
    expect(screen.getByTestId('setting-designer-model')).toHaveTextContent('openai · gpt-5.6-luna · sync')
  })
})
