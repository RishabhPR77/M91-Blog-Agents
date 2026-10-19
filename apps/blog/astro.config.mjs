// The M91 blog: static output only. Posts come from JSON files (src/content/posts, written by the engine's
// Publisher); nothing is read from .env.
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { noindexPaths } from './src/lib/noindex.mjs'

// site.ts is TypeScript; read its two public constants without a build step.
const siteSource = readFileSync(new URL('./src/config/site.ts', import.meta.url), 'utf8')
const SITE_URL = siteSource.match(/^export const SITE_URL = '([^']+)'$/m)[1]
const BASE_PATH = siteSource.match(/^export const BASE_PATH = '([^']*)'$/m)[1]

// Noindex posts and the 404 page stay out of the sitemap.
const excluded = new Set([...noindexPaths(), '/404/'].map((p) => new URL(BASE_PATH.replace(/\/$/, '') + p, SITE_URL).href))

export default defineConfig({
  site: SITE_URL,
  base: BASE_PATH,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap({ filter: (page) => !excluded.has(page) })],
  vite: { plugins: [tailwindcss()] },
  devToolbar: { enabled: false }
})
