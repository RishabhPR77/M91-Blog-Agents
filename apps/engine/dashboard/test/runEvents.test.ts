import { describe, expect, it } from 'vitest'
import fixture from './fixtures/events.json'
import type { EngineEvent } from '../src/api/sse'
import { applyEvent, initialRunView, MAX_LOG, rebuildFromRecord, runReducer, trackerSteps, outputRecordIds, type RunRecord, type RunView } from '../src/state/runEvents'

const play = (events: EngineEvent[], runId = events[0].run_id): RunView => events.reduce((s, e) => runReducer(s, { type: 'event', event: e }), initialRunView(runId))
const byName = (s: RunView) => Object.fromEntries(trackerSteps(s).map((x) => [x.name, x.status]))

describe('runEvents reducer: the recorded full run (hand-written in the engine format)', () => {
  const s = play(fixture.full_run as EngineEvent[])

  it('ends succeeded with run fields, totals and every step state', () => {
    expect(s.status).toBe('succeeded')
    expect([s.mode, s.trigger, s.dryRun, s.ms, s.briefId]).toEqual(['full', 'manual', true, 353000, '261019-0900-ABCD'])
    expect(s.resultSummary).toBe('awaiting human approval (v2, score 86)')
    expect(s.totals).toEqual({ aiCalls: 7, retries: 3 })
    expect(byName(s)).toEqual({ editor: 'skipped', scout: 'done', strategist: 'done', writer: 'done', checks: 'done', reviewer: 'done', promo: 'skipped', designer: 'skipped', export: 'skipped', publisher: 'skipped' })
    expect(s.source).toBe('live')
  })

  it('nests Scout sub-steps and counts their AI calls, models and retries on both levels', () => {
    expect(s.steps.scout.children).toEqual(['scout.facts', 'scout.questions.g1'])
    expect(s.steps['scout.facts']).toMatchObject({ status: 'done', aiCalls: 1, retries: 2, models: ['gpt-5-mini'], summary: '12 kept of 14 returned (2 dropped)' })
    expect(s.steps.scout).toMatchObject({ aiCalls: 2, retries: 2, ms: 90000 })
    expect(s.steps.strategist.children).toEqual(['strategist.plan'])
  })

  it('counts both Writer and Reviewer rounds', () => {
    expect(s.steps.writer).toMatchObject({ rounds: 2, aiCalls: 2, retries: 1, ms: 122000, summary: 'Draft v2: 1,143 words · grade 8.2 · hard checks passed · repairs 0' })
    expect(s.steps.reviewer).toMatchObject({ rounds: 2, aiCalls: 2 })
  })

  it('keeps the loop timeline and the approval banner', () => {
    expect(s.routes.map((r) => [r.action, r.sendTo, r.total, r.version, r.round])).toEqual([['revise', 'writer', 77, 1, 0], ['approve', null, 86, 2, 1]])
    expect(s.approvals).toEqual([expect.objectContaining({ kind: 'waiting', briefId: '261019-0900-ABCD', version: 2, total: 86 })])
  })

  it('logs every event in order and links outputs to records', () => {
    expect(s.log).toHaveLength(fixture.full_run.length)
    expect(s.log.map((l) => l.seq)).toEqual(fixture.full_run.map((e) => e.seq))
    expect(s.log.find((l) => l.type === 'log' && l.level === 'warn')?.message).toBe('viaSocket call retried after a timeout')
    const scoutOut = s.outputs.find((o) => o.step === 'scout')!
    expect(outputRecordIds(scoutOut)).toEqual(['C-261019-0901-AAAA', 'S-261019-0901-BBBB'])
  })
})

describe('runEvents reducer: real streams from the engine', () => {
  it('approve: placeholders shown as not built yet, approval.approved banner, 1 AI call', () => {
    const s = play(fixture.approve as EngineEvent[])
    expect(s.status).toBe('succeeded')
    expect(s.steps.designer).toMatchObject({ status: 'done', placeholder: true, summary: 'Designer: not built yet (Phase 8)' })
    expect(s.steps.publisher.placeholder).toBe(true)
    expect(s.steps.promo).toMatchObject({ status: 'done', aiCalls: 1, models: ['gpt-5-mini'] })
    expect(s.approvals.map((a) => a.kind)).toEqual(['approved'])
    expect(s.totals.aiCalls).toBe(1)
  })

  it('human_revise: changes_requested then waiting; the "approve" route; writer and checks done', () => {
    const s = play(fixture.human_revise as EngineEvent[])
    expect(s.approvals.map((a) => a.kind)).toEqual(['changes_requested', 'waiting'])
    expect(s.routes).toHaveLength(1)
    expect(s.routes[0].action).toBe('approve')
    expect(byName(s)).toMatchObject({ writer: 'done', checks: 'done', reviewer: 'skipped', scout: 'skipped' })
    expect(s.log.filter((l) => l.level === 'warn')).toHaveLength(3)
  })
})

