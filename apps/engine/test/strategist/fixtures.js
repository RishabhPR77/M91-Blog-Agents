// Fixtures for Strategist unit tests. All content is made up; nothing touches the network.

import { STANDING_CLAIMS } from '../../src/strategist/prompts.js'
import { fakeConfig, memoryStore } from '../helpers.js'

export const NOW = Date.parse('2026-10-17T08:35:00Z') // 14:05 IST
export const TODAY = '2026-10-17'
export const CTA = 'https://m91.msg91.com/signup'
export const LLMS = 'https://m91.msg91.com/llms.txt'
export const API_DOC = 'https://m91.msg91.com/docs/api.md'
export const ISSUE = 'https://github.com/example/agents/issues/1'
export const STORY_URL = 'https://news.example.com/s1'
export const REPO = 'https://github.com/MSG91/m91-skill'
export const SCRIPT = 'https://github.com/MSG91/m91-skill/blob/main/scripts/m91.sh'

export const config = (env = {}) => fakeConfig({ M91_CTA_URL: CTA, ...env })

export const FACTS = {
  can: [{ fact: 'Rings every phone in a channel at full volume until someone answers.', source_url: LLMS }],
  cannot: [{ fact: 'M91 does not execute the approved action itself.', source_url: API_DOC }],
  integrations: [{ name: 'm91.sh script', what_it_enables: 'Send alerts and approval requests from a shell or CI job.', source_url: API_DOC }]
}

/** A store seeded with today's facts, two clusters, two stories, a tutorial and style notes. */
export async function seededStore(opts = {}) {
  const store = memoryStore(opts)
  await store.createRecord({ type: 'm91_facts', payload: { ...FACTS, sources: [LLMS, API_DOC] }, status: 'current', date: TODAY })
  await store.createRecord({ type: 'question_cluster', status: 'open', topicGroup: 1, payload: {
    cluster_id: 'C-1', main_question: 'How do I make an AI agent wait for a human to approve a risky action?', related_questions: ['What happens if nobody answers the approval?'],
    topic_group: 1, reader_type: 'developer', intent: 'learn', freshness: 'this_week', demand: { level: 'high', reason: 'x' }, m91_fit: { score: 5, reason: 'x' },
    update_candidate: false, rank_score: 15, source_urls: [{ url: ISSUE, url_status: 'ok' }] } })
  await store.createRecord({ type: 'question_cluster', status: 'open', topicGroup: 2, payload: {
    cluster_id: 'C-2', main_question: 'How should payment failures page someone?', related_questions: [], topic_group: 2, reader_type: 'fintech_ops', intent: 'fix',
    freshness: 'ongoing', demand: { level: 'low', reason: 'x' }, m91_fit: { score: 3, reason: 'x' }, update_candidate: true, rank_score: 7, source_urls: [{ url: 'https://forum.example.com/pay' }] } })
  await store.createRecord({ type: 'story_lead', status: 'open', topicGroup: 2, payload: {
    story_id: 'S-1', title: 'Agent refunded the wrong customers', summary: 'x', why_it_matters: 'x', source_url: STORY_URL, source_name: 'Example News',
    published_date: '2026-10-15', attribution_line: 'reported by Example News', topic_group: 2 } })
  await store.createRecord({ type: 'story_lead', status: 'open', topicGroup: 4, payload: {
    story_id: 'S-2', title: 'Old pager outage', summary: 'x', why_it_matters: 'x', source_url: 'https://blog.example.com/old', source_name: 'Example Blog',
    published_date: '2026-09-25', attribution_line: 'described on Example Blog', topic_group: 4 } })
  await store.createRecord({ type: 'tutorial_lead', status: 'open', topicGroup: 1, payload: {
    tutorial_id: 'T-1', title: 'How to make Claude Code ask you before it deploys', target: 'Claude Code', reader_outcome: 'Deploys wait for a yes.',
    supporting_facts: [{ fact: 'Has a shell script', source_url: SCRIPT }],
    steps_outline: [{ step: 'Install the skill', source_url: REPO }, { step: 'Call m91.sh from the hook', source_url: SCRIPT }],
    gaps: ['Retry policy is not documented'], topic_group: 1 } })
  await store.createRecord({ type: 'tone_profile', status: 'current', topicGroup: 1, date: TODAY, payload: {
    profile_id: 'P-1', topic: 'x', topic_group: 1, kind: 'style_notes', based_on: [{ title: 'Clear guide', url: 'https://blog.example.com/a', engagement_signal: 'x' }],
    notes: { opening_pattern: 'Answer first.', sentence_length: 'Short.', paragraph_style: 'x', explanation_style: 'x', examples: 'x', headings: 'x', avoid: ['hooks'] } } })
  return store
}

