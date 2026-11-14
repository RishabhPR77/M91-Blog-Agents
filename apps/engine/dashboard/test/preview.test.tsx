// The live preview beside a run (2026-11-14): preview events kept apart from the log, and the panel for each agent.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import type { EngineEvent } from '../src/api/sse'
import { EVENT_TYPES } from '../src/api/sse'
import { initialRunView, runReducer, type RunView } from '../src/state/runEvents'
import { LivePreview, splitBlocks, workingAgent } from '../src/components/LivePreview'
import RunLive from '../src/pages/RunLive'
import { FakeEventSource, mockFetch, renderApp } from './helpers'

const RUN = 'R-261114-1200-PREV'
let seq = 0
const ev = (type: string, more: Partial<EngineEvent> = {}): EngineEvent => ({ run_id: RUN, seq: ++seq, ts: '2026-11-14T06:30:00.000Z', type, ...more })
const preview = (agent: string, data: Record<string, unknown>, step = agent) => ev('preview', { agent, step, data })
const play = (events: EngineEvent[]): RunView => events.reduce((s, e) => runReducer(s, { type: 'event', event: e }), initialRunView(RUN))

const DRAFT_1 = '# Who answers the alert\n\nA ringing phone gets attention fast.\n\n## What happens at night?\n\nThe agent waits for a person.'
const DRAFT_2 = '# Who answers the alert\n\nA ringing phone gets attention fast.\n\n## What happens at night?\n\nM91 rings the on-call person until someone answers.'
const START = [ev('run.started', { data: { mode: 'full', trigger: 'manual', dry_run: false } })]
const SCOUT = [
  ev('step.started', { agent: 'scout', step: 'scout' }),
  ev('step.started', { agent: 'scout', step: 'scout.timely' }),
  preview('scout', { kind: 'scout', call: 'timely', items: [{ group: '', text: 'Agents get a human approval step', meta: 'example.com' }, { group: '', text: 'On-call teams move to phone alerts', meta: '' }] }, 'scout.timely'),
  ev('step.finished', { agent: 'scout', step: 'scout.timely' }),
  ev('step.finished', { agent: 'scout', step: 'scout' })
]
const EDITOR = [
  ev('step.started', { agent: 'editor', step: 'editor' }),
  preview('editor', { kind: 'editor', reason: 'Most asked this week', chosen_by: 'editor', candidates: [
    { title: 'Who answers the alert', format: 'guide', total: 21, scores: { demand: 5, timeliness: 4, m91_fit: 5, gap: 4, variety: 3 }, left_out: null, chosen: true },
    { title: 'Pager history', format: 'story', total: 12, scores: { demand: 2, timeliness: 2, m91_fit: 3, gap: 3, variety: 2 }, left_out: 'no demand', chosen: false }
  ] }),
  ev('step.finished', { agent: 'editor', step: 'editor' })
]
const STRATEGIST = [
  ev('step.started', { agent: 'strategist', step: 'strategist' }),
  preview('strategist', { kind: 'strategist', call: 'plan', title: 'Who answers the alert', keyword: 'alert escalation', format: 'guide', reader: 'On-call leads', angle: 'Phones get answered', outline: [{ heading: 'What happens at night?', answer_first: 'M91 rings until someone answers.' }, { heading: 'How do you set it up?', answer_first: '' }], problems: 0 }),
  ev('step.finished', { agent: 'strategist', step: 'strategist' })
]
const WRITER = [
  ev('step.started', { agent: 'writer', step: 'writer' }),
  preview('writer', { kind: 'writer', pass: 'new', version: 1, title: 'Who answers the alert', markdown: DRAFT_1, words: 900, grade: 8.1, hard: ['answer_first'], soft: [], fixes: [] }),
  preview('writer', { kind: 'writer', pass: 'repair', version: 1, title: 'Who answers the alert', markdown: DRAFT_2, words: 910, grade: 8, hard: [], soft: [], fixes: ['answer_first: the night section now answers first'] }),
  preview('writer', { kind: 'factcheck', version: 1, issues: [{ quote: 'M91 rings the on-call person', problem: 'fine', fix: 'M91 calls the on-call person' }] }),
  ev('step.finished', { agent: 'writer', step: 'writer' })
]
const REVIEW_START = [ev('step.started', { agent: 'reviewer', step: 'reviewer' })]
const REVIEW = [
  preview('reviewer', { kind: 'reviewer', version: 1, total: 78, pass: false, pass_mark: 80,
    gates: [{ id: 'm91_claims_correct', passed: false }, { id: 'no_invented_content', passed: true }],
    areas: [{ id: 'simplicity', score: 9 }, { id: 'accuracy', score: 5 }],
    feedback: [{ severity: 'must', area: 'accuracy', quote: 'M91 rings the on-call person until someone answers.', problem: 'M91 does not retry forever', fix: 'Say it rings the listed people' }] }),
  ev('step.finished', { agent: 'reviewer', step: 'reviewer' })
]

