// The Publisher (Phase 7, Part C): code, not an AI agent. It turns an approved draft into a post file,
// rebuilds the whole blog from every published post in Mem0, uploads it to Embarko, checks the post is
// really live and marks it published. It also unpublishes posts, switches noindex, and rebuilds the blog.
// Its sub-steps show as step.output events of the "publisher" step:
//   1/6 build post · 2/6 export · 3/6 build blog · 4/6 deploy · 5/6 verify · 6/6 mark published.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../util/log.js'
import { istIso } from '../util/time.js'
import { emit, throwIfCancelled, isCancel } from '../events.js'
import { loadBrief } from '../writer/inputs.js'
import { draftsOf, draftVersion, draftBriefVersion } from '../writer/save.js'
import { buildPost } from './post.js'
import { chooseBlocks } from './blocks.js'
import { isInteractive, latestBlockDoc } from '../designer/index.js'
import { bodyMarkdown } from '../designer/parts.js'
import { exportPublished, BLOG_DIR, CONTENT_DIR } from './export.js'
import { runBlogBuild, checkBuild } from './build.js'
import { deploy as embarkoDeploy } from './embarko.js'
import { verifyLive, verifyGone, verifyPage } from './verify.js'

export class PublishError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = 'PublishError'
    this.code = code
    this.status = status
  }
}

/** The blog's committed SITE_URL (apps/blog/src/config/site.ts). */
export function blogSiteUrl(blogDir = BLOG_DIR) {
  const src = readFileSync(join(blogDir, 'src', 'config', 'site.ts'), 'utf8')
  return src.match(/^export const SITE_URL = '([^']+)'$/m)?.[1] ?? null
}

const norm = (u) => String(u ?? '').trim().replace(/\/+$/, '').toLowerCase()
const slugOf = (r) => r.payload?.slug ?? r.payload?.post?.slug ?? r.metadata?.slug ?? null

/** Never deploy without a token; the blog's committed URL must equal BLOG_BASE_URL. Throws PublishError. */
export function publishPreflight(config, { blogDir = BLOG_DIR } = {}) {
  const b = config.blog
  const site = blogSiteUrl(blogDir)
  if (norm(site) !== norm(b.baseUrl)) throw new PublishError('site_url_mismatch', `BLOG_BASE_URL (${b.baseUrl}) differs from the blog's SITE_URL in apps/blog/src/config/site.ts (${site}): make them equal before publishing`)
  if (!config.runtime.dryRun && !b.embarkoDeployToken) throw new PublishError('no_token', 'EMBARKO_DEPLOY_TOKEN is not set: the Publisher never deploys without a token (a token-less Embarko app is deleted after 24 hours)')
}

/** Replaces {{POST_URL}} everywhere in a value (strings, arrays, objects). */
export function fillPostUrl(value, url) {
  if (typeof value === 'string') return value.split('{{POST_URL}}').join(url)
  if (Array.isArray(value)) return value.map((v) => fillPostUrl(v, url))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillPostUrl(v, url)]))
  return value
}

/**
 * @param {{ config, store, notifier, fetch?, now?, sleepFn?, build?, deployFn?, blogDir?, contentDir? }} deps
 *   build / deployFn: injectable for tests (default: the real blog build and the Embarko client).
 */
