// npm run package:embarko [-- --prebuilt] — builds the folder that is uploaded to Embarko (one app = one folder with
// its own package.json; the repo root and its workspaces cannot be uploaded as they are).
//
//   .embarko-stage/                 (gitignored; this is exactly what Embarko receives)
//     package.json                  derived: the engine's dependencies, @m91/content as file:vendor/content,
//                                   "build" builds the dashboard, "start" runs src/server.js with a heap cap
//     src/                          the engine
//     vendor/content/               packages/content (post format), as a local dependency
//     dashboard/                    the dashboard sources (built on Embarko), or only dist/ with --prebuilt
//     embarko.json                  the app id (after the first deploy), if apps/engine/embarko.json exists
//
// Nothing is copied unless it is named here (an allowlist), and the finished folder is scanned: a .env file, the
// data/ or exports/ folder, node_modules, key files or anything that looks like a secret stops the packaging.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ENGINE = resolve(fileURLToPath(new URL('..', import.meta.url)))
const REPO = resolve(ENGINE, '..', '..')
export const STAGE = join(REPO, '.embarko-stage')
export const APP_HEAP_MB = 200 // the app has 256 MB in all

/** Names that must never be in the upload (matched on every path segment). */
export const FORBIDDEN = Object.freeze([/^\.env($|\.)/i, /^data$/i, /^exports$/i, /^drafts$/i, /^node_modules$/i, /^\.git$/i, /^dockerfile$/i, /\.(pem|key|p12|pfx)$/i, /^id_(rsa|ed25519)/i, /^\.npmrc$/i, /^credentials$/i])
/** Text that looks like a secret (the same families the pre-push scan looks for). */
export const SECRET_TEXT = Object.freeze([/sk-[A-Za-z0-9]{16,}/, /m0-[A-Za-z0-9]{16,}/, /xox[bp]-[A-Za-z0-9-]{10,}/, /ghp_[A-Za-z0-9]{20,}/, /eyJ[A-Za-z0-9_-]{20,}\./, /https:\/\/flow\.sokt\.io\/func\/[A-Za-z0-9]+/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/])

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))

/** The package.json that Embarko installs from. */
export function stagePackage({ engine, prebuilt = false }) {
  const dependencies = { ...engine.dependencies, '@m91/content': 'file:vendor/content' }
  return {
    name: 'm91-engine',
    version: engine.version,
    private: true,
    description: 'M91 Blog Engine (engine + dashboard), hosted on Embarko',
    type: 'module',
    engines: { node: '>=22.12.0' },
    scripts: {
      ...(prebuilt ? {} : { build: 'npm --prefix dashboard ci --include=dev && npm --prefix dashboard run build:embarko' }),
      start: `node --max-old-space-size=${APP_HEAP_MB} src/server.js`
    },
    dependencies
  }
}

/** Every path (relative, "/" separators) under dir. */
function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    out.push(relative(base, full).split(sep).join('/'))
    if (statSync(full).isDirectory()) walk(full, base, out)
  }
  return out
}

/** Problems found in a finished folder: forbidden names and secret-looking text. Empty means clean. */
export function scanStage(dir) {
  const problems = []
  for (const rel of walk(dir)) {
    const segs = rel.split('/')
    if (segs.some((s) => FORBIDDEN.some((re) => re.test(s)))) problems.push(`forbidden path: ${rel}`)
    const full = join(dir, rel)
    if (statSync(full).isFile() && statSync(full).size < 2_000_000 && !/\.(png|ico|woff2?|jpg|jpeg|gif)$/i.test(rel)) {
      const text = readFileSync(full, 'utf8')
      for (const re of SECRET_TEXT) if (re.test(text)) problems.push(`looks like a secret in ${rel}`)
    }
  }
  return problems
}

export function buildStage({ prebuilt = false, stage = STAGE, engineDir = ENGINE, repoDir = REPO } = {}) {
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  const skip = (src) => !/(^|[\\/])(node_modules|\.git|\.env[^\\/]*|data|exports|dist|test|coverage)([\\/]|$)/i.test(relative(repoDir, src))
  const engine = read(join(engineDir, 'package.json'))
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(stagePackage({ engine, prebuilt }), null, 2)}\n`)
  cpSync(join(engineDir, 'src'), join(stage, 'src'), { recursive: true, filter: skip })
  cpSync(join(repoDir, 'packages', 'content'), join(stage, 'vendor', 'content'), { recursive: true, filter: skip })
  const dash = join(engineDir, 'dashboard')
  if (prebuilt) {
    if (!existsSync(join(dash, 'dist', 'index.html'))) throw new Error('--prebuilt needs a built dashboard: run "npm run build:dashboard" first')
    cpSync(join(dash, 'dist'), join(stage, 'dashboard', 'dist'), { recursive: true })
  } else {
    // The sources, built on Embarko (vite only: the type check runs here, in the tests).
    cpSync(dash, join(stage, 'dashboard'), { recursive: true, filter: (src) => skip(src) && !/(^|[\\/])scripts([\\/]|$)/.test(relative(dash, src)) })
    const dp = read(join(dash, 'package.json'))
    dp.scripts = { ...dp.scripts, 'build:embarko': 'vite build' }
    writeFileSync(join(stage, 'dashboard', 'package.json'), `${JSON.stringify(dp, null, 2)}\n`)
  }
  if (existsSync(join(engineDir, 'embarko.json'))) cpSync(join(engineDir, 'embarko.json'), join(stage, 'embarko.json'))
  return { stage, problems: scanStage(stage) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prebuilt = process.argv.includes('--prebuilt')
  const { stage, problems } = buildStage({ prebuilt })
  if (problems.length) {
    console.error(`Packaging stopped, nothing to upload:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    rmSync(stage, { recursive: true, force: true })
    process.exit(1)
  }
  // A lock file makes the installs on Embarko repeatable; without network the packaging still works.
  const lock = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, shell: true, encoding: 'utf8' })
  if (lock.status !== 0) console.warn('Note: no package-lock.json was made (is the network up?). Embarko will resolve the versions when it installs.')
  const files = walk(stage)
  console.log(`Ready to upload: ${stage}\n  ${files.filter((f) => statSync(join(stage, f)).isFile()).length} files, top level: ${readdirSync(stage).join(', ')}${prebuilt ? ' (prebuilt dashboard)' : ' (the dashboard is built on Embarko)'}`)
}
