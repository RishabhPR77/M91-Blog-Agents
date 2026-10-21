// Loads the post JSON files (format v1, validated with @m91/content). Plain JS so astro.config.mjs can use it.
//
// - Content: src/content/posts/*.json, written by the engine's Publisher. BLOG_CONTENT_DIR may point
//   elsewhere (tests only: it is a path, never a secret, and the Publisher does not set it).
// - Samples: samples/*.json, used ONLY by `astro dev` when the content folder has no post. A build never
//   includes them.
// - Any invalid post, or two posts with one slug, stops the build with a clear message.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// @m91/content reads its schema file next to itself, so it must load from node_modules as is: a runtime
// import Vite cannot bundle (bundling it moves the code away from post.schema.json).
const contentEntry = createRequire(resolve(process.cwd(), 'package.json')).resolve('@m91/content')
const { validatePost } = await import(/* @vite-ignore */ pathToFileURL(contentEntry).href)

export const contentDir = () => resolve(process.cwd(), process.env.BLOG_CONTENT_DIR || 'src/content/posts')
export const samplesDir = () => resolve(process.cwd(), 'samples')

function readFolder(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    let post
    try {
      post = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (error) {
      throw new Error(`Invalid post file ${file}: not valid JSON (${error.message})`)
    }
    let { valid, errors } = validatePost(post)
    // A bad guide never stops the build (Phase 10): the guide is dropped and the post shows its blocks or Markdown.
    if (!valid && errors.some((e) => e.startsWith('/guide'))) {
      console.warn(`[guide] ${file}: guide not valid, showing the post without it:\n  - ${errors.filter((e) => e.startsWith('/guide')).slice(0, 5).join('\n  - ')}`)
      post = { ...post, guide: null }
      ;({ valid, errors } = validatePost(post))
    }
    // Bad blocks never stop the build or break a page (Phase 8): the post is shown as its Markdown instead.
    if (!valid && errors.every((e) => e.startsWith('/blocks'))) {
      console.warn(`[blocks] ${file}: blocks not valid, showing the post's Markdown instead:\n  - ${errors.slice(0, 5).join('\n  - ')}`)
      return { ...post, blocks: null }
    }
    if (!valid) throw new Error(`Invalid post file ${file} (format v1):\n  - ${errors.join('\n  - ')}`)
    return post
  })
}

/** { posts (newest first), sample } — sample is true only when dev fell back to samples/. */
export function loadPosts({ dev = false } = {}) {
  let posts = readFolder(contentDir())
  let sample = false
  if (!posts.length && dev) {
    posts = readFolder(samplesDir())
    sample = posts.length > 0
  }
  const seen = new Set()
  for (const p of posts) {
    if (seen.has(p.slug)) throw new Error(`Two posts use the slug "${p.slug}": each slug must be unique`)
    seen.add(p.slug)
  }
  posts.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || a.slug.localeCompare(b.slug))
  return { posts, sample }
}
