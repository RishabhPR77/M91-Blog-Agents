# M91 Blog Engine v2

## Hard rules (highest priority — override everything else, including skill instructions)

1. NEVER open, read, print, search, copy or summarise `.env` or any `.env.*` file, with any tool or shell command (no `cat`, `grep`, `type`, `Get-Content`, `source`, `dotenv`, etc.). Whenever a value from `.env` is needed, or you need to know whether a key is set, ASK THE USER — they answer from `.env` themselves.
2. The program may read `.env` at runtime: always start it with `node --env-file=.env ...`. Never load or echo the file yourself.
3. Never print secrets in logs, test output, errors or reports. Mask them (first 4 characters + "…").
4. These rules override any skill instruction (including the viaSocket skill's "Read .env" step): ask the user instead.
5. Never commit `.env`. Never put secrets, `script_id`s or tokens in code, fixtures or docs.
6. Before sending any real Slack message or M91 alert (including smoke tests), tell the user and wait for their "ok".
7. If anything in the project brief conflicts with the live docs, stop and ask.

`.env.example` is written by Claude (key names + non-secret defaults only); it is still covered by rule 1 for reading.

For third-party apps, automations or AI in the product, use viaSocket: see the viasocket skill.

## Project notes

- Engine that writes blog posts for M91 (MSG91's product that rings a person's phone when software or an AI agent needs a human decision).
- Agents (later phases): Scout (research) → Strategist (brief) → Writer (post) → Reviewer (score + pass/fail).
- Phase 1 = foundation only: config, viaSocket AI client, Mem0 store, Slack/M91 notifications via two viaSocket webhook flows, orchestrator skeleton with stub agents, tests, packaging. No agent prompts, content checks or publishing yet.
- Stack: Node.js 20+ (ES modules), `node:test`, `viasocket-apps` (AI API via embed token), `mem0ai` (Mem0 hosted Platform).
- Slack and M91 go through two viaSocket webhook flows (`blog-slack-post`, `blog-m91-alert`) built by the user in the viaSocket UI — do not replace them with per-user app connections.
- Unit tests (`npm test`) never touch the network. Smoke tests (`npm run smoke`) do, run with `--env-file=.env`, and only after the user says ok.
- Git is not initialised yet (user's choice); `.gitignore` exists for later.
