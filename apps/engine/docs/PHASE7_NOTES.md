# Phase 7: fast Mem0 reads, the blog website, and the Publisher

How publishing works, step by step: [PUBLISHING.md](PUBLISHING.md). The blog itself:
[apps/blog/README.md](../../blog/README.md).

## Decisions (agreed with you)

- **The blog URL** is `https://m91-blog.embarko.app`, the same in `.env` (`BLOG_BASE_URL`) and committed in
  `apps/blog/src/config/site.ts`. The Publisher refuses to run when they differ (`site_url_mismatch`).
- **The blog is its own npm project** (not a workspace, like the dashboard). Fresh checkout, from the root:
  `npm install`, `npm run install:dashboard`, `npm run install:blog`.
- **The OG image font** is Inter (latin 400/700, SIL Open Font License), with `OFL.txt` next to it in
  `apps/blog/src/og/fonts/`.
- **Docker:** the image builds the dashboard and also holds the blog's source with its packages installed, so
  the Publisher can build the blog in the container. Both stages use Node 22 (Astro 7 needs 22.12+).

## Where the code differs from the brief (and why)

1. **No response headers on the blog.** Embarko static sites cannot set headers, and `embarko.json` supports
   only schedules (no headers, redirects or 404 settings). So:
   - CSP and Referrer-Policy are `<meta>` tags;
   - the 404 page is Astro's `404.html`.
2. **The site uses the system font stack**, like the M91 site. Inter is used only for the OG images.
3. **`app_name_taken` stops the Publisher** with a clear message. You choose the new name; the code never
   picks one.
4. **A failed republish of a live post keeps it `published`**, with `last_error`: the old version is still
   online. Only a failed first publish becomes `publish_failed`.
5. **The H1 and the TL;DR are stripped one by one.** A part that isn't found stays in the post, with a
   warning, instead of failing the publish.
6. **The blog build runs with a clean environment** (PATH, home and temp folders only), so no `.env` value can
   reach the blog or its output. After the build, `dist/` is scanned for `.env` files, secret patterns and
   the configured secret values before any upload.
7. **The `.tar.gz` writer is built in** (a small ustar plus gzip writer in `src/publisher/embarko.js`), so
   there is no new dependency.
8. **`env.example` test:** `PUBLISH_*` keys were not allowed before; `PUBLISH_VERIFY_TIMEOUT_MS` is now the
   one exception.
9. **The Mem0 read cache is per process.** It is cleared on every write the engine makes. Changes made
   outside the engine (for example in the Mem0 console) show after `STORE_CACHE_TTL_MS` (30 s).

## Part A timings (ms)

"Before" was measured on your engine (8080), GETs only. "After" was a second engine on 8091, GETs only;
it was stopped right after. The data was the same in both.

| Endpoint | Before: cold / warm | After: cold / warm |
|---|---|---|
| `/api/runs` | 827 / 522–534 | 952 / 2–3 |
| `/api/runs/:id` | 8741 / 5950–6763 | 2655–2927 / 2–3 |
| `/api/records?type=draft` | 689 / 574–617 | (cached by the run detail) / 1–2 |
| `/api/approvals` | 578 / 627–691 | 404–513 / 1–2 |

Mem0 accepted the server-side metadata filters (no fallback warning).

## API additions

| Call | What changed |
|---|---|
| `POST /api/runs` | New modes: `publish` (`brief_id`), `unpublish` (`slug`), `set_index` (`slug`, `noindex`), `rebuild_blog`. Checked before the run starts: 409 `no_token`, `site_url_mismatch` or `no_approved_draft`; 404 `unknown_post`; 409 `not_published`. |
| `GET /api/posts` | New: one row per published post (no post body). |
| `GET /api/settings` | Also `blog` (`auto_publish`, `app_name`, `base_url`, `noindex_first_n_posts`, `deploy_token_set` yes/no) and `publish_modes`. |

No new event types: the Publisher's sub-steps are `step.output` events of the `publisher` step.

## Commands (from `apps/engine`)

| What | Command |
|---|---|
| Publish an approved draft | `npm run publish -- --brief-id=<id>` |
| Take a post down | `npm run unpublish -- --slug=<slug>` |
| Hide or show a post in search | `npm run set-index -- --slug=<slug> --noindex=true` |
| Rebuild and redeploy the blog | `npm run rebuild-blog` |
| Write the published posts locally (no build, no deploy) | `npm run blog:sync` |

## Dashboard

- **Posts page:** status, search visibility, Open live, and Republish / Unpublish / Hide or Show in search.
  Every action has a confirm that shows 0 AI calls.
- **Control:** Publish (pick an approved draft) and Rebuild blog.
- **Approvals:** a Publish card for an approved draft when `AUTO_PUBLISH=false`, and a note when it is true.
- **Live run:** the Publisher's six sub-steps, with the live link at the end.
- **Settings:** the blog settings, and whether the deploy token is set (yes/no only).

