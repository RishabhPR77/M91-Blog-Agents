// The blog's production build as a child process, and the checks on its output before any upload
// (Phase 7 C4 steps 4–5).

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { BLOG_DIR } from './export.js'

export class BlogBuildError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'BlogBuildError'
    if (details) this.details = details
  }
}

/**
 * The child's environment: only what Node and npm need to run (path, home, temp, Windows system folders).
 * The engine's process has .env values loaded; none of them reaches the blog build.
 */
export function buildEnv(env = process.env) {
  const keep = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG']
  const out = Object.fromEntries(keep.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]))
  return { ...out, NODE_ENV: 'production', ASTRO_TELEMETRY_DISABLED: '1' }
}

/**
 * Runs the blog build (node scripts/astro.mjs build in apps/blog). onLine(level, text) gets its warning and
 * error lines (trimmed). Resolves { ms, dist }; rejects with BlogBuildError on a failure or the timeout.
 */
export function runBlogBuild({ blogDir = BLOG_DIR, timeoutMs, onLine = () => {}, spawnFn = spawn, outDir = null, extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    // outDir / extraEnv: the page preview (Phase 10 D1) builds elsewhere, with its content folder and base path (no secrets).
    const args = [join(blogDir, 'scripts', 'astro.mjs'), 'build', ...(outDir ? ['--outDir', outDir] : [])]
    const child = spawnFn(process.execPath, args, { cwd: blogDir, env: { ...buildEnv(), ...extraEnv }, windowsHide: true })
    const tail = []
    const take = (chunk) => {
      for (const raw of String(chunk).split(/\r?\n/)) {
        const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim()
        if (!line) continue
        tail.push(line)
        if (tail.length > 40) tail.shift()
        if (/\b(error|failed|invalid)\b/i.test(line)) onLine('error', line.slice(0, 300))
        else if (/\bwarn(ing)?\b/i.test(line)) onLine('warn', line.slice(0, 300))
      }
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    const timer = setTimeout(() => {
      child.kill()
      reject(new BlogBuildError(`the blog build took longer than BLOG_BUILD_TIMEOUT_MS (${timeoutMs} ms)`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new BlogBuildError(`the blog build could not start: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve({ ms: Date.now() - started, dist: outDir ?? join(blogDir, 'dist') })
      const reason = tail.filter((l) => /error|invalid|failed/i.test(l)).slice(-3).join(' | ') || tail.slice(-3).join(' | ')
      reject(new BlogBuildError(`the blog build failed (exit ${code}): ${reason.slice(0, 600)}`, { tail }))
    })
  })
}

// The git secret-scan patterns (keys, tokens, JWTs, webhook script ids), plus the exact secret values.
const SECRET_PATTERNS = [/sk_[0-9a-f]{8,}/, /\bm0-[A-Za-z0-9]{10,}/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /flow\.sokt\.io\/func\/scri[A-Za-z0-9]{6,}/, /ghp_[A-Za-z0-9]{20,}/, /xox[bpa]-[A-Za-z0-9-]+/, /Bearer\s+[A-Za-z0-9._-]{16,}/]
const TEXT = new Set(['.html', '.xml', '.txt', '.js', '.mjs', '.css', '.json', '.svg', '.map', '.webmanifest'])

const filesOf = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? filesOf(join(dir, f)) : [join(dir, f)]))

/**
 * Before any upload: the post page exists (when a slug is given), no .env file, and no file holds a
 * secret-looking string or one of the configured secret values. Returns { files }; throws BlogBuildError.
 */
export function checkBuild(dist, { slug, secretValues = [] } = {}) {
  if (!existsSync(join(dist, 'index.html'))) throw new BlogBuildError('the build has no index.html at the top')
  if (slug && !existsSync(join(dist, 'posts', slug, 'index.html'))) throw new BlogBuildError(`the build has no page for the post ${slug}`)
  const files = filesOf(dist)
  const problems = []
  for (const f of files) {
    const rel = f.slice(dist.length + 1).replace(/\\/g, '/')
    if (/^\.env/i.test(basename(f))) problems.push(`${rel} is an env file`)
    if (!TEXT.has(extname(f).toLowerCase())) continue
    const text = readFileSync(f, 'utf8')
    if (SECRET_PATTERNS.some((re) => re.test(text)) || secretValues.some((s) => s && text.includes(s))) problems.push(`${rel} contains a secret-looking string`)
  }
  if (problems.length) throw new BlogBuildError(`the build output failed its safety check: ${problems.slice(0, 5).join('; ')}`)
  return { files: files.length }
}
