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

## Published guides and longer, SEO-shaped posts

The agent decides the next post itself (the roadmap and "Run full pipeline", later a cron), and it now knows what is
already live on msg91.com/guide, hand-written guides included.

**Published guides (code only, no AI).**
- `src/guides/sync.js` reads the guide site's RSS feed (the 20 newest posts) and the listing page. It keeps only M91
  posts: a post whose feed text never names "M91" on its own (every MSG91 post) is dropped without opening it; a link
  that is only on the listing page is opened once and kept when it is about M91. Posts found not to be about M91 are
  remembered in `guides-seen.json` in the engine's data folder, so they are not opened again.
- Each M91 guide is one `published_guide` record in Mem0: URL, title, description, date, headings, summary, keywords,
  word count (one add per new guide; existing ones are not rewritten). At most `GUIDES_MAX_PAGES` (12) pages per sync;
  the rest wait for the next one.
- When: before each full run (`GUIDES_SYNC_ON_RUN=true`; a failed read is a warning and the run goes on), with
  **Sync guides** on the Roadmap page, or the run mode `guides`. Mem0: the list read (once per engine start, from the
  index) plus one add per new guide. A full run now sends one more Mem0 read than before (31, 18 with the local work
  store).

**What the agents do with them.**
- **Roadmap:** a new slot status `covered` (`covered_by: { url, title }`): a guide already answers the slot, so it is
  done (for the picker and for "needs") and never written. The Planner gets PUBLISHED GUIDES and returns `covered`
  (only known guide URLs, only planned slots); regenerating keeps covered slots as they are. On the Roadmap page a
  planned slot can be marked "Covered by a guide…" and a covered one put back ("Not covered"):
  `POST /api/roadmap/slots/:id/cover { guide_url | null }`. The page says when guides were published after the roadmap
  was made (regenerate it then).
- **Knowledge map:** the guides join the approved posts (no duplicates by title, link or slug), with the slot they cover.
- **Strategist:** the guides are PUBLISHED POSTS (so `internal_links` may point to them, 1 to 3 per post) and ALREADY
  COVERED (no second post on the same thing).
- `GET /api/guides`: the guides, the slot each covers, and how many are newer than the roadmap.

**Posts closer to the hand-written guides** (rules taken from them, nothing copied):
- 1,200–2,000 words (`TARGET_WORDS_MIN`/`MAX`), up to 10 sections (`OUTLINE_MAX_SECTIONS`).
- The brief has 8–14 secondary keywords; the Writer uses every one at least once, and the main keyword in one H2.
- A "Frequently Asked Questions" section with 6–10 real questions before "What to do next"; a checklist for how-to,
  tutorial and checklist posts; problems and fixes in a table; "New to M91? Start with …" pointing to an earlier guide.
- "M91" links to https://m91.msg91.com/ at its first mention in the opening and in each H2 section (at most 8).
- Soft checks (pass with notes, never block): `secondary_keywords`, `faq_count`, `m91_links`; `keyword_count` allows
  about one use per 250 words. The Reviewer's SEO area looks for the same.
- No "SEO DETAILS" block in the export: the Docstar publisher sends the meta title, description and slug itself.

New settings (in env.example): `GUIDES_SYNC_ON_RUN`, `GUIDES_FEED_URL`, `GUIDES_LIST_URL`, `GUIDES_MAX_PAGES`,
`GUIDES_TIMEOUT_MS`. Changed defaults: `TARGET_WORDS_MIN=1200`, `TARGET_WORDS_MAX=2000`, `OUTLINE_MAX_SECTIONS=10`.

## The editor: what the next run writes (no AI)

The next post is no longer simply the next roadmap slot. `src/roadmap/editor.js` decides like an editor, and every
choice carries a one-line reason (in the run, and in "Next up" on the Roadmap page and on Control):

1. A pinned topic that is due, then a news card you chose with **Write now**: first, as before.
2. Candidates: the ready roadmap slots of the lowest unfinished stage, the ready tutorial slots of the next stage, and
   the news cards the news check found (medium or high urgency, not expired).
3. No near-repeats: a candidate too close to a guide live on msg91.com/guide, an approved post or a post being
   written is left out and listed with the post it repeats ("Left out s0-2 …: close to a published guide …"). Close =
   similar titles, or at least `NEXT_SIMILARITY` (0.6) of the candidate's words (title, question, what it teaches)
   already in that post's title, description, headings and keywords. When every ready topic repeats something, the run
   writes nothing and says which slots to mark covered or edit.
4. The mix:
   - **news** when a fresh, relevant card exists and no news post went out in the last `NEXT_NEWS_GAP_DAYS` (7) days
     (the Starter must have an approved post, and `TIMELY_MAX_PER_WEEK` still applies). The card is marked Write now;
   - a **tutorial** when none of the last `NEXT_TUTORIAL_EVERY - 1` (2) posts was one and a tutorial is ready (stage 2,
     or a how-to title);
   - otherwise **the next roadmap slot**.