/** A brief that passes every check against seededStore() for the C-1 question lead. */
export function validBrief(over = {}) {
  return {
    post_type: 'question',
    lead: { kind: 'cluster', id: 'C-1' },
    why_today: 'Developers are asking this now.',
    titles: ['How to make your AI agent wait for a human yes', 'Stop agents acting before a person approves', 'Agent approvals when nobody answers'],
    keyword: 'ai agent human approval',
    supporting_keywords: ['agent approval', 'human in the loop', 'approval timeout'],
    topic_group: 1,
    reader: 'Developers building AI agents who need a person to approve risky steps.',
    intent: 'learn',
    format: 'guide',
    angle: 'Shows what happens when nobody answers, which most guides skip.',
    tone: { source: 'style_notes', profile_id: 'P-1', guidance: ['Answer first.', 'Short sentences.', 'No hooks.'] },
    outline: [
      { heading: 'How do I make an AI agent wait for a human to approve a risky action?', answer_first: 'Pause the action and ring a person.', points: ['pause'], source_urls: [ISSUE] },
      { heading: 'What happens if nobody answers the approval?', answer_first: 'Keep ringing until someone answers.', points: ['escalate'], source_urls: [LLMS] },
      { heading: 'Who acts on the decision?', answer_first: 'Your software does.', points: ['callback'], source_urls: [API_DOC] },
      { heading: 'Next steps', answer_first: 'Send a test alert.', points: ['cta'], source_urls: [] }
    ],
    questions: ['How do I make an AI agent wait for a human to approve a risky action?', 'What happens if nobody answers the approval?'],
    m91_facts_to_use: [{ fact: 'Rings every phone in a channel at full volume until someone answers.', source_url: LLMS }],
    claims_to_avoid: [...STANDING_CLAIMS],
    story: { use: false, story_id: '', attribution_line: '', source_url: '', how_to_use: '' },
    tutorial: { use: false, tutorial_id: '', target: '', reader_outcome: '', steps: [], gaps: [] },
    news: { is_news_based: false, outlet: '', published_date: '', claim_in_own_words: '', source_url: '' },
    sources: [{ url: ISSUE, what_it_supports: 'the question' }, { url: LLMS, what_it_supports: 'ringing until answered' }],
    cta: { text: 'Try M91.', url: CTA },
    review_flags: [],
    notes_for_writer: ['Not legal or compliance advice.'],
    interactive_ideas: [{ block_type: 'phone_ring_sim', why: 'Shows the approval call the reader is setting up.' }],
    internal_links: [],
    ...over
  }
}

/** Fake aiSend: answers[call] is a value, an Error, or (n) => value|Error; call = plan | repair | rebrief. */
export function fakeAi(answers = {}) {
  const requests = []
  const attempts = {}
  const fn = async (opts) => {
    const call = opts.threadId.match(/-(plan|repair|rebrief)-[a-z0-9]{4}$/)?.[1] ?? 'unknown'
    attempts[call] = (attempts[call] ?? 0) + 1
    requests.push({ call, ...opts })
    let a = answers[call] ?? validBrief()
    if (typeof a === 'function') a = a(attempts[call], opts)
    if (a instanceof Error) throw a
    return { content: structuredClone(a), threadId: opts.threadId, messageId: 'm', finishReason: 'completed', model: null, ms: 5, delivery: 'sync', recoveredFromHistory: false }
  }
  fn.requests = requests
  return fn
}
