# Hosting the engine and dashboard on Embarko

The engine (API, pipeline) and the dashboard run as one Node app, **m91-engine**, behind an admin login. Embarko
publishing of the blog stays off (`PUBLISH_TARGET=none`); this is only where the engine lives.

## What Embarko gives us (read from its live docs, 2026-10-23)

| Topic | What it is |
| --- | --- |
| Process | One always-on Node process: `npm install`, the `build` script, then `npm start`. It must listen on `PORT` and `0.0.0.0`. |
| Limits | **256 MB of memory per app, cannot be raised.** CPU is not documented. No build time limit. |
| Requests | No HTTP duration limit is documented; our runs go on in the background after a quick `202`. Embarko's timed jobs have a 5-minute limit; we use none. |
| Sleep | Not documented. Check after the first deploy (`npm run embarko -- status` after a quiet day). |
| Disk | Only the folder in `DATA_DIR` survives redeploys and restarts. Everything else is wiped on every redeploy. Not backed up. |
| WebSockets | Not supported. We do not use them. |
| Server-sent events | Not mentioned either way. The dashboard's live run page uses them (keep-alive every 15 s). Verify on the first deploy. |
| Environment | Set on the app's settings page (write-only values) or through the API with a deploy token; a change needs "apply". |
| Rollback | Previous successful deploy, no rebuild; env and domains kept, `DATA_DIR` not rolled back; last 5 builds kept. |
| Login | None from Embarko: the engine has its own. |
| Plan | The free plan has 1 dynamic app. |

## What we do about it

- **Layout:** one upload is one app with its own `package.json`, so `npm run package:embarko` builds
  `.embarko-stage/`: the engine's `src/`, `packages/content` as `vendor/content` (a `file:` dependency) and the dashboard
  sources. The `build` script installs the dashboard's own dependencies and runs `vite build` on Embarko (the type
  check runs in our tests). `--prebuilt` ships a locally built `dashboard/dist` instead, if building on Embarko ever
  fails.
- **Memory:** `npm start` runs `node --max-old-space-size=200`, so a leak ends in a clean restart, not a kill. Each
  password check uses about 32 MB (scrypt) and the server does one at a time.
- **Files:** with `DATA_DIR` set, `ENGINE_DATA_DIR` defaults to `DATA_DIR/engine` and `EXPORT_DIR` to `DATA_DIR/exports`
  (both can still be set explicitly). `DATA_DIR` plus `APP_NAME` mean "hosted".
- **Login (hosted):** `DASHBOARD_AUTH` is forced on, `DASHBOARD_PASSWORD` is ignored, and `ADMIN_USERNAME` +
  `ADMIN_PASSWORD_HASH` are required (the engine refuses to start without them). The hash is scrypt
  (`scrypt:N:r:p:salt:hash`, N=32768, r=8, p=3), made by `npm run admin:hash`.
  - Every page and every `/api` route needs the session. Without one, pages go to `/login`. Open: `/login`, the
    built script and style files under `/assets/` and root icons (no data in them), `/api/health` (only
    `{ok, login}`), `POST /api/login` and `POST /api/logout`.
  - The cookie is `HttpOnly; SameSite=Strict; Path=/; Secure` (always `Secure` when hosted), 12 hours; `Strict-Transport-Security`
    is sent. Sessions live in memory: a restart logs everyone out.
  - Rate limits: 5 tries a minute per address (the last `X-Forwarded-For` entry, the one Embarko's proxy adds) and
    20 failures per 10 minutes from anywhere, then `429` with `Retry-After`. A wrong ID and a wrong password take the
    same time and say the same thing.
  - `POST /run` (the Phase 1 trigger) is not behind the session: it needs its own `X-Trigger-Key`
    (`PIPELINE_TRIGGER_KEY`, 16+ characters). It is the only such route.
- **Secrets:** the upload is built from an allowlist and scanned: `.env*`, `data/`, `exports/`, `drafts/`, `node_modules`,
  key files, the Dockerfile and secret-looking text stop the packaging. `npm run embarko:env` lists the setting
  **names** (from `env.example`, never `.env`). The deploy token is read from the environment only, sent as the
  Authorization header only, and masked in everything printed. A deploy without it is refused (Embarko would make a
  temporary app that is deleted after 24 hours).

## Commands (in `apps/engine`)

| Command | What it does |
| --- | --- |
| `npm run admin:hash` | Turns the admin password into `ADMIN_PASSWORD_HASH` (hidden input; the password is not stored). |
| `npm run embarko:env` | The environment setting names to set in Embarko. |
| `npm run package:embarko` | Builds and scans the upload folder (`--prebuilt` for a built dashboard). Uploads nothing. |
| `npm run deploy:embarko -- --yes` | Packages, then uploads with the embarko-deploy skill's `deploy.sh` as `m91-engine`. |
| `npm run embarko:env-sync [-- --yes]` | Sends the settings from `.env` to Embarko (names printed, never values) and applies them. |
| `npm run embarko -- status | logs | deployments | env-keys` | Looks at the deployed app. |
| `npm run embarko -- apply-env --yes` / `rollback --yes [<id>]` | Applies saved settings / rolls back. |

On Windows the deploy runs `deploy.sh` with Git Bash (`C:\Program Files\Git\bin\bash.exe`). A plain `bash` from
PowerShell is often WSL's, which cannot see `C:/` paths ("No such file or directory"). Set `EMBARKO_BASH` to use
another bash.

## What is not known until the first deploy

Whether the app sleeps when idle, whether Embarko's proxy streams server-sent events without buffering, the real
memory use (watch `npm run embarko -- logs`), and whether the plan's dynamic-app limit allows a second app.
