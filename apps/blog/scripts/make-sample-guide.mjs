// node scripts/make-sample-guide.mjs — writes apps/blog/samples/sample-guide-refund-approval.json: a sample guide that uses every component.
// The post's Markdown is the same text as the guide's Writer parts (prose, steps, questions, problems, table).
import { writeFileSync } from 'node:fs'

const out = new URL(`../samples/sample-guide-refund-approval.json`, import.meta.url)
const slug = 'sample-guide-refund-approval'
const prose = (id, markdown) => ({ type: 'prose', id, data: { markdown } })

const P = {
  intro: 'An AI agent that can refund customers can also refund the wrong customer. One approval step lets a person check a refund before the money moves.',
  problem1: 'Refunds are hard to undo. Once the money leaves, getting it back takes time and trust.',
  problem2: 'A chat message can sit unread for hours. A ringing phone gets attention in seconds.',
  how: 'The agent pauses before the refund and asks one person. The person approves or rejects. The agent reads the answer and carries on.',
  setup: 'Add the approval step where your agent decides to refund. Test it with your own phone first.',
  table: '| Route | Who sees it | How fast |\n| --- | --- | --- |\n| Slack group | Anyone who looks | When someone looks |\n| Pager | The person on call | Minutes |\n| Phone call | One named person | Seconds |',
  next: 'Pick one refund rule, add the pause, and try it with a small amount.'
}
const steps = [
  'Choose the refund rule that needs a person, for example refunds above a limit you set.',
  'Send the approval request with a stable `customId` for the order.',
  'Wait for the decision, then refund or stop.'
]
const faq = [
  ['What if nobody answers?', 'Decide a timeout and a safe default, such as "do not refund".'],
  ['Can two people approve the same refund?', 'Use one stable `customId` per refund so the first answer wins.']
]
const problems = [
  ['The phone does not ring', 'Likely cause: the send link is wrong.', 'Fix: copy the send link again and store it as a secret.'],
  ['The agent refunds before the answer', 'Likely cause: the code does not wait for the decision.', 'Fix: read the decision first, then call the refund.']
]
const code = '{\n  "customId": "refund-1182",\n  "message": "Refund ₹48,000 to order #1182?"\n}'

