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

## Timely posts (the timely lane)

News that M91 could help with shows up as cards in **Roadmap → Timely opportunities**. A badge on Control
shows how many are open.

1. **Find events:** every full run checks the news first. You can also click **Check news** (1 AI call), or
   run this in `apps/engine`:

```bash
npm run timely -- --check
```

2. **Decide on each card:**
   - **Write now:** the next run writes it before the roadmap's next slot. It does not use up a slot.
   - **Add to roadmap:** it becomes a planned slot in the stage you pick.
   - **Dismiss:** the card goes away.
3. **Run the full pipeline** as usual. A Write now card waits in two cases: until the Starter (stage 0) has an
   approved post, and while `TIMELY_MAX_PER_WEEK` timely posts were already written this week. Control and the
   Roadmap page say why.
4. **Approve it** like any post. A timely post starts with "New to M91? Start here: …" and credits its source
   ("reported by …").

Cards you don't act on expire `TIMELY_WINDOW_DAYS` after the event.

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
   - The draft goes back to the Writer only for a **major** problem: wrong or invented facts, an unlinked or
     contradicting source, a major hard check, or a score below `REVISE_BELOW_SCORE` (70).
   - With only minor problems (a score of 70–79, a low area, a long paragraph or sentence) the Reviewer says
     **pass with notes** (amber). It comes to you with the minor items as "should fix". Approve it, or use
     **Request changes**.

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

Posts never link to M91's docs: a docs link becomes a link to https://m91.msg91.com/ (the run's warnings say
so). To bring every approved post's file up to that rule, type `npm run export -- --all-approved` (0 AI calls,
a few Mem0 requests per post).

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

## On Embarko: log in, redeploy, roll back

The engine and dashboard can run on Embarko as the app **m91-engine** (https://m91-engine.embarko.app once it is
deployed). The details and limits are in [EMBARKO_HOSTING.md](EMBARKO_HOSTING.md). Commands below run in
`apps/engine`, and none of them shows a secret.

**Log in.** Open the address. Every page asks for the **Admin ID** and **Password** first; only the login page
is open. After 12 hours, or after **Log out**, you log in again. A wrong ID and a wrong password get the same
message. After 5 wrong tries from one place in a minute, or 20 wrong tries from anywhere in 10 minutes, logging in
waits a little.

**Make the admin ID and password (first time, or if you forget the password):**

```bash
npm run admin:hash
```

It asks for the password twice (hidden) and prints one line, `ADMIN_PASSWORD_HASH=…`. The password itself is
never stored. Put that line and `ADMIN_USERNAME=<your ID>` in Embarko's environment settings, then apply:

```bash
npm run embarko -- apply-env --yes
```

**Which settings Embarko needs:** `npm run embarko:env` prints the names (never values), in four groups. You type
the values in Embarko's **App setup** page. Do not set `PORT`, `DATA_DIR`, `APP_NAME` or `APP_VERSION`: Embarko does.

**Copy the settings from `.env` instead of typing them:**

```bash
npm run embarko:env-sync
npm run embarko:env-sync -- --yes
```

The first only lists the setting names it would send. The second sends them to Embarko and applies them. It reads
`.env` itself, prints names only (never a value), and leaves out `PORT`, `DATA_DIR`, `APP_NAME`, the local-only keys
and a `PUBLISH_TARGET` that is not `none`. Re-run it after you change a value in `.env`.

**Redeploy** (after a code change; do it when the header does not say **Run in progress**, because a redeploy
stops the engine and ends a run that is still going):

```bash
npm run package:embarko
npm run deploy:embarko -- --yes
```

The first command only packages and checks (nothing is uploaded). The second uploads, waits for the build and
prints the address. The upload never contains `.env`, `data/`, `exports/`, `node_modules` or the Dockerfile; if
anything secret-looking is found, it stops before uploading. After a deploy, wait for the engine to start (the
header says **Engine online**), then log in. Every start loads the engine's lists from Mem0 (about 7 Mem0
retrievals), so avoid redeploying many times in a row.

**Is it up?**

```bash
npm run embarko -- status
npm run embarko -- logs
```

**Roll back** (when a new version is broken and you do not know why yet):

```bash
npm run embarko -- deployments
npm run embarko -- rollback --yes
```

`rollback` puts the previous good version back without rebuilding (add a deployment id from the list to go
further back; Embarko keeps the last 5). It keeps today's settings and data. Anything added after that version
(the admin login, if you go back before it) is gone until you redeploy a fixed version. Roll back, then fix and
redeploy.

**What a restart or redeploy loses.** Only the folder Embarko keeps (`DATA_DIR`) survives, and the engine puts
its files there: the Mem0 usage counter, the run lock, the exported Markdown files and the refresh marker survive.
Lost: the logins (you log in again), a run that was in progress, and nothing else. The exported posts are also in
Mem0. Embarko does not back up `DATA_DIR`.

**One engine at a time.** Both this engine and a local one use the same Mem0 account, and the run lock is a local
file, so they cannot see each other's runs. Run from one place; if you use the hosted one, stop the local one.

## Start again from zero

`npm run reset:all -- --dry-run` shows what would be deleted (1 Mem0 request). `npm run reset:all` deletes
every Mem0 memory of this engine (our agent id only) and the local files in `data/` and `exports/`, after you
type "yes". It cannot be undone. Stop any run first.

## Stop everything

1. Wait until no run is in progress (the header shows **Run in progress** while one is going). To stop a
   run, open it and click **Stop**.
2. In the terminal where the engine runs, press **Ctrl+C**. The dashboard then shows "Engine offline".
3. Nothing else needs to be stopped. The blog keeps running on its own at https://m91-blog.embarko.app.
