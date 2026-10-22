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
RAPID_RESPONSE_ENABLED=false
READING_GRADE_POST_MAX=7
READING_GRADE_INTRO_MAX=6
READING_GRADE_HARD_MARGIN=0
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
- Rapid response is off (`RAPID_RESPONSE_ENABLED=false`).

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
- **Settings:** a Roadmap card (roadmap on or off, rapid response, the Planner's model).

## Expected costs

| Action | AI calls | Mem0 requests |
| --- | --- | --- |
| Generate the roadmap | 1–2 | ≈5–8 |
| Full run (one slot) | 5–12 | ≈20–35 |
| Approve a post | 0 | a few (export + knowledge record) |
