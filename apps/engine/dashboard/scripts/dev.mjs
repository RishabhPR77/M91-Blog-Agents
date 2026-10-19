// `npm run dev:ui` (from apps/engine): starts the Vite dev server for the dashboard. It is started with
// --env-file=../../.env only so vite.config.ts sees PORT and DASHBOARD_PORT; nothing is passed to the browser.
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root, configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)) })
await server.listen()
server.printUrls()
