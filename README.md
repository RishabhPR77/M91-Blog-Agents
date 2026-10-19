# M91 Blog Engine v2

Writes blog posts for **M91**, MSG91's product that rings a person's phone when software or an AI
agent needs a human decision.

| Part | What it is |
| --- | --- |
| [apps/engine](apps/engine/README.md) | The agents (Scout, Strategist, …), orchestrator, API, CLI, Publisher and tests |
| [apps/engine/dashboard](apps/engine/dashboard) | The control dashboard (its own npm project) |
| [apps/blog](apps/blog/README.md) | The blog website: a static Astro site (its own npm project) |
| [packages/content](packages/content) | Post format v1 and block names, shared by the engine and the blog |

## Setup on a fresh checkout

Node.js 22.12 or newer (the blog's Astro needs it). From the repo root, in this order:

```bash
npm install
```

```bash
npm run install:dashboard
```

```bash
npm run install:blog
```

Then copy `env.example` to `.env` at the repo root and fill in the blanks. Never commit `.env`.
The dashboard and the blog are separate npm projects (not workspaces), so each needs its own install.

## Commands (from the repo root)

| What | Command |
| --- | --- |
| All unit tests (engine, dashboard, content, blog) | `npm test` |
| Blog tests only | `npm run test:blog` |
| viaSocket id/URL check | `npm run check` |
| Engine + dashboard dev servers | `npm run dev:engine` |
| Blog dev server (http://localhost:4321, sample posts when there are none) | `npm run dev:blog` |
| Blog production build (into `apps/blog/dist`) | `npm run build:blog` |
| Any engine script | `npm run <script> --workspace @m91/engine` (e.g. `pipeline:lite`, `scout`, `strategist`, `pin`) |
