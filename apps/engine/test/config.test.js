import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig, ConfigError } from '../src/config.js'
import { fakeEnv } from './helpers.js'

const problemsFor = (env) => {
  try {
    loadConfig(env)
  } catch (error) {
    assert.ok(error instanceof ConfigError)
    return error.problems
  }
  assert.fail('expected ConfigError')
}

test('valid env loads with defaults, grouped per agent, frozen', () => {
  const c = loadConfig(fakeEnv())
  assert.equal(c.scout.service, 'openai')
  assert.equal(c.scout.model, 'gpt-5-mini')
  assert.equal(c.scout.delivery, 'sync')
  assert.equal(c.strategist.service, 'openai')
  assert.equal(c.strategist.model, 'gpt-5.6-luna')
  assert.equal(c.strategist.delivery, 'sync')
  assert.equal(c.writer.service, 'gemini')
  assert.equal(c.writer.delivery, 'rtlayer')
  assert.equal(c.reviewer.model, 'gpt-5.5')
  assert.equal(c.promo.model, 'gpt-5-mini')
  assert.equal(c.viasocket.apiBase, 'https://flow-api.viasocket.com')
  assert.equal(c.limits.maxAiRoundsPerPost, 5)
  assert.equal(c.runtime.autoPublish, false)
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.scout) && Object.isFrozen(c.limits))
  assert.throws(() => { c.scout.model = 'x' }, TypeError)
})

test('missing required keys are listed by name only', () => {
  const env = fakeEnv()
  delete env.VIASOCKET_EMBED_SECRET
  delete env.MEM0_API_KEY
  const problems = problemsFor(env)
  assert.ok(problems.includes('VIASOCKET_EMBED_SECRET: missing'))
  assert.ok(problems.includes('MEM0_API_KEY: missing'))
})

test('error messages never contain values', () => {
  const secret = 'super-secret-value-xyz'
  try {
    loadConfig(fakeEnv({ SCOUT_AI_SERVICE: secret, PASS_SCORE_MIN: secret, DRY_RUN: secret, M91_CTA_URL: secret }))
    assert.fail('expected ConfigError')
  } catch (error) {
    assert.ok(!error.message.includes(secret))
    assert.match(error.message, /SCOUT_AI_SERVICE/)
    assert.match(error.message, /PASS_SCORE_MIN/)
    assert.match(error.message, /DRY_RUN/)
    assert.match(error.message, /M91_CTA_URL/)
  }
})

test('service, delivery, number, boolean and range validation', () => {
  const problems = problemsFor(fakeEnv({
    WRITER_AI_SERVICE: 'mistral',
    REVIEWER_DELIVERY: 'websocket',
    MAX_WRITER_REVISIONS: 'two',
    AUTO_PUBLISH: 'yes',
    PASS_SCORE_MIN: '150',
    LOG_LEVEL: 'loud',
    TIMEZONE: 'Mars/Base'
  }))
  const keys = problems.map((p) => p.split(':')[0])
  for (const k of ['WRITER_AI_SERVICE', 'REVIEWER_DELIVERY', 'MAX_WRITER_REVISIONS', 'AUTO_PUBLISH', 'PASS_SCORE_MIN', 'LOG_LEVEL', 'TIMEZONE']) {
    assert.ok(keys.includes(k), `${k} should be reported`)
  }
})

test('model must be in the ai.md list for its service', () => {
  const problems = problemsFor(fakeEnv({ STRATEGIST_AI_MODEL: 'gpt-9-ultra' }))
  assert.match(problems.join('\n'), /STRATEGIST_AI_MODEL: got "gpt-9-ultra", which is not in ai.md/)
  // The value is shown JSON-quoted, so smart quotes copied from a document are visible.
  assert.match(problemsFor(fakeEnv({ STRATEGIST_AI_MODEL: '“gpt-5.5”' })).join('\n'), /got "“gpt-5\.5”"/)
  // A real model under the wrong service is also rejected.
  assert.match(problemsFor(fakeEnv({ WRITER_AI_SERVICE: 'openai' })).join('\n'), /WRITER_AI_MODEL/)
})

test('an inline "# comment" on a value gets a hint', () => {
  const problems = problemsFor(fakeEnv({ WRITER_DELIVERY: 'rtlayer          # long answer' }))
  assert.match(problems.join('\n'), /WRITER_DELIVERY: .*inline "# comment"/)
})

