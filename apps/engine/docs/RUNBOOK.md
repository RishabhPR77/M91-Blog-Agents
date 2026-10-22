# Runbook: running the M91 blog engine day to day

This page says what to click and what to expect. You never need to edit code to use the engine.

## Start everything

1. Open a terminal in the `apps/engine` folder.
2. Type `npm run start:local` and press Enter. The engine reads your `.env` and starts on port 8080.
3. Open http://localhost:8080 in your browser. This is the dashboard.

The header at the top of the dashboard shows:
- **Engine online**: the engine is running.
- **Live**: the dashboard is receiving live updates.
- **Data loaded N min ago**: how old the dashboard's copy of the data is.
- **Mem0 n/1000 · adds n/10000**: how many Mem0 reads and writes have been used this month (an estimate).
- **DRY RUN default** or **Live runs by default**: whether runs save and send by default.

Leave the terminal window open while you work: closing it stops the engine.

## The roadmap (Phase 12)

Runs follow a roadmap: a learning path from "what M91 is" to comparisons and migrations, in 6 stages.
Nothing runs until the roadmap is approved.

1. Go to **Roadmap** and click **Generate** (1–2 AI calls, about 5–8 Mem0 requests). The roadmap comes back
   as a draft.
2. Read the stages and slots. Change what you like: **Edit** a slot, **Move** it up or down, **Skip** it.
   Proposed slots (found by the Scout, with the demand it saw) wait for **Accept** or **Reject**.
3. Click **Approve roadmap**. Problems (if any) are listed and block the approval.

The slot marked **Next up** is what the next full run writes. Slots already written are locked.

## Run the pipeline

1. Go to **Control**. Above **Run full pipeline** you see **Next up**: the slot this run will write. If it
   says "Approve the roadmap first" or that there is nothing to write, the button is blocked.
2. Pick a preset:
   - **Normal run** (the default): research for the slot, up to 2 Writer revisions. About 5–12 AI calls and
     20–35 Mem0 requests.
   - **Low-cost test run**: one question group and fewer calls. About 9–14 AI calls and 25–35 Mem0 requests.
     Use it to try something out.
3. Check **Dry run**. When it is ticked, the AI is still called (credits are used), but nothing is saved and
   nothing is sent to Slack or M91. For a real post, untick it.
4. Click **Run full pipeline**. A box shows the preset, the expected AI calls and the expected Mem0 requests.
   Click **Start the run**.
5. The **Live run** page opens. You see each step as it happens: Scout (research), Strategist (the brief),
   Writer (the draft), checks, and Reviewer (the score). A full run takes 15–30 minutes.
6. When the Reviewer passes the draft, the run ends with **Waiting for your approval**. Slack gets a
   message. If the draft does not pass within the limits, the run ends as failed (see "When a run fails").

## Read a draft and decide

1. Go to **Approvals** and open the draft.
2. Read the post, the Reviewer's scores and notes, and the check results. The **Roadmap** card shows the
   slot, its stage and the earlier posts it builds on. **Compare** shows what changed
   from the previous version.
3. Choose one of these:
   - **Approve**: the post is approved and its final **Markdown export** is saved (the Mem0 record and
     `apps/engine/exports/<slug>.md`). No AI calls.
   - **Request changes** (a counter prompt): write what to change, then click **Send counter prompt**. You
     can quote exact sentences from the draft. The Writer revises, and the Reviewer checks again unless you
     turn that off. This uses 2–4 AI calls. The new version comes back to Approvals. With the Experience
     Designer on, there is also **Change the design**.
   - **Review this version**: one Reviewer check of this version, without a rewrite.
   - **Reject the topic**: the brief and the draft are rejected, and the topic is never picked again. Its
     roadmap slot is marked skipped.

## Get the Markdown file (Phase 11)

The output is a clean Markdown file for Docstar (see [PHASE11_NOTES.md](PHASE11_NOTES.md)).

- **Any reviewed draft:** in **Approvals**, the **Markdown export** card has **Show the Markdown**, **Copy
  Markdown** and **Download .md**. Nothing is saved.
- **After you approve:** the **Exports** page lists the saved files, one per approved post.
- **From the terminal** (in `apps/engine`, 0 AI calls):

