import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import Content from '../src/pages/Content'
import RecordDetail from '../src/pages/RecordDetail'
import Pinned, { pinError } from '../src/pages/Pinned'
import Lessons from '../src/pages/Lessons'
import Settings from '../src/pages/Settings'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const rec = (id: string, type: string, extra = {}) => ({ id, type, status: 'open', brief_id: null, date: '2026-10-19', topic_group: '1', version: null, key_id: null, title: null, ...extra })

describe('Content', () => {
  it('tabs per type, filters sent to the API, rows open the record', async () => {
    const calls = mockFetch({
      'GET /api/records?type=brief&limit=50': { body: { records: [rec('m1', 'brief', { status: 'approved', brief_id: '261019-1055-BZ89', key_id: '261019-1055-BZ89', version: 1, title: 'How to Gate Destructive AI Agent Actions' })] } },
      'GET /api/records?type=brief&status=drafted&limit=50': { body: { records: [] } },
      'GET /api/records?type=question_cluster&limit=50': { body: { records: [rec('m2', 'question_cluster', { status: 'used', key_id: 'C-261019-1101-L7PD', title: 'How can HumanInTheLoop middleware reliably require approval?' })] } }
    })
    renderApp(<Routes><Route path="/content" element={<Content />} /><Route path="/records/:memoryId" element={<p>record page</p>} /></Routes>, { route: '/content' })
    expect(await screen.findByText('How to Gate Destructive AI Agent Actions')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'drafted')
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Question clusters' }))
    await userEvent.click(await screen.findByText(/HumanInTheLoop middleware/))
    expect(await screen.findByText('record page')).toBeInTheDocument()
    expect(calls.map((c) => c.path)).toEqual(['/api/records?type=brief&limit=50', '/api/records?type=brief&status=drafted&limit=50', '/api/records?type=question_cluster&limit=50'])
  })
})

describe('Record detail', () => {
  const page = (id: string, record: unknown) => {
    mockFetch({ [`GET /api/records/${id}`]: record ? { body: { record } } : { status: 404, body: { error: { code: 'not_found', message: `no record ${id}` } } }, 'GET /api/settings': { body: SETTINGS } })
    return renderApp(<Routes><Route path="/records/:memoryId" element={<RecordDetail />} /></Routes>, { route: `/records/${id}` })
  }

  it('brief: titles, outline, M91 facts with safe links, claims to avoid, sources, interactive ideas', async () => {
    page('m1', { id: 'm1', type: 'brief', briefId: 'B', status: 'approved', version: 1, date: '2026-10-19', payload: {
      titles: ['How to Gate Destructive AI Agent Actions', 'Alt title'], angle: 'Treat approval as an envelope.', keyword: 'human approval', supporting_keywords: ['when predicate'],
      outline: [{ heading: 'What went wrong?', answer_first: 'Agents ran destructive commands.', points: ['Summarize'] }],
      m91_facts_to_use: [{ fact: 'Ring every phone in a channel', source_url: 'https://m91.msg91.com/llms.txt' }], claims_to_avoid: ['Do not promise silent-mode bypass'],
      story: { use: true, attribution_line: 'written by chen yuan on Medium', source_url: 'https://medium.com/x', how_to_use: 'Use briefly' },
      sources: [{ url: 'https://medium.com/x', what_it_supports: 'The incidents' }], interactive_ideas: [{ block_type: 'diagram', why: 'Show the flow' }], internal_links: []
    } })
    expect(await screen.findByRole('heading', { name: 'How to Gate Destructive AI Agent Actions' })).toBeInTheDocument()
    expect(screen.getByText('What went wrong?')).toBeInTheDocument()
    expect(screen.getByText('Do not promise silent-mode bypass')).toBeInTheDocument()
    const source = screen.getAllByRole('link', { name: 'source' })[0]
    expect(source).toHaveAttribute('href', 'https://m91.msg91.com/llms.txt')
    expect(source).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('diagram')).toBeInTheDocument()
  })

  it('promo pack: each text with its character count and a copy button; raw JSON view with copy', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    page('m3', { id: 'm3', type: 'promo_pack', briefId: 'B', status: 'ok', version: 3, date: '2026-10-19', payload: { linkedin_post: 'Pause on ambiguity.', x_thread: ['One', 'Two'], newsletter_blurb: 'Gate destructive actions.', video_script: [{ on_screen_text: 'Pause', voiceover: 'If an agent might act…' }], checks: { passed: true, problems: [] } } })
    const li = await screen.findByTestId('promo-LinkedIn')
    expect(within(li).getByTestId('char-count')).toHaveTextContent('19 chars')
    expect(within(screen.getByTestId('promo-X post 1')).getByTestId('char-count')).toHaveTextContent('3 chars / 280')
    await userEvent.click(within(li).getByRole('button', { name: /Copy/ }))
    expect(writeText).toHaveBeenCalledWith('Pause on ambiguity.')
    await userEvent.click(screen.getByRole('tab', { name: 'Raw JSON' }))
    expect(screen.getByTestId('json-view')).toHaveTextContent('"linkedin_post": "Pause on ambiguity."')
  })

  it('review uses the verdict panel; other types use the field view; 404 is clear', async () => {
    const r = page('m4', { id: 'm4', type: 'review', briefId: 'B', status: 'fail', version: 2, date: '2026-10-19', payload: { total: 78, pass: false, gates: [{ id: 'checks_hard_passed', passed: true, source: 'code' }], areas: [{ id: 'simplicity', score: 6, evidence: 'dense' }], feedback: [], lessons: ['Put the answer first'] } })
    expect(await screen.findByTestId('score-total')).toHaveTextContent('78')
    expect(screen.getByText('Put the answer first')).toBeInTheDocument()
    r.unmount()
    const c = page('m5', { id: 'm5', type: 'question_cluster', briefId: null, status: 'used', version: null, date: '2026-10-19', payload: { main_question: 'How can middleware require approval?', demand: { level: 'high', reason: 'many issues' }, source_urls: [{ url: 'https://github.com/x', url_status: 'ok' }] } })
    expect(await screen.findByText('Main question')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://github.com/x' })).toHaveAttribute('target', '_blank')
    c.unmount()
    page('nope', null)
    expect(await screen.findByText('There is no record nope.')).toBeInTheDocument()
  })
})

