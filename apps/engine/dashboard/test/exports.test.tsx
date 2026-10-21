// Phase 11: the Markdown export on an approval and on the Exports page, and the two switches
// (EXPERIENCE_ENABLED, PUBLISH_TARGET) hiding what does not apply.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import ApprovalDetail, { type ApprovalDetailData } from '../src/pages/ApprovalDetail'
import Exports from '../src/pages/Exports'
import { bodyOf } from '../src/components/MarkdownExportView'
import { flagsOf } from '../src/config/flags'
import { COSTS } from '../src/config/costs'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const B = '261021-0937-JHTR'
const FILE = '---\ntitle: "Certificate compromise alert"\nslug: "cert-alert"\nversion: 3\nreview_score: 84.5\n---\n\n# Certificate compromise alert\n\nWhen should a human be called?\n\n## TL;DR\n\n- Call a human.\n'
const FM = { title: 'Certificate compromise alert', slug: 'cert-alert', version: 3, review_score: 84.5, tags: ['a', 'b'] }
const OFF = { ...SETTINGS, built_modes: [...SETTINGS.built_modes, 'export', 'designer', 'publish'], publish: { target: 'none', docstar_configured: false, auto_publish: false }, designer: { enabled: false, max_repairs: 1, interactive_default: true, promo_enabled: false } }
const ON = { ...OFF, publish: { target: 'embarko', docstar_configured: false, auto_publish: false }, designer: { ...OFF.designer, enabled: true }, blog: { auto_publish: false, app_name: 'm91-blog', base_url: 'https://m91-blog.embarko.app', noindex_first_n_posts: 10, deploy_token_set: true } }

function detail(): ApprovalDetailData {
  return {
    brief_id: B,
    draft: { record_id: 'mem-v3', version: 3, brief_version: 1, status: 'awaiting_human', waiting_since: null, title: 'Certificate compromise alert', post_markdown: '# Certificate compromise alert\n\nBody.', reviewed: true, hard_passed: true },
    review: null, checks: [], earlier: [],
    interactive: { on: true, default: true, set: false, guide_doc: { status: 'ok', record_id: 'g1', summary: '3 chapters', chapters: 3, components: [], dropped: 0, coverage: true } } as unknown as ApprovalDetailData['interactive'],
    preview: null
  }
}
const page = () => renderApp(<Routes><Route path="/approvals/:briefId" element={<ApprovalDetail />} /></Routes>, { route: `/approvals/${B}` })

describe('flags and costs', () => {
  it('older engines behave as Phase 10; the fallback turns the designer and the blog off', () => {
    expect(flagsOf(undefined)).toEqual({ experienceOn: true, target: 'embarko', blogOn: true, docstarConfigured: false })
    expect(flagsOf(OFF as never)).toEqual({ experienceOn: false, target: 'none', blogOn: false, docstarConfigured: false })
    expect(COSTS.export.normal).toBe('0')
    expect(COSTS.full_plain.normal).not.toBe(COSTS.full.normal)
    expect(bodyOf(FILE).startsWith('# Certificate')).toBe(true)
  })
})

describe('approval page (Phase 11)', () => {
  it('with the fallback: the Markdown export card, no page preview, no Publish, no guide card, no "Change the design"', async () => {
    const calls = mockFetch({
      'GET /api/settings': { body: OFF },
      [`GET /api/approvals/${B}`]: { body: detail() },
      [`GET /api/exports/${B}`]: { status: 404, body: { error: { code: 'not_found', message: 'none' } } },
      [`GET /api/approvals/${B}/markdown?version=3`]: { body: { version: 3, filename: 'cert-alert.md', markdown: FILE, front_matter: FM, warnings: [] } }
    })
    page()
    expect(await screen.findByText('Markdown export')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Change the design')).not.toBeInTheDocument())
    expect(screen.queryByText(/Preview the page/)).not.toBeInTheDocument()
    expect(screen.queryByText('Interactive guide')).not.toBeInTheDocument()
    expect(screen.getByText('The Writer revises the post.')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('show-export'))
    const view = await screen.findByTestId('markdown-export')
    expect(within(view).getByText('cert-alert.md')).toBeInTheDocument()
    expect(within(view).getByTestId('front-matter')).toHaveTextContent('review_score84.5')
    expect(within(view).getByRole('heading', { level: 1, name: 'Certificate compromise alert' })).toBeInTheDocument()
    expect(within(view).getByTestId('download-markdown')).toHaveAttribute('href', `/api/approvals/${B}/markdown?version=3&format=md&download=1`)
    expect(calls.some((c) => c.path === `/api/approvals/${B}/markdown?version=3`)).toBe(true)
  })

  it('Copy Markdown copies the whole file, front matter included', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    mockFetch({
      'GET /api/settings': { body: OFF },
      [`GET /api/approvals/${B}`]: { body: detail() },
      [`GET /api/exports/${B}`]: { status: 404, body: { error: { code: 'not_found', message: 'none' } } },
      [`GET /api/approvals/${B}/markdown?version=3`]: { body: { version: 3, filename: 'cert-alert.md', markdown: FILE, front_matter: FM, warnings: [] } }
    })
    page()
    await userEvent.click(await screen.findByTestId('show-export'))
    await userEvent.click(await screen.findByTestId('copy-markdown'))
    expect(writeText).toHaveBeenCalledWith(FILE)
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('with the designer and the blog on (Phase 10): "Change the design" and the guide card are back', async () => {
    mockFetch({
      'GET /api/settings': { body: ON },
      [`GET /api/approvals/${B}`]: { body: detail() },
      [`GET /api/exports/${B}`]: { status: 404, body: { error: { code: 'not_found', message: 'none' } } }
    })
    page()
    expect(await screen.findByText('Change the design')).toBeInTheDocument()
    expect(screen.getByText('Markdown export')).toBeInTheDocument()
  })
})

describe('Exports page', () => {
  it('lists the final exports and shows the chosen one with Copy and Download', async () => {
    mockFetch({
      'GET /api/settings': { body: OFF },
      'GET /api/exports': { body: { exports: [{ record_id: 'm1', brief_id: B, version: 3, slug: 'cert-alert', filename: 'cert-alert.md', title: 'Certificate compromise alert', exported_at: '2026-10-21T10:00:00+05:30', chars: FILE.length, review_score: 84.5, status: 'final', docstar_page_id: null, docstar_url: null }] } },
      [`GET /api/exports/${B}`]: { body: { export: { brief_id: B, version: 3, filename: 'cert-alert.md', title: 'Certificate compromise alert', markdown: FILE, front_matter: FM, warnings: [] } } }
    })
    renderApp(<Exports />, { route: '/exports' })
    expect(await screen.findByText(/Publishing is off \(PUBLISH_TARGET=none\)/)).toBeInTheDocument()
    const list = await screen.findByTestId('export-list')
    expect(within(list).getByText(/v3 · score 84\.5/)).toBeInTheDocument()
    const view = await screen.findByTestId('markdown-export')
    expect(within(view).getByTestId('download-markdown')).toHaveAttribute('href', `/api/exports/${B}/download`)
  })

  it('no exports yet: says how to get one', async () => {
    mockFetch({ 'GET /api/settings': { body: OFF }, 'GET /api/exports': { body: { exports: [] } } })
    renderApp(<Exports />, { route: '/exports' })
    expect(await screen.findByText(/No exports yet/)).toBeInTheDocument()
  })
})
