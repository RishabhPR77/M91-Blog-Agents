# Phase 6: the control dashboard

## Decisions (agreed with you)

- **Finished runs keep a compact timeline** in their run record: step boundaries, `step.output`
  summaries, `loop.route`, `approval.*`, compact AI calls (step, call, model, delivery, ms, retries,
  finish reason) and warn/error log lines. Last 300 entries, written at step boundaries and at the end
  of the run. Never info log lines, post text, prompts or secrets.
- **The Live run page** uses the in-memory events when the engine still has them, else the saved
  timeline ("Info-level log lines are kept only while the engine runs."), else, for runs from before
  Phase 6, the run record's steps.
- **Both `score` and `total`** are kept for earlier versions in the approval detail.
- **Exact package versions**, each published at least two weeks before the work.

## Where the code differs from the brief (and why)

1. **The dashboard is its own npm project, not a workspace.** `apps/engine/dashboard` has its own
   `package.json` and `package-lock.json`. As a workspace, npm 10.9.3 crashed on install ("Cannot read
   properties of null (reading 'edgesOut')"): Vite's optional `@vitejs/devtools` peer asks for any
   vitest, npm picks the newest one, and the mismatch breaks its peer resolution. The dashboard pins
   vitest with an npm `overrides` entry. **A fresh checkout needs one extra step:**
   `npm run install:dashboard` (from `apps/engine`) after the root `npm install`.
2. **Older versions on purpose:** TypeScript 6.0.3 (7.0 is the new native compiler), jsdom 29 (30
   needs Node 22.22; you have 22.19), Vitest 4.1.11 (5 also crashes npm 10), concurrently 9.2.4 (10
   needs Node 22).
3. **`shell-quote` pinned to 1.11.0** with a root `overrides` entry: concurrently 9.2.4 brings 1.9.0,
   which has a critical advisory. The fixed concurrently (9.2.5) is younger than two weeks.
   `npm audit` reports 0 vulnerabilities at the root and in the dashboard.
4. **Engine tests run `node --test "test/**/*.test.js"`.** Node's default discovery also picked up the
   dashboard's `.ts` tests and counted helper files as tests.
5. **EventSource only delivers event types it listens for** (the engine names every event), so the
   dashboard lists them in `src/api/sse.ts`; a node test keeps that list equal to `EVENT_TYPES`.
6. **Polling is a slow backstop** (health 10 s, runs and approvals 30 s): live events refresh those
   lists at once, and each list makes the engine scan Mem0.

## API additions

| Call | What changed |
|---|---|
| `GET /api/settings` | Also `built_modes`, `decision_modes`, `approval` (`max_human_revisions`, `rereview_after_human`, `m91_notify_on_awaiting`) |
| `GET /api/approvals/:brief_id` | `draft.reviewed`, `draft.hard_passed`, `draft.approved_unreviewed`; earlier versions also get `total` (= `score`) and `record_id` |
| `DELETE /api/lessons/:memory_id` | Deletes a lesson (404 for any other record) |
| `GET /api/records?type=lesson` | A lesson's text is its title |
| `GET /api/runs/:run_id` | The run record now includes `timeline` (and `timeline_dropped`) |
| `GET /` and app paths | The built dashboard (below) |

## Commands (from `apps/engine`; the root `npm run dev:engine` runs `dev`)

```text
npm run install:dashboard   once, after npm install (dashboard packages)
npm run dev                 engine (node --watch) + Vite on http://localhost:5173
npm run dev:api             engine only
npm run dev:ui              Vite only (proxies /api to PORT)
npm run build:dashboard     builds dashboard/dist
npm run start:local         engine on PORT, serving dashboard/dist
npm test                    node tests, then Vitest
```

## Production serving

- Non-`/api` GET/HEAD requests serve `dashboard/dist` with
  `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
- Hashed files under `/assets/` are cached for a year (`immutable`); `index.html` is `no-cache`. App
  paths fall back to `index.html`; a missing file with an extension is a 404; no path traversal.
- Without a build, `GET /` says "Dashboard not built. Run `npm run build:dashboard`."
- `/health` and `POST /run` are unchanged.
- The Dockerfile builds the dashboard in a `node:22-slim` stage and copies `dist` into the image.

## Settings

No new `.env` keys. `PORT` (8080) and `DASHBOARD_PORT` (5173) already existed; `dev:ui` reads them
with `--env-file`, and nothing from `.env` reaches the browser (only `VITE_*` keys could, and there are
none).

## Safety

- The browser only calls same-origin `/api/*` (the client refuses anything else).
- Markdown is rendered without raw HTML; links open in a new tab with `rel="noopener noreferrer"`.
- Every action that starts a run or changes state asks first and shows its expected AI calls (in
  `dashboard/src/config/costs.ts`).
