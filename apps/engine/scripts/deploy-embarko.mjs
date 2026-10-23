// npm run deploy:embarko -- --yes [--prebuilt] [--name=m91-engine] — packages the engine and dashboard (see
// package-embarko.mjs) and uploads them with the embarko-deploy skill's deploy.sh.
//
// Without --yes it only packages and says what it would do (nothing is uploaded). The token comes from the process
// environment only (EMBARKO_DEPLOY_TOKEN, loaded with `node --env-file=../../.env`): it is never read from a file here,
// never printed, and masked in everything this script prints. A deploy without a token is refused: Embarko would make a
// temporary app that is deleted after 24 hours.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStage, STAGE } from './package-embarko.mjs'

const ENGINE = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const DEFAULT_NAME = 'm91-engine'

/** Replaces the token wherever it appears. */
export const maskToken = (text, token) => (token ? String(text).split(token).join('***') : String(text))

export function deployScriptPath(env = process.env) {
  return env.EMBARKO_DEPLOY_SCRIPT || join(homedir(), '.claude', 'skills', 'embarko-deploy', 'scripts', 'deploy.sh')
}

/**
 * The bash that runs deploy.sh. On Windows a bare "bash" from PowerShell is often WSL's (WindowsApps), which cannot see
 * C:/ paths, so Git Bash is preferred: EMBARKO_BASH, else Git for Windows' usual places, else "bash".
 */
export function bashPath(env = process.env, { platform = process.platform, exists = existsSync } = {}) {
  if (env.EMBARKO_BASH) return env.EMBARKO_BASH
  if (platform !== 'win32') return 'bash'
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean)
  return roots.map((r) => join(r, 'Git', 'bin', 'bash.exe')).find((p) => exists(p)) ?? 'bash'
}

/** The version label: engine version, short commit, time (unique per upload). */
export function versionLabel(now = new Date()) {
  const pkg = JSON.parse(readFileSync(join(ENGINE, 'package.json'), 'utf8'))
  const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ENGINE, encoding: 'utf8' }).stdout?.trim() || 'nogit'
  return `${pkg.version}-${sha}-${now.toISOString().replace(/[-:T]/g, '').slice(0, 12)}`
}

async function main() {
  const args = process.argv.slice(2)
  const yes = args.includes('--yes')
  const prebuilt = args.includes('--prebuilt')
  const name = args.find((a) => a.startsWith('--name='))?.slice(7) || DEFAULT_NAME
  const token = process.env.EMBARKO_DEPLOY_TOKEN?.trim()
  const { stage, problems } = buildStage({ prebuilt })
  if (problems.length) {
    console.error(`Packaging stopped, nothing was uploaded:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`Packaged ${stage} (${prebuilt ? 'prebuilt dashboard' : 'the dashboard is built on Embarko'}).`)
  if (!yes) {
    console.log(`Not uploaded: add --yes to deploy it as "${name}".`)
    return
  }
  if (!token) {
    console.error('EMBARKO_DEPLOY_TOKEN is not set in the environment, so nothing was uploaded (a deploy without it would be a temporary app). Run it with:  node --env-file=../../.env scripts/deploy-embarko.mjs --yes')
    process.exit(1)
  }
  const script = deployScriptPath()
  if (!existsSync(script)) {
    console.error(`The embarko-deploy script was not found at ${script}. Set EMBARKO_DEPLOY_SCRIPT to its path.`)
    process.exit(1)
  }
  const child = spawn(bashPath(), [script.replace(/\\/g, '/'), STAGE.replace(/\\/g, '/'), name, versionLabel()], {
    env: { ...process.env, DEPLOY_TOKEN: token, EMBARKO_APP_TYPE: 'admin dashboard', EMBARKO_AGENT_NAME: 'claude-code' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (d) => process.stdout.write(maskToken(d, token)))
  child.stderr.on('data', (d) => process.stderr.write(maskToken(d, token)))
  child.on('close', (code) => process.exit(code ?? 1))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
