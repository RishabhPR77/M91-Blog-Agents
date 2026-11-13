// Plain words for the run page. The engine names its sub-steps as code does (scout.timely, scout.questions.g1,
// strategist.plan, …); a person reads "This week's news" or "Questions people ask: payment alerts".

const SUB: Record<string, string> = {
  'scout.timely': 'This week’s news',
  'scout.questions-week': 'What people asked this week',
  'scout.questions-slot': 'Questions people ask about this post',
  'scout.sources-slot': 'Sources for this post',
  'scout.facts': 'M91 facts from the docs',
  'scout.sources': 'Sources for the claims the Reviewer flagged',
  'scout.stories': 'Recent public stories',
  'scout.tutorials': 'Tutorial ideas',
  'scout.clusters': 'Grouping the questions into post ideas',
  'scout.style': 'How popular articles on the topic are written',
  'strategist.plan': 'Plans the brief',
  'strategist.rebrief': 'Plans the brief again',
  'strategist.repair': 'Fixes the brief',
  'strategist.truncated': 'Shortens the brief'
}

// The Scout's topic groups (the engine's TOPIC_GROUPS), short.
const GROUP: Record<string, string> = {
  '1': 'AI agent approvals',
  '2': 'payment alerts',
  '3': 'on-call alerting',
  '4': 'alerting best practices',
  '5': 'comparisons'
}

/** "scout.questions.g2" → "Questions people ask: payment alerts"; an unknown name in words ("scout.new-thing" → "New thing"). */
export function subStepLabel(name: string): string {
  if (SUB[name]) return SUB[name]
  const g = /^scout\.questions\.g(\d)$/.exec(name)
  if (g) return `Questions people ask: ${GROUP[g[1]] ?? `topic ${g[1]}`}`
  const words = name.split('.').slice(1).join(' ').replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : name
}

/** How many times a step ran, in words: "2 drafts", "2 reviews", "checked 2 times". */
export function roundsText(step: string, n: number): string {
  switch (step) {
    case 'writer': return `${n} drafts`
    case 'reviewer': return `${n} reviews`
    case 'checks': return `checked ${n} times`
    case 'strategist': return `${n} plans`
    default: return `ran ${n} times`
  }
}

/** Where a review sent the post, in words. */
export const sentToWords = (to: string | null, action: string | null): string =>
  to === 'human' || action === 'await_human' ? 'to you' : action === 'approve' ? 'approved' : to ? `back to the ${to[0].toUpperCase()}${to.slice(1)}` : 'next'
