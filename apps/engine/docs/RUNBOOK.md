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
- **Mem0 n/1000**: how many Mem0 requests have been used this month (an estimate).
- **DRY RUN default** or **Live runs by default**: whether runs save and send by default.

Leave the terminal window open while you work: closing it stops the engine.

## Run the pipeline

1. Go to **Control**.
2. Pick a preset:
   - **Normal run** (the default): full research, up to 2 Writer revisions. About 15–23 AI calls and 28–45
     Mem0 requests.
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
2. Read the post, the Reviewer's scores and notes, and the check results. **Compare** shows what changed
   from the previous version.
3. Choose one of these:
   - **Approve**: the post is approved. The promo pack is made, then the Designer picks the interactive
     blocks (if blocks are on). This uses 2–4 AI calls.
   - **Request changes** (a counter prompt): write what to change, then click **Send counter prompt**. You
     can quote exact sentences from the draft. The Writer revises, and the Reviewer checks again unless you
     turn that off. This uses 2–4 AI calls. The new version comes back to Approvals.
   - **Review this version**: one Reviewer check of this version, without a rewrite.
   - **Reject the topic**: the brief and the draft are rejected, and the topic is never picked again.

## Publish

Publishing is manual (`AUTO_PUBLISH` is off).
1. Open the approved draft in **Approvals**. The **Publishing** card has a **Publish** button. You can also
   publish from **Control** or **Posts**.
2. Click **Publish** and confirm. This uses no AI calls. The blog is rebuilt and deployed, and the engine
   checks that the post is live. Slack gets the link.
3. The first 10 posts are hidden from search engines (noindex). To change one, go to **Posts** and click
   **Show in search**.

## Unpublish

Go to **Posts**, find the post, and click **Unpublish**. The blog is rebuilt without it, and its link stops
working. The draft goes back to "approved", so you can publish it again later.

## Interactive blocks on or off

- In **Approvals**, the **Interactive blocks** card has an on/off switch for each post.
- **Re-run Designer** (1–2 AI calls) picks the blocks again. The live post changes only after you click
  **Republish** on the **Posts** page.

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

Mem0 (where the engine keeps its data) allows a limited number of requests per month (1,000 on your plan).
The engine counts its own requests:
- **Amber banner (80% or more):** you are getting close. Runs still work. Each run's summary also mentions
  it.
- **Red banner (95% or more):** new runs are paused until the 1st of next month, so the data stays usable.
  Approving and publishing a waiting draft still work.

The engine's figure is an estimate. **The Mem0 console has the exact number.** If they differ, set the
engine's figure from the console: in the `apps/engine` terminal, type `npm run mem0:usage -- --set=` followed
by the number. Type `npm run mem0:usage` on its own to see the current estimate.

**"Data may be out of date":** a command was run outside the dashboard and changed the data. Click **Refresh
from Mem0** (about 7 Mem0 requests).

## Stop everything

1. Wait until no run is in progress (the header shows **Run in progress** while one is going). To stop a
   run, open it and click **Stop**.
2. In the terminal where the engine runs, press **Ctrl+C**. The dashboard then shows "Engine offline".
3. Nothing else needs to be stopped. The blog keeps running on its own at https://m91-blog.embarko.app.
