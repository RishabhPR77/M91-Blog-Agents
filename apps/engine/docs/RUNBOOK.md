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

## What each run writes: the weekly editor

One post goes out each week (the cron calls `POST /run` once a week), so each run decides what is most useful **now**.
There is no roadmap. A full run does this before it writes:

1. **This week's news:** the news check finds real events of the last `TIMELY_WINDOW_DAYS` days where M91 helps
   (1 AI call; it saves them as news cards).
2. **What readers already have:** it reads the guides live on msg91.com/guide (no AI).
3. **What comes first:** a pinned topic that is due, then a news card you chose with **Write now**. Otherwise:
4. **This week's questions:** the Scout finds real questions people asked in the last `EDITOR_QUESTION_DAYS` days on
   Reddit, Hacker News, GitHub, Stack Overflow and forums (1 web-search call). Dead pages and old questions are dropped.
5. **The editor** (1 call, `EDITOR_AI_MODEL`, a strong model) weighs the questions, the news, M91's new integrations,
   your pinned ideas, the live guides and our recent posts. It proposes `EDITOR_CANDIDATES` posts, scores each on
   demand, timeliness, M91 fit, gap and variety, and picks one. Often the best post is a lasting question made timely
   by this week's news: the post opens with the news (the "hook") and then answers the question.
6. **Code checks the pick:** it must cite at least `EDITOR_MIN_EVIDENCE` real signals, a hook must be a real news
   item of this week, and it must not repeat a live guide or an earlier post. If the editor's first choice fails, its
   best runner-up that passes is taken; if the call fails, code picks the strongest question itself. A weekly run
   always writes something unless every signal repeats a live guide.

Then the Scout researches the pick, the Strategist plans it (format, angle, hook), the Writer writes it and the AI
reviews it, as before. You see why on the post page (**Why this post**: the reason, the signals with links, the
hook) and on **This week**, with the runners-up. **Pin for next week** on a runner-up makes it next week's post.

To see the editor's latest decisions in a terminal (no AI), run this in `apps/engine`:

```bash
npm run weekly
```

## This week's news

News cards show up on **This week**. A badge on Control shows how many are open.

1. **Find events:** every full run checks the news first. You can also click **Check news** (1 AI call), or
   run this in `apps/engine`:

```bash
npm run timely -- --check
```

2. **Decide on a card if you want to** (you do not have to; the editor reads them anyway):
   - **Write now:** the next run writes a post about it (at most `TIMELY_MAX_PER_WEEK` per 7 days).
   - **Dismiss:** the card goes away.
3. A Write now post starts with "New to M91? Start here: …" (our first approved post) and credits its source.

Cards expire `TIMELY_WINDOW_DAYS` after the event.

## Published guides (msg91.com/guide)

The engine knows which M91 guides are already live on msg91.com/guide, including the ones you write by hand. It
reads them before each full run (no AI calls; one memory add per new guide). Posts about other MSG91 products are
ignored. You can also read them now: **This week**, **Published guides**, **Sync guides**.

What it changes: the editor never picks a topic a live guide already answers, and new posts link to the guides
instead of explaining again what they already explain.

## One click

Click **Write the next post** on Control. That is all: the editor decides the topic when the run starts, then the
post is researched, planned, written and reviewed, and waits for your review. The card says what the next run writes
about, shows the last pick and why, each step's AI model and the cost. The single agents (Scout, Strategist, Writer,
Reviewer) and the other actions are under **Run one agent, or another action**.

Every post has one page (open it from Approvals, from **Posts & runs**, or from a run). On top is its journey:
Topic → Research → Plan → Draft → AI review → You → Export → Published. A step turns green when it is done, whichever
run did it, so the writing run and the approve run show on the same bar. **Posts & runs** lists the posts this way
("By post"); "All runs" is the old table.

## Run the pipeline

1. Go to **Control**. On **Write the next post** you see what the next run writes about (a pinned topic, a Write now
   card, or "the editor decides when the run starts") and the last pick.
2. Pick a preset:
   - **Normal run** (the default): the news check, this week's questions, the editor, research for the pick, up to 2
     Writer revisions. About 10–22 AI calls and 33–50 memory requests.
   - **Low-cost test run**: one question group and fewer calls. About 9–14 AI calls and 25–35 Mem0 requests.
     Use it to try something out.
3. Check **Dry run**. When it is ticked, the AI is still called (credits are used), but nothing is saved and
   nothing is sent to Slack or M91. For a real post, untick it.
4. Click **Write the next post**. A box shows the preset, the expected AI calls and the expected Mem0 requests.
   Click **Start the run**.
5. The **Live run** page opens. You see each step as it happens: the news check and this week's questions (Scout),
   the editor's pick, Scout (research), Strategist (the brief), Writer (the draft), checks, and Reviewer (the score). A full run takes 15–30 minutes.
