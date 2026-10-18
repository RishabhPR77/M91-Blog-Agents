// Fixtures for Scout unit tests. All URLs and content are made up; nothing touches the network.

import { AiError, TruncatedError } from '../../src/viasocket.js'

export const DOC_INTRO = 'https://m91.msg91.com/docs/intro.md'
export const DOC_API = 'https://m91.msg91.com/docs/api.md'
export const LLMS = 'https://m91.msg91.com/llms.txt'
export const REPO = 'https://github.com/MSG91/m91-skill'

/** One valid answer per schema. */
export const VALID = {
  scout_m91_facts: {
    can: [{ fact: 'Rings a phone for approval', source_url: DOC_INTRO }, { fact: 'Has an HTTP API', source_url: 'http://m91.msg91.com/docs/api.md' }, { fact: 'Made up', source_url: 'https://elsewhere.example.com/x' }],
    cannot: [{ fact: 'No SMS fallback yet', source_url: DOC_API }],
    integrations: [{ name: 'HTTP API', what_it_enables: 'Trigger calls', source_url: DOC_API }],
    contradictions: [{ issue: 'Timeouts differ', source_urls: [DOC_INTRO, DOC_API] }]
  },
  scout_questions: {
    questions: [
      { question: 'How do I make my agent ask before deleting data?', source_url: 'https://forum.example.com/q1', source_type: 'reddit', demand_evidence: '120 upvotes', date_seen: '2026-10-15', reader_type: 'developer', intent: 'learn', m91_help: 'M91 can ring for approval.' },
      { question: 'What happens if nobody answers an alert?', source_url: 'https://dead.example.com/q2', source_type: 'search', demand_evidence: 'none visible', date_seen: 'unknown', reader_type: 'oncall_engineer', intent: 'fix', m91_help: 'not a fit' }
    ]
  },
  scout_stories: {
    stories: [
      { title: 'Agent refunded the wrong customers', summary: 'An agent issued refunds without review. Many were wrong.', why_it_matters: 'Shows the cost of no human check.', source_url: 'https://news.example.com/s1', source_name: 'Example News', published_date: '2026-10-14', attribution_line: 'reported by Example News', topic_group: 2 },
      { title: 'Old outage', summary: 'An old one.', why_it_matters: 'Old.', source_url: 'https://news.example.com/old', source_name: 'Example News', published_date: '2026-01-01', attribution_line: 'reported by Example News', topic_group: 3 },
      { title: 'Undated story', summary: 'No date given.', why_it_matters: 'Still relevant.', source_url: 'https://blog.example.com/s3', source_name: 'Example Blog', published_date: 'unknown', attribution_line: 'described on Example Blog', topic_group: 4 }
    ]
  },
  scout_tutorials: {
    tutorials: [
      { title: 'How to make Claude Code ask you on your phone before it deploys', target: 'Claude Code', reader_outcome: 'Deploys wait for your yes.', supporting_facts: [{ fact: 'Has an HTTP API', source_url: DOC_API }], steps_outline: [{ step: 'Install the skill', source_url: `${REPO}/blob/main/README.md` }, { step: 'Call the API', source_url: DOC_API }], gaps: ['Retry policy is not documented'], topic_group: 1 },
      { title: 'Unsupported tutorial', target: 'Cursor', reader_outcome: 'x', supporting_facts: [], steps_outline: [{ step: 'Do a thing', source_url: 'https://random.example.com/guide' }], gaps: [], topic_group: 1 }
    ]
  },
  scout_clusters: {
    clusters: [
      { main_question: 'How do I make my agent ask before deleting data?', related_questions: [], topic_group: 1, reader_type: 'developer', intent: 'learn', freshness: 'ongoing', demand: { level: 'high', reason: '120 upvotes' }, m91_fit: { score: 5, reason: 'Direct fit' }, source_urls: ['https://forum.example.com/q1'] }
    ]
  },
  scout_style: {
    topic: 'How do I make my agent ask before deleting data?',
    based_on: [{ url: 'https://blog.example.com/a1', title: 'Clear guide', engagement_signal: '300 claps' }],
    notes: { opening_pattern: 'Answers first.', sentence_length: 'Short.', paragraph_style: 'Two to three sentences.', explanation_style: 'Analogy then code.', examples: 'One small example.', headings: 'Questions as headings.', avoid: ['Clickbait hooks'] }
  },
  scout_sources: {
    claims: [
      { claim: 'M91 rings a phone for approval', results: [{ url: DOC_INTRO, publisher: 'M91 docs', verdict: 'supports', note: 'The docs say so.' }] },
      { claim: 'M91 was founded on the Moon', results: [] }
    ]
  }
}

