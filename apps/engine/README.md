# M91 Blog Engine v2

An internal engine that writes blog posts for **M91**, MSG91's product that rings a person's phone
when software or an AI agent needs a human decision.

**Phase 1 (this code) is the foundation only:** config, the viaSocket AI client, Mem0 storage,
Slack/M91 notifications through two viaSocket webhook flows, an orchestrator with **stub** agents,
tests and packaging. Later phases add the real agents: Scout → Strategist → Writer → Reviewer.

## Setup

1. Node.js 20 or newer.
2. `npm ci`
3. Copy `env.example` (repo root) to `.env` at the repo root and fill in the blanks. Keep comments on their own lines (no
   `KEY=value  # note`). `.env` is never committed.
4. Build the two viaSocket webhook flows: [docs/SETUP_FLOWS.md](docs/SETUP_FLOWS.md).

The app reads `.env` only through Node's own loader: every local command uses `node --env-file=.env`.

## Running

| What | Command |
| --- | --- |
| Unit tests (no network) | `npm test` |
| Smoke tests (real network; S1–S4 by default) | `npm run smoke` · one test: `npm run smoke -- S2` |
| Real Slack + M91 test messages | `npm run smoke -- S5` (sends for real unless `DRY_RUN=true`) |
| One pipeline run with stubs | `npm run pipeline` (set `DRY_RUN=true` to send nothing) |
| HTTP server, locally | `npm run start:local` |
| HTTP server (env from the host) | `npm start` |
| viaSocket id/URL check | `npm run check` |

### Server endpoints

- `GET /health`: no auth. Returns `{ ok, running }`.
- `POST /run`: header `x-trigger-key: <PIPELINE_TRIGGER_KEY>` (at least 16 characters). Returns `202` and
  runs one pipeline in the background. Wrong or missing key: `401`. A run already in progress: `409`.
  The port is `PORT` (default `8080`).

Only one run happens at a time. A lock record in Mem0 enforces it; a lock older than 30 minutes is
treated as stale and cleared.

### What DRY_RUN and AUTO_PUBLISH do

- `DRY_RUN=true`: nothing goes to Slack, M91 or a publish target, and nothing is saved to Mem0 except `run_log` and `run` records (marked `dry_run: true`); the engine logs what it would send.
  AI calls and Mem0 records still happen, so `run_log` records stay visible.
- `AUTO_PUBLISH=false`: never publish. In Phase 1, publishing is a no-op placeholder either way.

## Docker

```bash
docker build -f apps/engine/Dockerfile -t m91-engine .   (from the repo root)
docker run --rm -p 8080:8080 --env-file .env m91-engine
```

The image contains no secrets: `.env` is excluded by `.dockerignore`, and the variables are supplied
when the container starts. It runs as the non-root `node` user.

## Setting env vars on a cloud host

Set every key from `env.example` as an environment variable or secret in the platform's settings.
For example: Render or Railway → *Environment*, Fly.io → `fly secrets set KEY=value`, Google Cloud
Run → *Variables & Secrets*, AWS ECS → the task definition's `environment` / `secrets`, Azure
Container Apps → *Secrets* plus env refs. Store the secret keys (`VIASOCKET_EMBED_SECRET`,
`MEM0_API_KEY`, `WEBHOOK_SHARED_KEY`, `PIPELINE_TRIGGER_KEY`, `DASHBOARD_PASSWORD`, `EMBARKO_DEPLOY_TOKEN`, and both webhook
URLs) as **secrets**, not plain variables. The container's start command is `node src/server.js`,
which reads `process.env` directly.

## Layout

```
src/config.js        env → one frozen config (validates keys, types, models)
src/viasocket.js     embed token + AI calls (sync, or rtlayer read from thread history)
src/store.js         Mem0 records (one memory per record, agent_id + run_id + metadata)
src/notify.js        Slack + M91 through the two webhook flows
src/orchestrator.js  state machine, loop limits, run lock, run_log
src/agents/stubs.js  placeholder agents (Phase 1)
src/cli.js           npm run pipeline
src/server.js        GET /health, POST /run
src/util/            log (masking), retry, ids, time (IST)
test/                unit tests (no network)
smoke/run.js         smoke tests (real network)
docs/                flow setup, notes on differences from the brief
```

## Secrets

Logs mask anything that looks like a key or token, plus every configured secret value (first 4
characters + `…`). Webhook URLs count as secrets: the `script_id` in them is a credential.
