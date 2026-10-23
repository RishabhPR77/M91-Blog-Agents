// npm run embarko -- <command> — looks after the deployed app without handling the token yourself.
//
//   status                     is it live? (building, starting, live, failed, crashed)
//   logs                       the tail of the app's error output (about the last 8 KB)
//   deployments                the last deploys, newest first (the line marked "rollback target" can be restored)
//   env-keys                   the NAMES of the environment variables that are set (values are never readable)
//   apply-env --yes            makes the saved environment values reach the running app (restarts it, no rebuild)
//   rollback --yes [<id>]      puts the previous successful deploy back (or the one with that id), no rebuild
//
// The token (EMBARKO_DEPLOY_TOKEN) comes from the environment (`node --env-file=../../.env`), is sent only as the
// Authorization header, and is masked in everything printed. Commands that change the running app need --yes.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const API = 'https://ship.embarko.ai'
export const DEFAULT_APP = 'm91-engine'
export const maskToken = (text, token) => (token ? String(text).split(token).join('***') : String(text))

export class EmbarkoError extends Error {}

/** One call to Embarko; returns { status, body } (body parsed when it is JSON). */
export async function call({ token, fetchImpl = globalThis.fetch, method = 'GET', path, body }) {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'x-agent-name': 'claude-code', ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) })
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, body: json ?? text }
}

const need = (token) => {
  if (!token) throw new EmbarkoError('EMBARKO_DEPLOY_TOKEN is not set in the environment. Run it with: npm run embarko -- <command> (it loads ../../.env itself).')
}

/** Polls a status URL until it says terminal (rollback and env apply answer 202 and finish a little later). */
export async function waitTerminal({ token, fetchImpl, statusUrl, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 30, everyMs = 10000 }) {
  const path = String(statusUrl).replace(API, '')
  for (let i = 0; i < tries; i++) {
    const r = await call({ token, fetchImpl, path })
    if (r.body?.terminal === true || ['live', 'failed', 'crashed'].includes(r.body?.status)) return r.body
    await sleep(everyMs)
  }
  throw new EmbarkoError('still not finished after 5 minutes: run "npm run embarko -- status" later')
}

/** Runs one command; returns the lines to print. */
export async function run(command, args, { token, app = DEFAULT_APP, fetchImpl = globalThis.fetch, sleep } = {}) {
  need(token)
  const yes = args.includes('--yes')
  const base = { token, fetchImpl }
  const ok = (r, what) => {
    if (r.status >= 400) throw new EmbarkoError(`${what}: ${r.status} ${r.body?.error ?? r.body?.code ?? ''} ${r.body?.next ?? ''}`.trim())
    return r.body
  }
  if (command === 'status') {
    const b = ok(await call({ ...base, path: `/apps/${app}/status` }), 'status')
    return [`${app}: ${b.status}`, ...(b.links?.app ? [`address: ${b.links.app}`] : []), ...(b.error ? [`error: ${b.error}`] : [])]
  }
  if (command === 'logs') {
    const b = ok(await call({ ...base, path: `/apps/${app}/logs?stream=stderr` }), 'logs')
    return [String(b.logs ?? '(no logs available)')]
  }
  if (command === 'deployments') {
    const b = ok(await call({ ...base, path: `/api/apps/${app}/deployments` }), 'deployments')
    const list = b.deployments ?? b
    return Array.isArray(list) ? list.map((d) => `${d.id ?? d.deploymentId}  ${d.status ?? ''}  ${d.version ?? ''}  ${d.createdAt ?? ''}${d.rollbackTarget ? '  rollback target' : ''}`.trim()) : [JSON.stringify(b)]
  }
  if (command === 'env-keys') {
    const b = ok(await call({ ...base, path: `/api/apps/${app}/env-vars` }), 'env-keys')
    const list = b.vars ?? b.envVars ?? b
    return Array.isArray(list) ? list.map((v) => (typeof v === 'string' ? v : v.key)).sort() : [JSON.stringify(b)]
  }
  if (command === 'apply-env' || command === 'rollback') {
    if (!yes) return [`Not done: "${command}" changes the running app. Add --yes to go ahead.`]
    const id = command === 'rollback' ? args.find((a) => !a.startsWith('--')) : undefined
    const b = ok(await call({ ...base, method: 'POST', path: command === 'rollback' ? `/api/apps/${app}/rollback` : `/api/apps/${app}/env-vars/apply`, body: id ? { deploymentId: id } : {} }), command)
    const done = b.statusUrl ? await waitTerminal({ ...base, statusUrl: b.statusUrl, sleep }) : b
    return [`${command}: ${done.status ?? 'done'}`, ...(done.error ? [`error: ${done.error}`] : [])]
  }
  throw new EmbarkoError(`unknown command "${command ?? ''}": status | logs | deployments | env-keys | apply-env --yes | rollback --yes [<deployment id>]`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2)
  const token = process.env.EMBARKO_DEPLOY_TOKEN?.trim()
  const appArg = args.find((a) => a.startsWith('--app='))
  try {
    for (const line of await run(command, args.filter((a) => !a.startsWith('--app=')), { token, ...(appArg && { app: appArg.slice(6) }) })) console.log(maskToken(line, token))
  } catch (error) {
    console.error(maskToken(error.message, token))
    process.exit(1)
  }
}
