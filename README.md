# M91 Blog Engine v2

Writes blog posts for **M91**, MSG91's product that rings a person's phone when software or an AI
agent needs a human decision.

| Part | What it is |
| --- | --- |
| [apps/engine](apps/engine/README.md) | The agents (Scout, Strategist, …), orchestrator, API, CLI and tests |
| [apps/blog](apps/blog/README.md) | The blog website (Phase 7) |
| [packages/content](packages/content) | Post format v1 and block names, shared by both apps |

## Setup

1. Node.js 20 or newer, then `npm install` at the repo root (npm workspaces).
2. Copy `env.example` to `.env` at the repo root and fill in the blanks. Never commit `.env`.

## Commands (from the repo root)

| What | Command |
| --- | --- |
| All unit tests | `npm test` |
| viaSocket id/URL check | `npm run check` |
| Engine server with file watching | `npm run dev:engine` |
| Any engine script | `npm run <script> --workspace @m91/engine` (e.g. `pipeline:lite`, `scout`, `strategist`, `pin`) |