const guide = {
  version: 1,
  title_accent: 'ask before',
  hero: { example: true, agent: 'Refund agent', request: 'Refund ₹48,000 to order #1182?', person: 'Priya, support lead', decision: 'approved', result: 'Refund sent, approved by Priya' },
  status_states: [
    { state: 'waiting', chapter: 'c1' },
    { state: 'ringing', chapter: 'c2' },
    { state: 'approved', chapter: 'c3' },
    { state: 'continuing', chapter: 'c4' }
  ],
  chapters: [
    { id: 'c1', number: 1, label: 'The problem', heading: 'Why a refund needs a person', components: [
      prose('g1', `${P.problem1}\n\n${P.problem2}`),
      { type: 'journey_steps', id: 'g2', data: { current: 2, steps: [
        { title: 'Agent decides', text_markdown: 'The agent wants to refund an order.' },
        { title: 'Agent pauses', text_markdown: 'It stops before the money moves.' },
        { title: 'A person decides', text_markdown: 'One person approves or rejects.' },
        { title: 'Agent continues', text_markdown: 'It refunds, or it stops.' }
      ] } },
      { type: 'comparison_table', id: 'g3', data: { caption: 'Three ways to reach the person who decides', markdown: P.table } }
    ] },
    { id: 'c2', number: 2, label: 'How it works', heading: 'What happens when the agent asks', components: [
      prose('g4', P.how),
      { type: 'phone_ring_sim', id: 'g5', data: { moments: [
        { state: 'waiting', actor: 'agent', markdown: 'Your agent pauses and asks for a decision.' },
        { state: 'ringing', actor: 'm91', markdown: 'M91 calls the person who decides.' },
        { state: 'approved', actor: 'human', markdown: 'The person taps Approve.' },
        { state: 'continuing', actor: 'software', markdown: 'Your agent reads the answer and refunds.' }
      ] } },
      { type: 'route_compare', id: 'g6', data: { caption: 'Three routes to the same answer', routes: [
        { name: 'Slack group', best_for: 'Questions that can wait', stops: ['Post the question', 'Someone notices', 'Someone replies', 'Agent reads the chat'] },
        { name: 'Pager', best_for: 'Outages', stops: ['Page on-call', 'They log in', 'Agent waits'] },
        { name: 'Phone call with M91', best_for: 'One decision from one person', stops: ['Phone rings', 'Person taps'], highlight: true }
      ] } }
    ] },
    { id: 'c3', number: 3, label: 'Try it', heading: 'Approve or reject a refund', components: [
      { type: 'approve_demo', id: 'g7', data: { example: true, request: 'Your agent wants to refund ₹48,000 to order #1182', context: 'Customer says the parcel never arrived.', approve: { label: 'Approve', outcome_markdown: 'The agent sends the refund and logs who approved it.' }, reject: { label: 'Reject', outcome_markdown: 'The agent does not refund and tells the support team why.' } } }
    ] },
    { id: 'c4', number: 4, label: 'Set it up', heading: 'Add the approval step', components: [
      prose('g8', P.setup),
      { type: 'steps_checklist', id: 'g9', data: { intro: 'Tap a number when you have done it.', steps: [
        { title: 'Pick the rule', markdown: steps[0] },
        { title: 'Send the request', markdown: steps[1], stuck: { cause_markdown: 'The request has no `customId`.', fix_markdown: 'Add one stable `customId` per order.' } },
        { title: 'Act on the answer', markdown: steps[2] }
      ] } },
      { type: 'tool_picker', id: 'g10', data: { question: 'Where does your agent run?', options: [
        { id: 'langgraph', label: 'LangGraph', steps: [{ markdown: 'Add a node before the refund node that sends the request.' }, { markdown: 'Make the refund node read the decision first.' }], done_markdown: 'You will know it worked when your phone rings before the refund.' },
        { id: 'http', label: 'Plain HTTP', steps: [{ markdown: 'Send the request from your server.' }, { markdown: 'Check the decision before you call the refund.' }], file: { filename: 'approval-request.json', language: 'json', what: 'The approval request for one refund.', code } }
      ] } },
      { type: 'file_card', id: 'g11', data: { filename: 'approval-request.json', language: 'json', what: 'Asks one person to approve this refund.', code, preview_lines: 3 } }
    ] },
    { id: 'c5', number: 5, label: 'Stuck?', heading: 'If something goes wrong', components: [
      { type: 'troubleshooting_picker', id: 'g12', data: { items: problems.map(([p, c, f]) => ({ problem_markdown: p, cause_markdown: c, fix_markdown: f })) } }
    ] },
    { id: 'c6', number: 6, label: 'Questions', heading: 'Questions', components: [
      { type: 'faq', id: 'g13', data: { items: faq.map(([q, a]) => ({ question_markdown: q, answer_markdown: a })) } },
      prose('g14', P.next)
    ] }
  ],
  your_turn: { title: 'Let your agent ask before it refunds.' }
}

const markdown = [
  P.intro,
  '## Why a refund needs a person', P.problem1, P.problem2, P.table,
  '## What happens when the agent asks', P.how,
  '## Add the approval step', P.setup, steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
  '## If something goes wrong', ...problems.flatMap(([p, c, f]) => [`### ${p}`, `${c}\n${f}`]),
  '## Questions', ...faq.flatMap(([q, a]) => [`### ${q}`, a]),
  P.next
].join('\n\n')

const post = {
  slug,
  title: 'Sample: how to make your AI agent ask before it refunds a customer',
  description: 'Sample guide for local development: one approval step, a phone that rings, and an answer your agent waits for.',
  tldr: ['A refund agent should ask a person before money moves.', 'A phone call gets an answer faster than a chat message.', 'Your agent reads the answer, then refunds or stops.'],
  published_at: '2026-10-21T09:00:00+05:30',
  updated_at: '2026-10-21T09:00:00+05:30',
  topic_group: 1,
  tags: ['ai agent approval', 'refunds', 'human in the loop'],
  reading_time_min: 6,
  markdown,
  blocks: null,
  seo: { title_tag: 'Sample: make your AI agent ask before a refund', meta_description: 'Sample guide: an approval step before an AI agent refunds a customer.', og_image: `https://m91-blog.embarko.app/og/${slug}.png` },
  sources: [{ url: 'https://m91.msg91.com/llms.txt', title: 'The M91 docs' }],
  related_slugs: [],
  noindex: false,
  canonical_url: `https://m91-blog.embarko.app/posts/${slug}/`,
  brief_id: 'sample-guide',
  version: 1,
  guide
}
writeFileSync(out, JSON.stringify(post, null, 2) + '\n')
console.log('wrote', out.pathname)