test('empty optional keys are accepted (webhooks, MEM0 org/project, Embarko token, dashboard password)', () => {
  const empty = { SLACK_POST_WEBHOOK_URL: '', M91_ALERT_WEBHOOK_URL: '', MEM0_ORG_ID: '', MEM0_PROJECT_ID: '', EMBARKO_DEPLOY_TOKEN: '', DASHBOARD_PASSWORD: '', M91_CTA_URL: '' }
  const c = loadConfig(fakeEnv({ ...empty, DRY_RUN: 'false' }))
  assert.equal(c.notify.slackWebhookUrl, undefined)
  assert.equal(c.blog.embarkoDeployToken, undefined)
  assert.equal(c.mem0.orgId, undefined)
})

test('old PUBLISH_API_* keys in .env are ignored (removed in Phase 3.5); PUBLISH_TARGET is the Phase 11 target', () => {
  const c = loadConfig(fakeEnv({ PUBLISH_TARGET: 'none', PUBLISH_API_URL: 'not even a url', PUBLISH_API_KEY: 'k' }))
  assert.deepEqual(c.publish, { target: 'none', exportDir: c.publish.exportDir })
  assert.match(problemsFor(fakeEnv({ PUBLISH_TARGET: 'x' })).join(), /PUBLISH_TARGET: must be one of none | embarko | docstar/)
})

test('Phase 11 keys: designer off and no publishing by default; Docstar empty until set; the Docstar key is a secret', async () => {
  const env = fakeEnv()
  delete env.EXPERIENCE_ENABLED
  delete env.PUBLISH_TARGET
  const c = loadConfig(env)
  assert.equal(c.designer.enabled, false)
  assert.equal(c.publish.target, 'none')
  assert.deepEqual(c.docstar, { apiUrl: undefined, apiKey: '', collectionId: '', orgId: '' })
  const d = loadConfig(fakeEnv({ DOCSTAR_API_URL: 'https://api.docstar.example/', DOCSTAR_API_KEY: 'hm_secret', DOCSTAR_COLLECTION_ID: 'col1' }))
  assert.equal(d.docstar.apiUrl, 'https://api.docstar.example')
  const { SECRET_KEYS } = await import('../src/config.js')
  assert.ok(SECRET_KEYS.includes('DOCSTAR_API_KEY'))
})

test('TARGET_WORDS_MIN must not exceed TARGET_WORDS_MAX', () => {
  assert.match(problemsFor(fakeEnv({ TARGET_WORDS_MIN: '2000', TARGET_WORDS_MAX: '1000' })).join(), /TARGET_WORDS_MIN/)
})

test('Phase 2 Scout keys: defaults and validation', () => {
  const c = loadConfig(fakeEnv())
  assert.equal(c.scout.researchDelivery, 'rtlayer')
  assert.equal(c.scout.maxCalls, 14)
  assert.equal(c.scout.reuseHours, 24)
  assert.equal(c.scout.minOpenClusters, 5)
  assert.equal(c.scout.questionsPerGroup, 8)
  assert.equal(c.scout.storyLookbackDays, 30)
  assert.equal(c.scout.rapidResponseDays, 7)
  assert.equal(c.scout.styleReuseDays, 14)
  assert.equal(c.scout.docsMaxPages, 15)
  assert.equal(c.scout.docsMaxChars, 45000)
  assert.ok(problemsForKeys({ DOCS_MAX_CHARS: '48001' }).includes('DOCS_MAX_CHARS'))
  assert.equal(loadConfig(fakeEnv({ DOCS_MAX_CHARS: '48000' })).scout.docsMaxChars, 48000)
  assert.deepEqual(c.scout.docsHosts, ['m91-api.msg91.com', 'm91.msg91.com'])
  assert.equal(c.scout.dedupeSimilarity, 0.85)
  assert.equal(c.scout.urlCheckTimeoutMs, 10000)
  assert.deepEqual(c.scout.competitors, ['withHuman', 'PagerDuty', 'Opsgenie', 'Twilio A2H', 'Pushover'])
  assert.equal(c.m91.skillRepoUrl, 'https://github.com/MSG91/m91-skill')
  assert.equal(c.viasocket.maxRetries, 3)
  assert.deepEqual(c.scout.questionGroups, [1, 2, 3, 4, 5])
  assert.deepEqual(loadConfig(fakeEnv({ SCOUT_QUESTION_GROUPS: '3, 1,3' })).scout.questionGroups, [1, 3])
  assert.ok(problemsForKeys({ SCOUT_QUESTION_GROUPS: '1,6' }).includes('SCOUT_QUESTION_GROUPS'))
  const keys = problemsForKeys({ SCOUT_RESEARCH_DELIVERY: 'push', DEDUPE_SIMILARITY: '1.5', SCOUT_MAX_CALLS: '0', M91_SKILL_REPO_URL: 'not a url' })
  for (const k of ['SCOUT_RESEARCH_DELIVERY', 'DEDUPE_SIMILARITY', 'SCOUT_MAX_CALLS', 'M91_SKILL_REPO_URL']) assert.ok(keys.includes(k), k)
})

