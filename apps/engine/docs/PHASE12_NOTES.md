# Phase 12: fresh start, the roadmap, simpler and stricter writing

The engine now writes along a **roadmap**: a learning path from "what M91 is" to comparisons and migrations.
Each full run writes the next slot of the roadmap. Nothing runs until you approve the roadmap.

Embarko is not used any more. Its code stays in the repo, unused; with `PUBLISH_TARGET=none` the dashboard
shows no blog, publish or preview item.

## Settings

```
PLANNER_AI_SERVICE=openai
PLANNER_AI_MODEL=gpt-5.6-luna
PLANNER_DELIVERY=sync
PLANNER_MAX_REPAIRS=1
ROADMAP_ENABLED=true
RAPID_RESPONSE_ENABLED=true
READING_GRADE_POST_MAX=7
READING_GRADE_INTRO_MAX=6
READING_GRADE_HARD_MARGIN=1
TARGET_WORDS_MIN=500
TARGET_WORDS_MAX=1200
SENTENCE_MAX_WORDS=20
SENTENCE_HARD_MAX_WORDS=25
PARAGRAPH_MAX_SENTENCES=3
MEM0_MONTHLY_ADD_LIMIT=10000
```

These are also the defaults when a line is missing (all are in `env.example`). The unit tests pin the earlier
behaviour (`ROADMAP_ENABLED=false`, `RAPID_RESPONSE_ENABLED=true`) and test the roadmap explicitly.

## Task 1: a fresh start (`npm run reset:all`)

- `npm run reset:all -- --dry-run` counts the Mem0 memories under `MEM0_AGENT_ID` by type, and the local
  leftovers (`data/`, `exports/`). It deletes nothing. 1 Mem0 request.
- Without `--dry-run` it asks for "yes", then sends one Mem0 delete-all for our agent id only, waits 20 s,
  and checks with one list. It then clears the local leftovers, except `data/mem0-usage.json`.
- It refuses an empty or `*` agent id, a run in progress, and `DRY_RUN=true`.
- Mem0's delete-all runs in the background. The engine does not poll for it (polling used about 46 requests).

## The Mem0 quota: two limits

Mem0 counts reads and writes apart:
- **Retrievals** (reads + searches) count against `MEM0_MONTHLY_LIMIT` (1,000).
- **Adds** (writes) count against `MEM0_MONTHLY_ADD_LIMIT` (10,000).

The banner level is the worse of the two, and it names the limit reached. The header pill shows both:
"Mem0 619/1000 · adds 146/10000". Set the figures from the Mem0 console with
`npm run mem0:usage -- --set=<retrievals> --set-adds=<adds>`.

## Task 2: the roadmap and the Roadmap Planner

- Stages: 0 Starter (exactly 2 slots), 1 Foundations, 2 First steps (beginner), 3 Use cases, 4 Best
  practices (intermediate), 5 Comparisons and migrations (advanced). Stages 1–5 have 3–6 slots each.
- A slot has an id (`s<stage>-<n>`), a title idea, the reader's question, what it teaches, and `needs`
  (earlier slots only). Comparisons and migrations go in stage 5 only.
- `npm run roadmap -- --generate` (or **Generate** on the Roadmap page): the Planner gets the M91 facts first
  (1 Scout call when there are none yet), then 1 call plus repairs. The roadmap is saved as a **draft**.
  Regenerating keeps the slots already written (locked) and the proposed ones.
- `npm run roadmap -- --show` and `-- --approve` do the same as the dashboard.
- One Mem0 record of type `roadmap` holds it.

## Task 3: each run writes the next slot

- A full run picks its target before research: a pinned topic that is due first, otherwise the next planned
  slot whose `needs` are done (approved or skipped). With nothing to write, the run ends as **skipped**
  (no alert).
- The gate: a full run answers 409 `roadmap_not_approved` ("Approve the roadmap first") or `nothing_to_write`.
- Slot statuses: planned → drafting → in_review → approved. A failed or cancelled run puts the slot back to
  planned. Rejecting the topic marks the slot skipped.
- Rapid response was off in Phase 12; it is now the timely lane (see below), where you decide on every post.

