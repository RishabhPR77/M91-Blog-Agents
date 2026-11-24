// The Write page's preview uses copies of the M91 blog's renderer and stylesheet: they must be the blog's own files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PREVIEW_FILES, sameFile } from '../scripts/sync-blog-preview.mjs'

test('the dashboard preview files are exact copies of the blog\'s (run npm run sync:blog-preview after changing the blog)', () => {
  for (const [blog, copy] of PREVIEW_FILES) assert.ok(sameFile(blog, copy), `${copy} differs from ${blog}`)
})
