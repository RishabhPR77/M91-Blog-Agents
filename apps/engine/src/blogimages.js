// Images for the posts you write (2026-11-24). Saved under the engine's data folder (blog-images/), which Embarko keeps
// across deploys, named by their content (the same picture uploaded twice is one file). Only PNG, JPEG, GIF and WebP,
// recognised by their first bytes (never SVG: it can carry script). Public by name, for the blog:
// GET /api/public/images/<name>, shown on the blog as /images/<name>.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './util/runlock.js'
import { BlogError } from './blogposts.js'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const IMAGE_NAME_RE = /^[a-f0-9]{20}\.(png|jpg|gif|webp)$/
export const IMAGE_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' })

export const imagesDir = (config) => join(dataDir(config), 'blog-images')

/** The image's kind from its first bytes, or null. */
export function imageKind(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a') return 'gif'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

/** Saves an image. Returns { name, url, bytes, type }. Throws BlogError for an empty, too large or unknown file. */
export function saveImage(config, buf) {
  if (!buf?.length) throw new BlogError(400, 'no_image', 'the upload is empty')
  if (buf.length > MAX_IMAGE_BYTES) throw new BlogError(413, 'image_too_large', `the image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
  const kind = imageKind(buf)
  if (!kind) throw new BlogError(415, 'not_an_image', 'only PNG, JPEG, GIF and WebP images can be uploaded')
  const name = `${createHash('sha256').update(buf).digest('hex').slice(0, 20)}.${kind}`
  const dir = imagesDir(config)
  const file = join(dir, name)
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, buf)
    renameSync(tmp, file)
  }
  return { name, url: `/images/${name}`, bytes: buf.length, type: IMAGE_TYPES[kind] }
}

/** { body, type } of a saved image, or null. */
export function readImage(config, name) {
  const m = IMAGE_NAME_RE.exec(String(name ?? ''))
  if (!m) return null
  const file = join(imagesDir(config), name)
  if (!existsSync(file)) return null
  return { body: readFileSync(file), type: IMAGE_TYPES[m[1]] }
}
