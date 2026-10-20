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

## New settings

| Key | Default | Meaning |
|---|---|---|
| `ENGINE_DATA_DIR` | empty (`apps/engine/data`) | The engine's local data folder: the run lock and, from A5, the Mem0 usage numbers. Never content. |
| `RUN_LOCK_STALE_MIN` | `10` | A run lock whose heartbeat is older than this (minutes) is taken over. |
