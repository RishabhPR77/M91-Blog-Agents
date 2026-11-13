// Why it stopped: the failed step's error once (not again as "the run's own reason"), and rounds counted from 1.
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { EngineEvent } from '../src/api/sse'
import { WhyStopped } from '../src/components/RunActivity'
import { PipelineTracker } from '../src/components/PipelineTracker'
import { initialRunView, runReducer } from '../src/state/runEvents'

const RUN = 'R-261113-0914-RUDY'
let seq = 0
const ev = (type: string, more: Partial<EngineEvent> = {}): EngineEvent => ({ seq: ++seq, ts: `2026-11-13T09:${String(14 + seq).padStart(2, '0')}:00Z`, run_id: RUN, type, ...more }) as EngineEvent
const play = (events: EngineEvent[]) => events.reduce((s, e) => runReducer(s, { type: 'event', event: e }), initialRunView(RUN))

const ERROR = "Writer message is 57586 characters; viaSocket's limit is 50000"
const events = () => {
  seq = 0
  return [
    ev('run.started', { data: { mode: 'full', trigger: 'manual', dry_run: false } }),
    ev('step.started', { agent: 'reviewer', step: 'reviewer' }),
    ev('step.finished', { agent: 'reviewer', step: 'reviewer' }),
    ev('loop.route', { agent: 'orchestrator', message: 'send_to writer: accuracy', data: { send_to: 'writer', action: 'revise', reason: 'accuracy', total: 57.5, version: 1, counters: { rounds: 0 } } }),
    ev('step.started', { agent: 'writer', step: 'writer' }),
    ev('step.failed', { agent: 'writer', step: 'writer', message: ERROR, data: { error: ERROR } }),
    ev('run.failed', { message: `writer: ${ERROR}` })
  ]
}

describe('Why it stopped', () => {
  it('names the failed step once and counts the review round from 1', () => {
    const view = play(events())
    render(<WhyStopped view={view} />)
    const box = screen.getByTestId('why-stopped')
    expect(within(box).queryByText(/The run's own reason/)).toBeNull()
    expect(box.textContent).toMatch(/Last review: 57\.5\/100 \(round 1\), because of accuracy/)
    expect(box.textContent).not.toMatch(/round 0/)
  })

  it("keeps the run's own reason when it says something the step error does not", () => {
    const evs = events()
    evs[evs.length - 1] = { ...evs[evs.length - 1], message: 'stopped after 3 rounds: best score 57.5' } as EngineEvent
    render(<WhyStopped view={play(evs)} />)
    expect(screen.getByTestId('why-stopped').textContent).toMatch(/The run's own reason: stopped after 3 rounds/)
  })

  it('the round chips under the Reviewer start at 1', () => {
    render(<PipelineTracker view={play(events())} />)
    expect(screen.getByLabelText('Review rounds').textContent).toMatch(/^Round 1: 57\.5\/100 · back to the Writer/)
  })
})

describe('Plain words for the run page', () => {
  it('names sub-steps and rounds the way a person says them', async () => {
    const { subStepLabel, roundsText, sentToWords } = await import('../src/components/stepWords')
    expect(subStepLabel('scout.timely')).toBe('This week’s news')
    expect(subStepLabel('scout.questions-week')).toBe('What people asked this week')
    expect(subStepLabel('scout.questions.g2')).toBe('Questions people ask: payment alerts')
    expect(subStepLabel('strategist.plan')).toBe('Plans the brief')
    expect(subStepLabel('scout.brand-new_call')).toBe('Brand new call')
    expect(roundsText('checks', 2)).toBe('checked 2 times')
    expect(roundsText('writer', 3)).toBe('3 drafts')
    expect(roundsText('scout', 2)).toBe('ran 2 times')
    expect(sentToWords('writer', 'revise')).toBe('back to the Writer')
    expect(sentToWords(null, 'await_human')).toBe('to you')
  })
})
