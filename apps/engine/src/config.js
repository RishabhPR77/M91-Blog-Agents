// Loads and validates process.env into one frozen config object.
// Error messages name keys only — never values.

export const SERVICES = Object.freeze(['openai', 'anthropic', 'gemini'])
export const DELIVERIES = Object.freeze(['sync', 'rtlayer'])
export const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error'])
export const AGENTS = Object.freeze(['scout', 'strategist', 'writer', 'reviewer', 'promo'])

// From ai.md "Choosing the model" (fetched 2026-10-17; list confirmed by viaSocket on 2026-10-14).
export const MODELS = Object.freeze({
  openai: Object.freeze(['gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini']),
  anthropic: Object.freeze(['claude-opus-4-7', 'claude-sonnet-4-6']),
  gemini: Object.freeze(['gemini-2.5-pro', 'gemini-2.5-flash'])
})

// Values that must never be printed. Webhook URLs count: their script_id is a credential.
export const SECRET_KEYS = Object.freeze([
  'VIASOCKET_EMBED_SECRET',
  'MEM0_API_KEY',
  'WEBHOOK_SHARED_KEY',
  'PIPELINE_TRIGGER_KEY',
  'DASHBOARD_PASSWORD',
  'EMBARKO_DEPLOY_TOKEN',
  'SLACK_POST_WEBHOOK_URL',
  'M91_ALERT_WEBHOOK_URL'
])

const DEFAULTS = {
  VIASOCKET_API_BASE: 'https://flow-api.viasocket.com/',
  VIASOCKET_SYSTEM_USER_ID: 'm91-blog-engine',
  SCOUT_AI_SERVICE: 'openai', SCOUT_AI_MODEL: 'gpt-5-mini', SCOUT_DELIVERY: 'sync',
  STRATEGIST_AI_SERVICE: 'openai', STRATEGIST_AI_MODEL: 'gpt-5.6-luna', STRATEGIST_DELIVERY: 'sync',
  WRITER_AI_SERVICE: 'gemini', WRITER_AI_MODEL: 'gemini-2.5-flash', WRITER_DELIVERY: 'rtlayer',
  REVIEWER_AI_SERVICE: 'openai', REVIEWER_AI_MODEL: 'gpt-5.5', REVIEWER_DELIVERY: 'rtlayer',
  PROMO_AI_SERVICE: 'openai', PROMO_AI_MODEL: 'gpt-5-mini', PROMO_DELIVERY: 'sync',
  MEM0_AGENT_ID: 'm91-blog',
  M91_DOCS_URL: 'https://m91.msg91.com/llms.txt',
  PASS_SCORE_MIN: '85', PASS_AREA_MIN: '7',
  MAX_WRITER_REVISIONS: '2', MAX_STRATEGIST_REBRIEFS: '1', MAX_SCOUT_RETRIES: '1', MAX_AI_ROUNDS_PER_POST: '5',
  TARGET_WORDS_MIN: '700', TARGET_WORDS_MAX: '1500',
  DEFAULT_TONE: 'friendly-teacher', TIMEZONE: 'Asia/Kolkata',
  AUTO_PUBLISH: 'false', DRY_RUN: 'false', LOG_LEVEL: 'info',
  AI_RTLAYER_TIMEOUT_MS: '300000', AI_POLL_INTERVAL_MS: '3000', AI_MAX_RETRIES: '3',
  // Phase 2: Scout
  SCOUT_RESEARCH_DELIVERY: 'rtlayer', SCOUT_MAX_CALLS: '14', SCOUT_REUSE_HOURS: '24', SCOUT_MIN_OPEN_CLUSTERS: '5',
  SCOUT_QUESTIONS_PER_GROUP: '8', SCOUT_QUESTION_GROUPS: '1,2,3,4,5', STORY_LOOKBACK_DAYS: '30', RAPID_RESPONSE_DAYS: '7', STYLE_REUSE_DAYS: '14',
  // viaSocket refuses a `message` over 50,000 characters; the docs bundle must leave room for the rest.
  DOCS_MAX_PAGES: '15', DOCS_MAX_CHARS: '45000', M91_DOCS_HOSTS: 'm91.msg91.com', DEDUPE_SIMILARITY: '0.85',
  URL_CHECK_TIMEOUT_MS: '10000',
  // Phase 4: Writer
  WRITER_MAX_REPAIRS: '1', WRITER_REVISION_INPUT: 'context', TUTORIAL_SOURCE_MAX_CHARS: '40000', SLACK_POST_DRAFTS: 'false',
  READING_GRADE_HARD_MARGIN: '2', WORDS_HARD_MARGIN_PCT: '20', SLACK_CHUNK_CHARS: '2800',
  // Phase 5: Reviewer, lessons, promo pack
  REVIEWER_MAX_SOURCE_CHECKS: '5', REVIEW_FEEDBACK_MAX_ITEMS: '8', LESSONS_PER_REVIEW_MAX: '3',
  SLACK_POST_APPROVED: 'true', PROMO_LINKEDIN_MAX_CHARS: '1300', PROMO_X_POST_MAX_CHARS: '270',
  // Phase 5.5: human approval gate
  MAX_HUMAN_REVISIONS: '5', REREVIEW_AFTER_HUMAN: 'true', M91_NOTIFY_ON_AWAITING: 'false',
  // Phase 3.5: dashboard API
  DASHBOARD_PORT: '5173', DASHBOARD_AUTH: 'false', PORT: '8080',
  // Designer (Phase 8) and blog + Embarko (Phase 7)
  DESIGNER_AI_SERVICE: 'openai', DESIGNER_AI_MODEL: 'gpt-5.6-luna', DESIGNER_DELIVERY: 'rtlayer',
  BLOG_APP_NAME: 'm91-blog', BLOG_BASE_URL: 'https://m91-blog.embarko.app', NOINDEX_FIRST_N_POSTS: '10',
  // Phase 3: Strategist
  STRATEGIST_MAX_REPAIRS: '1', RECENT_BRIEFS_WINDOW: '10', TITLE_MAX_CHARS: '70', KEYWORD_MAX_WORDS: '6', OUTLINE_MIN_SECTIONS: '4',
  OUTLINE_MAX_SECTIONS: '8', MIN_QUESTION_HEADINGS: '3', LESSONS_LIMIT: '5', ALLOW_UPDATE_BRIEFS: 'false',
  READING_GRADE_INTRO_MAX: '6', READING_GRADE_POST_MAX: '8',
  M91_SKILL_REPO_URL: 'https://github.com/MSG91/m91-skill',
  COMPETITORS: 'withHuman, PagerDuty, Opsgenie, Twilio A2H, Pushover'
}

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    this.name = 'ConfigError'
    this.problems = problems
  }
}

