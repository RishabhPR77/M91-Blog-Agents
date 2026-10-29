import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { MarkdownPreview } from '../src/components/MarkdownPreview'
import { diffStats, wordDiff } from '../src/components/VersionDiff'
import { sortChecks } from '../src/components/ChecksTable'
import ApprovalDetail, { approvalFlags, type ApprovalDetailData } from '../src/pages/ApprovalDetail'
import Approvals from '../src/pages/Approvals'
import { findExactQuote, NO_MATCH_MESSAGE } from '../src/quote'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

const B = '261019-1055-BZ89'
const MD = [
  '# How to Gate Destructive AI Agent Actions',
  '',
  'Tie each risky tool call to a small approval envelope, wake a human with **M91**, and get the decision as an HTTP callback.',
  '',
  '## What went wrong?',
  '',
  'Agents ran destructive commands because gates were weak. Read the [M91 quickstart](https://m91.msg91.com/api/public/quickstart.md) first.'
].join('\n')

function detail(over: Partial<ApprovalDetailData['draft']> = {}, extra: Partial<ApprovalDetailData> = {}): ApprovalDetailData {
  return {
    brief_id: B,
    draft: { record_id: 'mem-v3', version: 3, brief_version: 1, status: 'awaiting_human', waiting_since: '2026-10-19T11:25:44+05:30', title: 'How to Gate Destructive AI Agent Actions', tldr: ['Pause on any unresolved approval.'], seo: { title_tag: 'Gate Destructive AI Actions', meta_description: 'Pause risky agent actions.', slug_suggestion: 'gate-destructive-ai-actions' }, post_markdown: MD, word_count: 1139, reading: { intro_grade: 12.5, post_grade: 8.6 }, revision_notes: [{ feedback_quote: 'Make the first paragraph shorter', what_changed: 'Reduced the opening to two sentences.' }], reviewed: false, hard_passed: true, ...over },
    review: null,
    checks: [{ id: 'reading_post', passed: false, severity: 'soft', value: 8.6, detail: 'target grade 8' }, { id: 'h1', passed: true, severity: 'hard', value: 1, detail: 'ok' }],
    earlier: [
      { version: 2, brief_version: 1, status: 'changes_requested', title: 'How to Gate Destructive AI Agent Actions', score: 78, total: 78, human_feedback: { text: 'Make the first paragraph shorter.', quotes: [], at: 't' }, record_id: 'mem-v2' },
      { version: 1, brief_version: 1, status: 'superseded', title: 'How can HumanInTheLoop middleware reliably require human approval?', score: 77, total: 77, human_feedback: null, record_id: 'mem-v1' }
    ],
    ...extra
  }
}

const REVIEW = {
  total: 86, pass: true, summary: 'Publish after a small revision.',
  gates: [{ id: 'checks_hard_passed', passed: true, source: 'code', evidence: 'ok' }, { id: 'no_invented_content', passed: true, source: 'ai', evidence: 'nothing invented' }],
  areas: [{ id: 'simplicity', score: 6, evidence: 'intro is dense' }, { id: 'accuracy', score: 9, evidence: 'matches the facts' }],
  feedback: [{ area: 'simplicity', quote: 'Tie each risky tool call', problem: 'Dense.', fix: 'Shorter.', severity: 'must', send_to: 'writer', quote_found: true }],
  sources_checked: [{ url: 'https://m91.msg91.com/api/public/quickstart.md', claim: 'M91 rings phones', verdict: 'supports' }]
}

const DOCSTAR = { ...SETTINGS, publish: { target: 'docstar', docstar_configured: true, auto_publish: false } }
function routes(d: ApprovalDetailData, extra: Record<string, unknown> = {}, settings: unknown = DOCSTAR) {
  return {
    'GET /api/settings': { body: settings },
    [`GET /api/approvals/${B}`]: { body: d },
    'GET /api/records/mem-v2': { body: { record: { payload: { post_markdown: MD.replace('a small approval envelope', 'an approval envelope that binds the action') } } } },
    ...extra
  } as Parameters<typeof mockFetch>[0]
}
const page = () => renderApp(<Routes><Route path="/approvals/:briefId" element={<ApprovalDetail />} /><Route path="/runs/:runId" element={<p>live page</p>} /></Routes>, { route: `/approvals/${B}` })
const posts = (calls: ReturnType<typeof mockFetch>) => calls.filter((c) => c.method === 'POST')

