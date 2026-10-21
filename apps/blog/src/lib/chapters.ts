// The post page's chapters (Phase 10, A3): the post's H2s, numbered, each linked to one of the guide's status
// states, plus the "Stuck?" chapter and the number of questions the post answers.
import type { Heading } from './markdown'

export const STATES = ['waiting', 'ringing', 'approved', 'rejected', 'continuing'] as const
export type State = (typeof STATES)[number]
export type Chapter = { id: string; text: string; state: State }

// A post without a guide gets M91's story in four states, spread over its chapters in order.
export const DEFAULT_STATES: State[] = ['waiting', 'ringing', 'approved', 'continuing']

const STUCK = /troubleshoot|stuck|not work|went wrong|problem|error|fix/i

export function chaptersOf(headings: Heading[], states: State[] = DEFAULT_STATES): Chapter[] {
  const h2s = headings.filter((h) => h.depth === 2 && h.id)
  return h2s.map((h, i) => ({ id: h.id, text: h.text, state: states[Math.min(states.length - 1, Math.floor((i * states.length) / h2s.length))] }))
}

/** The chapter readers jump to with "Stuck?": the first H2 about problems or fixes, if any. */
export const stuckChapter = (chapters: Chapter[]) => chapters.find((c) => STUCK.test(c.text))

/** Headings phrased as questions (FAQ items and question headings). */
export const questionCount = (headings: Heading[]) => headings.filter((h) => h.depth <= 3 && h.text.trim().endsWith('?')).length
