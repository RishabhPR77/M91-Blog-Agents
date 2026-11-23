// npm run deploy -- --yes [--name=m91-blog] — uploads this folder to Embarko as its own app (https://m91-blog.embarko.app)
// with the embarko-deploy skill's deploy.sh. The blog is separate from the engine (m91-engine) and uses its own token.
//
// The token: EMBARKO_BLOG_DEPLOY_TOKEN or DEPLOY_TOKEN in the environment, else the file ~/.embarko/m91-blog.token
// (outside the repo, one line).
// It is never printed (masked in everything this script prints) and never written anywhere. Without a token nothing is
// uploaded: Embarko would make a temporary app that is deleted after 24 hours. Without --yes it only says what it would do.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const DEFAULT_NAME = 'm91-blog'
export const TOKEN_FILE = join(homedir(), '.embarko', 'm91-blog.token')

export const maskToken = (text, token) => (token ? String(text).split(token).join('***') : String(text))

export function readToken(env = process.env, file = TOKEN_FILE) {
  const fromEnv = env.EMBARKO_BLOG_DEPLOY_TOKEN?.trim() || env.DEPLOY_TOKEN?.trim()
  if (fromEnv) return fromEnv
  return existsSync(file) ? readFileSync(file, 'utf8').trim() || null : null
}

export function deployScriptPath(env = process.env) {
  return env.EMBARKO_DEPLOY_SCRIPT || join(homedir(), '.claude', 'skills', 'embarko-deploy', 'scripts', 'deploy.sh')
}

/** Git Bash on Windows (a bare "bash" there is often WSL's, which cannot see C:/ paths). */
export function bashPath(env = process.env, { platform = process.platform, exists = existsSync } = {}) {
  if (env.EMBARKO_BASH) return env.EMBARKO_BASH
  if (platform !== 'win32') return 'bash'
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean)
  return roots.map((r) => join(r, 'Git', 'bin', 'bash.exe')).find((p) => exists(p)) ?? 'bash'
}

export function versionLabel(now = new Date()) {
  const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'))
  const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: APP, encoding: 'utf8' }).stdout?.trim() || 'nogit'
  return `${pkg.version}-${sha}-${now.toISOString().replace(/[-:T]/g, '').slice(0, 12)}`
}

function main() {
  const args = process.argv.slice(2)
  const name = args.find((a) => a.startsWith('--name='))?.slice(7) || DEFAULT_NAME
  if (!args.includes('--yes')) {
    console.log(`Would upload ${APP} to Embarko as "${name}". Add --yes to deploy.`)
    return
  }
  const token = readToken()
  if (!token) {
    console.error(`No deploy token: set EMBARKO_BLOG_DEPLOY_TOKEN or save the token in ${TOKEN_FILE}. Nothing was uploaded.`)
    process.exit(1)
  }
  const script = deployScriptPath()
  if (!existsSync(script)) {
    console.error(`The embarko-deploy script was not found at ${script}. Set EMBARKO_DEPLOY_SCRIPT to its path.`)
    process.exit(1)
  }
  const child = spawn(bashPath(), [script.replace(/\\/g, '/'), APP.replace(/\\/g, '/'), name, versionLabel()], {
    env: { ...process.env, DEPLOY_TOKEN: token, EMBARKO_APP_TYPE: 'blog', EMBARKO_AGENT_NAME: 'claude-code' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (d) => process.stdout.write(maskToken(d, token)))
  child.stderr.on('data', (d) => process.stderr.write(maskToken(d, token)))
  child.on('close', (code) => process.exit(code ?? 1))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
