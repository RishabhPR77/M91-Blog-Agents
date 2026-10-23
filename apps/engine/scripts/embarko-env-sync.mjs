// npm run embarko:env-sync [-- --yes] — sends the engine's settings from the local .env to the Embarko app, so you do not
// type them there. The program reads .env itself (node --env-file=../../.env); no value is ever printed or logged:
// the output lists setting NAMES only. Without --yes it only lists what it would send.
//
// What is sent: the names `npm run embarko:env` lists (required, needed, only-if-set and optional) that have a value
// in .env. Never sent: PORT, DATA_DIR, APP_NAME, APP_VERSION (Embarko sets them), the local-only keys (DASHBOARD_AUTH,
// DASHBOARD_PASSWORD, EMBARKO_DEPLOY_TOKEN, ENGINE_DATA_DIR, EXPORT_DIR, ...), and PUBLISH_TARGET unless it is "none".
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { envNames } from './embarko-env.mjs'
import { SECRET_KEYS } from '../src/config.js'
import { call, waitTerminal, maskToken, DEFAULT_APP, EmbarkoError } from './embarko-api.mjs'

/** { send: {KEY: value}, missingRequired: [names], skipped: [names + reason] } from an environment. Values stay in `send`. */
export function planSync(env, names = envNames()) {
  const wanted = [...names.required, ...names.needed, ...names.onlyIfSet, ...names.optional]
  const send = {}
  const skipped = []
  for (const key of wanted) {
    const value = env[key]?.trim()
    if (!value) continue
    if (key === 'PUBLISH_TARGET' && value !== 'none') {
      skipped.push(`${key} (not "none": blog publishing stays off on Embarko)`)
      continue
    }
    send[key] = value
  }
  const missingRequired = [...names.required, ...names.needed].filter((k) => !(k in send))
  return { send, missingRequired, skipped }
}

/** Sends the plan; returns the lines to print (names only). */
export async function sync({ env = process.env, token, app = DEFAULT_APP, yes = false, fetchImpl = globalThis.fetch, sleep } = {}) {
  if (!token) throw new EmbarkoError('EMBARKO_DEPLOY_TOKEN is not set in the environment (npm run embarko:env-sync loads ../../.env itself).')
  const plan = planSync(env)
  const keys = Object.keys(plan.send).sort()
  const lines = [`${yes ? 'Sending' : 'Would send'} ${keys.length} settings to ${app}: ${keys.join(' ')}`]
  if (plan.missingRequired.length) lines.push(`Not in .env (the app cannot start without the required ones): ${plan.missingRequired.join(' ')}`)
  if (plan.skipped.length) lines.push(`Left out: ${plan.skipped.join('; ')}`)
  if (!yes) return [...lines, 'Nothing was sent: add --yes.']
  const r = await call({ token, fetchImpl, method: 'PUT', path: `/api/apps/${app}/env-vars`, body: { vars: keys.map((key) => ({ key, value: plan.send[key] })), apply: true } })
  if (r.status >= 400) throw new EmbarkoError(`Embarko refused the settings: ${r.status} ${r.body?.code ?? r.body?.error ?? ''}`.trim())
  lines.push(`Saved ${keys.length} settings${r.body?.applied === false ? ' (not applied yet)' : ' and applied them'}.`)
  if (r.body?.statusUrl) {
    const done = await waitTerminal({ token, fetchImpl, statusUrl: r.body.statusUrl, sleep })
    lines.push(`App: ${done.status ?? 'done'}${done.error ? ` (${done.error})` : ''}`)
  }
  return lines
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = process.env.EMBARKO_DEPLOY_TOKEN?.trim()
  // Masks the token and every secret setting's value (the lines printed hold names only; this is a second guard).
  const secrets = [token, ...SECRET_KEYS.map((k) => process.env[k]?.trim())].filter((v) => v && v.length >= 4)
  const mask = (text) => secrets.reduce((t, s) => (s ? maskToken(t, s) : t), String(text))
  try {
    for (const line of await sync({ token, yes: process.argv.includes('--yes') })) console.log(mask(line))
  } catch (error) {
    console.error(mask(error.message))
    process.exit(1)
  }
}
