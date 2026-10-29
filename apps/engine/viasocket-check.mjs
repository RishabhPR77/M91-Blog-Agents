#!/usr/bin/env node
/* global process, console, fetch, AbortSignal */
/**
 * viasocket-check.mjs — checks a viaSocket integration's code for what reading it cannot show.
 *
 *   curl -fsSL https://flow.viasocket.com/viasocket-check.mjs -o viasocket-check.mjs
 *   node viasocket-check.mjs [folder or file ...]      defaults to the current folder
 *
 * It finds every viaSocket id and URL the code hard-codes and checks each against the live catalog:
 *   - a slug passed to serviceIdFor() names a real app (slugs are case-sensitive), and its app's
 *     action and trigger ids are then checked like the rest
 *   - a service_id names a real app — not the app's name, its slug, or the id with a name joined on
 *   - an action's or trigger's id sits where the call takes that kind of id (the two ids look alike:
 *     run, list-options and subscribe-event take the version id; everything else the plain one)
 *   - every viasocket URL is a published endpoint — never a popup or auth-page URL built by hand
 *   - the embed secret is not a string literal in source
 *   - the connect script is reachable; the embed token works (VIASOCKET_TEST_EMBED_TOKEN, optional)
 *
 * No dependencies, Node 18+. Exits 1 on any FAIL, so it works as a test (`npm test`) or a CI step.
 * It never reads a .env file, sends only the ids it finds to viaSocket's public catalog, and prints
 * no line of code — only file:line and the id or URL.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'

const CATALOG = 'https://flow.sokt.io/func/scriK4LFg2kc'
const SLUG_URL = 'https://plug-service.viasocket.com/api/v1/plugins/recommend/services'
const SEARCH_HINT =
  "find the app's slug with searchApps(name) — https://flow.viasocket.com/documentation/apps-api.md — and copy its appslugname exactly"
const CONNECT_SCRIPT = process.env.VIASOCKET_CONNECT_SCRIPT || 'https://flow.viasocket.com/connect.js'
const API = process.env.VIASOCKET_API_URL || 'https://flow-api.viasocket.com'
const EMBED_TOKEN = process.env.VIASOCKET_TEST_EMBED_TOKEN

const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'dist', 'build', '.next', 'coverage', 'vendor', '.venv', '__pycache__'])
const EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.vue',
  '.svelte',
  '.html',
  '.py',
  '.rb',
  '.php',
  '.go',
  '.java',
  '.kt',
  '.cs',
  '.json',
  '.yaml',
  '.yml'
])
const MAX_FILE_BYTES = 2 * 1024 * 1024

/** What a product may call or load. Any other URL on a viasocket host was built by hand. */
const KNOWN_URL_PREFIXES = [
  'https://flow-api.viasocket.com/',
  'https://dev-api.viasocket.com/',
  'https://flow.sokt.io/func/',
  'https://dev-flow.sokt.io/func/',
  'https://flow.viasocket.com/connect.js',
  'https://dev-flow.viasocket.com/connect.js',
  'https://flow.viasocket.com/viasocket-check.mjs',
  'https://flow.viasocket.com/documentation/',
  'https://dev-flow.viasocket.com/documentation/',
  'https://embed.viasocket.com/',
  'https://memory-api.viasocket.com/',
  'https://plug-service.viasocket.com/api/v1/plugins/all',
  'https://plug-service.viasocket.com/api/v1/plugins/recommend/services',
  'https://plug-service.viasocket.com/plugins/search',
  'https://viasocket.com/',
  'https://www.viasocket.com/'
]

