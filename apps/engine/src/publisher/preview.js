// The page preview (Phase 10 D1): before approving, the editor sees the waiting post exactly as the blog will
// render it, guide included. Code only, no AI. The post JSON is built the way the Publisher builds it, written
// alone into data/previews/<brief_id>/content, and the blog is built with base path /preview/<brief_id>/ into
// data/previews/<brief_id>/dist. The engine serves that folder at /preview/<brief_id>/ (local, noindex).
// Nothing is saved to Mem0 and nothing is deployed.

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { istIso } from '../util/time.js'
import { BRIEF_ID_RE } from '../util/ids.js'
import { loadBrief } from '../writer/inputs.js'
import { draftsOf, draftVersion, draftBriefVersion } from '../writer/save.js'
import { bodyMarkdown } from '../designer/parts.js'
import { isInteractive, latestGuideDoc } from '../experience/index.js'
import { buildPost, planDocsRewrite } from './post.js'
import { chooseGuide } from './blocks.js'
import { runBlogBuild, checkBuild } from './build.js'
import { BLOG_DIR } from './export.js'

/** apps/engine/data/previews (gitignored, on the same drive as the blog so Astro can move its files). */
export const PREVIEW_ROOT = fileURLToPath(new URL('../../data/previews/', import.meta.url))

export class PreviewError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = 'PreviewError'
    this.code = code
    this.status = status
  }
}

export const previewBase = (briefId) => `/preview/${briefId}/`
export const previewDir = (briefId, root = PREVIEW_ROOT) => join(root, briefId)

/** The preview's manifest (slug, version, when it was built), or null when there is none. */
export function readPreview(briefId, root = PREVIEW_ROOT) {
  if (!BRIEF_ID_RE.test(String(briefId))) return null
  try {
    return JSON.parse(readFileSync(join(previewDir(briefId, root), 'preview.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Builds the preview of a brief's newest draft (waiting, approved or published).
 * @param {{ briefId, store, config, now?, root?, blogDir?, build?, fetch? }} input  build, fetch: injectable for tests
 * @returns {{ brief_id, version, slug, url, guide, note, built_at, ms, warnings }}
 */
export async function buildPreview({ briefId, store, config, now = Date.now, root = PREVIEW_ROOT, blogDir = BLOG_DIR, build, fetch = globalThis.fetch }) {
  if (!BRIEF_ID_RE.test(String(briefId))) throw new PreviewError('bad_brief_id', 'brief_id must look like YYMMDD-HHMM-XXXX', 400)
  const draft = (await draftsOf(store, briefId)).find((d) => ['awaiting_human', 'approved', 'published'].includes(d.status))
  if (!draft) throw new PreviewError('no_draft', `brief ${briefId} has no waiting, approved or published draft`, 404)
  const briefRec = await loadBrief(store, briefId, draftBriefVersion(draft))
  const version = draftVersion(draft)
  const doc = isInteractive(draft, config) ? await latestGuideDoc(store, briefId, version, draftBriefVersion(draft)) : null
  const picked = chooseGuide({ interactive: isInteractive(draft, config), doc, markdown: bodyMarkdown(draft.payload?.post_markdown) })
  // The same link fixes as the Publisher (old docs host → new, when the new page answers 200), so the preview matches.
  const docsPlan = await planDocsRewrite(draft.payload?.post_markdown, { fetch, cache: new Map(), timeoutMs: config.scout?.urlCheckTimeoutMs ?? 10000 })
  const { post, warnings } = buildPost({ draft, briefId, brief: briefRec?.payload ?? {}, published: [], config, now, istIso, blocks: null, guide: picked.guide, docsPlan })
  // A preview is never for search engines, whatever the post's own setting.
  const previewPost = { ...post, noindex: true }

  const dir = previewDir(briefId, root)
  rmSync(dir, { recursive: true, force: true })
  const content = join(dir, 'content')
  mkdirSync(content, { recursive: true })
  writeFileSync(join(content, `${post.slug}.json`), JSON.stringify(previewPost, null, 2) + '\n', 'utf8')
  const out = join(dir, 'dist')
  const run = build ?? ((opts) => runBlogBuild({ blogDir, timeoutMs: config.blog.buildTimeoutMs, ...opts }))
  const built = await run({ outDir: out, extraEnv: { BLOG_CONTENT_DIR: content, BLOG_PREVIEW_BASE: previewBase(briefId) } })
  checkBuild(built.dist, { slug: post.slug, secretValues: config.secretValues ?? [] })
  if (picked.warning) warnings.push(picked.warning)
  const manifest = {
    brief_id: briefId, version, status: draft.status, slug: post.slug, url: `${previewBase(briefId)}posts/${post.slug}/`,
    guide: Boolean(picked.guide), note: picked.note, built_at: istIso(new Date(now())), ms: built.ms ?? null, warnings
  }
  writeFileSync(join(dir, 'preview.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return manifest
}