describe('Pinned topics', () => {
  it('validates like the engine; add asks first (0 calls) and posts; cancel asks and deletes', async () => {
    expect(pinError('', '2026-11-01')).toBe('Topic is required.')
    expect(pinError('x'.repeat(301), '2026-11-01')).toMatch(/at most 300/)
    expect(pinError('Topic', '01/11/2026')).toBe('Date must be YYYY-MM-DD.')
    expect(pinError('Topic', '2026-11-01')).toBeNull()
    const calls = mockFetch({
      'GET /api/pinned': { body: { pinned: [{ pinned_id: 'PIN-1', topic: 'Holiday on-call', target_date: '2026-12-20', priority: 'high', notes: '', status: 'open', used_by: null }] } },
      'POST /api/pinned': { status: 201, body: { pinned: { pinned_id: 'PIN-2', topic: 'Diwali release freeze', target_date: '2026-11-01', priority: 'normal', notes: '', status: 'open', used_by: null }, saved: true } },
      'DELETE /api/pinned/PIN-1': { body: { pinned: { pinned_id: 'PIN-1', status: 'cancelled' } } }
    })
    renderApp(<Pinned />)
    expect(await screen.findByText('Holiday on-call')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pin topic' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Topic is required.')
    await userEvent.type(screen.getByLabelText('Topic'), 'Diwali release freeze')
    await userEvent.type(screen.getByLabelText('By date'), '2026-11-01')
    await userEvent.click(screen.getByRole('button', { name: 'Pin topic' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent('0')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pin' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ topic: 'Diwali release freeze', date: '2026-11-01', priority: 'normal' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel the pin' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/pinned/PIN-1')).toBe(true))
  })
})

describe('Lessons', () => {
  it('newest first; delete asks first and calls DELETE /api/lessons/:id', async () => {
    const calls = mockFetch({
      'GET /api/records?type=lesson&limit=200': { body: { records: [rec('L1', 'lesson', { date: '2026-10-17', title: 'Older lesson' }), rec('L2', 'lesson', { date: '2026-10-19', title: 'Newer lesson', brief_id: 'B' })] } },
      'DELETE /api/lessons/L2': { body: { deleted: 'L2' } }
    })
    renderApp(<Lessons />)
    const list = await screen.findByRole('list', { name: 'Lessons' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent?.split('2026')[0])).toEqual(['Newer lesson', 'Older lesson'])
    await userEvent.click(within(list).getAllByRole('button', { name: 'Delete lesson' })[0])
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('“Newer lesson”')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/lessons/L2')).toBe(true))
  })
})

describe('Settings', () => {
  it('groups the engine settings, read-only, with the .env note', async () => {
    mockFetch({ 'GET /api/settings': { body: SETTINGS } })
    renderApp(<Settings />)
    expect(await screen.findByText(/Change these in/)).toHaveTextContent('Change these in .env and restart the engine.')
    expect(screen.getByTestId('setting-dry-run')).toHaveTextContent('on')
    expect(screen.getByTestId('setting-max-revisions')).toHaveTextContent('5 per brief')
    expect(screen.getByRole('table', { name: 'Models' })).toHaveTextContent('gemini-2.5-flash')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('an engine from before Phase 6: approval settings and modes "not reported"', async () => {
    const { approval: _a, built_modes: _b, ...old } = SETTINGS
    mockFetch({ 'GET /api/settings': { body: old } })
    renderApp(<Settings />)
    expect(await screen.findByText('Not reported by this engine (restart it).')).toBeInTheDocument()
    expect(screen.getByText('not reported (restart the engine)')).toBeInTheDocument()
  })
})
