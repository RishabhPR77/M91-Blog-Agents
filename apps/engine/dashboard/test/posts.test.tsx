// Phase 7 Part D: the Posts page, Publish / Rebuild blog on Control, the Publish card on an approval,
// the blog settings and the Publisher sub-steps on the live run page.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import Posts from '../src/pages/Posts'
import Control from '../src/pages/Control'
import Settings from '../src/pages/Settings'
import { PublishCard } from '../src/components/PublishCard'
import { PublisherSteps } from '../src/components/PublisherSteps'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const PUBLISH_MODES = ['publish', 'unpublish', 'set_index', 'rebuild_blog']
const BLOG = { auto_publish: false, app_name: 'm91-blog', base_url: 'https://m91-blog.embarko.app', noindex_first_n_posts: 10, deploy_token_set: true }
const settings = (blog: Partial<typeof BLOG> = {}, runtime: Partial<typeof SETTINGS.runtime> = {}) => ({
  ...SETTINGS,
  runtime: { ...SETTINGS.runtime, ...runtime },
  built_modes: [...SETTINGS.built_modes, ...PUBLISH_MODES],
  publish_modes: PUBLISH_MODES,
  blog: { ...BLOG, ...blog }
})
const POST = { record_id: 'pp1', slug: 'gate-agent-actions', title: 'How to Gate Agent Actions', status: 'published', noindex: true, url: 'https://m91-blog.embarko.app/posts/gate-agent-actions/', brief_id: '261019-1055-BZ89', version: 3, topic_group: 1, published_at: '2026-10-19T12:00:00+05:30', updated_at: null, deployed_at: '2026-10-19T12:01:00+05:30', last_error: null }

