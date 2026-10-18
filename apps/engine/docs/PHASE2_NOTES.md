# Phase 2 (Scout): decisions and differences from the brief

viaSocket `skill.md` and `ai.md` were re-fetched on 2026-10-17 and are unchanged since Phase 1's read.

## Decided with you

| Topic | Brief | Decision |
| --- | --- | --- |
| DRY_RUN | "save nothing to Mem0" | Phase 1 rule kept: no Mem0 writes **except `run_log`**, which carry `dry_run: true`. Reads still happen. No Slack/M91. |
| `aiSend` | (needs per-call delivery + retry cap) | Two optional params added: `delivery`, `retries` (+ `onRetry`). Existing callers unchanged. |
| `SCOUT_MAX_CALLS` | 10 | **14**: 10 planned calls leave no room for any retry. |
| `DOCS_MAX_CHARS` | 150000 | **45000** (config rejects > 48000). The live API refuses a `message` over 50,000 characters (`Validation error "message" length must be less than or equal to 50000 characters long`), which ai.md doesn't mention. Every Scout message also goes through a guard that cuts docs → README → already-covered → facts to fit, with a warning. |

## Differences and interpretations (tell me if any is wrong)

1. **"Web: No" can't be enforced by a flag.** viaSocket's web access is always on; a body flag is
   rejected (ai.md, section 3). Only the prompt can forbid it. FACTS says "Do not use the web" and
   TUTORIALS limits it to the repo URL. **CLUSTERS has no such line**, and I kept the brief's
   prompt text exactly. Add a line? (It works on the questions given, so web use is unlikely.)
2. **Missing keys.** `M91_SKILL_REPO_URL`, `COMPETITORS` and `AI_MAX_RETRIES` were described as
   "already in .env" but weren't in Phase 1. They're added with defaults (see `ENV_PHASE2.md`).
3. **`send_to: "scout"` routing changed.** Phase 1 re-ran research + Strategist. Now the orchestrator
   runs the Scout in **sources mode** and goes straight back to the Writer with the source pack
   (brief 8/13). Claims come from `review.claims`, falling back to `review.feedback` until Phase 5
   defines the Reviewer's shape.
4. **Approved posts.** For dedupe to recognise "an approved or published post (or its brief)", the
   orchestrator now marks the `brief` record `approved` when the Reviewer passes it.
5. **Reuse mode** skips questions, clusters **and tutorials** (the brief lists only facts, stories and
   ranking as running). Style notes still run, but normally reuse the profile (`STYLE_REUSE_DAYS`).
   "Last successful research run" = the latest non-dry `run_log` with `call: "research_summary"`.
6. **URL rules.** Besides 401/403/429, other non-404 errors (e.g. 500, 405 on GET) are also kept as
   `blocked`, since they don't prove a page is gone. Only 404, 410, DNS failure and timeouts are dropped.
   Sources mode uses the same rule (ok + blocked kept).
7. **llms.txt is page 1 of the docs bundle** (it counts toward `DOCS_MAX_PAGES`/`DOCS_MAX_CHARS`), so
   facts may cite it. Doc pages already fetched for the bundle aren't re-checked.
8. **Tutorial steps** may cite any URL under the skill repo (e.g. `…/m91-skill/blob/main/README.md`),
   not only the bare repo URL.
9. **Dedupe** uses Mem0 search scores. Mem0 v3 uses hybrid retrieval, so a score of 0.85 may not mean
   what it would with plain cosine similarity. The live smoke test will show real scores; the
   threshold may need tuning.
10. **Truncation over rtlayer.** The thread history may not carry `finish_reason`, so a truncated
    rtlayer answer is caught as invalid JSON and gets the schema retry instead.
11. **Schema fallback.** If the API rejects `$defs`/`$ref` in `scout_m91_facts`, the call is retried once
    with an inlined copy (a warning is added).
12. **Sync 502 is not re-sent.** A sync call that outlives viaSocket's ~1-minute gateway gets a 502, but
    the run finishes and its answer lands in the thread history (ai.md). Re-sending paid for the call twice
    (seen live on the facts call), so a sync 502 now reads the answer from the history instead. A 502 on an
    rtlayer *send* is still retried. 402 "plan credits exhausted" fails the run at once.
13. **Low-credit scripts:** `scout:lite` / `pipeline:lite` (DRY_RUN) and `scout:lite:live` use 1 question
    group, 3 questions, 15,000 chars of docs, max 6 calls, 1 retry. `SCOUT_QUESTION_GROUPS` picks the groups.
14. **`ajv`** pinned at 8.18.0 (8.17.1 has a moderate advisory; `npm audit` now reports 0).