// seq only grows (the reducer drops an event it has seen), so events made inside a test come after the ones above.
beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

describe('preview events', () => {
  it('the dashboard listens for them', () => {
    expect(EVENT_TYPES).toContain('preview')
  })

  it('are kept in previews, never in the log', () => {
    const s = play([...START, ...SCOUT, ...EDITOR, ...STRATEGIST, ...WRITER, ...REVIEW_START, ...REVIEW])
    expect(s.log.some((l) => l.type === 'preview')).toBe(false)
    expect(s.previews.scout[0]).toMatchObject({ step: 'scout.timely', items: [{ text: 'Agents get a human approval step' }, { text: 'On-call teams move to phone alerts' }] })
    expect(s.previews.editor?.candidates.map((c) => c.chosen)).toEqual([true, false])
    expect(s.previews.strategist[0].outline).toHaveLength(2)
    expect(s.previews.writer.map((w) => w.pass)).toEqual(['new', 'repair'])
    expect(s.previews.factcheck[0].issues).toHaveLength(1)
    expect(s.previews.reviewer[0]).toMatchObject({ total: 78, pass: false, passMark: 80 })
  })

  it('each list keeps only its newest entries', () => {
    const many = Array.from({ length: 14 }, (_, i) => preview('writer', { kind: 'writer', pass: 'revise', version: i + 1, markdown: `v${i + 1}` }))
    const s = play([...START, ...many])
    expect(s.previews.writer).toHaveLength(10)
    expect(s.previews.writer.at(-1)?.version).toBe(14)
  })

  it('the working agent follows the running step (the checks are the Writer\'s)', () => {
    expect(workingAgent(play([...START, ...SCOUT.slice(0, 2)]))).toBe('scout')
    expect(workingAgent(play([...START, ev('step.started', { agent: 'checks', step: 'checks' })]))).toBe('writer')
    expect(workingAgent(play([...START, ...SCOUT, ...EDITOR, ...STRATEGIST, ...WRITER, ...REVIEW_START]))).toBe('reviewer')
    expect(workingAgent(play([...START, ...SCOUT, ev('run.finished', { data: { ms: 1 } })]))).toBeNull()
  })

  it('splits Markdown into blocks, keeping a code fence whole', () => {
    expect(splitBlocks('# A\n\npara\n\n```\nx\n\ny\n```\n\nend')).toEqual(['# A', 'para', '```\nx\n\ny\n```', 'end'])
  })
})

