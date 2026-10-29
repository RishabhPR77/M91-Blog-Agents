// Phase 9 B1: expected Mem0 requests next to each run button and in the confirm dialog.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RunButton } from '../src/components/RunButton'
import { ConfirmDialog } from '../src/components/ConfirmDialog'
import { COSTS } from '../src/config/costs'

describe('Mem0 estimates', () => {
  it('every action has one', () => {
    for (const [k, v] of Object.entries(COSTS)) expect(v.mem0, k).toMatch(/^≈\d+(–\d+)?$/)
    expect(COSTS.full.mem0).toBe('≈30–48')
  })
  it('the run button and the confirm dialog show it', () => {
    render(<RunButton title="Write the next post" description="d" costKey="full" lowCost={false} built onRun={() => {}} />)
    expect(screen.getByTestId('cost-mem0')).toHaveTextContent('Expected memory calls: ≈30–48')
    render(<ConfirmDialog open title="Start" expectedCalls="16–29" expectedMem0="≈30–48" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByTestId('expected-mem0')).toHaveTextContent('Expected memory calls: ≈30–48')
  })
})
