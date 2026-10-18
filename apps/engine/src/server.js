// HTTP server: GET /health (no auth), POST /run (x-trigger-key) → 202 and runs in the background.

import http from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { getConfig, ConfigError } from './config.js'
import { log, registerSecrets, setLevel } from './util/log.js'
import { getStore } from './store.js'
import { createNotifier } from './notify.js'
import { runPipeline } from './orchestrator.js'

/** Constant-time comparison; hashing first makes lengths equal so length isn't leaked either. */
export function keysMatch(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * @param {{ triggerKey: string, run: () => Promise<any> }} deps  run() executes one pipeline.
 */
export function createServer({ triggerKey, run }) {
  let running = null

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, running: Boolean(running) })
    if (path === '/run') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
      if (!keysMatch(req.headers['x-trigger-key'], triggerKey)) return send(res, 401, { error: 'unauthorized' })
      if (running) return send(res, 409, { error: 'a run is already in progress' })
      running = Promise.resolve()
        .then(run)
        .then((result) => log.info('background run finished', { briefId: result?.briefId, state: result?.state }))
        .catch((error) => log.error('background run crashed', { error }))
        .finally(() => { running = null })
      return send(res, 202, { accepted: true })
    }
    send(res, 404, { error: 'not found' })
  })
  server.isRunning = () => Boolean(running)
  return server
}

async function main() {
  let config
  try {
    config = getConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message)
      process.exit(2)
    }
    throw error
  }
  registerSecrets(config.secretValues)
  setLevel(config.runtime.logLevel)
  if (!config.runtime.triggerKey || config.runtime.triggerKey.length < 16) {
    console.error('Invalid configuration:\n  - PIPELINE_TRIGGER_KEY: required for the server, at least 16 characters')
    process.exit(2)
  }
  const store = getStore()
  const notifier = createNotifier({ config })
  const server = createServer({ triggerKey: config.runtime.triggerKey, run: () => runPipeline({ config, store, notifier }) })
  const port = Number(process.env.PORT) || 8080
  server.listen(port, () => log.info('server listening', { port, dryRun: config.runtime.dryRun }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
