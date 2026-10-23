// The score card's verdict: pass (green), pass with notes (amber, with a line saying why), fail (red).
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScoreCard } from '../src/components/ScoreCard'

describe('ScoreCard verdict', () => {
  it('pass with notes: amber pill and a line saying it was not sent back to the Writer', () => {
    render(<ScoreCard total={76} pass notes passMin={80} />)
    expect(screen.getByTestId('score-verdict')).toHaveTextContent('pass with notes')
    expect(screen.getByTestId('score-verdict')).toHaveClass('pill-amber')
    expect(screen.getByTestId('score-notes')).toHaveTextContent('Only minor problems: not sent back to the Writer.')
  })

  it('a plain pass and a fail have no notes line', () => {
    const { rerender } = render(<ScoreCard total={88} pass passMin={80} />)
    expect(screen.getByTestId('score-verdict')).toHaveTextContent(/^pass$/)
    expect(screen.queryByTestId('score-notes')).not.toBeInTheDocument()
    rerender(<ScoreCard total={60} pass={false} notes passMin={80} />)
    expect(screen.getByTestId('score-verdict')).toHaveTextContent(/^fail$/)
    expect(screen.queryByTestId('score-notes')).not.toBeInTheDocument()
  })
})