const ID = /(?<![A-Za-z0-9_])row[a-z0-9]{6,9}(?![A-Za-z0-9_])/g
const COMPOSED_ID = /(["'`])(row[a-z0-9]{6,9}[_-][A-Za-z0-9_-]+)\1/g
const VIASOCKET_URL = /https?:\/\/[a-z0-9.-]*(?:viasocket\.com|sokt\.io)[^\s'"`<>)]*/gi
const SECRET_LITERAL = /VIASOCKET_EMBED_SECRET\s*[=:]\s*["'][^"'\n]{6,}["']/
const EXPECTS_VERSION = /list-options|subscribe-event|update-subscribed-event|version/i
const EXPECTS_PLAIN = /filteredActions|filteredServices|service_action_functions|action_id|trigger_id|actionId|triggerId|open\s*:/
const EXPECTS_SERVICE = /service_id|serviceId(?!For)|\/enable\//
/** A slug the code names: serviceIdFor('slack'), serviceIds['slack'], listEvents('slack'), the slug argument of
 * findEnabledApp / enableApp, slug: 'slack', VIASOCKET_APP_SLUG = 'slack'. */
const SLUG_USE =
  /(?:serviceIdFor\s*\(\s*|versionIdFor\s*\(\s*|serviceIds\s*\[\s*|listEvents\s*\(\s*|(?:findEnabledApp|enableApp)\s*\([^()'"`]*?,\s*|\bslug\s*[:=]\s*|APP_SLUG\s*[:=]\s*)(["'`])([A-Za-z0-9_-]+)\1/g
/** versionIdFor('slack', 'send-message', 'V107'): checked against the version the catalog publishes. */
const VERSION_USE = /versionIdFor\s*\(\s*(["'`])([A-Za-z0-9_-]+)\1\s*,\s*(["'`])([A-Za-z0-9_-]+)\3\s*,\s*(["'`])([^"'`]+)\5/g
/** The event argument of versionIdFor(serviceId or slug, event, …): a plain action_id / trigger_id, or a page path. */
const EVENT_ARG = /versionIdFor\s*\([^,()]*(?:\([^()]*\))?[^,()]*,\s*(["'`])([A-Za-z0-9_-]+)\1/g
/** The token endpoint's ?apps=slack,google-sheets */
const SLUG_LIST = /[?&]apps=([A-Za-z0-9_,-]+)/g

const findings = { FAIL: 0, WARN: 0 }
const say = (level, where, text) => {
  if (level in findings) findings[level] += 1
  console.log(`${level.padEnd(4)} ${where ? `${where}  ` : ''}${text}`)
}

async function* walk(target) {
  const info = await stat(target).catch(() => null)
  if (!info) return
  if (info.isFile()) {
    yield target
    return
  }
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(target, entry.name))
    } else if (entry.isFile()) yield join(target, entry.name)
  }
}

const scannable = (file) => {
  const name = basename(file)
  if (name.startsWith('.env') || name === 'viasocket-check.mjs') return false
  return EXTENSIONS.has(extname(name))
}

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['.']
const ids = new Map() // id → [{ where, expects }]
const urls = []
const slugs = new Map() // slug → [where]
const versionUses = [] // { slug, event, version, where }
let filesScanned = 0
let mentionsConnect = false

for (const root of roots) {
  for await (const file of walk(root)) {
    if (!scannable(file)) continue
    const info = await stat(file)
    if (info.size > MAX_FILE_BYTES) continue
    const text = await readFile(file, 'utf8')
    filesScanned += 1
    const where = relative(process.cwd(), file) || file
    if (SECRET_LITERAL.test(text))
      say('FAIL', where, 'VIASOCKET_EMBED_SECRET is a string literal in source — it lives in .env and nowhere else')
    if (/openViasocketConnection|connect\.js/.test(text)) mentionsConnect = true
    text.split('\n').forEach((line, index) => {
      const at = `${where}:${index + 1}`
      for (const match of line.matchAll(COMPOSED_ID)) {
        say(
          'FAIL',
          at,
          `'${match[2]}' is an id with something joined on — a service_id is the bare id (${match[2].split(/[_-]/)[0]}?); ${SEARCH_HINT}`
        )
      }
      for (const match of line.matchAll(SLUG_USE)) {
        if (!slugs.has(match[2])) slugs.set(match[2], [])
        slugs.get(match[2]).push(at)
      }
      for (const match of line.matchAll(VERSION_USE)) versionUses.push({ slug: match[2], event: match[4], version: match[6], where: at })
      for (const match of line.matchAll(SLUG_LIST)) {
        for (const slug of match[1].split(',').filter(Boolean)) {
          if (!slugs.has(slug)) slugs.set(slug, [])
          slugs.get(slug).push(at)
        }
      }
      for (const match of line.matchAll(ID)) {
        // A few slugs look like ids (rowzffkpcszo); one handed to serviceIdFor is a slug, checked below.
        if ([...line.matchAll(SLUG_USE)].some((use) => use[2] === match[0])) continue
        // versionIdFor(app, 'row1jrbor', 'V107') names the event by its plain id; the version id is what it returns.
        const eventArg = [...line.matchAll(EVENT_ARG)].some((use) => use[2] === match[0])
        const version = !eventArg && EXPECTS_VERSION.test(line)
        const plain = eventArg || EXPECTS_PLAIN.test(line)
        const expects =
          EXPECTS_SERVICE.test(line) && !version && !plain ? 'service' : version && !plain ? 'version' : plain && !version ? 'plain' : null
        if (!ids.has(match[0])) ids.set(match[0], [])
        ids.get(match[0]).push({ where: at, expects })
      }
      for (const match of line.matchAll(VIASOCKET_URL)) urls.push({ where: at, url: match[0] })
    })
  }
}

if (!filesScanned) {
  say('FAIL', '', `nothing to scan under ${roots.join(', ')} — pass the folder that holds the integration`)
}

// ---- URLs -----------------------------------------------------------------------------------
for (const { where, url } of urls) {
  // A base URL in a constant (`https://flow-api.viasocket.com`) counts as its prefix.
  if (KNOWN_URL_PREFIXES.some((prefix) => `${url}/`.startsWith(prefix))) continue
  say(
    'FAIL',
    where,
    `${url} is a viasocket URL built by hand — the connect popup is opened only by openViasocketConnection (${CONNECT_SCRIPT}); the prebuilt UI by viaSocket.mount; the API is ${API}; AI memory is https://memory-api.viasocket.com`
  )
}

// ---- ids, against the live catalog ------------------------------------------------------------
const lookup = async (serviceId) => {
  try {
    const res = await fetch(CATALOG, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId })
    })
    const body = await res.json()
    return body?.service?.name ? body : null
  } catch (error) {
    say('WARN', '', `catalog unreachable (${error?.message}) — ids could not be checked`)
    return null
  }
}

// ---- slugs, resolved the way serviceIdFor() resolves them ------------------------------------------
const resolveSlug = async (slug) => {
  try {
    const res = await fetch(`${SLUG_URL}?service=${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(30000) })
    const body = await res.json()
    return { serviceId: body?.data?.plugins?.[slug]?.rowid || null }
  } catch (error) {
    return { error }
  }
}
const slugServiceIds = new Set()
const serviceIdOfSlug = new Map()
for (const [slug, places] of slugs) {
  const { serviceId, error } = await resolveSlug(slug)
  // A known slug answers in well under a second; only an unknown one runs into the 30 s timeout.
  if (error && error?.name !== 'TimeoutError') say('WARN', places[0], `slug '${slug}' could not be checked (${error?.message})`)
  else if (!serviceId) say('FAIL', places[0], `'${slug}' is no app's slug — slugs are case-sensitive and copied exactly; ${SEARCH_HINT}`)
  else {
    say('PASS', '', `slug ${slug} resolves to ${serviceId} (${places.length} place${places.length === 1 ? '' : 's'})`)
    slugServiceIds.add(serviceId)
    serviceIdOfSlug.set(slug, serviceId)
  }
}

const services = new Map() // service_id → { name, actions, triggers }
const batch = [...new Set([...ids.keys(), ...slugServiceIds])]
for (let i = 0; i < batch.length; i += 6) {
  const results = await Promise.all(batch.slice(i, i + 6).map((id) => lookup(id).then((app) => [id, app])))
  for (const [id, app] of results) if (app) services.set(id, app)
}
const kinds = new Map() // id → { kind, app, pair }
for (const [serviceId, app] of services) {
  if (ids.has(serviceId)) kinds.set(serviceId, { kind: 'service', app: app.service.name })
  for (const action of app.actions || []) {
    kinds.set(action.action_id, {
      kind: 'plain',
      what: 'action_id',
      app: app.service.name,
      name: action.name,
      pair: action.action_version_id
    })
    kinds.set(action.action_version_id, {
      kind: 'version',
      what: 'action_version_id',
      app: app.service.name,
      name: action.name,
      pair: action.action_id
    })
  }
  for (const trigger of app.triggers || []) {
    kinds.set(trigger.trigger_id, {
      kind: 'plain',
      what: 'trigger_id',
      app: app.service.name,
      name: trigger.name,
      pair: trigger.trigger_version_id
    })
    kinds.set(trigger.trigger_version_id, {
      kind: 'version',
      what: 'trigger_version_id',
      app: app.service.name,
      name: trigger.name,
      pair: trigger.trigger_id
    })
  }
}

// ---- versions named in code: the event exists and the version is the published one ---------------
const eventPath = (name) =>
  `${name || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
for (const use of versionUses) {
  const app = services.get(serviceIdOfSlug.get(use.slug))
  if (!app) continue // the slug itself was reported above
  const all = [...(app.actions || []), ...(app.triggers || [])]
  const byId = all.filter((e) => e.action_id === use.event || e.trigger_id === use.event)
  const found = byId.length ? byId : all.filter((e) => eventPath(e.name) === use.event)
  if (found.length !== 1) say('FAIL', use.where, `'${use.event}' is no single event of ${use.slug}: use the path or id its app page lists`)
  else if (found[0].versionid && found[0].versionid !== use.version)
    say(
      'FAIL',
      use.where,
      `${use.slug}/${use.event} is published as ${found[0].versionid}, not ${use.version}: reread its page and update the code`
    )
  else say('PASS', '', `${use.slug}/${use.event} ${use.version} is the published version`)
}

const appNames = [...services.values()].map((app) => app.service.name)
for (const [id, uses] of ids) {
  const known = kinds.get(id)
  if (!known) {
    const serviceUse = uses.find((use) => use.expects === 'service')
    if (serviceUse) say('FAIL', serviceUse.where, `'${id}' names no app — ${SEARCH_HINT}`)
    else
      say(
        'WARN',
        uses[0].where,
        `'${id}' is not an id of ${appNames.length ? appNames.join(', ') : 'any app whose slug or service_id appears in the code'} — a typo, or an app whose slug is missing from the code (used in ${uses.length} place${uses.length === 1 ? '' : 's'})`
      )
    continue
  }
  if (known.kind === 'service') {
    say('PASS', '', `${id} is ${known.app} (service_id, ${uses.length} place${uses.length === 1 ? '' : 's'})`)
    for (const use of uses) {
      if (use.expects === 'plain' || use.expects === 'version')
        say('FAIL', use.where, `'${id}' is ${known.app}'s service_id, but this line takes an action's or trigger's id`)
    }
    continue
  }
  say('PASS', '', `${id} is ${known.app}'s ${known.what} for "${known.name}"`)
  for (const use of uses) {
    if (!use.expects || use.expects === known.kind) continue
    if (use.expects === 'service') say('FAIL', use.where, `'${id}' is ${known.app}'s ${known.what}, but this line takes the service_id`)
    else
      say(
        'FAIL',
        use.where,
        `'${id}' is ${known.app}'s ${known.what}, but this line takes the ${known.kind === 'plain' ? 'version id' : 'plain id'} — for "${known.name}" that is ${known.pair}`
      )
  }
}

// ---- the connect script and the token ----------------------------------------------------------
if (mentionsConnect) {
  try {
    const res = await fetch(CONNECT_SCRIPT)
    const text = res.ok ? await res.text() : ''
    if (text.includes('openViasocketConnection')) say('PASS', '', `connect script loads from ${CONNECT_SCRIPT}`)
    else
      say(
        'FAIL',
        '',
        `${CONNECT_SCRIPT} answered ${res.status} without openViasocketConnection — load the connect script from this URL and nowhere else`
      )
  } catch (error) {
    say('WARN', '', `connect script unreachable (${error?.message})`)
  }
}

if (EMBED_TOKEN) {
  try {
    const res = await fetch(`${API}/embed/authentications`, { headers: { authorization: EMBED_TOKEN } })
    if (res.status === 200) say('PASS', '', 'embed token accepted by /embed/authentications')
    else say('FAIL', '', `embed token refused (${res.status}) — the secret or the org/project ids are wrong`)
  } catch (error) {
    say('WARN', '', `${API} unreachable (${error?.message})`)
  }
} else say('INFO', '', 'VIASOCKET_TEST_EMBED_TOKEN not set — token check skipped')

console.log(
  findings.FAIL
    ? `${findings.FAIL} FAIL, ${findings.WARN} WARN — fix every FAIL; paste this output in your report`
    : `0 FAIL, ${findings.WARN} WARN over ${filesScanned} file${filesScanned === 1 ? '' : 's'} — paste this output in your report`
)
process.exit(findings.FAIL ? 1 : 0)
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="13085d9b-6906-56f8-ac35-296d44d1a2c0")}catch(e){}}();
//# debugId=13085d9b-6906-56f8-ac35-296d44d1a2c0
