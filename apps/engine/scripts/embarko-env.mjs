// npm run embarko:env — the environment variable NAMES to set in Embarko's environment settings. Names only: it reads
// the template env.example (never .env), so no value is read or printed.
//
//   REQUIRED     the engine will not start without them
//   NEEDED       the engine starts, but the pipeline cannot do its job (post CTA, Slack, M91 alerts)
//   ONLY IF SET  empty in the template: copy one only if your local .env has a value for it
//   OPTIONAL     have a default in the template; set one only if your local .env changes it
//   SET BY EMBARKO   do not set these: PORT, DATA_DIR, APP_NAME, APP_VERSION
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { loadConfig, SECRET_KEYS, ConfigError } from '../src/config.js'

const TEMPLATE = resolve(fileURLToPath(new URL('../../../env.example', import.meta.url)))
export const SET_BY_EMBARKO = Object.freeze(['PORT', 'DATA_DIR', 'APP_NAME', 'APP_VERSION', 'CRON_SECRET'])
// Keys the config does not insist on but the pipeline cannot work without.
export const NEEDED = Object.freeze(['M91_CTA_URL', 'SLACK_POST_WEBHOOK_URL', 'M91_ALERT_WEBHOOK_URL', 'WEBHOOK_SHARED_KEY'])
// The server itself refuses to start without the trigger key (checked in server.js, not in the config).
export const START_KEYS = Object.freeze(['PIPELINE_TRIGGER_KEY'])
/** Not used when hosted: local-only helpers, the single dashboard password, the blog's deploy token, folders under DATA_DIR. */
export const NOT_NEEDED_HOSTED = Object.freeze(['DASHBOARD_PORT', 'DASHBOARD_AUTH', 'DASHBOARD_PASSWORD', 'EMBARKO_DEPLOY_TOKEN', 'ENGINE_DATA_DIR', 'EXPORT_DIR', 'ALLOW_TEST_COMMANDS'])

/** KEY → value from the template text (no file other than env.example is ever read). */
export function parseTemplate(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

/** The groups, from the template and the config's own checks. */
export function envNames(template = parseTemplate(readFileSync(TEMPLATE, 'utf8'))) {
  const names = Object.keys(template).filter((k) => !SET_BY_EMBARKO.includes(k) && !NOT_NEEDED_HOSTED.includes(k))
  // What config.js still asks for when hosted with the template's own values: those keys are required.
  const probe = { ...template, APP_NAME: 'probe', DATA_DIR: '/probe' }
  let missing = []
  try {
    loadConfig(probe)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    missing = error.problems.map((p) => /^([A-Z][A-Z0-9_]*)(?:, ([A-Z][A-Z0-9_]*))?(?: and ([A-Z][A-Z0-9_]*))?:/.exec(p)).filter(Boolean).flatMap((m) => m.slice(1).filter(Boolean))
  }
  const required = names.filter((k) => missing.includes(k) || START_KEYS.includes(k))
  const needed = names.filter((k) => NEEDED.includes(k) && !required.includes(k))
  const onlyIfSet = names.filter((k) => template[k] === '' && !required.includes(k) && !needed.includes(k))
  const optional = names.filter((k) => !required.includes(k) && !needed.includes(k) && !onlyIfSet.includes(k))
  const secrets = names.filter((k) => SECRET_KEYS.includes(k))
  return { required, needed, onlyIfSet, optional, secrets }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { required, needed, onlyIfSet, optional, secrets } = envNames()
  const mark = (k) => (secrets.includes(k) ? `${k}   (secret)` : k)
  const list = (arr) => (arr.length ? arr.map((k) => `  ${mark(k)}`).join('\n') : '  (none)')
  console.log('Names to set in Embarko (App setup, environment). You type the values there; this prints no value.\n')
  console.log(`REQUIRED (${required.length}), the engine will not start without them:\n${list(required)}\n`)
  console.log(`NEEDED (${needed.length}), the pipeline cannot post, alert or write the call to action without them:\n${list(needed)}\n`)
  console.log(`ONLY IF SET (${onlyIfSet.length}), empty in the template: copy one only if your local .env has a value for it:\n${list(onlyIfSet)}\n`)
  console.log(`OPTIONAL (${optional.length}): the template default is used when unset. If your local .env CHANGES one of them, copy that line too.`)
  console.log('  The ones that matter most to keep the same as local: MEM0_AGENT_ID (the Mem0 data it reads and writes), TIMEZONE,')
  console.log('  the *_AI_SERVICE / *_AI_MODEL pairs, MEM0_MONTHLY_LIMIT, MEM0_MONTHLY_ADD_LIMIT.\n')
  console.log('Do not set: PORT, DATA_DIR, APP_NAME, APP_VERSION (Embarko sets them), DASHBOARD_AUTH / DASHBOARD_PASSWORD (hosted always uses the admin login).')
  console.log('ADMIN_PASSWORD_HASH comes from `npm run admin:hash`. PUBLISH_TARGET: none or docstar (embarko is not sent).')
}