test('Phase 3 Strategist keys: defaults and validation', () => {
  const c = loadConfig(fakeEnv())
  assert.deepEqual(
    { r: c.strategist.maxRepairs, w: c.strategist.recentBriefsWindow, t: c.strategist.titleMaxChars, min: c.strategist.outlineMinSections, max: c.strategist.outlineMaxSections, q: c.strategist.minQuestionHeadings, l: c.strategist.lessonsLimit, u: c.strategist.allowUpdateBriefs },
    { r: 1, w: 10, t: 70, min: 4, max: 10, q: 3, l: 5, u: false }
  )
  assert.equal(c.content.readingGradeIntroMax, 6)
  assert.equal(c.content.readingGradePostMax, 7)
  const keys = problemsForKeys({ OUTLINE_MIN_SECTIONS: '11', ALLOW_UPDATE_BRIEFS: 'maybe', MIN_QUESTION_HEADINGS: '12' })
  for (const k of ['OUTLINE_MIN_SECTIONS', 'ALLOW_UPDATE_BRIEFS', 'MIN_QUESTION_HEADINGS']) assert.ok(keys.includes(k), k)
})

const problemsForKeys = (overrides) => problemsFor(fakeEnv(overrides)).map((p) => p.split(':')[0])

test('secret values are collected but not enumerable', () => {
  const c = loadConfig(fakeEnv())
  assert.ok(c.secretValues.includes('fake-embed-secret-for-tests'))
  assert.ok(!Object.keys(c).includes('secretValues'))
  assert.ok(!JSON.stringify(c).includes('secretValues'))
})

test('Phase 4 Writer keys: defaults, fallback pairing, validation', () => {
  const c = loadConfig(fakeEnv())
  assert.equal(c.writer.maxRepairs, 1)
  assert.equal(c.writer.revisionInput, 'full')
  assert.equal(c.writer.tutorialSourceMaxChars, 40000)
  assert.equal(c.writer.postDrafts, false)
  assert.equal(c.writer.fallbackService, undefined)
  assert.equal(c.content.readingGradeHardMargin, 1)
  assert.deepEqual([c.content.sentenceMaxWords, c.content.sentenceHardMaxWords, c.content.paragraphMaxSentences], [20, 25, 3])
  assert.equal(c.content.wordsHardMarginPct, 20)
  assert.equal(c.notify.chunkChars, 2800)
  assert.equal(c.reviewer.stubMode, undefined, 'REVIEWER_STUB_MODE is gone (Phase 5)')
  assert.deepEqual([c.reviewer.maxSourceChecks, c.reviewer.feedbackMaxItems, c.reviewer.lessonsPerReviewMax], [5, 8, 3])
  const fb = loadConfig(fakeEnv({ WRITER_FALLBACK_SERVICE: 'anthropic', WRITER_FALLBACK_MODEL: 'claude-sonnet-4-6' }))
  assert.deepEqual([fb.writer.fallbackService, fb.writer.fallbackModel], ['anthropic', 'claude-sonnet-4-6'])
  const keys = problemsForKeys({ WRITER_FALLBACK_MODEL: 'claude-sonnet-4-6', WRITER_REVISION_INPUT: 'half', TUTORIAL_SOURCE_MAX_CHARS: '60000', REVIEWER_MAX_SOURCE_CHECKS: 'many' })
  for (const k of ['WRITER_FALLBACK_SERVICE', 'WRITER_REVISION_INPUT', 'TUTORIAL_SOURCE_MAX_CHARS', 'REVIEWER_MAX_SOURCE_CHECKS']) assert.ok(keys.includes(k), k)
  assert.ok(problemsForKeys({ WRITER_FALLBACK_SERVICE: 'gemini', WRITER_FALLBACK_MODEL: 'gpt-5-mini' }).includes('WRITER_FALLBACK_MODEL'))
})