export function loadConfig(env = process.env) {
  const problems = []
  const raw = (key) => {
    const value = env[key]
    if (value === undefined || value.trim() === '') return DEFAULTS[key]
    return value.trim()
  }
  // An unquoted ".env" value followed by "# note" can arrive with the note attached.
  const looksCommented = (value) => /\s#/.test(value)

  const str = (key, { required = false } = {}) => {
    const value = raw(key)
    if (value === undefined) {
      if (required) problems.push(`${key}: missing`)
      return undefined
    }
    return value
  }
  const oneOf = (key, allowed) => {
    const value = str(key, { required: true })
    if (value === undefined) return undefined
    if (!allowed.includes(value)) {
      problems.push(`${key}: must be one of ${allowed.join(' | ')}${looksCommented(value) ? ' (looks like an inline "# comment" — move it to its own line)' : ''}`)
      return undefined
    }
    return value
  }
  const int = (key, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const value = str(key, { required: true })
    if (value === undefined) return undefined
    if (!/^-?\d+$/.test(value)) {
      problems.push(`${key}: must be a whole number${looksCommented(value) ? ' (looks like an inline "# comment")' : ''}`)
      return undefined
    }
    const n = Number(value)
    if (n < min || n > max) {
      problems.push(`${key}: must be between ${min} and ${max}`)
      return undefined
    }
    return n
  }
  const bool = (key) => {
    const value = str(key, { required: true })
    if (value === undefined) return undefined
    if (value !== 'true' && value !== 'false') {
      problems.push(`${key}: must be true or false`)
      return undefined
    }
    return value === 'true'
  }
  const num = (key, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const value = str(key, { required: true })
    if (value === undefined) return undefined
    if (!/^\d+(\.\d+)?$/.test(value) || Number(value) < min || Number(value) > max) {
      problems.push(`${key}: must be a number between ${min} and ${max}`)
      return undefined
    }
    return Number(value)
  }
  const questionGroups = () => {
    const groups = list('SCOUT_QUESTION_GROUPS')
    if (!groups.length || groups.some((g) => !/^[1-5]$/.test(g))) {
      problems.push('SCOUT_QUESTION_GROUPS: must be a comma-separated list of topic groups 1–5')
      return undefined
    }
    return [...new Set(groups.map(Number))].sort()
  }
  const list = (key) => (str(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const url = (key, { required = false } = {}) => {
    const value = str(key, { required })
    if (value === undefined) return undefined
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol')
    } catch {
      problems.push(`${key}: must be an http(s) URL`)
      return undefined
    }
    return value
  }

  const agent = (name) => {
    const prefix = name.toUpperCase()
    const service = oneOf(`${prefix}_AI_SERVICE`, SERVICES)
    const model = str(`${prefix}_AI_MODEL`, { required: true })
    if (service && model && !MODELS[service].includes(model)) {
      problems.push(`${prefix}_AI_MODEL: not in ai.md's "Choosing the model" list for service ${service} (allowed: ${MODELS[service].join(', ')})`)
    }
    const delivery = oneOf(`${prefix}_DELIVERY`, DELIVERIES)
    return { service, model, delivery }
  }

  const dryRun = bool('DRY_RUN')
  const writerFallback = () => {
    const service = str('WRITER_FALLBACK_SERVICE')
    const model = str('WRITER_FALLBACK_MODEL')
    if (!service && !model) return { fallbackService: undefined, fallbackModel: undefined }
    if (!service || !model) {
      problems.push(`${service ? 'WRITER_FALLBACK_MODEL' : 'WRITER_FALLBACK_SERVICE'}: set both WRITER_FALLBACK_SERVICE and WRITER_FALLBACK_MODEL, or neither`)
      return {}
    }
    if (!SERVICES.includes(service)) {
      problems.push(`WRITER_FALLBACK_SERVICE: must be one of ${SERVICES.join(' | ')}`)
      return {}
    }
    if (!MODELS[service].includes(model)) {
      problems.push(`WRITER_FALLBACK_MODEL: not in ai.md's "Choosing the model" list for service ${service}`)
      return {}
    }
    return { fallbackService: service, fallbackModel: model }
  }
  const dashboardAuth = bool('DASHBOARD_AUTH')
  const timezone = str('TIMEZONE', { required: true })
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone })
    } catch {
      problems.push('TIMEZONE: not a valid IANA time zone')
    }
  }

  const config = {
    viasocket: {
      orgId: str('VIASOCKET_ORG_ID', { required: true }),
      projectId: str('VIASOCKET_PROJECT_ID', { required: true }),
      embedSecret: str('VIASOCKET_EMBED_SECRET', { required: true }),
      apiBase: url('VIASOCKET_API_BASE', { required: true })?.replace(/\/+$/, ''),
      systemUserId: str('VIASOCKET_SYSTEM_USER_ID', { required: true }),
      rtlayerTimeoutMs: int('AI_RTLAYER_TIMEOUT_MS', { min: 1000 }),
      pollIntervalMs: int('AI_POLL_INTERVAL_MS', { min: 100 }),
      maxRetries: int('AI_MAX_RETRIES', { max: 10 })
    },
    scout: {
      ...agent('scout'),
      researchDelivery: oneOf('SCOUT_RESEARCH_DELIVERY', DELIVERIES),
      maxCalls: int('SCOUT_MAX_CALLS', { min: 1, max: 100 }),
      reuseHours: int('SCOUT_REUSE_HOURS'),
      minOpenClusters: int('SCOUT_MIN_OPEN_CLUSTERS'),
      questionsPerGroup: int('SCOUT_QUESTIONS_PER_GROUP', { min: 1, max: 50 }),
      // Which topic groups get a question call (fewer = fewer AI credits, e.g. "1" for tests).
      questionGroups: questionGroups(),
      storyLookbackDays: int('STORY_LOOKBACK_DAYS', { min: 1 }),
      rapidResponseDays: int('RAPID_RESPONSE_DAYS', { min: 0 }),
      styleReuseDays: int('STYLE_REUSE_DAYS'),
      docsMaxPages: int('DOCS_MAX_PAGES', { min: 1 }),
      docsMaxChars: int('DOCS_MAX_CHARS', { min: 1000, max: 48000 }),
      docsHosts: list('M91_DOCS_HOSTS').map((h) => h.toLowerCase()),
      dedupeSimilarity: num('DEDUPE_SIMILARITY', { min: 0, max: 1 }),
      urlCheckTimeoutMs: int('URL_CHECK_TIMEOUT_MS', { min: 100 }),
      competitors: list('COMPETITORS')
    },
    strategist: {
      ...agent('strategist'),
      maxRepairs: int('STRATEGIST_MAX_REPAIRS', { max: 5 }),
      recentBriefsWindow: int('RECENT_BRIEFS_WINDOW', { min: 2, max: 100 }),
      titleMaxChars: int('TITLE_MAX_CHARS', { min: 20, max: 200 }),
      keywordMaxWords: int('KEYWORD_MAX_WORDS', { min: 2, max: 12 }),
      outlineMinSections: int('OUTLINE_MIN_SECTIONS', { min: 1, max: 20 }),
      outlineMaxSections: int('OUTLINE_MAX_SECTIONS', { min: 1, max: 20 }),
      minQuestionHeadings: int('MIN_QUESTION_HEADINGS', { max: 20 }),
      lessonsLimit: int('LESSONS_LIMIT', { max: 50 }),
      allowUpdateBriefs: bool('ALLOW_UPDATE_BRIEFS')
    },
    writer: {
      ...agent('writer'),
      ...writerFallback(),
      maxRepairs: int('WRITER_MAX_REPAIRS', { max: 5 }),
      revisionInput: oneOf('WRITER_REVISION_INPUT', ['context', 'full']),
      // At most 48000: the tutorial text travels in the message, which viaSocket caps at 50,000 characters.
      tutorialSourceMaxChars: int('TUTORIAL_SOURCE_MAX_CHARS', { min: 1000, max: 48000 }),
      postDrafts: bool('SLACK_POST_DRAFTS')
    },
    reviewer: {
      ...agent('reviewer'),
      maxSourceChecks: int('REVIEWER_MAX_SOURCE_CHECKS', { max: 20 }),
      feedbackMaxItems: int('REVIEW_FEEDBACK_MAX_ITEMS', { min: 1, max: 30 }),
      lessonsPerReviewMax: int('LESSONS_PER_REVIEW_MAX', { max: 10 })
    },
    promo: {
      ...agent('promo'),
      linkedinMaxChars: int('PROMO_LINKEDIN_MAX_CHARS', { min: 100, max: 3000 }),
      xPostMaxChars: int('PROMO_X_POST_MAX_CHARS', { min: 50, max: 280 })
    },
    mem0: {
      apiKey: str('MEM0_API_KEY', { required: true }),
      // Not used by the v3 SDK (the API key is project-scoped); kept for reference.
      orgId: str('MEM0_ORG_ID'),
      projectId: str('MEM0_PROJECT_ID'),
      agentId: str('MEM0_AGENT_ID', { required: true })
    },
    notify: {
      // Optional here; notify.js refuses a real send when they are missing.
      slackWebhookUrl: url('SLACK_POST_WEBHOOK_URL'),
      m91WebhookUrl: url('M91_ALERT_WEBHOOK_URL'),
      sharedKey: str('WEBHOOK_SHARED_KEY'),
      chunkChars: int('SLACK_CHUNK_CHARS', { min: 500, max: 3900 }),
      postApproved: bool('SLACK_POST_APPROVED')
    },
    m91: {
      docsUrl: url('M91_DOCS_URL', { required: true }),
      ctaUrl: url('M91_CTA_URL'),
      skillRepoUrl: url('M91_SKILL_REPO_URL', { required: true })
    },
    approval: {
      maxHumanRevisions: int('MAX_HUMAN_REVISIONS', { max: 50 }),
      rereviewAfterHuman: bool('REREVIEW_AFTER_HUMAN'),
      notifyOnAwaiting: bool('M91_NOTIFY_ON_AWAITING')
    },
    gates: {
      passScoreMin: int('PASS_SCORE_MIN', { min: 0, max: 100 }),
      passAreaMin: int('PASS_AREA_MIN', { min: 0, max: 10 })
    },
    limits: {
      maxWriterRevisions: int('MAX_WRITER_REVISIONS'),
      maxStrategistRebriefs: int('MAX_STRATEGIST_REBRIEFS'),
      maxScoutRetries: int('MAX_SCOUT_RETRIES'),
      maxAiRoundsPerPost: int('MAX_AI_ROUNDS_PER_POST', { min: 1 })
    },
    content: {
      targetWordsMin: int('TARGET_WORDS_MIN', { min: 1 }),
      targetWordsMax: int('TARGET_WORDS_MAX', { min: 1 }),
      defaultTone: str('DEFAULT_TONE', { required: true }),
      readingGradeIntroMax: int('READING_GRADE_INTRO_MAX', { min: 1, max: 20 }),
      readingGradePostMax: int('READING_GRADE_POST_MAX', { min: 1, max: 20 }),
      readingGradeHardMargin: num('READING_GRADE_HARD_MARGIN', { min: 0, max: 10 }),
      wordsHardMarginPct: int('WORDS_HARD_MARGIN_PCT', { max: 100 }),
      timezone
    },
    runtime: {
      autoPublish: bool('AUTO_PUBLISH'),
      dryRun,
      triggerKey: str('PIPELINE_TRIGGER_KEY'),
      logLevel: oneOf('LOG_LEVEL', LOG_LEVELS)
    },
    server: {
      port: int('PORT', { min: 1, max: 65535 })
    },
    dashboard: {
      // Used by the Phase 6 dashboard dev server (it proxies /api to PORT).
      port: int('DASHBOARD_PORT', { min: 1, max: 65535 }),
      auth: dashboardAuth,
      password: str('DASHBOARD_PASSWORD', { required: dashboardAuth === true })
    },
    // Used from Phase 8 (validated now).
    designer: agent('designer'),
    // Blog + Embarko, used from Phase 7. The deploy token is optional until then.
    blog: {
      appName: str('BLOG_APP_NAME', { required: true }),
      baseUrl: url('BLOG_BASE_URL', { required: true })?.replace(/\/+$/, ''),
      embarkoDeployToken: str('EMBARKO_DEPLOY_TOKEN'),
      noindexFirstNPosts: int('NOINDEX_FIRST_N_POSTS', { max: 1000 })
    }
  }

  const { outlineMinSections, outlineMaxSections, minQuestionHeadings } = config.strategist
  if (outlineMinSections !== undefined && outlineMaxSections !== undefined && outlineMinSections > outlineMaxSections) {
    problems.push('OUTLINE_MIN_SECTIONS: must not be greater than OUTLINE_MAX_SECTIONS')
  }
  if (minQuestionHeadings !== undefined && outlineMaxSections !== undefined && minQuestionHeadings > outlineMaxSections) {
    problems.push('MIN_QUESTION_HEADINGS: must not be greater than OUTLINE_MAX_SECTIONS')
  }
  const { targetWordsMin, targetWordsMax } = config.content
  if (targetWordsMin !== undefined && targetWordsMax !== undefined && targetWordsMin > targetWordsMax) {
    problems.push('TARGET_WORDS_MIN: must not be greater than TARGET_WORDS_MAX')
  }

  if (problems.length) throw new ConfigError(problems)

  const secrets = SECRET_KEYS.map((key) => env[key]?.trim()).filter((v) => v && v.length >= 4)
  Object.defineProperty(config, 'secretValues', { value: Object.freeze(secrets), enumerable: false })
  return deepFreeze(config)
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value)
  }
  return Object.freeze(obj)
}

let cached
/** The one frozen config for this process, loaded from process.env on first use. */
export function getConfig() {
  cached ??= loadConfig(process.env)
  return cached
}
