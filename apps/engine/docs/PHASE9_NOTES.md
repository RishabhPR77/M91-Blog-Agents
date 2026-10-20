# Phase 9: far fewer Mem0 requests, quality tuning, production readiness

Mem0 stays the store. Agents in one run pass their results to each other in memory. Mem0 is written only
where something must outlast the run, and read only when the data isn't already in memory.

## Before (measured 2026-10-19, low-cost full run R-261019-1622-M2LU)

Measured total: 97 reads, 2 searches, 58 writes (157). The split by step is traced from the code.

| Step | Reads | Searches | Writes | Total |
|---|---|---|---|---|
| Scout (6 AI calls, 1 cluster) | 22 | 1 | 11 | 34 |
| Strategist | 13 | 1 | 3 | 17 |
| Writer v1 | 8 | 0 | 3 | 11 |
| Writer v2 | 8 | 0 | 3 | 11 |
| Reviewer ×2 | 14 | 0 | ~9 | ~23 |
| Orchestrator (run_log after every step, the lock, failure statuses) | 12 | 0 | 11 | 23 |
| Run record (rewritten at every step start and end) | 18 | 0 | 18 | 36 |

Decision runs (measured): Reviewer check 28, approve 34, publish 28, unpublish 25. The dashboard made about
340 reads in 35 minutes, mostly from polling.

## A1: the run context (each list once, the run's own writes kept in memory)

- **`src/runstore.js`** wraps the store for one run:
  - each list is asked for once, with the type (and the brief and status when given) as server-side filters;
  - a narrower list is served from a wider one already held (for example `story_lead, open` from
    `story_lead`);
  - every write is applied to the held lists, so a record made or changed earlier in the run is never read
    back, even while Mem0 doesn't list it yet;
  - updates pass the held record, so Mem0 is not read first (`updateRecord(..., { known })`);
  - a new pipeline's brief id is marked as new, so lists scoped to it need no read at all;
  - only the types a run actually asks for are listed. DRY_RUN placeholders are not kept: DRY_RUN still
    hands objects over in memory, as before.
- **Synchronous add:** for records stored verbatim (`infer: false`, every record type here), Mem0's add answer
  contains `results[].id` (Mem0 docs: API reference, "Add Memories"). The store uses that id, so a save is
  1 request. Fallbacks, so a save never fails silently:
  - an answer with only an `event_id` is polled, as before;
  - an answer with neither is found by its `record_key` (one list read).

  The first real run will confirm which answer Mem0 gives.
- **The run lock is a local file** (`apps/engine/data/run.lock`, gitignored), so taking it costs 0 Mem0
  requests:
  - it is created atomically (it fails if the file exists);
  - it holds the pid, the run id and a heartbeat time, refreshed every 30 s while the run is active;
  - a lock whose process is gone, or whose heartbeat is older than `RUN_LOCK_STALE_MIN` (default 10), is taken
    over with a warning;
  - it is always released, whether the run succeeds, fails or is cancelled;
  - the message stays "A pipeline run is already in progress (owner …)".

  **This lock only works on one machine:** the engine and the CLI on this computer. Revisit it when the
  engine moves to the cloud.

## A2: write only what must outlast the run

- **`run_log` only for errors** (`src/util/runlog.js`), from every agent and the orchestrator. Successful AI
  calls and steps are already in the run record's timeline, the step log of the result, and the logs. A cancel
  is not an error.
- **The Scout's reuse check** no longer lists every `run_log`. The time of the last full research is kept on
  today's `m91_facts` record (`research_at`, carried over to the next day's record), which the run reads
  anyway. A finished fresh research notes it with one write; DRY_RUN never does.
- **The run record** is saved at the start, when a step fails, when the run waits for approval, and at the
  end. It is no longer saved at every step start and end. Through the run store, each save is one write.
- **Status changes:** an update that changes nothing is not written. Updates of records the run holds don't
  read first.
- **Clusters:** one write per cluster. Merges are collected, so several merges into one cluster make one
  update, together with its new rank. New clusters are created after ranking, with their rank already set:
  before, each was created and then updated with its rank.

## A3: duplicate checks in memory

- `src/dedupe.js` compares titles with a character-trigram (Dice) similarity, against lists the run already
  holds: briefs, drafts, clusters and tutorials. The run store reads each list once. It is used by:
  - the Scout's cluster check (merge, covered, or new);
  - the Scout's tutorial check (a similar title for the same target);
  - the Strategist's "already covered" check.

  None of them sends a Mem0 search any more: yesterday's run used 2.
