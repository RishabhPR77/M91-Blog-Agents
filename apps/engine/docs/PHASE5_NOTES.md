# Phase 5: Phase 4 fixes, the Reviewer, routing, lessons, promo pack

## Decisions (agreed with you)

- **Drafts are numbered per brief version.** A new brief version starts again at v1. Drafts carry
  `brief_version` in their metadata. Older drafts that only have it in the payload still count.
  A new draft supersedes every earlier draft, including drafts of older brief versions.
- **Changed public functions:**
  - `decideAfterReview(review, counters, limits)` now routes on the "must" items.
  - `store.addLesson(text, meta?)` and `store.createRecord({ …, meta? })` take extra metadata.
  - `nextDraftVersion(store, briefId, briefVersion?)` takes the brief version.
  - `runContentChecks` takes `snippets` and `snippetErrors` instead of `tutorialText`.
- **The Reviewer's web limits are prompt-only.** viaSocket's web access is always on (Phase 2 note).
  Code checks afterwards. A `sources_checked` URL outside ALLOWED URLS gives a warning, and so do
  more than `REVIEWER_MAX_SOURCE_CHECKS` checks. A `contradicts` verdict always fails the
  `sources_contradicted` gate.

## Interpretations (tell me if any is wrong)

1. **Snippet sources for posts that aren't tutorials (A1.6).** The Writer fetches the M91 docs pages
   and skill-repo files that the brief cites: at most 4 pages, plain HTTP, no AI credits. It sends
   their code blocks as CODE SNIPPETS. A page that fails to load is a warning; the post then
   describes code in words.
2. **Prompt lines beyond the brief.** Two WRITER_BASE lines told the model to write fenced code.
   - The SIMPLE line is now the brief's "Before code, one plain sentence saying what it does."
   - The FORMAT code line now points to `[[SNIPPET:Sn]]` lines.
   - One HONESTY line was added for posts that aren't tutorials: the same no-code rule.
3. **Snippet details.**
   - A whole source file in a code language is one snippet, e.g. `scripts/m91.sh` from the skill repo.
   - Identical code found twice is kept once.
   - The tutorial source text sent to the Writer has each code block replaced by its token, so the
     code travels only once, in CODE SNIPPETS.
   - `ai_written_code` compares each fenced block with every snippet. Line endings, trailing spaces,
     the common indent and blank edge lines are ignored. So a revision that keeps an inserted block
     still passes. Repairs and revisions see the tokens again, not the code.
4. **`cta_exact` replaces `cta`** and checks the **last** H2 section, as the brief says.
   **`raw_html` (hard) replaces the soft `block_no_html`.**
5. **Rounds = routes.** Each routing decision counts once towards `MAX_AI_ROUNDS_PER_POST`. With 5,
   a post gets at most 6 reviews.
6. **Lessons are saved inside `runReviewer`,** so a standalone `reviewer` run saves them too.
   DRY_RUN logs them instead.
7. **Pending flows.** With an empty `SLACK_POST_WEBHOOK_URL` or `M91_ALERT_WEBHOOK_URL`, the
   notifier skips the send with a warning ("pending flows"). Before Phase 5 it threw an error.
   Approval and failure runs list these as warnings.
8. **DRY_RUN and post text.**
   - The full approved post is not sent to the (logging) notifier, because log lines become
     events and E1 forbids post text in events.
   - The DRY_RUN review log (B7: "log the full result") includes feedback quotes of at most 25 words.
9. **84.9 can't happen with whole-number scores** (totals move in steps of 0.5). The pass rule
   (`passRule`) is tested with 84.9 and 85.0 directly.
10. **`reviewer` mode with `route: true`** starts the loop at the review of the saved draft, with no
    Scout or Strategist. Without `route` it only reviews.
11. **Promo repair.** The pack kept is the better answer: a valid pack beats an invalid one, and
    fewer problems beat more. A pack still failing its checks is saved `with_issues`. A promo error
    never blocks approval; it becomes a run warning.
12. **The Reviewer's ALLOWED URLS** are the Writer's set, labelled by origin. The snippets a draft
    used are saved with it (`draft.snippets`), so the Reviewer sees them.

## Settings: your `.env` (repo root)

Add (the defaults are built in, so these lines are optional):

```dotenv
REVIEWER_MAX_SOURCE_CHECKS=5
REVIEW_FEEDBACK_MAX_ITEMS=8
LESSONS_PER_REVIEW_MAX=3
SLACK_POST_APPROVED=true
PROMO_LINKEDIN_MAX_CHARS=1300
PROMO_X_POST_MAX_CHARS=270
```

Remove this line (it is no longer read):

```dotenv
REVIEWER_STUB_MODE=pass
```

`PROMO_DELIVERY=sync` already existed and is used now.

## Commands

```text
npm run cleanup -- --list | --delete <memory_id …> | --delete-listed   (asks you to type "yes")
npm run lessons -- --list | --delete <memory_id>
npm run reviewer -- --brief-id=<id> [--version=<n>] [--brief-version=<n>] [--route]
npm run reviewer:dry -- --brief-id=<id>          (review only; nothing saved)
npm run promo -- --brief-id=<id> [--version=<n>]  (needs an approved draft)
npm run smoke -- reviewer                         (smoke steps 2–4, DRY_RUN, ~2 gpt-5.5 + 1–2 Writer calls)
npm run draft -- --show <brief_id> [--version <n> [--brief-version <n>]]
```

API: `POST /api/runs` accepts `{"mode":"reviewer","params":{"brief_id":"…","version":1,"route":false}}`
and `{"mode":"promo","params":{"brief_id":"…"}}`. Bad params return 400 with a code: `bad_params`,
`unknown_draft` or `no_approved_draft`. `GET /api/records?type=review&brief_id=…` and
`type=promo_pack` list them.

## Smoke step 5: the full pipeline live (DRY_RUN, low-cost Scout), in two terminals

Terminal 1:

```bash
npm run dev:engine
```

Terminal 2 (PowerShell): start the run, then stream its events.

```bash
curl.exe -s -X POST http://127.0.0.1:8080/api/runs -H "content-type: application/json" -d "{\"mode\":\"full\",\"dry_run\":true,\"params\":{\"scout\":{\"question_groups\":[1],\"questions_per_group\":3,\"docs_max_chars\":15000,\"docs_max_pages\":5,\"max_calls\":6},\"ai_max_retries\":1}}"
```

```bash
curl.exe -N http://127.0.0.1:8080/api/runs/<run_id>/events
```

## Smoke step 6 (after the two viaSocket flows exist, and after your "ok")

One run with `DRY_RUN=false` sends the approval Slack messages (or the failure message and the
LOW M91 alert). Until `SLACK_POST_WEBHOOK_URL` and `M91_ALERT_WEBHOOK_URL` are set, these sends are
skipped and reported as "pending flows". Build the flows from `docs/SETUP_FLOWS.md`, including the
IF-block key check.