## New settings

Add these lines to `.env` (the defaults are already in `env.example`):

```
STORE_CACHE_TTL_MS=30000
EMBARKO_API_BASE=https://ship.embarko.ai
EMBARKO_AGENT_NAME=m91-blog-engine
BLOG_BUILD_TIMEOUT_MS=300000
PUBLISH_VERIFY_TIMEOUT_MS=120000
```

## Safety

- `.env` was never opened, read or printed. The deploy token is checked only through `deploy_token_set`.
- The token goes only into the `Authorization` header. Tests check that it is absent from events, errors and
  the API. Request headers are never logged.
- Unit tests use fake builds, deploys and fetch; nothing reaches the network.

## Open issues

- **Docker:** checked on 2026-10-19:
  - `docker build -f apps/engine/Dockerfile .` succeeds;
  - in the container (Node 22.23, user `node`), the Publisher modules load and the blog builds (7 pages, no `.env` in `dist`);
  - not checked: the engine serving requests in the container with your real `.env`, and a deploy from it.
- **Not covered by the smoke tests:** the full flow from a new pipeline run to approve, publish and
  unpublish. The combined test waits for your ok.

## Smoke results (E4, 2026-10-19)

All steps used 0 AI calls. Slack and M91 URLs were blanked for the live runs, so nothing was sent.

| Step | Result |
|---|---|
| DRY_RUN publish of 261019-1055-BZ89 | Built locally (18 files); nothing deployed. Found whole-question tags, fixed (`f414060`). |
| First real deploy (noindex) | Live, verified: noindex meta, canonical, OG image, CSP; left out of the home page, sitemap and RSS; `/.env` is a 404. |
| Unpublish | The post URL became 404; the blog home stayed 200. |
| `rebuild_blog` (new, empty Mem0 account) | Deployed 16 files. Mem0: 14 requests (8 reads, 0 searches, 6 writes) in the run record. This was before the queued-save fix, so the full count was a little higher. |
| Lighthouse 12.6.1, local preview with the samples (home and a post) | Performance, accessibility, best practices and SEO all 100. LCP 0.9 s, CLS 0.002, TBT 0 ms. Only note: the one CSS file blocks rendering. |

The old Mem0 account ran out of its search quota during these tests; Mem0 counted list (`getAll`) calls as
"SEARCH" events. The store no longer turns its filters off on a 429 (`3204c0e`). The engine now uses a new,
empty Mem0 account.

## Mem0 call counter

- Every request the store sends to Mem0 is counted (each retry counts): **reads** (gets, list pages,
  add-event polls), **searches**, **writes** (adds, updates, deletes), plus **cache hits** (no request).
- **Per run:** the totals are saved in the run record (`mem0`), sent in `run.finished`, and logged as
  "run Mem0 calls". The run record's totals are taken after the queued record saves, just before its final
  save, so `run.finished` and the log line have 2 more requests (the final save's read and write). The dashboard's
  run page shows them in the "Mem0 calls" row: it takes the `run.finished` count when it saw the event, and the
  record's count otherwise.
- **Per API request:** logged only, as "api Mem0 calls" (method, path, status, ms, counts; never headers or the
  query string). The line is at info level when Mem0 was used, otherwise debug. A run started by a request
  counts in its own scope, not in the request's.
- Mem0's quota may count list calls as searches, so compare a quota with reads + searches.

## Combined test (2026-10-19, new Mem0 account)

Slack and M91 URLs were blanked on the 8080 engine for the test, so nothing was sent. Counts are full totals from
"run Mem0 calls" (they include the final record save).

| Run | Mode | AI calls | Mem0 requests (reads / searches / writes) | Result |
|---|---|---|---|---|
| R-261019-1622-M2LU | full, low-cost | 11 | 157 (97 / 2 / 58) | Failed: MAX_WRITER_REVISIONS (1); v2 scored 79.5 (pass mark 85). Scout's stories call got no answer in 300 s. |
| (CLI) | test:await on v2 | 0 | not counted (CLI command, not a run) | v2 marked test data, waiting for you |
| R-261019-1648-J6EV | approval_review | 1 | 28 (16 / 0 / 12) | Score 82: still a fail |
| R-261019-1649-38FB | approve (force_unreviewed) | 1 | 34 (20 / 0 / 14) | Approved; promo pack ok |
| R-261019-1650-65YP | publish | 0 | 28 (17 / 0 / 11) | Live as noindex, verified; tags are short phrases |
| R-261019-1651-B4DH | unpublish | 0 | 25 (15 / 0 / 10) | The post URL is a 404; the home page is 200 |
| **Total** | | **13** | **272 (165 / 2 / 105)** | |

The dashboard's polling while a page is open adds about 1 read per list endpoint every 30 s (the read cache
answers the rest).
