// Fixtures for Writer tests. All content is made up; nothing touches the network.

import { readFileSync } from 'node:fs'
import { STANDING_CLAIMS } from '../../src/strategist/prompts.js'
import { fakeConfig, memoryStore } from '../helpers.js'

export const NOW = Date.parse('2026-10-18T08:35:00Z')
export const CTA = 'https://m91.msg91.com/signup'
export const ISSUE = 'https://github.com/example/agents/issues/1'
export const LLMS = 'https://m91.msg91.com/llms.txt'
export const REPO = 'https://github.com/MSG91/m91-skill'
export const SCRIPT = 'https://github.com/MSG91/m91-skill/blob/main/scripts/m91.sh'
export const BRIEF_ID = '261018-1400-ABCD'
export const GOOD_MD = readFileSync(new URL('../fixtures/good-post.md', import.meta.url), 'utf8')

export const config = (env = {}) => fakeConfig({ M91_CTA_URL: CTA, TARGET_WORDS_MIN: '180', TARGET_WORDS_MAX: '500', AI_MAX_RETRIES: '1', ...env })

export function brief(over = {}) {
  return {
    brief_id: BRIEF_ID, brief_version: 1, post_type: 'question', lead: { kind: 'cluster', id: 'C-1' },
    why_today: 'x', titles: ['How agent approval works with a phone call', 'b', 'c'],
    keyword: 'agent approval', supporting_keywords: ['human approval', 'phone alert', 'approval step'],
    topic_group: 1, reader: 'Developers', intent: 'learn', format: 'explainer', angle: 'x',
    tone: { source: 'default', profile_id: 'friendly-teacher', guidance: ['Answer first.'] },
    outline: [
      { heading: 'What is agent approval?', answer_first: 'A pause before a risky step.', points: [], source_urls: [ISSUE] },
      { heading: 'Why does the phone need to ring?', answer_first: 'It gets attention.', points: [], source_urls: [LLMS] },
      { heading: 'What happens after someone answers?', answer_first: 'The answer goes back.', points: [], source_urls: [] },
      { heading: 'How do I start?', answer_first: 'Start small.', points: [], source_urls: [] }
    ],
    questions: [], m91_facts_to_use: [{ fact: 'Rings every phone in a channel until someone answers.', source_url: LLMS }],
    claims_to_avoid: [...STANDING_CLAIMS],
    story: { use: false, story_id: '', attribution_line: '', source_url: '', how_to_use: '' },
    tutorial: { use: false, tutorial_id: '', target: '', reader_outcome: '', steps: [], gaps: [] },
    news: { is_news_based: false, outlet: '', published_date: '', claim_in_own_words: '', source_url: '' },
    sources: [{ url: ISSUE, what_it_supports: 'x' }, { url: LLMS, what_it_supports: 'x' }],
    cta: { text: 'Try M91: send your first alert in a few minutes.', url: CTA }, review_flags: [], notes_for_writer: [],
    interactive_ideas: [{ block_type: 'phone_ring_sim', why: 'shows the flow' }], internal_links: [],
    slug: 'how-agent-approval-works', date: '2026-10-18', word_target: { min: 180, max: 500 }, reading_level: { intro_max_grade: 6, post_max_grade: 8 },
    ...over
  }
}

export async function seededStore(briefOver = {}, opts = {}) {
  const store = memoryStore(opts)
  await store.createRecord({ type: 'brief', briefId: BRIEF_ID, payload: brief(briefOver), status: 'new', version: 1, topicGroup: 1 })
  return store
}

/** A valid writer_draft built from the good fixture post. */
export function draftAnswer(over = {}) {
  return {
    title: 'How agent approval works with a phone call',
    post_markdown: GOOD_MD,
    tldr: ['Agent approval pauses a risky action until a person says yes or no.', 'M91 rings the phone until someone answers.', 'Your software reads the answer and then acts.'],
    seo: { title_tag: 'How agent approval works with a phone call', meta_description: 'Agent approval pauses a risky step until a person answers a phone call and says yes or no.', slug_suggestion: 'agent-approval-phone-call', image_ideas: [{ description: 'A flow diagram', alt_text: 'Software asks, phone rings, person decides' }] },
    context: { summary: 'Explains agent approval with a phone call.', key_points: ['pause', 'ring', 'answer'], structure: ['What is agent approval?', 'Why does the phone need to ring?', 'What happens after someone answers?', 'How do I start?', 'What to do next'], m91_facts_used: ['rings until answered'], sources_used: [ISSUE, LLMS], story_used: 'none', open_issues: [] },
    revision_notes: [],
    ...over
  }
}

/** Fake aiSend: answers[call] is a value, an Error, or (n, opts) => value|Error; call = new | revise | repair. */
export function fakeAi(answers = {}, { model = 'gemini-2.5-flash' } = {}) {
  const requests = []
  const attempts = {}
  const fn = async (opts) => {
    const call = opts.threadId.match(/-(new|revise|repair)-[a-z0-9]{4}$/)?.[1] ?? 'unknown'
    attempts[call] = (attempts[call] ?? 0) + 1
    requests.push({ call, ...opts })
    let a = answers[call] ?? draftAnswer()
    if (typeof a === 'function') a = a(attempts[call], opts)
    if (a instanceof Error) throw a
    return { content: structuredClone(a), threadId: opts.threadId, messageId: 'm', finishReason: 'completed', model, ms: 5, delivery: 'rtlayer', recoveredFromHistory: false, parseFixes: [] }
  }
  fn.requests = requests
  return fn
}

/** URL checker: everything loads unless listed. */
export const okChecker = (statuses = {}) => ({ async check(url) { return statuses[url] ?? 'ok' } })
