// Phase 9 B1: expected Mem0 requests next to each run button and in the confirm dialog.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RunButton } from '../src/components/RunButton'
import { ConfirmDialog } from '../src/components/ConfirmDialog'
import { COSTS } from '../src/config/costs'

describe('Mem0 estimates', () => {
  it('every action has one', () => {
    for (const [k, v] of Object.entries(COSTS)) expect(v.mem0, k).toMatch(/^≈\d+(–\d+)?$/)
    expect(COSTS.full.mem0).toBe('≈28–45')
  })
  it('the run button and the confirm dialog show it', () => {
    render(<RunButton title="Run full pipeline" description="d" costKey="full" lowCost={false} built onRun={() => {}} />)
    expect(screen.getByTestId('cost-mem0')).toHaveTextContent('Expected Mem0 requests: ≈28–45')
    render(<ConfirmDialog open title="Start" expectedCalls="15–23" expectedMem0="≈28–45" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByTestId('expected-mem0')).toHaveTextContent('Expected Mem0 requests: ≈28–45')
  })
})