```bash
npm run export -- --brief-id=<id>
```

This writes the file to `apps/engine/exports/` only. Add `--save` for the final export (the Mem0 record
too), and `--version=<n>` for an older reviewed version.

## Publish

`PUBLISH_TARGET` decides where an approved post goes:

- **none** (the fallback plan): nothing is published; the Markdown export is the output. Publish, Rebuild
  blog and the page preview are hidden.
- **docstar**: **Send to Docstar** (on Control) sends the saved export. Until the `DOCSTAR_*` keys are set,
  it answers "not configured" and sends nothing.
- **embarko**: the Phase 7 blog. Open the approved draft in **Approvals**: the **Publishing** card has a
  **Publish** button (also on **Control** and **Posts**). It uses no AI calls, and the blog is rebuilt,
  deployed and checked. The first 10 posts are hidden from search engines; change that on **Posts**, where
  **Unpublish** is too.

## Interactive guides on or off

`EXPERIENCE_ENABLED=false` (the fallback plan) turns the Experience Designer off everywhere: no guides, no
**Change the design**, and the Reviewer uses its pre-Phase-10 areas and weights. With it on, see
[PHASE10_NOTES.md](PHASE10_NOTES.md).

## What the statuses mean

| Status | Meaning |
|---|---|
| running | A run is working now. |
| succeeded | The run finished as planned (for a full run: a draft waits for you). |
| failed | The run stopped; the reason is on the run's page. |
| cancelled | You stopped the run. |
| drafted | The Writer wrote this version; it was not yet passed. |
| awaiting human | This version waits for your decision in Approvals. |
| changes requested | You sent a counter prompt; a newer version follows. |
| approved | You approved it; it can be published. |
| published | It is live on the blog. |
| unpublished | It was taken off the blog. |
| failed review | It did not pass the Reviewer within the limits. |
| superseded | A newer version replaced it. |
| rejected | You rejected the topic. |

## When a run fails

1. Open the run in **Runs**. The summary at the top says why it stopped, and the event log shows the step
   that failed.
2. Common reasons:
   - **"hit MAX_WRITER_REVISIONS"**: the draft did not reach the pass mark (80) in 2 revisions. Start a new
     run, or ask for the draft to be revised from **Approvals**.
   - **A step failed with an AI error or timeout**: wait a few minutes and run again.
   - **"A pipeline run is already in progress"**: another run is going. Wait for it to finish (see the
     header).
   - **"Mem0 quota almost used"**: see the next section.
3. Slack and M91 send an alert when a run fails, so you do not have to watch it.

## The Mem0 quota banner

Mem0 (where the engine keeps its data) has two monthly limits on your plan: 1,000 **retrievals** (reads and
searches, `MEM0_MONTHLY_LIMIT`) and 10,000 **adds** (writes, `MEM0_MONTHLY_ADD_LIMIT`). The engine counts its
own requests, and the banner names the limit that is close:
- **Amber banner (80% or more):** you are getting close. Runs still work. Each run's summary also mentions
  it.
- **Red banner (95% or more):** new runs are paused until the 1st of next month, so the data stays usable.
  Approving and publishing a waiting draft still work.

The engine's figure is an estimate. **The Mem0 console has the exact number.** If they differ, set the
engine's figure from the console: in the `apps/engine` terminal, type `npm run mem0:usage -- --set=` followed
by the Retrieval number, and `--set-adds=` followed by the Add number. Type `npm run mem0:usage` on its own
to see the current estimate.

**"Data may be out of date":** a command was run outside the dashboard and changed the data. Click **Refresh
from Mem0** (about 7 Mem0 requests).

## Start again from zero

`npm run reset:all -- --dry-run` shows what would be deleted (1 Mem0 request). `npm run reset:all` deletes
every Mem0 memory of this engine (our agent id only) and the local files in `data/` and `exports/`, after you
type "yes". It cannot be undone. Stop any run first.

## Stop everything

1. Wait until no run is in progress (the header shows **Run in progress** while one is going). To stop a
   run, open it and click **Stop**.
2. In the terminal where the engine runs, press **Ctrl+C**. The dashboard then shows "Engine offline".
3. Nothing else needs to be stopped. The blog keeps running on its own at https://m91-blog.embarko.app.
