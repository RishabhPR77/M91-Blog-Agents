// npm run sync:blog-preview — copies the M91 blog's renderer and stylesheet into the dashboard, so the Write page's
// preview is the blog page itself (same code, same CSS). test/blog-preview-sync.test.js fails when the copies differ.
import { copyFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENGINE = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BLOG = resolve(ENGINE, '..', 'm91-blog')

/** [blog file, dashboard copy] */
export const PREVIEW_FILES = Object.freeze([
  [join(BLOG, 'src', 'markdown.js'), join(ENGINE, 'dashboard', 'src', 'blogpreview', 'markdown.js')],
  [join(BLOG, 'src', 'pages.js'), join(ENGINE, 'dashboard', 'src', 'blogpreview', 'pages.js')],
  [join(BLOG, 'public', 'blog.css'), join(ENGINE, 'dashboard', 'src', 'blogpreview', 'blog.css')]
])

export const sameFile = (a, b) => readFileSync(a).equals(readFileSync(b))

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [from, to] of PREVIEW_FILES) {
    copyFileSync(from, to)
    console.log(`copied ${from} -> ${to}`)
  }
}