## Task 4: a focused Scout

In slot mode the Scout researches only the slot: 1 call for the questions people ask about it, 1 for the
sources (2–3 calls in all). It saves a question cluster with the slot id, a source pack for the brief, and
tutorial leads. When it finds demand outside the roadmap, it adds **proposed** slots (with the evidence).
They are not written until you accept them.

## Task 5: the knowledge map and a journey-aware Strategist

- After each approval, a `knowledge` record lists what the reader has learned (the slot's `teaches` and the
  brief's `terms_to_define`).
- The Strategist gets the post to plan, the knowledge map and the sources. The map it gets is capped: at most
  the last 40 entries, newest first, each summary at most 200 characters (no agent gets an earlier post's text). Its brief says which earlier posts
  it builds on (`why_today`) and which terms it must define (up to 8).

## Task 6: a stricter, simpler Writer

- Hard checks: a sentence over 25 words, a paragraph over 3 sentences, the post's reading grade over 7, the
  intro's (TL;DR + first paragraph) over 6.
- Soft check: sentences of 21–25 words, listed for the Reviewer.
- Length: 500–1,200 words.
- Reviewer weights (Experience Designer off, the current setting): answers 15, accuracy 15, simplicity 20,
  to the point 15, SEO 10, structure 5, tone 5, originality 5, AI answer readiness 5, M91 fit and CTA 5 = 100.
- With the Experience Designer on, `experience` (10) takes 5 from to the point (15 → 10) and 5 from SEO
  (10 → 5).

## Task 7: the dashboard

- **Roadmap** page (in the menu when the roadmap is on): status, Generate / Regenerate with its cost,
  Approve roadmap (blocked while there are problems), the stages and their slots with status, the **Next up**
  slot highlighted, and per slot: Edit, Move up/down, Skip / Unskip, and Accept / Reject for proposed ones.
  Written slots are locked. Changes are refused while a run is in progress.
- **Control:** "Next up" above **Run full pipeline**, with the roadmap cost (5–12 AI calls, ≈20–35 Mem0
  requests). The button is blocked with the reason when there is nothing to write.
- **Approval screen:** a Roadmap card with the slot, its stage and level, what it teaches and explains, the
  posts it builds on (linked), and how it builds on them.
- **Settings:** a Roadmap card (roadmap on or off, the timely lane, the Planner's model).

## Expected costs

| Action | AI calls | Mem0 requests |
| --- | --- | --- |
| Generate the roadmap | 1–2 | ≈5–8 |
| Full run (one slot) | 5–12 | ≈20–35 |
| Approve a post | 0 | a few (export + knowledge record) |

## The timely lane (next to the roadmap)

When something happens in the world that M91 could help with, the engine finds it and you decide. A timely post
jumps the queue without breaking the roadmap: it never uses up a slot.

### Settings

```
RAPID_RESPONSE_ENABLED=true
TIMELY_CHECK_ON_RUN=true
TIMELY_WINDOW_DAYS=7
TIMELY_MAX_PER_WEEK=1
```

`RAPID_RESPONSE_ENABLED=true` now means "the timely lane is on, and you decide". It works only with
`ROADMAP_ENABLED=true`. These values are also the defaults.

### The news check (1 AI call)

- A Scout mode, `timely`, makes one web-search call. It asks for real events of the last `TIMELY_WINDOW_DAYS`
  where M91 genuinely helps: AI agents acting without approval, missed alerts or approvals, payment or
  deployment mistakes, new rules about human oversight, Opsgenie news.
- **Each event has:** a title, what happened (2 sentences, in its own words), the source URL, outlet and
  date, why it matters for M91, and an urgency (low, medium or high) with a reason.
- **Code keeps an event only when:**
  - its date is inside the window (not undated, not in the future);
  - its source loads (the URL check);
  - it is not already known: the same source URL as a card, or a title close to a card's or an approved post's
    (local similarity, `DEDUPE_SIMILARITY_LOCAL`).
- **What's kept:** at most 5 events. Each becomes a `timely_opportunity` card with status `proposed`.
- **It runs:**
  - first in every full run (`TIMELY_CHECK_ON_RUN=true`); a failed check is a warning, and the run goes on;
  - on demand: **Check news** on the Roadmap page, or `npm run timely -- --check`. Both run as a normal run
    (mode `timely_check`).
- **Facts:** it uses the newest M91 facts as they are; a facts call is made only when there are none at all.
- **Mem0:** 2–3 retrievals (the cards, the facts and the knowledge map; the engine's index serves the
  cards), plus one add per new card.

### Cards (`timely_opportunity`)

| Status | Meaning |
| --- | --- |
| proposed | found by a news check; waits for you |
| write_now | you clicked **Write now**: the next run writes it |
| added_to_roadmap | it became a planned slot in the stage you picked |
| dismissed | you dismissed it, or rejected the timely post's topic |
| written | its timely post was approved |
| expired | proposed or write_now, and more than `TIMELY_WINDOW_DAYS` past the event's date |

- **Expiry:** a card expires `TIMELY_WINDOW_DAYS` after the event's date. A card being written never expires.
  Cards are marked expired at each news check; the list shows them as expired right away.
- **Add to roadmap:** the card becomes a planned slot in the chosen stage. Its question comes from the event,
  and it teaches one concept (the event's title), which you can edit on the Roadmap page. The roadmap's own
  rules apply (comparisons only in stage 5).

### Picking order (code)

The order is: a pinned topic that is due, then one `write_now` card, then the roadmap's next slot.

- **Starter rule:** no timely post until the Starter (stage 0) has an approved post.
- **Weekly cap:** at most `TIMELY_MAX_PER_WEEK` timely posts per 7 days. A post counts once it is written
  (approved) or being written.
- **When a card waits:** the run writes the roadmap's next slot instead. Control, the Roadmap page and the run
  show why the card waits.
- **During a run:** the card holds the run's brief id. A failed or cancelled run frees it again; it stays
  write_now.

### Writing a timely post

- **Scout (slot mode):** researches the event. Its source URL is the first source in the source pack, and the
  card becomes the run's story lead (`reported by <outlet>`).
- **Strategist:**
  - `post_type: rapid_response`, with the news fields filled from that story; `slot_id` is "";
  - the timely rules; the most relevant earlier posts from the knowledge map as notes for the Writer and
    internal links;
  - the story counts within `TIMELY_WINDOW_DAYS`.
- **Writer:** code puts "New to M91? Start here: **<Starter post title>**." as the first line of the body,
  right after the TL;DR. Any line the Writer wrote itself is replaced. The Starter post is the first approved
  stage-0 post. With `PUBLISH_TARGET=none` there are no public URLs, so it is the title in bold; it becomes a
  link once the post has a URL.
- **Checks:**
  - `start_here_line`, a new hard check for timely posts;
  - the existing `news_attribution` check ("reported by <outlet>").
- **Reviewer:** the existing news gates apply.
- **On approval:** the card becomes `written`. The knowledge map saves the post with `kind: "timely"`.
  Rejecting the topic dismisses the card.

### API, CLI, dashboard

| Route | What it does |
| --- | --- |
| `GET /api/timely` | The cards (newest first), the open count, the card written next, and a waiting card with its reason. 0 Mem0 requests with the index. |
| `POST /api/timely/<id>` | `{ "action": "write_now" }`, `{ "action": "add_to_roadmap", "stage": 1–5 }` or `{ "action": "dismiss" }`. 409 while a run is in progress or when the status doesn't allow it. |
| `POST /api/runs` with `mode: "timely_check"` | The news check alone. |

- **CLI** (in `apps/engine`): `npm run timely -- --check | --list | --write-now <id> | --dismiss <id> | --add <id> --stage <1-5>`.
- **Dashboard:**
  - the Roadmap page has a **Timely opportunities** section: the cards with their three buttons, **Check
    news** with its cost (1 AI call, ≈2–3 Mem0), and the waiting reason;
  - Control shows a badge with the open cards;
  - Settings shows the four settings.

| Action | AI calls | Mem0 requests |
| --- | --- | --- |
| Check news | 1 | ≈2–3 retrievals, + 1 add per new card |
| Full run (news check on) | 6–13 | ≈21–37 |
| Write now / Add to roadmap / Dismiss | 0 | 1–2 |

## No M91 docs links in posts

A post's links and its Sources list contain only real outside sources (news, articles, threads, official
third-party docs), M91's main site https://m91.msg91.com/ and the call to action (`M91_CTA_URL`, unless it is
itself a docs page). The agents still **read** the docs for facts (Scout facts, the Strategist's
`m91_facts_to_use`, the Reviewer's M91 FACTS); only the links readers see change.

- **What counts as a docs link** (`src/util/m91links.js`): any URL on `m91-api.msg91.com`; any path on
  `m91.msg91.com` other than the home page (llms.txt, `/api/public/*.md`, docs.html, quickstart, …); the M91
  skill repository on GitHub (`M91_SKILL_REPO_URL`).
- **Writer:**
  - docs URLs are out of ALLOWED URLS, and the main site is in;
  - the prompt says to state M91 facts without a docs link, and to link the word "M91" to the main site once
    or twice per post.
- **Code snippets:** no "Source: <docs link>" line under the code. The code still comes only from the docs.
  Drafts written with the old line still turn back into snippet tokens for a revision.
- **Automatic fix (code, 0 AI calls):** it runs before the checks and again in the Markdown export.
  - A docs link outside code becomes `[same text](https://m91.msg91.com/)`, and a bare docs URL becomes the
    main site.
  - A leftover "Source:" line goes, and the Sources list drops docs links and duplicates.
  - Code (fenced blocks and inline code) is never changed.
  - Each change is in the run's warnings ("docs links: …").
- **Hard check `no_docs_links`:** no docs link may remain in the post. The export is never saved while it
  still has one (409 `docs_links`).
- **`links_count`** (soft): neither the docs nor the main site count as an outside source.
- **Reviewer:** an M91 claim that matches M91 FACTS passes without a link; outside facts still need their
  outside source. Its ALLOWED URLS follow the Writer's.
- **Re-export:** `npm run export -- --all-approved` exports every approved post again under these rules (record
  replaced, file rewritten). It makes 0 AI calls and a few Mem0 requests per post.

## Why the Reviewer failed every post: four fixes

The first Phase 12 reviews (three briefs, eight versions) all failed the code gate `checks_hard_passed`. Two
versions scored 80 and 82.5 and failed only on a reading grade. Four fixes:

1. **Reading limits: hard 8/7, soft 7/6.** `READING_GRADE_HARD_MARGIN` is now 1 (it was 0).
   - `READING_GRADE_POST_MAX=7` and `READING_GRADE_INTRO_MAX=6` are targets. Missing them fails the soft checks
     `reading_post` and `reading_intro_target`; the Reviewer still scores simplicity by them.
   - The hard checks `reading_post_hard` and `reading_intro` fail only above target + margin: post 8, intro 7.
2. **Link checker: one retry, and a timeout is "blocked", not "dead".**
   - A request that fails (a timeout, a reset) is tried once more after a short wait. If it fails again, the
     link is "blocked" and kept.
   - Only 404/410, a host that does not exist (DNS) and a refused connection are "dead". Before this,
     https://m91.msg91.com/ was failed as dead after one slow answer.
3. **The news source is linked by code** (`src/writer/newslink.js`, part of the Writer's automatic fixes). In a
   story or news post, the outlet's name at its first mention ("reported by <outlet>" first) becomes a link to
   the brief's source URL. Headings, code and existing links are skipped. The wording does not change, so the
   attribution checks still pass.
4. **Writer prompt lines:**
   - link the outlet at its first mention; every outside claim carries its link;
   - examples stay generic: no invented names, IDs, timestamps, companies or payload values (no "Aryan", no
     "deploy-4821"), and an M91 field or behaviour only when the brief's M91 facts state it;
   - no absolute claims ("cannot", "always", "guarantees", "impossible"): say what a control does and what it
     does not cover.

0 extra AI calls and 0 extra Mem0 requests. A few more link-check requests when a site is slow.

## The Writer only for major problems

The next run (261023-1426-8D57) still failed: `READING_GRADE_HARD_MARGIN=0` in the settings kept the old limits, and
each revision for a small problem rewrote the post and added new, real errors (scores 71.5 → 72.5 → 71). In the 16
reviews read, four versions scored 80+ and failed only on a reading grade that the 8/7 limits allow.

```
REVISE_BELOW_SCORE=70
WRITER_REVISION_INPUT=full
```

- **Three outcomes** (code, `outcomeOf` in `reviewer/decide.js`):
  - **pass:** every gate passed, no hard check failed, total ≥ `PASS_SCORE_MIN`, every area ≥ `PASS_AREA_MIN`.
  - **pass with notes:** no major problem, but something minor is left: a total from `REVISE_BELOW_SCORE` up to
    `PASS_SCORE_MIN`, an area under `PASS_AREA_MIN`, or a minor hard check. The post goes to you, not back to the
    Writer. Its "must" items become "should", and code lists the minor checks and low areas as "should fix". The
    dashboard shows an amber **pass with notes**. **Request changes** still works as before.
  - **revise:** a major problem: a failed AI gate (facts, invented content, sources, claims to avoid, the main
    question, legal framing), a source that contradicts the post, a major hard check, or a total below
    `REVISE_BELOW_SCORE`. Only then does the post go back (Writer, Strategist or Scout, as before).
- **Minor hard checks:** `paragraph_length` and `sentence_hard`. They no longer trigger the Writer's repair call
  and never block **Approve**; every other hard check is major. A draft records `major_passed` next to `hard_passed`.
- **Paragraphs split by code:** a paragraph over `PARAGRAPH_MAX_SENTENCES` is split at sentence ends into even
  groups, same words (part of the Writer's automatic fixes; lists, quotes and code are left alone).
- **Attribution in common wording:** the `news_attribution` check and the Reviewer's `story_attribution_correct`
  gate accept "reported by X", "X reported", "a report by X", "X's report" and "according to X".
- **Focused revisions:** a revision now sees the full previous draft (`WRITER_REVISION_INPUT=full`; before, only a
  summary) and is told to change only the sentences the feedback names and copy everything else word for word.
- **Reviewer:** "must" is kept for problems that make the post wrong, unsupported or misleading; wording, length
  and polish are "should".

`REVISE_BELOW_SCORE=80` brings back the old rule for the score (a low area or a minor check still gives a pass with
notes). Costs: 0 extra AI calls; a revision's prompt is longer (the full draft).

## The Memory manager (dashboard /memory)

A page to see what Mem0 holds, judge whether each record is still useful, and delete what is not.

- **What it shows:** every record the engine's index holds, with counts per type (and how many look unused), filters
  (type, status, brief id, created after/before, title or id search, "Probably not useful", "Old after N days") and
  why each record may not be useful. Clicking a title opens the record (RecordDetail).
- **Why a record may not be useful** (`src/memory.js`, `judgeRecords`): a dead status (superseded, expired,
  discarded, cancelled, old, failed, rejected, failed_review, publish_failed, unpublished); dry-run or smoke-test data
  and broken version numbering (the cleanup rules); made for a brief that was rejected, replaced by a newer brief
  version, or is no longer in memory; a review/promo pack/guide of a draft that was superseded or rejected; the newest
  brief with no draft after N days; duplicates (same type and brief + version or lead id, or a lead with the same
  title; the newest copy is kept); leads (clusters, stories, tutorials, timely cards) older than N days that no brief,
  run, roadmap or knowledge record refers to; run history and run logs older than N days. Nothing is flagged for
  records of an approved or published post.
- **Protection:** never deletable here: published posts, current M91 facts and style notes, the approved roadmap,
  current knowledge records, and exports of approved or published posts. Deletable with an extra tick: lessons,
  open pinned topics, other blog post records, a roadmap that is not approved, settings, and the briefs, drafts and
  reviews of an approved or published post.
- **API:** `GET /api/memory` (index only, 0 Mem0 requests; `not_loaded` names types the index has not loaded),
  `POST /api/memory/load-all` (one paged list of the whole agent id, about 1 request per 100 records, then every type
  is held; Refresh repeats it), `DELETE /api/records` with `{ ids, confirm_protected }` (1 request per delete). The
  delete is refused while a run is in progress (409), with DRY_RUN on (409, deletes would be skipped), at the Mem0
  stop level (429), or when any id is protected (400) or needs the tick (409); then nothing is deleted. The index
  drops each deleted record from its own write events, so no re-read is needed.
- **Costs:** every list and filter 0 Mem0 requests; Load all ≈ records / 100; each delete 1. List views never read
  records one by one.

## The agents hand off in process; Mem0 keeps finished posts and context (`WORK_STORE=local`)

The agents (Scout → Strategist → Writer → Experience Designer → Reviewer) already passed their output to the next one
inside the run; every step also wrote it to Mem0. Now a run's work in progress stays in a local file, and Mem0 holds
only what has to outlive the run.

- **Local** (`work.json` in the engine's data folder, ids start with `w-`): the briefs, drafts, reviews, guides and
  source packs of a post this engine started (the full run "claims" its new brief before the first step), and every
  run's full record (steps, timeline). Code: `src/workstore.js`, under `createStore` in `src/store.js`.
- **Mem0:** M91 facts, style notes, lessons, the roadmap and knowledge records, pinned topics, leads and question
  clusters, timely cards; finished posts (published posts, Markdown exports, promo packs); one **short run summary**
  per run (status, times, steps without the timeline; written once, at the end; not in DRY_RUN).
- **Approval** copies the finished post to Mem0 (`promoteBrief`): the final brief, the approved draft, its review and
  its guide (4 writes, each with `promoted_from` = the local id), then deletes the brief's local work. Failed
  versions, their reviews, superseded briefs and source packs never reach Mem0. If the copy fails, the approval
  stands with a warning and the post stays in the local file.
- **Waiting for you:** a draft at awaiting_human (and its revisions) is in the local file, which survives an engine
  restart (and on Embarko a redeploy: `DATA_DIR` is kept). The engine's index loads the local records with Mem0's, so
  Approvals, Content and Runs show them; approve, counter prompt and reject find the draft by its `w-` id.
- **Clean-up:** the local work of a rejected, failed or cancelled post, and local run records, are deleted after
  `WORK_KEEP_DAYS` (default 7; a draft still waiting is never deleted) at engine start and at each full run
  (`pruneWork`); at most 200 local run records are kept. The Runs page then shows the run's Mem0 summary.
- **Lists:** a list of a work type scoped to a claimed brief is local only (0 Mem0 requests); other lists merge the
  local records with Mem0's (older posts stay readable). A run's Mem0 summary is hidden while its local record is held.
- **Older posts:** records already in Mem0 keep working (updates go by id). Work on a post that is not local (an
  older post, or a counter prompt on an approved post) goes to Mem0 as before.
- **The Memory page** (`GET /api/memory`, `held()`) lists Mem0 records only, not the local file.
- `WORK_STORE=mem0` puts every step in Mem0 again (the old behaviour). The unit tests pin it; `test/workstore.test.js`
  and the full-run measure test `local`.

Mem0 requests (`test/fullrun-mem0.test.js`, fake AI, a real Scout → Reviewer loop with one failed review; the engine's
index is not used, so reads of data from before the run are counted):

| Run | `WORK_STORE=mem0` | `WORK_STORE=local` |
|---|---|---|
| Full run | 30 (12 reads, 18 writes) | **17** (12 reads, 5 writes) |
| Counter prompt (revise) | 18 | **4** |
| Approve | 12 | **8** (4 copies, the export, the run summary, 2 reads) |
| Change the design | 7 | 5 |
| Publish | 12 | 10 |
| Unpublish | 10 | 8 |

With the engine's index (the dashboard engine) the lists are read once per engine start, then served from memory,
so later full runs should cost about 5 requests (the facts, cluster and lead writes, the cluster's "used" status and
the run summary). This is an estimate: the test above runs without the index.

## Hosting on Embarko (admin login)

The engine and dashboard can run on Embarko as `m91-engine`, behind an admin ID + password login that is forced
on there. See [EMBARKO_HOSTING.md](EMBARKO_HOSTING.md) for the limits found in Embarko's docs and the design, and the
runbook for how to log in, redeploy and roll back. New settings: `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`.