/** One invalid answer per schema. */
export const INVALID = {
  scout_m91_facts: { can: [{ fact: 'x' }], cannot: [], integrations: [], contradictions: [] },
  scout_questions: { questions: [{ question: 'q', source_url: 'u', source_type: 'tiktok', demand_evidence: '', date_seen: '', reader_type: 'developer', intent: 'learn', m91_help: '' }] },
  scout_stories: { stories: [{ title: 't', summary: 's', why_it_matters: 'w', source_url: 'u', source_name: 'n', published_date: 'd', attribution_line: 'a', topic_group: 9 }] },
  scout_tutorials: { tutorials: [{ title: 't' }] },
  scout_clusters: { clusters: [{ main_question: 'q', extra: true }] },
  scout_style: { topic: 't', based_on: [], notes: {} },
  scout_sources: { claims: [{ claim: 'c', results: [{ url: 'u', publisher: 'p', verdict: 'maybe', note: 'n' }] }] }
}

export const CALL_RE = /-(facts|questions-[1-5]|stories|tutorials|clusters|style|sources)-[a-z0-9]{4}$/

/**
 * Fake aiSend. `answers[call]` is a value, an Error, or (n) => value|Error for the n-th attempt of that call.
 * Records every request in `.requests`.
 */
export function fakeAi(answers = {}) {
  const requests = []
  const attempts = {}
  const fn = async (opts) => {
    const call = opts.threadId.match(CALL_RE)?.[1] ?? 'unknown'
    const group = call.startsWith('questions') ? 'questions' : call
    attempts[call] = (attempts[call] ?? 0) + 1
    requests.push({ call, ...opts })
    let a = answers[call] ?? answers[group] ?? defaultAnswer(group)
    if (typeof a === 'function') a = a(attempts[call], opts)
    if (a instanceof Error) throw a
    return { content: structuredClone(a), threadId: opts.threadId, messageId: 'm', finishReason: 'completed', model: opts.delivery === 'rtlayer' ? 'gpt-5-mini' : null, ms: 5, delivery: opts.delivery }
  }
  fn.requests = requests
  fn.attempts = attempts
  return fn
}

function defaultAnswer(group) {
  return {
    facts: VALID.scout_m91_facts,
    questions: VALID.scout_questions,
    stories: VALID.scout_stories,
    tutorials: VALID.scout_tutorials,
    clusters: VALID.scout_clusters,
    style: VALID.scout_style,
    sources: VALID.scout_sources
  }[group]
}

/** Fake fetch for docs, the README and nothing else. */
export function fakeWeb({ llmsStatus = 200, readmeStatus = 200 } = {}) {
  const calls = []
  const fn = async (url) => {
    calls.push(url)
    const res = (status, text, type = 'text/markdown') => ({ ok: status < 400, status, headers: { get: () => type }, text: async () => text })
    if (url === LLMS) return llmsStatus === 200 ? res(200, `# M91\n- [Intro](${DOC_INTRO})\n- [API](http://m91.msg91.com/docs/api.md)\n- [Elsewhere](https://elsewhere.example.com/x)`) : res(llmsStatus, 'nope')
    if (url === DOC_INTRO) return res(200, 'M91 rings a phone.')
    if (url === DOC_API) return res(200, '<html><body><h1>API</h1><p>POST /call</p></body></html>', 'text/html')
    if (url.startsWith('https://api.github.com/repos/MSG91/m91-skill/readme')) return readmeStatus === 200 ? res(200, '# m91-skill\nInstall it.') : res(readmeStatus, '')
    return res(404, '')
  }
  fn.calls = calls
  return fn
}

/** URL checker: everything ok unless listed. */
export function fakeChecker(statuses = { 'https://dead.example.com/q2': 'dead' }) {
  const checked = []
  return {
    checked,
    async check(url) {
      checked.push(url)
      if (/google\.com\/search/.test(url)) return 'invalid'
      return statuses[url] ?? 'ok'
    }
  }
}

export const truncated = () => new TruncatedError({ content: '', finishReason: 'truncated' })
export const fatal = (kind = 'token') => new AiError(`fake ${kind} error`, { kind })
