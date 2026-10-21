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

// Phase 10 D1: the engine's page preview builds one waiting post under /preview/<brief_id>/ (local, noindex).
const PREVIEW_BASE = process.env.BLOG_PREVIEW_BASE
if (PREVIEW_BASE !== undefined && !/^\/preview\/[A-Za-z0-9-]+\/$/.test(PREVIEW_BASE)) throw new Error(`BLOG_PREVIEW_BASE must look like /preview/<brief_id>/ (got ${PREVIEW_BASE})`)

// Noindex posts and the 404 page stay out of the sitemap.
const excluded = new Set([...noindexPaths(), '/404/'].map((p) => new URL(BASE_PATH.replace(/\/$/, '') + p, SITE_URL).href))

export default defineConfig({
  site: SITE_URL,
  base: PREVIEW_BASE ?? BASE_PATH,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // A preview has no sitemap: nothing in it is for search engines.
  integrations: PREVIEW_BASE ? [] : [sitemap({ filter: (page) => !excluded.has(page) })],
  // assetsInlineLimit 0: block scripts (Phase 8) ship as files from 'self', never inline in the HTML.
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } },
  devToolbar: { enabled: false }
})