describe('cancel, dedupe, unknown events, caps', () => {
  it('a cancelled step shows as cancelled, and still-running sub-steps end cancelled too', () => {
    const s = play(fixture.cancelled_run as EngineEvent[])
    expect(s.status).toBe('cancelled')
    expect(s.steps.scout.status).toBe('cancelled')
    expect(s.steps['scout.facts'].status).toBe('cancelled')
    expect(byName(s).strategist).toBe('skipped')
  })

  it('reconnect replays are deduplicated by seq (never applied twice)', () => {
    const events = fixture.full_run as EngineEvent[]
    const once = play(events)
    const replayed = [...events.slice(0, 20), ...events.slice(0, 30), ...events]
    const twice = play(replayed)
    expect(twice.totals).toEqual(once.totals)
    expect(twice.log).toHaveLength(once.log.length)
    expect(twice.routes).toHaveLength(2)
    const s1 = applyEvent(once, events[3])
    expect(s1).toBe(once)
  })

  it('unknown event types are logged as-is and never crash', () => {
    const s = play([{ run_id: 'R-1', seq: 1, ts: '2026-10-19T00:00:00Z', type: 'designer.sketch', message: 'new kind of event', data: { a: 1 } }])
    expect(s.log).toEqual([expect.objectContaining({ type: 'designer.sketch', message: 'new kind of event' })])
    expect(s.order).toEqual([])
  })

  it(`keeps at most ${MAX_LOG} log lines`, () => {
    let s = initialRunView('R-1')
    for (let i = 1; i <= MAX_LOG + 25; i++) s = applyEvent(s, { run_id: 'R-1', seq: i, ts: '2026-10-19T00:00:00Z', type: 'log', level: 'info', message: `line ${i}` })
    expect(s.log).toHaveLength(MAX_LOG)
    expect(s.log[0].message).toBe('line 26')
    expect(s.logDropped).toBe(25)
  })
})

describe('rebuild without live events', () => {
  it('from the saved timeline: same steps, routes and approvals as live, but no info log lines', () => {
    const live = play(fixture.full_run as EngineEvent[])
    const s = runReducer(initialRunView('R-261019-0900-FULL'), { type: 'rebuild', record: fixture.full_run_record as RunRecord })
    expect(s.source).toBe('timeline')
    expect(s.status).toBe('succeeded')
    expect(byName(s)).toEqual(byName(live))
    expect(s.totals).toEqual(live.totals)
    expect(s.steps.scout.children).toEqual(['scout.facts', 'scout.questions.g1'])
    expect(s.routes.map((r) => r.action)).toEqual(['revise', 'approve'])
    expect(s.approvals.map((a) => a.kind)).toEqual(['waiting'])
    expect(s.log.some((l) => l.type === 'log' && l.level === 'info')).toBe(false)
    expect(s.log.some((l) => l.level === 'warn')).toBe(true)
  })

  it('from the run record only (R-261019-1055-QHVG, before Phase 6): steps, AI calls and outputs', () => {
    const r = fixture.qhvg.run as RunRecord
    const s = rebuildFromRecord(r.run_id, r)
    expect(s.source).toBe('record')
    expect(s.status).toBe('failed')
    expect(s.resultSummary).toBe('hit MAX_WRITER_REVISIONS (1)')
    expect(s.totals.aiCalls).toBe(11)
    expect(s.steps.scout).toMatchObject({ status: 'done', aiCalls: 5 })
    // Steps listed once per round add up: Writer 1 + 2 calls, Reviewer 1 + 1, Checks 3 rounds.
    expect(s.steps.writer).toMatchObject({ aiCalls: 3, rounds: 2, retries: 0 })
    expect(s.steps.reviewer).toMatchObject({ aiCalls: 2, rounds: 2 })
    expect(s.steps.checks.rounds).toBe(3)
    expect(Object.values(s.steps).reduce((n, x) => n + (x.name.includes('.') ? 0 : x.aiCalls), 0)).toBe(11)
    expect(s.routes).toEqual([])
    expect(s.outputs.length).toBeGreaterThan(0)
  })

  it('a rebuild never replaces live events that already arrived', () => {
    const live = play(fixture.full_run as EngineEvent[])
    const s = runReducer(live, { type: 'rebuild', record: fixture.full_run_record as RunRecord })
    expect(s.source).toBe('live')
    expect(s.log).toHaveLength(live.log.length)
  })
})

describe('Mem0 call counts', () => {
  const M = { reads: 12, searches: 0, writes: 9, cache_hits: 4, requests: 21 }
  it('come from run.finished, and the event count wins over the saved record (it includes the final save)', () => {
    let s = initialRunView('R-261019-1600-ABCD')
    expect(s.mem0).toBeNull()
    s = applyEvent(s, { run_id: s.runId, seq: 1, ts: '2026-10-19T10:00:00Z', type: 'run.finished', message: 'ok', data: { status: 'succeeded', mem0: M } } as EngineEvent)
    expect(s.mem0).toEqual(M)
    const rec = { run_id: s.runId, status: 'succeeded', mem0: { ...M, writes: 8, requests: 20 } } as RunRecord
    expect(rebuildFromRecord(s.runId, rec).mem0).toEqual({ ...M, writes: 8, requests: 20 })
  })
  it('older runs have none', () => {
    expect(rebuildFromRecord('R-261019-1600-ABCD', { run_id: 'R-261019-1600-ABCD', status: 'succeeded' } as RunRecord).mem0).toBeNull()
  })
})