describe('MarkdownPreview', () => {
  it('never renders raw HTML; links open in a new tab with rel="noopener noreferrer"; javascript: links are dropped', () => {
    const md = 'Hi <script>alert(1)</script><b onclick="x()">bold</b> <img src=x onerror="alert(2)">\n\n[docs](https://example.com) [bad](javascript:alert(3))'
    const { container } = render(<MarkdownPreview markdown={md} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('onerror')
    expect(container.innerHTML).not.toContain('onclick')
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    const bad = screen.getByText('bad').closest('a')
    expect(bad?.getAttribute('href') ?? '').not.toMatch(/javascript:/i)
  })
})

describe('quote capture (selection → exact Markdown source)', () => {
  it('accepts an exact selection, and selections across inline markup map to the source text', () => {
    expect(findExactQuote(MD, 'Agents ran destructive commands because gates were weak.')).toBe('Agents ran destructive commands because gates were weak.')
    expect(findExactQuote(MD, 'wake a human with M91, and get')).toBe('wake a human with **M91**, and get')
    expect(findExactQuote(MD, 'Read the M91 quickstart first.')).toBe('Read the [M91 quickstart](https://m91.msg91.com/api/public/quickstart.md) first.')
    expect(findExactQuote(MD, '  Agents   ran\ndestructive ')).toBe('Agents ran destructive')
  })

  it('refuses selections that cannot be matched exactly', () => {
    expect(findExactQuote(MD, 'HTTP callback. What went wrong?')).toBeNull() // "## " sits in between
    // From the end of a heading into the next paragraph the source text is exact (only a blank line between).
    expect(findExactQuote(MD, 'went wrong? Agents ran')).toBe('went wrong?\n\nAgents ran')
    expect(findExactQuote(MD, 'not in the post at all')).toBeNull()
    expect(findExactQuote(MD, 'x'.repeat(501))).toBeNull()
    expect(findExactQuote(MD, '   ')).toBeNull()
  })

  it('in the page: a selected sentence becomes a removable chip; a cross-section selection shows the message', async () => {
    mockFetch(routes(detail()))
    page()
    const preview = await screen.findByTestId('markdown-preview')
    const para = within(preview).getByText(/Agents ran destructive commands/)
    const text = para.firstChild as Text
    const select = (node: Node, start: number, endNode: Node, end: number) => {
      const r = document.createRange()
      r.setStart(node, start)
      r.setEnd(endNode, end)
      const s = window.getSelection()!
      s.removeAllRanges()
      s.addRange(r)
    }
    act(() => select(text, 0, text, 'Agents ran destructive commands'.length))
    await userEvent.click(screen.getByRole('button', { name: /Quote selected text/ }))
    const chips = await screen.findByRole('list', { name: 'Quotes' })
    expect(chips).toHaveTextContent('“Agents ran destructive commands”')
    // From the first paragraph into the heading (the source has "## " in between): refused.
    const heading = within(preview).getByRole('heading', { name: 'What went wrong?' }).firstChild as Text
    const firstParaEnd = within(preview).getByText(/and get the decision as an HTTP callback/).lastChild as Text
    act(() => select(firstParaEnd, 5, heading, 4))
    await userEvent.click(screen.getByRole('button', { name: /Quote selected text/ }))
    expect(await screen.findByText(NO_MATCH_MESSAGE)).toBeInTheDocument()
    await userEvent.click(within(chips).getByRole('button', { name: /Remove quote/ }))
    expect(screen.queryByRole('list', { name: 'Quotes' })).not.toBeInTheDocument()
  })
})

describe('Approve', () => {
  it('not reviewed (REREVIEW_AFTER_HUMAN on): "Review it first" or "Approve without review", which needs the tick and sends force_unreviewed', async () => {
    const calls = mockFetch(routes(detail(), { [`POST /api/approvals/${B}/approve`]: { status: 202, body: { run_id: 'R-261019-1400-AAAA' } } }))
    page()
    expect(await screen.findByTestId('not-reviewed')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /^Approve and publish$/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('This version was not checked by the Reviewer')
    expect(within(dialog).getByRole('button', { name: /Review it first · expected AI calls 1–2/ })).toBeEnabled()
    const force = within(dialog).getByRole('button', { name: /Approve and publish without review/ })
    expect(force).toBeDisabled()
    await userEvent.click(within(dialog).getByLabelText('I understand this version was not checked by the Reviewer'))
    expect(force).toBeEnabled()
    await userEvent.click(force)
    // Approving stays on the post page (its journey shows each step).
    await waitFor(() => expect(posts(calls)).toEqual([{ method: 'POST', path: `/api/approvals/${B}/approve`, body: { force_unreviewed: true, publish: true } }]))
    expect(screen.queryByText('live page')).not.toBeInTheDocument()
  })

  it('"Review it first" starts the review action', async () => {
    const calls = mockFetch(routes(detail(), { [`POST /api/approvals/${B}/review`]: { status: 202, body: { run_id: 'R-261019-1400-BBBB' } } }))
    page()
    await userEvent.click(await screen.findByRole('button', { name: /^Approve and publish$/ }))
    await userEvent.click(screen.getByRole('button', { name: /Review it first/ }))
    expect(await screen.findByText('live page')).toBeInTheDocument()
    expect(posts(calls)[0].path).toBe(`/api/approvals/${B}/review`)
  })

  it('reviewed: "Approve and publish" is one confirm and one run (publish: true); the AI review sits next to the post', async () => {
    const calls = mockFetch(routes(detail({ reviewed: true }, { review: REVIEW }), { [`POST /api/approvals/${B}/approve`]: { status: 202, body: { run_id: 'R-261019-1400-CCCC' } } }))
    page()
    expect(await screen.findByTestId('score-total')).toHaveTextContent('86')
    expect(screen.getByTestId('review-summary')).toHaveTextContent('Publish after a small revision.')
    expect(screen.getByTestId('checks-line')).toHaveTextContent('All 1 hard checks passed · 1 soft note')
    expect(screen.getByTestId('approve-explain')).toHaveTextContent('One run: approve, save the Markdown export, then send it to Docstar. No AI calls.')
    expect(screen.getByTestId('score-verdict')).toHaveTextContent('pass')
    expect(screen.getByRole('list', { name: 'Gates' })).toHaveTextContent('checks_hard_passed')
    expect(screen.getByRole('list', { name: 'Feedback' })).toHaveTextContent('found')
    expect(screen.queryByTestId('not-reviewed')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Approve and publish$/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent('0')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and publish' }))
    await waitFor(() => expect(posts(calls)[0]?.body).toEqual({ publish: true }))
  })

  it('"Approve only" sends no publish; with PUBLISH_TARGET=none the button is "Approve"', async () => {
    const reply = { [`POST /api/approvals/${B}/approve`]: { status: 202, body: { run_id: 'R-261019-1400-DDDD' } } }
    const calls = mockFetch(routes(detail({ reviewed: true }, { review: REVIEW }), reply))
    const first = page()
    await userEvent.click(await screen.findByRole('button', { name: /Approve only/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(posts(calls)[0]?.body).toEqual({}))
    first.unmount()
    const calls2 = mockFetch(routes(detail({ reviewed: true }, { review: REVIEW }), reply, { ...SETTINGS, publish: { target: 'none' } }))
    page()
    await userEvent.click(await screen.findByRole('button', { name: /^Approve$/ }))
    expect(screen.queryByRole('button', { name: /Approve only/ })).not.toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(posts(calls2)[0]?.body).toEqual({}))
  })

  it('"Show in post" marks the quoted sentence in the reading view', async () => {
    mockFetch(routes(detail({ reviewed: true }, { review: REVIEW })))
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Show in post/ }))
    const mark = screen.getByTestId('markdown-preview').querySelector('mark.review-mark')
    expect(mark).toHaveTextContent('Tie each risky tool call')
  })

  it('the journey bar shows every step of the post, whichever run did it', async () => {
    const stage = (id: string, label: string, state: string, run_id: string | null = null) => ({ id, label, state, detail: '', run_id, at: null })
    mockFetch(routes(detail({ reviewed: true }, { review: REVIEW }), {
      [`GET /api/journeys/${B}`]: { body: { brief_id: B, title: 't', status: 'awaiting_human', active_run_id: null, updated_at: null, runs: [{ run_id: 'R-261019-1000-AAAA', mode: 'full', status: 'waiting_for_approval', started_at: '2026-10-19T10:00:00+05:30', finished_at: null, result_summary: 'waiting' }],
        stages: [stage('topic', 'Topic', 'done', 'R-261019-1000-AAAA'), stage('research', 'Research', 'done'), stage('plan', 'Plan', 'done'), stage('draft', 'Draft', 'done'), stage('review', 'AI review', 'done'), stage('you', 'You', 'waiting'), stage('export', 'Export', 'todo'), stage('published', 'Published', 'todo')] } }
    }))
    page()
    const bar = await screen.findByTestId('journey')
    expect(within(bar).getByTestId('stage-review')).toHaveAttribute('data-state', 'done')
    expect(within(bar).getByTestId('stage-you')).toHaveAttribute('data-state', 'waiting')
    expect(screen.getByTestId('journey-line')).toHaveTextContent('Waiting for your review')
    expect(within(bar).getByRole('link', { name: 'Topic: open its run' })).toHaveAttribute('href', '/runs/R-261019-1000-AAAA')
    expect(screen.getByTestId('post-runs')).toHaveTextContent('Write a post')
  })

  it('hard-check failure disables Approve with the reason', async () => {
    mockFetch(routes(detail({ hard_passed: false }, { checks: [{ id: 'cta_exact', passed: false, severity: 'hard', value: 0, detail: 'CTA missing' }] })))
    page()
    expect(await screen.findByRole('button', { name: /^Approve and publish$/ })).toBeDisabled()
    expect(screen.getByTestId('approve-blocked')).toHaveTextContent('hard content checks did not pass (cta_exact)')
  })

  it('a 409 from the engine is shown as a clear message', async () => {
    mockFetch(routes(detail({ reviewed: true }), { [`POST /api/approvals/${B}/approve`]: { status: 409, body: { error: { code: 'not_awaiting_human', message: `the latest draft of ${B} (v3) is approved, not awaiting_human` } } } }))
    page()
    await userEvent.click(await screen.findByRole('button', { name: /^Approve and publish$/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve and publish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('is approved, not awaiting_human (refresh to see the current state)')
  })
})

describe('Request changes and reject', () => {
  it('length limits (5–2,000), the re-review toggle sent as rereview_after_human, quotes included, expected calls follow the toggle', async () => {
    const calls = mockFetch(routes(detail(), { [`POST /api/approvals/${B}/revise`]: { status: 202, body: { run_id: 'R-261019-1400-DDDD' } } }))
    page()
    const box = await screen.findByLabelText('Your feedback')
    const send = screen.getByRole('button', { name: 'Send counter prompt' })
    expect(send).toBeDisabled()
    await userEvent.type(box, 'abc')
    expect(send).toBeDisabled()
    expect(screen.getByTestId('feedback-counter')).toHaveTextContent('at least 5 characters')
    await userEvent.clear(box)
    await userEvent.click(box)
    await userEvent.paste('x'.repeat(2001))
    expect(send).toBeDisabled()
    expect(screen.getByTestId('feedback-counter')).toHaveTextContent('too long')
    await userEvent.clear(box)
    await userEvent.type(box, 'Make the first paragraph shorter.')
    expect(send).toBeEnabled()
    expect(screen.getByTestId('revise-cost')).toHaveTextContent('Expected AI calls: 3–6 (Writer revision, the Experience Designer, then the Reviewer)')
    await userEvent.click(screen.getByLabelText('Re-review after the change'))
    expect(screen.getByTestId('revise-cost')).toHaveTextContent('Expected AI calls: 2–4 (Writer revision and the Experience Designer)')
    await userEvent.click(send)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent('2–4')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    await screen.findByText('live page')
    expect(posts(calls)[0]).toEqual({ method: 'POST', path: `/api/approvals/${B}/revise`, body: { feedback: 'Make the first paragraph shorter.', target: 'writing', params: { rereview_after_human: false } } })
  })

  it('a 400 (quote not found) is shown; reject sends the reason after a 0-call confirm', async () => {
    const calls = mockFetch(routes(detail(), {
      [`POST /api/approvals/${B}/revise`]: { status: 400, body: { error: { code: 'quote_not_found', message: 'quote(s) not found in the draft: "x"' } } },
      [`POST /api/approvals/${B}/reject`]: { status: 202, body: { run_id: 'R-261019-1400-EEEE' } }
    }))
    page()
    await userEvent.type(await screen.findByLabelText('Your feedback'), 'Shorter, please.')
    await userEvent.click(screen.getByRole('button', { name: 'Send counter prompt' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('quote(s) not found in the draft')
    await userEvent.type(screen.getByLabelText(/Reason/), 'Too close to last week')
    await userEvent.click(screen.getByRole('button', { name: /Reject topic/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('expected-calls')).toHaveTextContent('Expected AI calls: 0')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject the topic' }))
    await screen.findByText('live page')
    expect(posts(calls).at(-1)).toEqual({ method: 'POST', path: `/api/approvals/${B}/reject`, body: { reason: 'Too close to last week' } })
  })

  it('no counter prompts left: Request changes is off with the reason', async () => {
    mockFetch({ ...routes(detail()), 'GET /api/settings': { body: { ...SETTINGS, approval: { ...SETTINGS.approval, max_human_revisions: 1 } } } })
    page()
    expect(await screen.findByText(/No counter prompts left/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Your feedback'), 'Shorter, please.')
    expect(screen.getByRole('button', { name: 'Send counter prompt' })).toBeDisabled()
  })
})

describe('History, diff, checks, list', () => {
  it('Compare loads the earlier version and shows a word diff', async () => {
    mockFetch(routes(detail()))
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Compare versions/ }))
    await userEvent.selectOptions(await screen.findByLabelText('Compare from'), '2')
    await userEvent.selectOptions(screen.getByLabelText('Compare with'), '3')
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }))
    const diff = await screen.findByTestId('version-diff')
    expect(within(diff).getByTestId('diff-added')).toHaveTextContent('+2 words')
    await userEvent.click(within(diff).getByRole('button', { name: 'Side by side' }))
    expect(within(diff).getByLabelText('v2')).toHaveTextContent('binds the action')
  })

  it('word diff and check ordering helpers', () => {
    const parts = wordDiff('one two three', 'one 2 three four')
    expect(diffStats(parts)).toEqual({ added: 2, removed: 1 })
    expect(sortChecks([{ id: 'a', passed: true, severity: 'hard' }, { id: 'b', passed: false, severity: 'soft' }, { id: 'c', passed: false, severity: 'hard' }]).map((c) => c.id)).toEqual(['c', 'b', 'a'])
    expect(approvalFlags(detail({ reviewed: undefined, hard_passed: undefined }, { review: { ...REVIEW, pass: true } }))).toMatchObject({ reviewed: true, hardPassed: true })
  })

  it('the Approvals list shows waiting drafts, and an empty state otherwise', async () => {
    mockFetch({ 'GET /api/approvals': { body: { approvals: [{ brief_id: B, version: 3, brief_version: 1, title: 'How to Gate', total: null, waiting_since: '2026-10-19T11:25:44+05:30', record_id: 'm' }] } } })
    const first = renderApp(<Approvals />)
    expect(await screen.findByRole('link', { name: /How to Gate/ })).toHaveAttribute('href', `/approvals/${B}`)
    expect(screen.getByText('not reviewed')).toBeInTheDocument()
    first.unmount()
    mockFetch({ 'GET /api/approvals': { body: { approvals: [] } } })
    renderApp(<Approvals />)
    await waitFor(() => expect(screen.getByText(/No drafts waiting/)).toBeInTheDocument())
  })
})