- **DEDUPE_MODE=mem0** brings back the Mem0 search (with `DEDUPE_SIMILARITY`, 0.85).
- **Threshold: 0.65, not the 0.45 the brief suggested.** These are the scores on real-looking titles:

  | Pair | Score |
  |---|---|
  | "Send a One-Person Approval Alert" / "Send an approval alert to one person" | 1.000 |
  | "How to Gate Destructive AI Agent Actions" / "Gating destructive actions of AI agents" (with keyword) | 0.902 |
  | "How can HumanInTheLoop middleware reliably require human approval?" / "How do I make human-in-the-loop middleware reliably require approval?" | 0.869 |
  | "How do I make my agent ask before deleting data?" / "How can I make my AI agent ask before it deletes data?" | 0.833 |
  | "Bind Every AI Agent Human Approval to One Tool Call" / "Bind each human approval to a single tool call" | 0.697 |
  | "How to set up M91 with Claude Code" / "How to set up M91 with Cursor" (different) | 0.615 |
  | "How M91 Rings Through Silent Mode" / "Why does M91 ring through Do Not Disturb?" (close) | 0.552 |
  | "Approve a risky agent step from your phone" / "Approve a refund over $500 from Slack" (different) | 0.435 |
  | Other different topics | 0.03–0.25 |

  Duplicates scored 0.70 or more, and different topics 0.62 or less. With 0.45, the Claude Code and Cursor
  pair would count as a duplicate, and the "Approve …" pair was only 0.015 below the line. With 0.65, every
  pair falls on the right side. The silent-mode pair counts as different: it is a close topic, but a
  different question. The tests pin these pairs.

## A4: the dashboard stops spending quota

- **The engine's index** (`src/engineindex.js`) holds what the dashboard shows:
  - **Loading:** at engine start it loads the dashboard's types, one read each (runs, drafts, briefs, reviews,
    published posts, pinned topics, lessons). Other types load on first use, also with the type as a
    server-side filter.
  - **Staying current:** every write this process makes (runs, the API) is announced by the store
    (`src/storeevents.js`) and applied to the index, with no read.
  - **Lessons:** Mem0 extracts lessons later (`infer: true`), so a new lesson only marks that list for a
    reload on its next use.
  - **Serving:** every API read goes through the index. List pages, the run page, approvals, posts and
    record views cost **0 Mem0 requests** once their types are loaded.
- **Runs start from the index** while it is up to date. Pre-run checks and the run store's first lists come
  from memory. In the test, an approve run read nothing from Mem0 for its draft and brief.
- **Changes from another process:** every saved write stamps `data/last-write.json` (pid and time only).
  A stamp from another pid that is newer than the index's load time sets `out_of_date` in `/api/health`
  (which reads no Mem0). The dashboard then shows "Data may be out of date" with **Refresh from Mem0**
  (`POST /api/index/refresh`: one read per held type; refused while a run is in progress). While out of
  date, runs read Mem0 instead of the index.
- **CLI commands go through the running engine** when it answers on this machine and the dashboard login
  is off: `pipeline`/`run`, `publish`, `unpublish`, `set-index`, `rebuild-blog`, `designer`,
  `approve`, `revise`, `reject`, `review`, `reviewer`, `promo`, `pin` (add and cancel) and
  `lessons --delete`. The run shows live in the dashboard, and the CLI waits on the run detail, which is
  served from the index.

  These still work directly and set the out-of-date flag: `scout`, `strategist`, `writer`,
  `cleanup`, `test-await` and `blog:sync` (which only reads). The first three run an agent outside the
  run manager; the engine has no API for the other two.
- **No polling that touches Mem0:**
  - the dashboard polls only `/api/health`;
  - the lists refresh on live events;
  - the run page refreshes on step and approval events.

  The header shows "Data loaded N min ago".

## New settings

| Key | Default | Meaning |
|---|---|---|
| `ENGINE_DATA_DIR` | empty (`apps/engine/data`) | The engine's local data folder: the run lock and, from A5, the Mem0 usage numbers. Never content. |
| `RUN_LOCK_STALE_MIN` | `10` | A run lock whose heartbeat is older than this (minutes) is taken over. |
| `DEDUPE_MODE` | `local` | `local` (in-memory trigram similarity) or `mem0` (a Mem0 search per check). |
| `DEDUPE_SIMILARITY_LOCAL` | `0.65` | The threshold for local duplicate checks (see A3). |