`NEXT_PICK=roadmap` keeps the old behaviour (always the next slot). Settings in env.example: `NEXT_PICK`,
`NEXT_SIMILARITY`, `NEXT_NEWS_GAP_DAYS`, `NEXT_TUTORIAL_EVERY`.

## Mem0's own monthly limit

Seen on 2026-10-28: Mem0 refused every read ("Monthly retrieval limit reached (1000 of 1000)", reset 2026-11-19,
the account's billing day). The engine's own counters could not see it coming (the local and the hosted engine count
separately). Now the store turns that error into a clear one (no retry), the guard records Mem0's figures and reset
date and pauses runs until then (also past the 1st), the API answers 429 `mem0_quota` with the plain message, and the
dashboard banner says it. Setting the figures again (`npm run mem0:usage -- --set=<n>`) clears it, after the limit is
raised in Mem0.

## viaSocket AI memory instead of Mem0 (MEMORY_BACKEND=viasocket, the default)

Mem0's plan allows 1,000 retrievals a month, and the engine hit it on 2026-10-28 (reset 2026-11-19). The latest
viaSocket skill (2026-10-28.4) offers **viaSocket AI memory** (https://memory-api.viasocket.com/guide.md): no monthly
cap, paid per successful call (reads $0.002, writes $0.10 per 1,000), signed in with the VIASOCKET_* keys the engine
already has. It is now the engine's record store.

- `src/vsmemory.js`, the same interface as the Mem0 store. Every call goes through `viasocket-apps` (0.11.0):
  `viasocket.user(VIASOCKET_SYSTEM_USER_ID).memory.call(…)`, which signs the embed token and keeps the memory token
  fresh. The engine writes in its own space (the token's `me`); the local and the hosted engine share it.
- One record = one note at `<MEMORY_ROOT>/<type>/<id>` (MEMORY_ROOT=m91-blog), written with `PUT /notes`: saved
  exactly as sent, never merged; saving again updates the same path, and viaSocket keeps every version. The note body
  is the record as JSON; its title (`type|brief|status|version`) lets a list skip notes without opening them. Ids look
  like `vm_<type>_<20 hex>`.
- Lists: `GET /index` on the type's folder (500 a page), then `GET /open` for the notes that may match, 8 at a time.
  The engine's index loads them once and keeps them current. Search: `POST /search` in the folder. Delete:
  `DELETE /notes`. The reset (`npm run reset:all`) deletes every note under MEMORY_ROOT, one call each (deletes are
  free), never anything else in the space.
- Network errors and 5xx are tried twice more; a 4xx is not.
- The quota guard never stops runs on viaSocket memory: the header shows the month's reads, writes and their cost
  ("Memory 120 reads · 30 writes · ≈$0.00"). `MEM0_API_KEY` is needed only with `MEMORY_BACKEND=mem0`.
- `MEMORY_BACKEND=mem0` brings Mem0 back (the code is unchanged). The Mem0 records are not copied: they cannot be read
  until Mem0 resets. The first runs on viaSocket memory start fresh (guides sync, the Scout reads the M91 facts, the
  roadmap is generated again); drafts in progress stay in the local work store.
- The repo's `viasocket-check.mjs` is the latest from viaSocket (0 FAIL, 0 WARN over 102 files).

## One click, and each agent's model on Control

- **One click** (`ROADMAP_AUTO_PLAN=true`, `ROADMAP_AUTO_APPROVE=true`, the defaults): "Run full pipeline" no longer
  stops at "there is no roadmap yet" or "Approve the roadmap first". With no roadmap, the run plans it first (the
  Roadmap Planner, 1–2 AI calls; it sees the published guides), approves it itself when it has no problems, then picks
  and writes the next post. A draft roadmap without problems is approved by the run. A roadmap with problems is not
  approved (the run says so). "Next up" on Control says what the click will do ("First run: the run plans the roadmap
  first …"). `ROADMAP_AUTO_APPROVE=false` keeps your approval step; `ROADMAP_AUTO_PLAN=false` keeps the old gate.
- **Models on Control:** each run card names the AI model its agent uses now ("AI model: gpt-5.6-luna (openai)"), and
  "Run full pipeline" lists every step's model (Planner, Scout, Strategist, Writer, Designer when on, Reviewer). They
  come from the engine's settings, so they change when you change `*_AI_MODEL` / `*_AI_SERVICE` and restart.
- The cost lines say "Expected memory calls" (viaSocket memory or Mem0, whichever is the backend).

## The redesign: one page per post, approve and publish in one run

- **One journey per post** (`GET /api/journeys`, `GET /api/journeys/:briefId`, `src/journey.js`): Topic → Research →
  Plan → Draft → AI review → You → Export → Published, built from the post's records (brief, drafts, reviews, export,
  published post) and every run with its `brief_id`. Each step links to the run that did it. 0 AI calls, no writes.
  (`/api/posts` stays the blog's published posts.)
- **Approve and publish in one run:** the approve run takes `publish: true` (`POST /api/approvals/:id/approve` with
  `{ "publish": true }`, or `npm run approve -- --publish`): approval, Markdown export and the Publisher step (Docstar
  or the blog) in the same run, whatever `AUTO_PUBLISH` says. Without it the post is approved only.
- **Post page:** the journey on top; the post rendered like msg91.com/guide on the left (TL;DR, words, reading time,
  grade, a search-result preview); the AI review on the right (score, one-line summary, notes with **Show in post**,
  area scores, the checks in one line), then the decision. Compare versions swaps the post for the diff.
- **Posts & runs:** "By post" (each post with its journey, plus the runs that belong to no post) and "All runs".
- **Run page:** what the run is doing in plain words ("Writing the draft…") with a progress bar, the journey of its
  post, its steps; the facts, outputs and event log are under "Details".
- **Control:** one big **Write the next post** card (next up, each step's model, the cost); waiting posts, the current
  run and the run options below; single agents under **Run one agent**; the latest posts with small journey bars.
- **Look:** one accent colour (indigo) in light mode; dark mode is a neutral graphite theme (no blue tint, readable
  grey text, quiet tinted badges). Screenshots: `docs/screenshots/redesign/` (a seeded local engine, no AI).

## The weekly editor (in place of the roadmap)

One post a week (the cron), so each run decides what is most useful now instead of following a plan made weeks ago.

- **Removed:** the Roadmap Planner (`src/planner/`), the roadmap and its slots, stages and approval (`src/roadmap/`),
  the "roadmap" run mode, `/api/roadmap*`, the Roadmap page, "Add to roadmap" on news cards, the Starter-stage rule,
  and the settings `ROADMAP_*`, `PLANNER_*`, `NEXT_PICK`, `NEXT_NEWS_GAP_DAYS`, `NEXT_TUTORIAL_EVERY`. Old `roadmap`
  records stay listable on the Memory page (no longer protected) so they can be cleaned up.
- **New:** `src/weekly/` — `signals.js` (this week's questions, fresh news cards, M91's new integrations against a
  week-old fact sheet, integrations, pinned ideas, live guides, our recent posts), `editor.js` (1 call to
  `EDITOR_AI_MODEL`, default `openai` / `gpt-5.5`; code checks real evidence, real hooks and near-repeats; runner-up
  and code fallbacks; one `weekly_pick` record per decision, linked to its brief), `pick.js` (pins, then Write now,
  else the editor), `repeats.js`. Scout gains the `week` call (questions asked in the last `EDITOR_QUESTION_DAYS`
  days); its focused research takes the pick (format, angle, hook) and records the question pages as citable sources.
  The Strategist plans the pick (`TARGET_RULES`: follow the format and angle, open with the hook, `news` from the
  hook's source) and keeps `weekly` on the brief. The knowledge map (`src/knowledge.js`) is saved on every approval.
- **Order of a full run:** news check → guide sync → pins / Write now → this week's questions → editor → focused
  Scout → Strategist → Writer → Designer → Reviewer. A failed questions call is a warning; a failed editor call falls
  back to code's pick.
- **Cost:** about 3 Scout calls instead of 8, plus 1 editor call; 33 memory requests for a full run (31 before),
  approve 15 (12): the knowledge record and the post's news card are updated on every approval.
- **API:** `GET /api/weekly` (what the next run does, the latest picks); `/api/approvals/:id` has `pick`; settings
  have `weekly` and `models.editor`. CLI: `npm run weekly`.
- **Dashboard:** **This week** (in place of Roadmap: next run, the editor's decisions with reasons, signals, hook and
  runners-up with **Pin for next week**, the news cards, the live guides); **Why this post** on the post page; the
  topic line and last pick on Control; the Editor step in the run tracker.

## Approved automatically, sent to Slack

- `AUTO_APPROVE=true` (default): a full run that ends with a Reviewer pass calls the approve step itself
  (`approved_by: "auto"`): the Markdown export, then the publish step. No "ready for your approval" messages.
- `APPROVE_BEST_ON_FAIL=true` (default): when the review loop hits its limit without a pass, the best-scoring version
  is saved as a new, newest version (`best_of: { version, total, reviews }`, its review copied) and goes ahead (approved
  with `force_unreviewed`, so `approved_unreviewed: true`). Not when its hard checks failed.
- `PUBLISH_TARGET=slack` (the new default): `src/publisher/slack.js` sends one message through the existing
  `blog-slack-post` flow (body unchanged: `{ key, text }`): title, score, words, grade, the editor's reason, a link
  to `GET /api/exports/:id/download` and to the post page; the export record keeps `slack_sent_at` (the journey's
  Published step). The "publish" mode sends it again. `ENGINE_PUBLIC_URL` (default `https://<APP_NAME>.embarko.app`
  when hosted) builds the links.
- A signed-out browser opening the download link is sent to `/login?next=…`; the login page goes on at once when the
  session is valid (the cookie is `SameSite=Strict`, so a click from Slack arrives without it) and opens a download as
  a full page.
- VIASOCKET-PENDING: viaSocket's Slack app has no "upload file" action (reported as a missing capability), so the
  .md is a link, not an attachment.
