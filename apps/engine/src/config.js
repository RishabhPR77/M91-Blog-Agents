// Loads and validates process.env into one frozen config object.
// Error messages name keys only — never values.

import { join } from 'node:path'
import { isValidHash } from './util/adminhash.js'

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
  'ADMIN_PASSWORD_HASH',
  'EMBARKO_DEPLOY_TOKEN',
  'SLACK_POST_WEBHOOK_URL',
  'M91_ALERT_WEBHOOK_URL',
  'DOCSTAR_API_KEY'
])

// Phase 11: where an approved post goes. none: nowhere (the Markdown export is the output); embarko: the
// Phase 7 blog; docstar: Docstar (the adapter answers "not configured" until the DOCSTAR_* keys are set).
export const PUBLISH_TARGETS = Object.freeze(['none', 'embarko', 'docstar'])

const DEFAULTS = {
  VIASOCKET_API_BASE: 'https://flow-api.viasocket.com/',
  VIASOCKET_SYSTEM_USER_ID: 'm91-blog-engine',
  SCOUT_AI_SERVICE: 'openai', SCOUT_AI_MODEL: 'gpt-5-mini', SCOUT_DELIVERY: 'sync',
  STRATEGIST_AI_SERVICE: 'openai', STRATEGIST_AI_MODEL: 'gpt-5.6-luna', STRATEGIST_DELIVERY: 'sync',
  WRITER_AI_SERVICE: 'gemini', WRITER_AI_MODEL: 'gemini-2.5-flash', WRITER_DELIVERY: 'rtlayer',
  REVIEWER_AI_SERVICE: 'openai', REVIEWER_AI_MODEL: 'gpt-5.5', REVIEWER_DELIVERY: 'rtlayer',
  PROMO_AI_SERVICE: 'openai', PROMO_AI_MODEL: 'gpt-5-mini', PROMO_DELIVERY: 'sync',
  // Phase 12: the Roadmap Planner (one call plans the learning path; one repair when the code checks fail).
  PLANNER_AI_SERVICE: 'openai', PLANNER_AI_MODEL: 'gpt-5.6-luna', PLANNER_DELIVERY: 'sync', PLANNER_MAX_REPAIRS: '1',
  // Phase 12: runs follow the approved roadmap. Timely lane: RAPID_RESPONSE_ENABLED=true means "news checks find
  // timely opportunities, the person decides"; a timely post is written only after Write now.
  ROADMAP_ENABLED: 'true', RAPID_RESPONSE_ENABLED: 'true',
  TIMELY_CHECK_ON_RUN: 'true', TIMELY_WINDOW_DAYS: '7', TIMELY_MAX_PER_WEEK: '1',
  MEM0_AGENT_ID: 'm91-blog',
  // Phase 9 A5: the Mem0 quota guard (an estimate kept in apps/engine/data/mem0-usage.json)
  MEM0_MONTHLY_LIMIT: '1000', MEM0_MONTHLY_ADD_LIMIT: '10000', MEM0_WARN_PCT: '80', MEM0_STOP_PCT: '95',
  M91_DOCS_URL: 'https://m91-api.msg91.com/llms.txt',
  PASS_SCORE_MIN: '80', PASS_AREA_MIN: '6',
  MAX_WRITER_REVISIONS: '2', MAX_STRATEGIST_REBRIEFS: '1', MAX_SCOUT_RETRIES: '1', MAX_AI_ROUNDS_PER_POST: '5',
  TARGET_WORDS_MIN: '500', TARGET_WORDS_MAX: '1200',
  DEFAULT_TONE: 'friendly-teacher', TIMEZONE: 'Asia/Kolkata',
  AUTO_PUBLISH: 'false', DRY_RUN: 'false', LOG_LEVEL: 'info',
  // Phase 9: the engine's local data folder (run lock, Mem0 usage) and when a run lock counts as stale
  ENGINE_DATA_DIR: '', RUN_LOCK_STALE_MIN: '10',
  AI_RTLAYER_TIMEOUT_MS: '300000', AI_POLL_INTERVAL_MS: '3000', AI_MAX_RETRIES: '3',
  // Phase 2: Scout
  SCOUT_RESEARCH_DELIVERY: 'rtlayer', SCOUT_MAX_CALLS: '14', SCOUT_REUSE_HOURS: '24', SCOUT_MIN_OPEN_CLUSTERS: '5',
  SCOUT_STORIES_TIMEOUT_MS: '480000',
  // The Scout's independent calls (question groups, stories, tutorials) run at the same time, at most this many;
  // the question groups' web searches get their own answer timeout
  SCOUT_CONCURRENCY: '7', SCOUT_QUESTIONS_TIMEOUT_MS: '420000',
  SCOUT_QUESTIONS_PER_GROUP: '8', SCOUT_QUESTION_GROUPS: '1,2,3,4,5', STORY_LOOKBACK_DAYS: '30', RAPID_RESPONSE_DAYS: '7', STYLE_REUSE_DAYS: '14',
  // viaSocket refuses a `message` over 50,000 characters; the docs bundle must leave room for the rest.
  DOCS_MAX_PAGES: '15', DOCS_MAX_CHARS: '45000', M91_DOCS_HOSTS: 'm91-api.msg91.com,m91.msg91.com', DEDUPE_SIMILARITY: '0.85',
  // Phase 9 A3: duplicate checks in memory (trigram similarity) or with a Mem0 search
  DEDUPE_MODE: 'local', DEDUPE_SIMILARITY_LOCAL: '0.65',
  URL_CHECK_TIMEOUT_MS: '10000',
  // Phase 4: Writer
  WRITER_MAX_REPAIRS: '1', WRITER_REVISION_INPUT: 'context', TUTORIAL_SOURCE_MAX_CHARS: '40000', SLACK_POST_DRAFTS: 'false',
  READING_GRADE_HARD_MARGIN: '0', SENTENCE_MAX_WORDS: '20', SENTENCE_HARD_MAX_WORDS: '25', PARAGRAPH_MAX_SENTENCES: '3', WORDS_HARD_MARGIN_PCT: '20', SLACK_CHUNK_CHARS: '2800',
  // Phase 5: Reviewer, lessons, promo pack
  REVIEWER_MAX_SOURCE_CHECKS: '5', REVIEW_FEEDBACK_MAX_ITEMS: '8', LESSONS_PER_REVIEW_MAX: '3',
  SLACK_POST_APPROVED: 'true', PROMO_LINKEDIN_MAX_CHARS: '1300', PROMO_X_POST_MAX_CHARS: '270',
  // Phase 5.5: human approval gate
  // Phase 7: Mem0 read cache, Publisher and Embarko
  STORE_CACHE_TTL_MS: '30000',
  EMBARKO_API_BASE: 'https://ship.embarko.ai', EMBARKO_AGENT_NAME: 'm91-blog-engine', BLOG_BUILD_TIMEOUT_MS: '300000', PUBLISH_VERIFY_TIMEOUT_MS: '120000',
  MAX_HUMAN_REVISIONS: '5', REREVIEW_AFTER_HUMAN: 'true', M91_NOTIFY_ON_AWAITING: 'false',
  // TEST-ONLY CLI commands (npm run test:await); never available through the API
  ALLOW_TEST_COMMANDS: 'false',
  // Phase 3.5: dashboard API
  DASHBOARD_PORT: '5173', DASHBOARD_AUTH: 'false', PORT: '8080',
  // Phase 10: the Experience Designer (writes the guide's interactive parts, before the Reviewer); the promo
  // pack is off unless PROMO_ENABLED=true. Blog + Embarko (Phase 7).
  EXPERIENCE_AI_SERVICE: 'anthropic', EXPERIENCE_AI_MODEL: 'claude-sonnet-4-6', EXPERIENCE_DELIVERY: 'rtlayer',
  EXPERIENCE_MAX_REPAIRS: '1', EXPERIENCE_MAX_COMPONENTS: '10', MAX_DESIGNER_REVISIONS: '2', INTERACTIVE_DEFAULT: 'true',
  PROMO_ENABLED: 'false',
  // Phase 11 (fallback plan): the Experience Designer is off and nothing is published; the reviewed draft becomes a
  // Markdown file (apps/engine/exports unless EXPORT_DIR is set). Docstar is filled in once its keys exist.
  EXPERIENCE_ENABLED: 'false', PUBLISH_TARGET: 'none', EXPORT_DIR: '',
  DOCSTAR_API_URL: '', DOCSTAR_API_KEY: '', DOCSTAR_COLLECTION_ID: '',
  BLOG_APP_NAME: 'm91-blog', BLOG_BASE_URL: 'https://m91-blog.embarko.app', NOINDEX_FIRST_N_POSTS: '10',
  // Phase 3: Strategist
  STRATEGIST_MAX_REPAIRS: '1', RECENT_BRIEFS_WINDOW: '10', TITLE_MAX_CHARS: '70', KEYWORD_MAX_WORDS: '6', OUTLINE_MIN_SECTIONS: '4',
  OUTLINE_MAX_SECTIONS: '8', MIN_QUESTION_HEADINGS: '3', LESSONS_LIMIT: '5', ALLOW_UPDATE_BRIEFS: 'false',
  READING_GRADE_INTRO_MAX: '6', READING_GRADE_POST_MAX: '7',
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
    // An empty default (Phase 11: DOCSTAR_API_URL until Docstar is set up) means "not set".
    if (value === undefined || value === '') return undefined
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
      // A model name is not a secret: show what was read (JSON-quoted, so stray quotes or hidden characters show).
      problems.push(`${prefix}_AI_MODEL: got ${JSON.stringify(model.slice(0, 60))}, which is not in ai.md's "Choosing the model" list for service ${service} (allowed: ${MODELS[service].join(', ')})`)
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
  // Hosted on Embarko (it sets APP_NAME and DATA_DIR): the dashboard login is forced on and needs the admin ID and
  // password hash; DASHBOARD_PASSWORD is ignored there. Local runs keep DASHBOARD_AUTH as it is.
  const hosted = Boolean(env.APP_NAME?.trim() && env.DATA_DIR?.trim())
  const hostedDir = hosted ? env.DATA_DIR.trim() : null
  const dashboardAuthSetting = bool('DASHBOARD_AUTH')
  const dashboardAuth = hosted ? true : dashboardAuthSetting
  const adminUsername = str('ADMIN_USERNAME')
  const adminHash = str('ADMIN_PASSWORD_HASH')
  if (adminHash !== undefined && !isValidHash(adminHash)) problems.push('ADMIN_PASSWORD_HASH: not a hash made by "npm run admin:hash"')
  if ((adminUsername === undefined) !== (adminHash === undefined)) problems.push('ADMIN_USERNAME and ADMIN_PASSWORD_HASH: set both or neither')
  if (adminUsername !== undefined && adminUsername.length < 3) problems.push('ADMIN_USERNAME: at least 3 characters')
  if (hosted && adminUsername === undefined) problems.push('ADMIN_USERNAME and ADMIN_PASSWORD_HASH: required when hosted (the dashboard login is always on there)')
  const adminLogin = adminUsername !== undefined && adminHash !== undefined && isValidHash(adminHash) ? { username: adminUsername, passwordHash: adminHash } : null
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
      // Phase 9 B3: the stories call's own answer timeout (rtlayer); other calls use AI_RTLAYER_TIMEOUT_MS
      storiesTimeoutMs: int('SCOUT_STORIES_TIMEOUT_MS', { min: 1000 }),
      concurrency: int('SCOUT_CONCURRENCY', { min: 1, max: 10 }),
      questionsTimeoutMs: int('SCOUT_QUESTIONS_TIMEOUT_MS', { min: 1000 }),
      rapidResponseDays: int('RAPID_RESPONSE_DAYS', { min: 0 }),
      // Phase 12: news / rapid-response posts are off.
      rapidResponseEnabled: bool('RAPID_RESPONSE_ENABLED'),
      styleReuseDays: int('STYLE_REUSE_DAYS'),
      docsMaxPages: int('DOCS_MAX_PAGES', { min: 1 }),
      docsMaxChars: int('DOCS_MAX_CHARS', { min: 1000, max: 48000 }),
      docsHosts: list('M91_DOCS_HOSTS').map((h) => h.toLowerCase()),
      dedupeSimilarity: num('DEDUPE_SIMILARITY', { min: 0, max: 1 }),
      dedupeMode: oneOf('DEDUPE_MODE', ['local', 'mem0']),
      dedupeSimilarityLocal: num('DEDUPE_SIMILARITY_LOCAL', { min: 0, max: 1 }),
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
    planner: {
      ...agent('planner'),
      maxRepairs: int('PLANNER_MAX_REPAIRS', { max: 3 })
    },
    // Phase 12: each run writes the next slot of the approved roadmap (pinned topics first).
    roadmap: { enabled: bool('ROADMAP_ENABLED') },
    // The timely lane, next to the roadmap (on only when both RAPID_RESPONSE_ENABLED and ROADMAP_ENABLED are true).
    timely: {
      enabled: bool('RAPID_RESPONSE_ENABLED') && bool('ROADMAP_ENABLED'),
      checkOnRun: bool('TIMELY_CHECK_ON_RUN'),
      windowDays: int('TIMELY_WINDOW_DAYS', { min: 1, max: 60 }),
      maxPerWeek: int('TIMELY_MAX_PER_WEEK', { min: 0, max: 7 })
    },
    promo: {
      ...agent('promo'),
      // Phase 10: off by default (the code and tests stay; approving never runs it unless this is true)
      enabled: bool('PROMO_ENABLED'),
      linkedinMaxChars: int('PROMO_LINKEDIN_MAX_CHARS', { min: 100, max: 3000 }),
      xPostMaxChars: int('PROMO_X_POST_MAX_CHARS', { min: 50, max: 280 })
    },
    mem0: {
      apiKey: str('MEM0_API_KEY', { required: true }),
      // Not used by the v3 SDK (the API key is project-scoped); kept for reference.
      orgId: str('MEM0_ORG_ID'),
      projectId: str('MEM0_PROJECT_ID'),
      agentId: str('MEM0_AGENT_ID', { required: true }),
      // Phase 7: in-process read cache lifetime; 0 turns it off
      cacheTtlMs: int('STORE_CACHE_TTL_MS', { max: 3600000 }),
      // Phase 9 A5: the plan's monthly request limit, and the warn / stop levels (percent of it)
      // Phase 12: retrievals (reads + searches) and adds (writes) are two separate Mem0 quotas.
      monthlyLimit: int('MEM0_MONTHLY_LIMIT', { min: 1 }),
      monthlyAddLimit: int('MEM0_MONTHLY_ADD_LIMIT', { min: 1 }),
      warnPct: int('MEM0_WARN_PCT', { min: 1, max: 100 }),
      stopPct: int('MEM0_STOP_PCT', { min: 1, max: 100 })
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
    testing: {
      allowTestCommands: bool('ALLOW_TEST_COMMANDS')
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
      maxAiRoundsPerPost: int('MAX_AI_ROUNDS_PER_POST', { min: 1 }),
      // Phase 10: Reviewer feedback for the design only (send_to "designer") re-runs the Experience Designer
      maxDesignerRevisions: int('MAX_DESIGNER_REVISIONS', { max: 10 })
    },
    content: {
      targetWordsMin: int('TARGET_WORDS_MIN', { min: 1 }),
      targetWordsMax: int('TARGET_WORDS_MAX', { min: 1 }),
      defaultTone: str('DEFAULT_TONE', { required: true }),
      readingGradeIntroMax: int('READING_GRADE_INTRO_MAX', { min: 1, max: 20 }),
      readingGradePostMax: int('READING_GRADE_POST_MAX', { min: 1, max: 20 }),
      readingGradeHardMargin: num('READING_GRADE_HARD_MARGIN', { min: 0, max: 10 }),
      // Phase 12: a sentence over SENTENCE_HARD_MAX_WORDS or a paragraph over PARAGRAPH_MAX_SENTENCES is a hard check
      // (a repair call); sentences of SENTENCE_MAX_WORDS+1 to SENTENCE_HARD_MAX_WORDS words are listed for the Reviewer.
      sentenceMaxWords: int('SENTENCE_MAX_WORDS', { min: 5, max: 60 }),
      sentenceHardMaxWords: int('SENTENCE_HARD_MAX_WORDS', { min: 5, max: 200 }),
      paragraphMaxSentences: int('PARAGRAPH_MAX_SENTENCES', { min: 1, max: 99 }),
      wordsHardMarginPct: int('WORDS_HARD_MARGIN_PCT', { max: 100 }),
      timezone
    },
    runtime: {
      autoPublish: bool('AUTO_PUBLISH'),
      dryRun,
      triggerKey: str('PIPELINE_TRIGGER_KEY'),
      logLevel: oneOf('LOG_LEVEL', LOG_LEVELS),
      // Empty: apps/engine/data (gitignored). Holds the run lock and the Mem0 usage file; never content.
      // Hosted: a folder under DATA_DIR (the only disk Embarko keeps across redeploys).
      dataDir: str('ENGINE_DATA_DIR') || (hostedDir ? join(hostedDir, 'engine') : null),
      runLockStaleMin: int('RUN_LOCK_STALE_MIN', { min: 1, max: 1440 })
    },
    server: {
      port: int('PORT', { min: 1, max: 65535 })
    },
    dashboard: {
      // Used by the Phase 6 dashboard dev server (it proxies /api to PORT).
      port: int('DASHBOARD_PORT', { min: 1, max: 65535 }),
      auth: dashboardAuth,
      // admin: the ID + password login (always when hosted); else the single dashboard password (local use).
      admin: adminLogin,
      password: hosted || adminLogin ? undefined : str('DASHBOARD_PASSWORD', { required: dashboardAuth === true }),
      hosted
    },
    // Phase 10: the Experience Designer turns each draft into an interactive guide (it writes short interface
    // text only; the post's own text and code are placed by code). It runs before the Reviewer.
    designer: {
      // Phase 11: false skips the Experience Designer everywhere (pipeline, counter prompts, the Reviewer's design rules)
      enabled: bool('EXPERIENCE_ENABLED'),
      ...agent('experience'),
      maxRepairs: int('EXPERIENCE_MAX_REPAIRS', { max: 3 }),
      maxComponents: int('EXPERIENCE_MAX_COMPONENTS', { min: 1, max: 30 }),
      interactiveDefault: bool('INTERACTIVE_DEFAULT')
    },
    // Phase 11: the publish target, the Markdown export and Docstar (the API key is a secret; empty until known)
    publish: {
      target: oneOf('PUBLISH_TARGET', PUBLISH_TARGETS),
      exportDir: str('EXPORT_DIR') || (hostedDir ? join(hostedDir, 'exports') : undefined)
    },
    docstar: {
      apiUrl: url('DOCSTAR_API_URL')?.replace(/\/+$/, ''),
      apiKey: str('DOCSTAR_API_KEY'),
      collectionId: str('DOCSTAR_COLLECTION_ID')
    },
    // Blog + Embarko, used from Phase 7. The deploy token is optional until then.
    blog: {
      appName: str('BLOG_APP_NAME', { required: true }),
      baseUrl: url('BLOG_BASE_URL', { required: true })?.replace(/\/+$/, ''),
      embarkoDeployToken: str('EMBARKO_DEPLOY_TOKEN'),
      noindexFirstNPosts: int('NOINDEX_FIRST_N_POSTS', { max: 1000 }),
      // Phase 7: the Publisher (Embarko deploy API, blog build and live checks)
      embarkoApiBase: url('EMBARKO_API_BASE', { required: true })?.replace(/\/+$/, ''),
      embarkoAgentName: str('EMBARKO_AGENT_NAME', { required: true }),
      buildTimeoutMs: int('BLOG_BUILD_TIMEOUT_MS', { min: 10000, max: 3600000 }),
      publishVerifyTimeoutMs: int('PUBLISH_VERIFY_TIMEOUT_MS', { min: 5000, max: 3600000 })
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
