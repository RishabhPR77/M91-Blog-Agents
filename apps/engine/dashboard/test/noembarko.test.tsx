// Embarko is no longer used (2026-10-22): with PUBLISH_TARGET=none no Embarko or blog item shows anywhere in the
// dashboard (navigation, Settings, Posts, Control, the approval screen), and the blog's data is never fetched.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import Settings from '../src/pages/Settings'
import Posts from '../src/pages/Posts'
import Control from '../src/pages/Control'
import { Layout } from '../src/components/Layout'
import { flagsOf } from '../src/config/flags'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const BLOG = { auto_publish: false, app_name: 'm91-blog', base_url: 'https://m91-blog.embarko.app', noindex_first_n_posts: 10, deploy_token_set: true }
// What the engine sends with PUBLISH_TARGET=none: it still reports its blog settings and modes.
const NONE = { ...SETTINGS, built_modes: [...SETTINGS.built_modes, 'export', 'publish', 'unpublish', 'set_index', 'rebuild_blog'], publish: { target: 'none', docstar_configured: false, auto_publish: false }, blog: BLOG, designer: { enabled: false, max_repairs: 1, interactive_default: true, promo_enabled: false } }
const noEmbarko = () => expect(document.body.textContent ?? '').not.toMatch(/embarko|rebuild blog|deploy token|blog app/i)

describe('PUBLISH_TARGET=none: no Embarko item anywhere', () => {
  it('flags: nothing blog-related while the settings load or with target none; older engines (no publish field) keep the blog', () => {
    expect(flagsOf(undefined).blogOn).toBe(false)
    expect(flagsOf(NONE as never).blogOn).toBe(false)
    const { publish: _p, ...old } = NONE
    expect(flagsOf(old as never).blogOn).toBe(true)
  })

  it('Settings: no "Blog and publishing" card, no Embarko app or blog URL, no blog run modes', async () => {
    mockFetch({ 'GET /api/settings': { body: NONE } })
    renderApp(<Settings />)
    expect(await screen.findByTestId('setting-publish-target')).toHaveTextContent('none: the Markdown export is the output')
    expect(screen.queryByText('Blog and publishing')).toBeNull()
    expect(screen.getByTestId('setting-built-modes').textContent).not.toMatch(/publish|rebuild_blog|set_index/)
    noEmbarko()
  })

  it('Posts (typed in the address bar): a note pointing to Exports, and /api/posts is never fetched', async () => {
    const calls = mockFetch({ 'GET /api/settings': { body: NONE } })
    renderApp(<Routes><Route path="/posts" element={<Posts />} /></Routes>, { route: '/posts' })
    expect(await screen.findByText(/There is no blog to manage/)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/posts')).toBe(false)
    noEmbarko()
  })

  it('Control: no Publish and no Rebuild blog cards', async () => {
    mockFetch({
      'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } },
      'GET /api/settings': { body: NONE },
      'GET /api/runs?limit=5': { body: { runs: [] } },
      'GET /api/approvals': { body: { approvals: [] } },
      'GET /api/records?type=brief&limit=30': { body: { records: [] } },
      'GET /api/records?type=draft&limit=60': { body: { records: [] } },
      'GET /api/records?type=draft&status=approved&limit=30': { body: { records: [] } }
    } as Parameters<typeof mockFetch>[0])
    renderApp(<Routes><Route path="/" element={<Control />} /></Routes>)
    await screen.findByTestId('run-card-Run full pipeline')
    await waitFor(() => expect(screen.queryByTestId('run-card-Publish')).toBeNull())
    expect(screen.queryByTestId('run-card-Rebuild blog')).toBeNull()
    noEmbarko()
  })

  it('navigation: no Posts link', async () => {
    mockFetch({ 'GET /api/settings': { body: NONE }, 'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } }, 'GET /api/approvals': { body: { approvals: [] } } } as Parameters<typeof mockFetch>[0])
    renderApp(<Layout><p>home</p></Layout>)
    expect(await screen.findByText('home')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('link', { name: /Exports/ })).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /^Posts$/ })).toBeNull()
  })
})