describe('the preview panel', () => {
  const panel = (events: EngineEvent[], briefId: string | null = null) => renderApp(<LivePreview view={play(events)} briefId={briefId} />)

  it('Scout: the findings of each search, and what it is searching now', () => {
    panel([...START, ...SCOUT.slice(0, 3), ev('step.started', { agent: 'scout', step: 'scout.questions-week' })])
    expect(screen.getByRole('tab', { name: 'Scout' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Agents get a human approval step')).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(screen.getByText('· 2 found', { exact: false })).toBeInTheDocument()
    expect(screen.getByLabelText(/searching the web/)).toBeInTheDocument()
  })

  it('Editor: every candidate with its scores, the chosen one marked', () => {
    panel([...START, ...SCOUT, ...EDITOR])
    expect(screen.getByTestId('editor-chosen')).toHaveTextContent('Who answers the alert')
    expect(screen.getByText('Left out: no demand')).toBeInTheDocument()
    expect(screen.getByText('Most asked this week')).toBeInTheDocument()
  })

  it('Strategist: the brief and its numbered outline', () => {
    panel([...START, ...SCOUT, ...EDITOR, ...STRATEGIST])
    const outline = screen.getByTestId('preview-outline')
    expect(within(outline).getAllByRole('listitem')).toHaveLength(2)
    expect(outline).toHaveTextContent('1What happens at night?M91 rings until someone answers.')
    expect(screen.getByText('alert escalation')).toBeInTheDocument()
  })

  it('Writer: the newest pass, what changed, what it fixed, the fact check; a chip shows an earlier pass', async () => {
    panel([...START, ...SCOUT, ...EDITOR, ...STRATEGIST, ...WRITER])
    expect(screen.getByRole('button', { name: 'v1 · Repair' })).toHaveAttribute('aria-pressed', 'true')
    const post = screen.getByTestId('preview-post')
    const changed = post.querySelectorAll('[data-changed]')
    expect(changed).toHaveLength(1)
    expect(changed[0]).toHaveTextContent('M91 rings the on-call person until someone answers.')
    expect(screen.getByTestId('preview-fixes')).toHaveTextContent('answer_first: the night section now answers first')
    expect(screen.getByTestId('preview-factcheck')).toHaveTextContent('Fact check: 1 sentence(s) to correct')
    expect(screen.getByText('910 words · grade 8 · every hard check passed', { exact: false })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'v1 · Draft' }))
    expect(screen.getByTestId('preview-post')).toHaveTextContent('The agent waits for a person.')
    expect(screen.getByTestId('preview-post').querySelectorAll('[data-changed]')).toHaveLength(0)
    expect(screen.getByText(/fix: answer_first/)).toBeInTheDocument()
  })

  it('Reviewer: reading the draft first, then the score, gates, areas and a numbered box on what it flagged', () => {
    const { unmount } = panel([...START, ...SCOUT, ...EDITOR, ...STRATEGIST, ...WRITER, ...REVIEW_START])
    expect(screen.getByLabelText(/The Reviewer is reading v1/)).toBeInTheDocument()
    expect(screen.getByTestId('preview-post').className).toContain('preview-scan')
    unmount()
    panel([...START, ...SCOUT, ...EDITOR, ...STRATEGIST, ...WRITER, ...REVIEW_START, ...REVIEW])
    expect(screen.getByRole('tab', { name: 'Reviewer' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('back to the Writer')).toBeInTheDocument()
    expect(screen.getByText(/pass mark 80/)).toBeInTheDocument()
    expect(within(screen.getByTestId('preview-gates')).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByTestId('preview-areas')).toHaveTextContent('accuracy5/10')
    expect(screen.getByTestId('preview-feedback')).toHaveTextContent('M91 does not retry forever')
    const boxed = screen.getByTestId('preview-post').querySelector('.preview-box')
    expect(boxed).toHaveTextContent('M91 rings the on-call person until someone answers.')
    expect(boxed).toHaveAttribute('data-n', '1')
    expect(boxed?.className).toContain('preview-box-must')
  })

  it('a tab shows another agent\'s work while one is working', async () => {
    panel([...START, ...SCOUT, ...EDITOR, ...STRATEGIST, ...WRITER, ...REVIEW_START])
    await userEvent.click(screen.getByRole('tab', { name: 'Strategist' }))
    expect(screen.getByTestId('preview-outline')).toBeInTheDocument()
  })

  it('after the run (no live previews): the saved draft and review', async () => {
    mockFetch({ 'GET /api/approvals/261114-1200-PREV': { body: {
      draft: { post_markdown: DRAFT_2, version: 2, title: 'Who answers the alert', word_count: 910 },
      review: { total: 88, pass: true, version: 2, gates: [{ id: 'm91_claims_correct', passed: true }], areas: [{ id: 'accuracy', score: 9 }], feedback: [] }
    } } })
    panel([...START, ev('run.finished', { data: { ms: 1, brief_id: '261114-1200-PREV' } })], '261114-1200-PREV')
    expect(await screen.findByRole('tab', { name: 'Reviewer' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('pass')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Writer' }))
    expect(screen.getByRole('button', { name: 'v2 · Saved draft' })).toBeInTheDocument()
  })
})

describe('the run page', () => {
  it('shows the preview beside a running run, and the activity on its tab', async () => {
    mockFetch({ [`GET /api/runs/${RUN}`]: { body: { run: { run_id: RUN, mode: 'full', trigger: 'manual', dry_run: false, status: 'running', steps: [] }, records: [] } } })
    renderApp(<Routes><Route path="/runs/:runId" element={<RunLive />} /></Routes>, { route: `/runs/${RUN}` })
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const es = FakeEventSource.instances[0]
    act(() => {
      es.open()
      for (const e of [...START, ...SCOUT, ...EDITOR, ...STRATEGIST, ...WRITER.slice(0, 3)]) es.emit(e)
    })
    expect(await screen.findByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('live-preview')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Writer' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('run-ai-calls')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(screen.getByTestId('run-ai-calls')).toBeInTheDocument()
    expect(screen.queryByTestId('live-preview')).not.toBeInTheDocument()
  })
})
