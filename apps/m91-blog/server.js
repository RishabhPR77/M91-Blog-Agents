// The M91 blog server: `npm start`. Embarko sets PORT; it listens on every address (0.0.0.0).
import http from 'node:http'
import { loadConfig } from './src/config.js'
import { createApp } from './src/app.js'

const cfg = loadConfig()
const log = (level, message, data = {}) => console[level === 'error' ? 'error' : 'log'](JSON.stringify({ level, message, ...data, at: new Date().toISOString() }))
const app = createApp(cfg, { log })

const server = http.createServer((req, res) => {
  app.handle(req, res).catch((error) => {
    log('error', 'request crashed', { error: error.message })
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Internal error\n')
  })
})
server.listen(cfg.port, cfg.host, () => log('info', 'M91 blog listening', { port: cfg.port, engine: cfg.engineUrl, site: cfg.siteUrl }))
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)))