describe('Posts page', () => {
  function setup(s = settings(), posts = [POST, { ...POST, record_id: 'pp2', slug: 'old-post', title: 'Old post', status: 'unpublished', noindex: false, url: null, last_error: 'taken down' }]) {
    const calls = mockFetch({
      'GET /api/settings': { body: s },
      'GET /api/posts': { body: { posts } },
      'POST /api/runs': { status: 202, body: { run_id: 'R-261019-1300-ABCD' } }
    })
    renderApp(<Routes><Route path="/posts" element={<Posts />} /><Route path="/runs/:runId" element={<p>live page</p>} /></Routes>, { route: '/posts' })
    return calls
  }

  it('lists posts with status, search visibility, live link and the right actions', async () => {
    setup()
    const live = await screen.findByTestId('post-gate-agent-actions')
    expect(live).toHaveTextContent('published')
    expect(live).toHaveTextContent('hidden (noindex)')
    expect(within(live).getByRole('link', { name: /Open live/ })).toHaveAttribute('href', POST.url)
    expect(within(live).getByRole('button', { name: 'Republish' })).toBeEnabled()
    expect(within(live).getByRole('button', { name: 'Show in search' })).toBeEnabled()
    expect(within(live).getByRole('button', { name: 'Unpublish' })).toBeEnabled()
    const old = screen.getByTestId('post-old-post')
    expect(old).toHaveTextContent('Last error: taken down')
    expect(within(old).queryByRole('button', { name: 'Unpublish' })).toBeNull()
    expect(within(old).getByRole('button', { name: 'Publish again' })).toBeInTheDocument()
  })

  it('Show in search asks first (0 AI calls), then starts set_index with the dry-run choice', async () => {
    const calls = setup()
    const live = await screen.findByTestId('post-gate-agent-actions')
    await userEvent.click(within(live).getByRole('button', { name: 'Show in search' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent('Expected AI calls: 0')
    expect(within(dialog).getByTestId('publish-dry')).toHaveTextContent('Dry run')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    await screen.findByText('live page')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ mode: 'set_index', dry_run: true, params: { slug: 'gate-agent-actions', noindex: false } })
  })

  it('Unpublish is a danger action and sends the slug', async () => {
    const calls = setup()
    const live = await screen.findByTestId('post-gate-agent-actions')
    await userEvent.click(within(live).getByRole('button', { name: 'Unpublish' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unpublish' }))
    await screen.findByText('live page')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ mode: 'unpublish', dry_run: true, params: { slug: 'gate-agent-actions' } })
  })

  it('without a deploy token, only dry runs can start', async () => {
    setup(settings({ deploy_token_set: false }, { dry_run: false }))
    const live = await screen.findByTestId('post-gate-agent-actions')
    expect(await screen.findByTestId('token-missing')).toBeInTheDocument()
    expect(within(live).getByRole('button', { name: 'Republish' })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /Dry run/ }))
    expect(within(live).getByRole('button', { name: 'Republish' })).toBeEnabled()
  })

  it('shows a 409 from the engine as an alert', async () => {
    mockFetch({
      'GET /api/settings': { body: settings() },
      'GET /api/posts': { body: { posts: [POST] } },
      'POST /api/runs': { status: 409, body: { error: { code: 'run_in_progress', message: 'a run is in progress (R-261019-1259-WXYZ)' } } }
    })
    renderApp(<Posts />, { route: '/posts' })
    await userEvent.click(within(await screen.findByTestId('post-gate-agent-actions')).getByRole('button', { name: 'Republish' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('a run is in progress')
  })
})

describe('Control: Publish and Rebuild blog', () => {
  const approved = { records: [{ id: 'd3', type: 'draft', status: 'approved', brief_id: '261019-1055-BZ89', version: 3, key_id: null, title: 'How to Gate' }] }
  function setup(s: unknown) {
    const calls = mockFetch({
      'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } },
      'GET /api/settings': { body: s },
      'GET /api/runs?limit=5': { body: { runs: [] } },
      'GET /api/approvals': { body: { approvals: [] } },
      'GET /api/records?type=brief&limit=30': { body: { records: [] } },
      'GET /api/records?type=draft&limit=60': { body: approved },
      'GET /api/records?type=draft&status=approved&limit=30': { body: approved },
      'POST /api/runs': { status: 202, body: { run_id: 'R-261019-1300-ABCD' } }
    })
    renderApp(<Routes><Route path="/" element={<Control />} /><Route path="/runs/:runId" element={<p>live page</p>} /></Routes>)
    return calls
  }

  it('Publish needs an approved draft; it starts without the low-cost params and shows 0 AI calls', async () => {
    const calls = setup(settings())
    const card = screen.getByTestId('run-card-Publish')
    await waitFor(() => expect(within(card).getByRole('button')).toHaveAttribute('title', 'Pick an approved draft'))
    expect(within(card).getByTestId('cost')).toHaveTextContent('Expected AI calls: 0 normal · 0 low-cost')
    await userEvent.selectOptions(await within(card).findByRole('combobox', { name: 'Approved draft to publish' }), '261019-1055-BZ89')
    await userEvent.click(within(card).getByRole('button'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('run-summary')).toHaveTextContent('not used (no AI)')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start the run' }))
    await screen.findByText('live page')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ mode: 'publish', dry_run: true, params: { brief_id: '261019-1055-BZ89' } })
  })

  it('Rebuild blog is blocked for a live run without the token, allowed as a dry run', async () => {
    setup(settings({ deploy_token_set: false }, { dry_run: false }))
    const card = screen.getByTestId('run-card-Rebuild blog')
    await waitFor(() => expect(within(card).getByRole('button')).toHaveAttribute('title', 'Deploy token not set (dry run only)'))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Dry run' }))
    await waitFor(() => expect(within(card).getByRole('button')).toBeEnabled())
  })
})

describe('Publish card on an approval', () => {
  const show = (s: unknown, status: string) => {
    mockFetch({ 'GET /api/settings': { body: s }, 'POST /api/runs': { status: 202, body: { run_id: 'R-261019-1300-ABCD' } } })
    renderApp(<PublishCard briefId="261019-1055-BZ89" status={status} version={3} title="How to Gate" />)
  }

  it('AUTO_PUBLISH=false: an approved draft gets a Publish button (0 AI calls)', async () => {
    show(settings(), 'approved')
    expect(await screen.findByRole('button', { name: 'Publish · expected AI calls 0' })).toBeEnabled()
  })

  it('AUTO_PUBLISH=true: a waiting draft says approving will publish it', async () => {
    show(settings({ auto_publish: true }), 'awaiting_human')
    expect(await screen.findByTestId('auto-publish-note')).toHaveTextContent('will publish it automatically')
  })

  it('no token and a live default: the button is disabled with a note', async () => {
    show(settings({ deploy_token_set: false }, { dry_run: false }), 'approved')
    expect(await screen.findByTestId('publish-token-missing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Publish/ })).toBeDisabled()
  })
})

describe('Settings: blog', () => {
  it('shows deploy token set yes/no, never a token', async () => {
    mockFetch({ 'GET /api/settings': { body: settings({ auto_publish: true }) } })
    renderApp(<Settings />)
    expect(await screen.findByTestId('setting-deploy-token')).toHaveTextContent('yes')
    expect(screen.getByTestId('setting-auto-publish')).toHaveTextContent('on')
    expect(screen.getByText('https://m91-blog.embarko.app')).toBeInTheDocument()
  })
})

describe('Publisher sub-steps', () => {
  const out = (n: number, name: string, text: string, data?: Record<string, unknown>) => ({ seq: n, ts: '2026-10-19T07:00:00Z', step: 'publisher', message: `${n}/6 ${name}: ${text}`, data })
  it('marks done steps, the running one, and links the live post', () => {
    const outputs = [out(1, 'build post', 'gate · v3'), out(2, 'export', '1 post file(s)')]
    const { rerender } = render(<PublisherSteps outputs={outputs} stepStatus="running" />)
    expect(screen.getByTestId('publisher-substep-2')).toHaveTextContent('2. export: 1 post file(s)')
    expect(screen.getByTestId('publisher-substep-3')).toHaveTextContent('3. build blog')
    rerender(<PublisherSteps outputs={outputs} stepStatus="failed" />)
    expect(screen.getByTestId('publisher-substep-3')).toHaveTextContent('failed (see the event log)')
    const all = [...outputs, out(3, 'build blog', 'ok'), out(4, 'deploy', 'live'), out(5, 'verify', 'live'), out(6, 'mark published', 'done', { url: POST.url })]
    rerender(<PublisherSteps outputs={all} stepStatus="succeeded" />)
    expect(screen.getByRole('link', { name: 'Open the live post' })).toHaveAttribute('href', POST.url)
  })
})