export function createPublisher({ config, store, notifier, fetch = globalThis.fetch, now = Date.now, sleepFn, build, deployFn, blogDir = BLOG_DIR, contentDir = CONTENT_DIR } = {}) {
  const b = config.blog
  const dry = config.runtime.dryRun
  const runBuild = build ?? ((onLine) => runBlogBuild({ blogDir, timeoutMs: b.buildTimeoutMs, onLine }))
  const doDeploy = deployFn ?? ((dir) => embarkoDeploy({ dir, appName: b.appName, agentName: b.embarkoAgentName, token: b.embarkoDeployToken, apiBase: b.embarkoApiBase, fetch, ...(sleepFn && { sleepFn }), onEvent: (e) => log.info('embarko', e) }))
  const verifyOpts = { fetch, timeoutMs: b.publishVerifyTimeoutMs, ...(sleepFn && { sleepFn }) }
  const at = () => istIso(new Date(now()))

  const sub = (n, name, message, data = {}) => emit('step.output', { agent: 'publisher', step: 'publisher', message: `${n}/6 ${name}: ${message}`, data: { substep: name, ...data } })

  async function notify(kind, args, warnings) {
    try {
      const r = kind === 'slack' ? await notifier.slack(args) : await notifier.m91Alert(args)
      if (r?.skipped === 'pending_flows') warnings.push(`${kind === 'slack' ? 'Slack message' : 'M91 alert'} skipped: pending flows (${r.key} is empty)`)
    } catch (error) {
      warnings.push(`${kind === 'slack' ? 'Slack message' : 'M91 alert'} not sent: ${error.message}`)
    }
  }

  const preflight = () => publishPreflight(config, { blogDir })

  /** Export from Mem0 (plus in-memory changes in DRY_RUN), build, check; then deploy unless DRY_RUN. */
  async function ship({ slug, extra = [], drop = [], step = 2 }) {
    const { files } = await exportPublished(store, { dir: contentDir, extra, drop })
    sub(step, 'export', `${files.length} post file(s) written to apps/blog/src/content/posts`, { files: files.length })
    throwIfCancelled()
    const warnLines = []
    const built = await runBuild((level, text) => {
      warnLines.push(text)
      emit('log', { agent: 'publisher', level, message: `blog build: ${text}` })
    })
    const checked = checkBuild(built.dist, { slug, secretValues: config.secretValues ?? [] })
    sub(step + 1, 'build blog', `built ${checked.files} file(s) in ${Math.round(built.ms / 1000)} s; output checks passed`, { files: checked.files, ms: built.ms })
    throwIfCancelled()
    if (dry) return { dist: built.dist, files: checked.files, deployed: null }
    // No cancel check from here until the upload is done: an upload is never cut in half.
    const deployed = await doDeploy(built.dist)
    sub(step + 2, 'deploy', `Embarko status ${deployed.status} (app ${deployed.app}${deployed.polls ? `, ${deployed.polls} status check(s)` : ''})`, { app: deployed.app, status: deployed.status })
    return { dist: built.dist, files: checked.files, deployed }
  }

  async function fail(record, title, error, warnings, { keepStatus = null } = {}) {
    const reason = error.message
    if (record?.id && !dry) {
      try {
        await store.updateRecord(record.id, { ...record.payload, last_error: reason, last_error_at: at() }, { status: keepStatus ?? 'publish_failed' })
      } catch (e) {
        warnings.push(`could not record the failure: ${e.message}`)
      }
    }
    await notify('slack', `❌ Publish failed: ${title}: ${reason}`, warnings)
    await notify('m91', { title: 'Blog publish failed', description: `${title}: ${reason.slice(0, 300)}`, severity: 'LOW' }, warnings)
  }

  /** publish (or republish) a brief's approved draft. */
  async function publish({ briefId }) {
    preflight()
    const warnings = []
    const draft = (await draftsOf(store, briefId)).find((d) => d.status === 'approved' || d.status === 'published')
    if (!draft) throw new PublishError('no_approved_draft', `brief ${briefId} has no approved draft to publish`)
    const briefRec = await loadBrief(store, briefId, draftBriefVersion(draft))
    if (!briefRec) throw new PublishError('unknown_brief', `no brief ${briefId}`, 404)
    const published = await store.getRecords({ type: 'published_post' })
    // Phase 8: the interactive blocks from the newest block_doc of this version (a republish reuses it: no AI).
    const interactive = isInteractive(draft, config)
    const doc = interactive ? await latestBlockDoc(store, briefId, draftVersion(draft)) : null
    const chosen = chooseBlocks({ interactive, doc, markdown: bodyMarkdown(draft.payload?.post_markdown) })
    if (chosen.warning) warnings.push(chosen.warning)
    const { post, existing, warnings: postWarnings } = buildPost({ draft, briefId, brief: briefRec.payload, published, config, now, istIso, blocks: chosen.blocks })
    warnings.push(...postWarnings)
    for (const w of postWarnings) log.warn('publisher', { briefId, warning: w })
    const test = draft.metadata?.test === true || briefRec.metadata?.test === true
    const payload = {
      ...(existing?.payload ?? {}),
      slug: post.slug, title: post.title, url: post.canonical_url, topic_group: post.topic_group, description: post.description,
      brief_id: briefId, version: post.version, noindex: post.noindex, post, ...(test && { test: true })
    }
    const wasLive = existing?.status === 'published'
    const record = existing
      ? { ...existing, ...(await store.updateRecord(existing.id, payload, { status: 'publishing', slug: post.slug })), payload }
      : { ...(await store.createRecord({ type: 'published_post', briefId, payload, status: 'publishing', version: post.version, meta: { slug: post.slug, ...(test && { test: true }) } })), payload }
    sub(1, 'build post', `${post.slug} · v${post.version} · ${post.reading_time_min} min read · ${post.noindex ? 'noindex' : 'indexed'} · ${chosen.note}`, { slug: post.slug, noindex: post.noindex, record_id: record.id, blocks: post.blocks?.length ?? 0 })
    try {
      throwIfCancelled()
      const shipped = await ship({ slug: post.slug, extra: dry ? [post] : [] })
      if (dry) {
        sub(4, 'deploy', 'skipped (DRY_RUN)')
        return { status: 'succeeded', summary: `DRY_RUN: ${post.slug} built locally in apps/blog/dist (${shipped.files} files); nothing deployed. Preview: npm run preview in apps/blog`, warnings, post, dist: shipped.dist, files: shipped.files }
      }
      const v = await verifyLive({ url: post.canonical_url, title: post.title, slug: post.slug, noindex: post.noindex, homeUrl: `${b.baseUrl}/`, ...verifyOpts })
      sub(5, 'verify', `live at ${post.canonical_url} (${v.attempts} check(s), ${Math.round(v.ms / 1000)} s)`, { url: post.canonical_url })
      const deployedAt = at()
      await store.updateRecord(record.id, {
        ...payload, url: post.canonical_url, deployed_at: deployedAt, first_published_at: payload.first_published_at ?? deployedAt,
        deploy: { status: shipped.deployed.status, app: shipped.deployed.app }, last_error: null
      }, { status: 'published', slug: post.slug })
      await store.updateRecord(draft.id, undefined, { status: 'published', published_at: deployedAt, url: post.canonical_url })
      if (briefRec.id) await store.updateRecord(briefRec.id, undefined, { status: 'published' })
      const promo = await fillPromoPack(briefId, draft, post.canonical_url, warnings)
      sub(6, 'mark published', `post, draft and brief published${promo ? '; promo pack links filled in' : ''}`, { url: post.canonical_url })
      await notify('slack', `🚀 Published: *${post.title}* → ${post.canonical_url}${post.noindex ? ' (noindex)' : ''}`, warnings)
      return { status: 'succeeded', summary: `published ${post.slug}${post.noindex ? ' (noindex)' : ''} → ${post.canonical_url}`, warnings, post, url: post.canonical_url }
    } catch (error) {
      if (isCancel(error)) throw error
      // A republish of a live post keeps it in the blog (status published); a first publish is publish_failed.
      await fail(record, post.title, error, warnings, { keepStatus: wasLive ? 'published' : null })
      throw error
    }
  }

  async function fillPromoPack(briefId, draft, url, warnings) {
    try {
      const packs = (await store.getRecords({ type: 'promo_pack', brief_id: briefId }))
        .filter((r) => Number(r.payload?.version ?? r.version) === draftVersion(draft))
        .sort((a, c) => String(c.createdAt ?? c.date).localeCompare(String(a.createdAt ?? a.date)))
      if (!packs.length) return false
      await store.updateRecord(packs[0].id, fillPostUrl(packs[0].payload, url), {})
      return true
    } catch (error) {
      warnings.push(`promo pack link not filled in: ${error.message}`)
      return false
    }
  }

  async function findLive(slug) {
    const rec = (await store.getRecords({ type: 'published_post' })).find((r) => slugOf(r) === slug)
    if (!rec) throw new PublishError('unknown_post', `no published post with the slug ${slug}`, 404)
    return rec
  }

  /** unpublish: take a post down (the draft and brief go back to approved). */
  async function unpublish({ slug }) {
    preflight()
    const warnings = []
    const rec = await findLive(slug)
    if (rec.status !== 'published') throw new PublishError('not_published', `the post ${slug} is ${rec.status}, not published`)
    const title = rec.payload?.title ?? slug
    if (!dry) await store.updateRecord(rec.id, rec.payload, { status: 'unpublished' })
    sub(1, 'build post', `${slug} marked unpublished`, { slug })
    try {
      throwIfCancelled()
      const shipped = await ship({ slug: null, drop: dry ? [slug] : [] })
      if (dry) return { status: 'succeeded', summary: `DRY_RUN: the blog without ${slug} built locally (${shipped.files} files); nothing deployed`, warnings }
      const v = await verifyGone({ url: rec.payload.url ?? `${b.baseUrl}/posts/${slug}/`, title, ...verifyOpts })
      sub(5, 'verify', `${slug} no longer served (${v.attempts} check(s))`)
      const draft = (await draftsOf(store, rec.payload.brief_id)).find((d) => d.status === 'published')
      if (draft) await store.updateRecord(draft.id, undefined, { status: 'approved' })
      const briefRec = await loadBrief(store, rec.payload.brief_id)
      if (briefRec?.id && briefRec.status === 'published') await store.updateRecord(briefRec.id, undefined, { status: 'approved' })
      await store.updateRecord(rec.id, { ...rec.payload, unpublished_at: at() }, { status: 'unpublished' })
      sub(6, 'mark published', `${slug} unpublished; draft and brief back to approved`)
      await notify('slack', `🗑️ Unpublished: *${title}*`, warnings)
      return { status: 'succeeded', summary: `unpublished ${slug}`, warnings }
    } catch (error) {
      if (isCancel(error)) throw error
      await fail(rec, title, error, warnings, { keepStatus: 'published' })
      throw error
    }
  }

  /** set_index: switch a post's noindex flag (remembered), then rebuild and deploy. */
  async function setIndex({ slug, noindex }) {
    preflight()
    const warnings = []
    const rec = await findLive(slug)
    if (rec.status !== 'published') throw new PublishError('not_published', `the post ${slug} is ${rec.status}, not published`)
    const post = { ...rec.payload.post, noindex, updated_at: at() }
    const payload = { ...rec.payload, post, noindex, noindex_override: noindex }
    if (!dry) await store.updateRecord(rec.id, payload, { status: 'published' })
    sub(1, 'build post', `${slug} → ${noindex ? 'noindex (hidden from search)' : 'indexed (shown in search)'}`, { slug, noindex })
    try {
      throwIfCancelled()
      const shipped = await ship({ slug, extra: dry ? [post] : [] })
      if (dry) return { status: 'succeeded', summary: `DRY_RUN: ${slug} as ${noindex ? 'noindex' : 'indexed'} built locally; nothing deployed`, warnings }
      const v = await verifyLive({ url: post.canonical_url, title: post.title, slug, noindex, homeUrl: `${b.baseUrl}/`, ...verifyOpts })
      sub(5, 'verify', `live as ${noindex ? 'noindex' : 'indexed'} (${v.attempts} check(s))`)
      await store.updateRecord(rec.id, { ...payload, deployed_at: at(), deploy: { status: shipped.deployed.status, app: shipped.deployed.app } }, { status: 'published' })
      sub(6, 'mark published', `${slug} noindex = ${noindex}`)
      return { status: 'succeeded', summary: `${slug} is now ${noindex ? 'hidden from search (noindex)' : 'shown in search'}`, warnings }
    } catch (error) {
      if (isCancel(error)) throw error
      await fail(rec, rec.payload?.title ?? slug, error, warnings, { keepStatus: 'published' })
      throw error
    }
  }

  /** rebuild_blog: rebuild and redeploy from Mem0 without changing any post. */
  async function rebuildBlog() {
    preflight()
    const warnings = []
    sub(1, 'build post', 'no post changes (rebuild only)')
    try {
      const shipped = await ship({ slug: null })
      if (dry) return { status: 'succeeded', summary: `DRY_RUN: the blog built locally (${shipped.files} files); nothing deployed`, warnings }
      const v = await verifyPage({ url: `${b.baseUrl}/`, ...verifyOpts })
      sub(5, 'verify', `home page live (${v.attempts} check(s))`)
      sub(6, 'mark published', 'blog rebuilt and redeployed')
      return { status: 'succeeded', summary: `blog rebuilt and deployed (${shipped.files} files)`, warnings }
    } catch (error) {
      if (isCancel(error)) throw error
      await fail(null, 'blog rebuild', error, warnings)
      throw error
    }
  }

  return { publish, unpublish, setIndex, rebuildBlog }
}
