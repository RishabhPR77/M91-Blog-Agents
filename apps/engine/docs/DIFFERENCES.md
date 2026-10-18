# Brief vs. live docs: differences and decisions (Phase 1)

Docs read in full on 2026-10-17: viaSocket `skill.md` (version 2026-10-16), `ai.md`,
`automations.md`; Mem0 `llms.txt`, Add Memories, Update Memory, Get Events, Platform v2→v3 migration;
package sources `viasocket-apps@0.6.0` and `mem0ai@3.3.1`.

## viaSocket skill (installed 2026-10-17)

`.claude/skills/viasocket/SKILL.md` is a copy (not a symlink) of
`skill-install.md?org=82344&project=projiwTiI1aA`. It's a short pointer that fetches the full, current
`skill.md` each time the skill is used. The `beta-flow.viasocket.com` and `flow.viasocket.com` versions
were byte-identical. The full skill with these ids matched the `skill.md` read earlier the same day
(version 2026-10-16), apart from the filled-in ids. Its "Read .env" step stays overridden by CLAUDE.md.

## Needs your decision

| # | Brief says | Docs say | What the code/docs do now |
| --- | --- | --- | --- |
| 1 | Webhook flows: "JS step that **stops** unless body.key equals my shared key" | automations.md: a step that throws or returns early does **not** stop the run; the next step still runs | `SETUP_FLOWS.md` makes the **send step** check `context.res.check_key.ok` (condition block, or a JS step that calls the Slack/M91 action only when ok). Pending your OK. |
| 2 | M91 severity default LOW | M91's "Send Channel Alert" field values not checked yet (needs the app doc with your org/project) | Engine sends `LOW \| MEDIUM \| HIGH \| CRITICAL`. Tell me if M91 uses other values. |

## Noted, no conflict (following the docs)

- **Model list.** All five configured models are in ai.md's "Choosing the model" list (confirmed there
  on 2026-10-14): `gpt-5-mini`, `gpt-5.6-luna` (the default), `gemini-2.5-flash`, `gpt-5.5`. The
  commented `WRITER_FALLBACK_MODEL=claude-sonnet-4-6` is also on the list.
- **Model confirmation.** The sync reply does not name the model (ai.md). The websocket answer does
  (`data.model`). The thread history may or may not include it; smoke test S3 reports what it sees.
- **422 for a misspelled `service`.** Treated as a config error, not retried, like a 400 "model or
  service does not exist".
- **502 retries.** ai.md: a 502 after about a minute usually means a sync call outlived the gateway (often
  browser use). It is retried as the brief asks (max 3 retries), but long work should use `rtlayer`.
- **Token signing.** Uses `signEmbedToken` from `viasocket-apps`; it produces exactly the skill's HS256
  three-claim token. `jsonwebtoken` is not needed. The AI calls themselves use a thin fetch wrapper,
  because the package's `history()` drops extra fields (`model`, `finish_reason`).
- **The skill's "Read .env" step** is overridden by CLAUDE.md: Claude asks you instead.
- **Thread per call.** ai.md requires a `thread_id` with `rtlayer`, at most 100 characters of letters,
  digits, `-` and `_`. The generated ids fit that.

## Mem0 (v3 Platform / `mem0ai` 3.x)

- **`add` is asynchronous.** It returns `{ event_id, status: "PENDING" }`. `createRecord` polls
  `GET /v1/event/<id>/` until `SUCCEEDED`, then takes the memory id from the event. If the event
  doesn't name it, it finds the memory by a unique `record_key` that it adds to the metadata.
- **`MEM0_ORG_ID` / `MEM0_PROJECT_ID` are removed in v3.** The API key is project-scoped. The keys
  stay optional in config and are unused.
- **Entity ids for reads go in `filters`**: `{ AND: [{ agent_id }, { run_id }] }`; top-level use is a 400.
  Metadata (`type`, `status`, `version`…) is filtered client-side after listing by agent_id/run_id.
- **v3 add is ADD-only.** With `infer: false` the text is stored as-is. Updates go through
  `PUT /v1/memories/<id>/` by id, so there is never a second copy.
- **SDK telemetry** is turned off (`MEM0_TELEMETRY=false`) before the SDK loads.

## Small additions beyond the brief (optional keys with defaults)

- `PROMO_DELIVERY` (default `sync`): the brief gives promo a service and model but no delivery.
- `AI_RTLAYER_TIMEOUT_MS` (default 300000) and `AI_POLL_INTERVAL_MS` (default 3000): the "configurable
  timeout" for rtlayer polling.
- `PORT` (default 8080) for the server.
- `.env.example` itself can't be read or written by Claude (deny rule `./.env.*`). You created it
  from the content Claude provided.