6. When the Reviewer passes the draft, the run ends with **Waiting for your approval**. Slack gets a
   message. If the draft does not pass within the limits, the run ends as failed (see "When a run fails").
   - The draft goes back to the Writer only for a **major** problem: wrong or invented facts, an unlinked or
     contradicting source, a major hard check, or a score below `REVISE_BELOW_SCORE` (70).
   - With only minor problems (a score of 70–79, a low area, a long paragraph or sentence) the Reviewer says
     **pass with notes** (amber). It comes to you with the minor items as "should fix". Approve it, or use
     **Request changes**.

## Read a draft and decide

1. Go to **Approvals** and open the draft.
2. On the left is the post as readers will see it (with its words, reading time and reading grade). On the right is
   the AI review: the score, what the Reviewer says in one line, its notes (**Show in post** marks the quoted
   sentence in the post), the scores by area and the content checks in one line (click it for the table). **Why this
   post** (above the post) shows the weekly editor's reason, the signals it used and the news hook. **Compare
   versions** shows what changed from the previous version.
3. Choose one of these:
   - **Approve and publish** (while `PUBLISH_TARGET` is `docstar` or `embarko`): one run approves the post, saves
     its final **Markdown export** and sends it to Docstar (or the blog). No AI calls. You stay on the post page
     and watch Export and Published turn green. **Approve only (publish later)** skips the publishing step.
   - **Approve** (with `PUBLISH_TARGET=none`): the post is approved and its final **Markdown export** is saved (the
     record and `apps/engine/exports/<slug>.md`). No AI calls.
   - **Request changes** (a counter prompt): write what to change, then click **Send counter prompt**. You
     can quote exact sentences from the draft. The Writer revises, and the Reviewer checks again unless you
     turn that off. This uses 2–4 AI calls. The new version comes back to Approvals. With the Experience
     Designer on, there is also **Change the design**.
   - **Review this version**: one Reviewer check of this version, without a rewrite.
   - **Reject the topic**: the brief and the draft are rejected, and the topic is never picked again. A news card
     it used is dismissed.

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
- **docstar**: **Send to Docstar** (on Control) sends the saved export and publishes it in the **M91 Blogs**
  collection; a second send updates the same page. Until the four `DOCSTAR_*` keys are set, it answers "not
  configured" and sends nothing. To check a post in Docstar before it goes public, run this in `apps/engine`:

```bash
npm run publish -- --brief-id=<brief id> --draft
```

  **Unpublish** takes the page back to draft (nothing is deleted).
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

## Where the engine keeps its data

The engine keeps its records in **viaSocket AI memory** (`MEMORY_BACKEND=viasocket`, the default): there is no monthly
limit, and each call costs a fraction of a cent (the header shows this month's reads, writes and cost). The local and
the hosted engine use the same memory, so they see the same posts. `MEMORY_BACKEND=mem0` switches back to Mem0; the
banner below is about Mem0 only.

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

## Where the work is kept

A run's work in progress (briefs, every draft version, reviews, guides, source packs, the run's full record) is kept
in `work.json` in the engine's data folder (`apps/engine/data`, or `DATA_DIR` on Embarko), not in Mem0. A draft
waiting for you is there too and survives a restart. When you **Approve**, the final brief, the approved draft, its
review and its guide are copied to Mem0 (4 requests) and the post's local work is deleted. A rejected or failed
post never goes to Mem0: its local work is deleted after `WORK_KEEP_DAYS` (default 7). Each run also saves one short
summary in Mem0 (1 request), so the Runs page keeps its history.

`WORK_STORE=mem0` in `.env` writes every step to Mem0 again (about 30 requests per full run instead of 17).
`npm run reset:all` also deletes `work.json`.

## See and clean up what Mem0 holds

Open **Memory** in the dashboard. The type buttons show how many records of each kind are stored; the amber number
is how many look unused. Tick **Probably not useful** to see only those, with the reason on each row (old status,
test data, a rejected or replaced brief, no draft, a duplicate, old and unused). Click a title to read the record.

If the page says some types are not loaded, click **Load all types** (about 1 Mem0 request per 100 records, once).
Listing and filtering cost 0 requests.

To delete, tick rows (or use the bin on one row) and click **Delete selected**. The dialog lists every record and
the cost: 1 Mem0 request per record. Records with a lock (published posts, current facts and style notes,
what approved posts taught, exports of approved posts) cannot be deleted; lessons, open pinned topics and the records of an
approved post need the extra tick. Deleting waits until no run is in progress and does nothing while DRY_RUN is on.

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
its files there: the Mem0 usage counter, the run lock, the exported Markdown files, the refresh marker and the work
file (`work.json`: drafts waiting for you, their revisions and the run history) survive. Embarko does not back up
that folder: if it were lost, a draft still waiting for you would be lost too (approved posts are in Mem0).
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
