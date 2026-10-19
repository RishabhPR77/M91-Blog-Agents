// PUBLIC constants only. The blog reads no .env value and no secret: everything here ships in the HTML.

// The canonical site address. It must equal BLOG_BASE_URL in the engine's .env: the Publisher reads this
// line and refuses to publish if the two differ. Keep it on one line, in this exact form.
export const SITE_URL = 'https://m91-blog.embarko.app'

// Base path, for a later move under /blog on M91's own domain. '/' today.
export const BASE_PATH = '/'

export const SITE = {
  name: 'M91 Blog',
  title: 'M91 Blog: getting a human decision when software needs one',
  description:
    'Plain guides on human approval for AI agents, on-call alerting and urgent decisions: how to make sure a real person answers when your software needs one.',
  author: 'The M91 team',
  publisher: 'M91',
  locale: 'en'
} as const

// The M91 product site: the logo, the footer links and every call to action point here.
export const M91_URL = 'https://m91-site.embarko.app/'
export const CTA = {
  text: 'Try M91',
  title: 'Get a real answer when your software needs one',
  body: 'M91 rings a person’s phone through silent mode until someone answers, then sends the decision back to your software.'
} as const

// The five topic groups of the engine (topic_group 1–5), each with its page slug.
export const TOPICS = [
  { group: 1, slug: 'human-approval-for-ai-agents', name: 'Human approval for AI agents', short: 'AI agents', description: 'Pausing an AI agent until a person approves the risky step.' },
  { group: 2, slug: 'fintech-and-payments', name: 'Fintech and payments', short: 'Fintech', description: 'Alerts and approvals for payments, refunds and money movement.' },
  { group: 3, slug: 'on-call-and-opsgenie', name: 'On-call and Opsgenie', short: 'On-call', description: 'On-call alerting, and moving off Opsgenie before support ends.' },
  { group: 4, slug: 'alerting-best-practices', name: 'Alerting best practices', short: 'Best practices', description: 'What is worth waking someone for, and how to say it.' },
  { group: 5, slug: 'comparisons', name: 'Comparisons', short: 'Comparisons', description: 'M91 next to PagerDuty, Pushover, Slack groups and building it yourself.' }
] as const

export const POSTS_PER_PAGE = 12
