# Publishing the blog (Phase 7)

The Publisher is plain code, not an AI agent: publishing never spends AI credits. It turns an approved draft
into a post file, rebuilds the whole blog (`apps/blog`) from every published post in Mem0, uploads it to
Embarko as a static site, checks the post is really live, and only then marks it published.

Mem0 is the single source of truth. `apps/blog/src/content/posts/` is regenerated on every publish and is
not committed.

## Settings

| Key | Default | What it does |
|---|---|---|
| `AUTO_PUBLISH` | `false` | `true`: approving a post publishes it in the same run. `false`: use **Publish** in the dashboard (Approvals) or `npm run publish`. |
| `BLOG_APP_NAME` | `m91-blog` | The Embarko app name (the site lives at `https://<name>.embarko.app`). |
| `BLOG_BASE_URL` | `https://m91-blog.embarko.app` | Must equal `SITE_URL` in `apps/blog/src/config/site.ts`; the Publisher refuses to run otherwise. |
| `NOINDEX_FIRST_N_POSTS` | `10` | The first N posts ever published are `noindex` (hidden from search) until you switch them. |
| `EMBARKO_DEPLOY_TOKEN` | (empty, secret) | Required for a real deploy. Never logged, never written to files, events or run records. |
| `EMBARKO_API_BASE` | `https://ship.embarko.ai` | The Embarko deploy API. |
| `EMBARKO_AGENT_NAME` | `m91-blog-engine` | Sent as `X-Agent-Name`. |
| `BLOG_BUILD_TIMEOUT_MS` | `300000` | The blog build is stopped after this long. |
| `PUBLISH_VERIFY_TIMEOUT_MS` | `120000` | How long the Publisher waits for the live page to show the post. |

The dashboard's Settings page shows whether the deploy token is set (yes/no), never its value.

## What a publish does

The Live run page shows these as sub-steps of the `publisher` step:

1. **build post**: the post JSON (format v1) from the approved draft: slug, description, TL;DR, tags,
   reading time, sources, related posts, noindex, canonical URL. The H1 line and the TL;DR block are
   removed from the Markdown (the page renders them itself). The `published_post` record goes `publishing`.
2. **export**: every published post from Mem0 is written to `apps/blog/src/content/posts/`.
3. **build blog**: `astro build` in `apps/blog`, run with a clean environment (no `.env` value reaches it),
   then safety checks on `dist/`: `index.html` and the post page exist, there is no `.env` file, and no file
   contains a secret-looking string or a configured secret value.
4. **deploy**: `dist/` is packed as a `.tar.gz` and uploaded to Embarko. A 4xx is never retried; a 5xx or a
   lost reply is retried once, after a status check (the upload may have been accepted).
5. **verify**: the post URL answers 200 and shows the title. A noindex post must carry the robots meta; an
   indexed post must be listed on the home page.
6. **mark published**: the post record gets `published` with its URL and deploy time; the draft and brief
   become `published`; `{{POST_URL}}` in the promo pack is filled in; Slack gets "🚀 Published…".

**When it fails:**

- A first publish becomes `publish_failed` with `last_error`.
- A republish of a live post stays `published`: the old version is still live, and `last_error` is set.
- Slack gets "❌ Publish failed…" and M91 gets a LOW alert, "Blog publish failed".
- With `AUTO_PUBLISH=true`, a failed publish does not undo the approval: the draft stays `approved`, and the
  approve run ends with a warning.

**DRY_RUN:** the blog is built locally in `apps/blog/dist` with the post included, and nothing is deployed,
written to Mem0 or sent. Preview it with `npm run preview` in `apps/blog`.

## Republishing

Publishing the same brief again keeps its slug, `published_at` and noindex value; `updated_at` changes.
Slugs come from the brief's `slug`, else the draft's SEO slug suggestion. If another live post already uses
the slug, `-2`, `-3` and so on are added. Slugs are at most 60 characters.

## noindex

- While fewer than `NOINDEX_FIRST_N_POSTS` posts have ever been published, a new post is `noindex`.
  Unpublished test posts don't count.
- A noindex post has `<meta name="robots" content="noindex, nofollow">` and is left out of the home page
  (and its search), RSS, the sitemap and `llms.txt`. Its URL still works.
- Switch it with **Hide / Show in search** on the dashboard's Posts page, or:

```bash
npm run set-index -- --slug=<slug> --noindex=false
```

A choice made this way is remembered on later republishes.

## Unpublish

```bash
npm run unpublish -- --slug=<slug>
```

The blog is rebuilt without the post and redeployed, and the Publisher checks that the post URL no longer
shows the post. The post record becomes `unpublished`, and the draft and brief go back to `approved`, so the
post can be published again later.

## Rebuild only

```bash
npm run rebuild-blog
```

This rebuilds and redeploys the blog from Mem0 without changing any post: use it after a change to the blog's
code or look. `npm run blog:sync` only writes the post files locally (no build, no deploy), for `npm run
dev:blog`.

## All commands (from `apps/engine`)

```bash
npm run publish -- --brief-id=<id>
```

```bash
npm run unpublish -- --slug=<slug>
```

```bash
npm run set-index -- --slug=<slug> --noindex=true
```

```bash
npm run rebuild-blog
```

```bash
npm run blog:sync
```

The first four run as normal runs: they take the run lock, stream events, and save a run record. In the
dashboard, the same actions are on the Posts page, in Approvals (Publish) and on Control (Rebuild blog).

## Manual rollback

If a deploy put a broken site live, roll Embarko back to the previous version. Run this yourself, with the
token typed into your own terminal; never paste it into a file:

```bash
curl.exe -X POST https://ship.embarko.ai/api/apps/m91-blog/rollback -H "Authorization: Bearer <EMBARKO_DEPLOY_TOKEN>"
```

Check the rollback endpoint in the Embarko docs (embarko.ai/docs) before you run it. Then fix the cause and run `npm run rebuild-blog`. A rollback does not change Mem0, so the next rebuild
deploys what Mem0 says is published.

## Errors you may see

| Code | Meaning |
|---|---|
| `no_token` | `EMBARKO_DEPLOY_TOKEN` is empty: the Publisher never deploys without a token. |
| `site_url_mismatch` | `BLOG_BASE_URL` and `SITE_URL` in `site.ts` differ. |
| `unauthorized` | The deploy token is wrong. |
| `app_name_taken` | Someone else owns `BLOG_APP_NAME`. Stop and choose a new name with the user. |
| `app_kind_changed` | An Embarko server app already has this name. |
| `no_manifest_at_root` | The upload has no `index.html` at the top (a build problem). |
| `no_approved_draft` | The brief has no approved draft. |
| `not_published` / `unknown_post` | The slug is not live, or doesn't exist. |
