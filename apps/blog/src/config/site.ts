// PUBLIC constants only. The blog reads no .env value and no secret: everything here ships in the HTML.

// The canonical site address. It must equal BLOG_BASE_URL in the engine's .env: the Publisher reads this
// line and refuses to publish if the two differ. Keep it on one line, in this exact form.
export const SITE_URL = 'https://m91-blog.embarko.app'

// Base path, for a later move under /blog on M91's own domain. '/' today.
export const BASE_PATH = '/'

export const SITE = {
  name: 'M91 Blog',
  title: 'M91 Blog: getting a human decision when software needs one',
  // Meta description only (search results, RSS, llms.txt); the home page shows no subtitle.
  description: 'Notes on getting a real person to answer when software or an AI agent needs a decision: approvals, on-call alerts and escalation.',
  author: 'The M91 team',
  publisher: 'M91',
  locale: 'en'
} as const

// The M91 product site: the logo, the footer links and every call to action point here.
export const M91_URL = 'https://m91.msg91.com/'
export const CTA = {
  text: 'Try M91',
  title: 'Get a real answer when your software needs one',
  body: 'M91 rings a person’s phone through silent mode until someone answers, then sends the decision back to your software.'
} as const

// The home page's heading, as on the M91 site's blog section.
export const HOME = { eyebrow: 'Blog', title: 'Notes on waking people up.' } as const

// Links of the M91 site's header and footer (m91.msg91.com), so the blog reads as part of it.
const m91 = (path: string) => new URL(path, M91_URL).href
export const M91_LINKS = {
  how: m91('#how'),
  cases: m91('#cases'),
  features: m91('#features'),
  integrations: m91('#integrations'),
  pricing: m91('#pricing'),
  docs: m91('docs.html?doc=overview.md'),
  llms: 'https://m91-api.msg91.com/llms.txt',
  skill: 'https://github.com/MSG91/m91-skill',
  contact: 'mailto:support@msg91.com',
  msg91: 'https://msg91.com',
  abuse: 'mailto:abuse@msg91.com',
  terms: 'https://msg91.com/terms',
  privacy: 'https://msg91.com/privacy',
  antiSpam: 'https://msg91.com/no-spam',
  appStore: 'https://apps.apple.com/app/id6759090472',
  googlePlay: 'https://play.google.com/store/apps/details?id=com.msg91.m91'
} as const

// The M91 site's "Copy setup prompt" text (its closing call to action), word for word.
export const SETUP_PROMPT = `Set up M91 alerting in this project, so a real person gets woken when something breaks.

Read https://m91-api.msg91.com/llms.txt and follow it. Nothing to install.
Start with quickstart.md, then playbook.md, before writing any code.

My send link — ask me for it. It is a live credential, so store it the way this project already stores its secrets, never in source.

Faster, if your tools let you install one:
npx skills add MSG91/m91-skill --skill m91-alerting -g`

// The five topic groups of the engine (topic_group 1–5): each card's label. There are no topic pages: readers search.
export const TOPICS = [
  { group: 1, slug: 'human-approval-for-ai-agents', name: 'Human approval for AI agents', short: 'AI agents', description: 'Pausing an AI agent until a person approves the risky step.' },
  { group: 2, slug: 'fintech-and-payments', name: 'Fintech and payments', short: 'Fintech', description: 'Alerts and approvals for payments, refunds and money movement.' },
  { group: 3, slug: 'on-call-and-opsgenie', name: 'On-call and Opsgenie', short: 'On-call', description: 'On-call alerting, and moving off Opsgenie before support ends.' },
  { group: 4, slug: 'alerting-best-practices', name: 'Alerting best practices', short: 'Best practices', description: 'What is worth waking someone for, and how to say it.' },
  { group: 5, slug: 'comparisons', name: 'Comparisons', short: 'Comparisons', description: 'M91 next to PagerDuty, Pushover, Slack groups and building it yourself.' }
] as const
