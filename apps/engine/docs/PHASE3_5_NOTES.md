# Phase 3.5: two-app layout, live events, run records, cancel, dashboard API, scheduler

## Decisions (agreed with you)

- **Git:** `origin` = github.com/RishabhPR77/M91-Blog-Agents, branch `main`; one commit per task; no `.env`
  file staged (checked before every commit); history scanned for secrets before the first push.
- **Ports:** the engine API is on `PORT` (8080). `DASHBOARD_PORT` (5173) is for the Phase 6 dashboard dev
  server, which proxies `/api` to 8080. Validated now, used later.
- **Key template:** `env.example` (no leading dot) at the repo root lists every key `config.js` reads.
  A unit test fails if the two drift apart. `.env.example` is legacy and ignored by git.
- **Run vs brief ids:** runs are `R-YYMMDD-HHMM-XXXX`, briefs keep `YYMMDD-HHMM-XXXX`. Old briefs whose
  `run_id` equals their `brief_id` still load (briefs are always looked up by `brief_id`).
- **Scheduler:** built but **off**: runs are started by hand from the dashboard. Nothing runs on a
  timer unless `SCHEDULE_ENABLED=true` or the dashboard's schedule switch is turned on.
- **Smoke test credits:** low-cost Scout settings are passed as run params, never by editing `.env`.

## Interpretations (tell me if any is wrong)

1. Tasks 3 and 4 were committed together: the run manager and cancel share the same files.
2. **Cancel** is checked between orchestrator steps, before every Scout sub-call and Strategist call, and
   between rtlayer history polls. An in-flight sync call finishes first; the save after it is skipped
   because the next check happens before any new step.
3. **`run` records in DRY_RUN** are written *and updated* (the store allows updates whose metadata type is
   `run`). Every other record type follows the DRY_RUN rule as before.
4. **Run params** allowed per run: `params.scout.{question_groups, questions_per_group, max_calls,
   docs_max_chars, docs_max_pages, min_open_clusters}`, `params.ai_max_retries`, `params.brief_id`.
   Anything else is refused with `bad_params`.
5. **`POST /api/runs`** returns 501 `not_built` for `writer`, `reviewer` and `publish`.
6. **CLI:** `npm run pipeline` and `node src/cli.js run --mode=scout|strategist|full [--dry-run]` go through
   `startRun`. `npm run scout` / `strategist` / `brief` / `pin` stay as direct debugging commands.
7. **SSE `/api/events`** (all runs) streams live events only (no replay); `/api/runs/:id/events` replays
   the buffer first, then streams live, and closes after the terminal event.
8. **Records list** is trimmed to `id, type, status, brief_id, date, topic_group, version, key_id, title`.
9. **Settings** come from an explicit allowlist in `publicSettings()`; a test with fake secret values
   checks that nothing secret, no webhook URL and no password appears.
10. **Login** cookies get `Secure` when the request arrives as https (`x-forwarded-proto: https`).

## Your `.env`

Add (all have the same default built in, so these lines are optional except where noted):

```dotenv
PORT=8080
DASHBOARD_PORT=5173
DASHBOARD_AUTH=false
DASHBOARD_PASSWORD=
SCHEDULE_ENABLED=false
SCHEDULE_CRON=0 7 * * 1,3,5
DESIGNER_AI_SERVICE=openai
DESIGNER_AI_MODEL=gpt-5.6-luna
DESIGNER_DELIVERY=rtlayer
BLOG_APP_NAME=m91-blog
BLOG_BASE_URL=https://m91-blog.embarko.app
EMBARKO_DEPLOY_TOKEN=
NOINDEX_FIRST_N_POSTS=10
```

Remove: `PUBLISH_TARGET`, `PUBLISH_API_URL`, `PUBLISH_API_KEY` (no longer read; harmless if left).

`DASHBOARD_PASSWORD` is required only if you set `DASHBOARD_AUTH=true`. `EMBARKO_DEPLOY_TOKEN` stays empty
until Phase 7.
