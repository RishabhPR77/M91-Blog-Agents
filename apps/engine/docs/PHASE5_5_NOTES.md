# Phase 5.5: human approval gate + small fixes

## Decisions (agreed with you)

- **The C2 smoke run is a live run (`DRY_RUN=false`).** DRY_RUN saves no statuses, so a draft can
  only reach `awaiting_human` (and then be approved or revised) in a live run. Slack and M91 stay
  "pending flows" while their webhook URLs are empty, so nothing is sent.
- **`step.cancelled` is a real event type.** A step interrupted by a cancel emits `step.cancelled`
  (no longer `step.failed` with a flag). The run record shows that step as `cancelled`.
- **No record/replay of AI answers for now.** Unit tests use mocked AI.

## What changed

**A1, snippets**
- CODE SNIPPETS shows each snippet's kind and numbered lines.
- `[[SNIPPET:S1:L10-L25]]` inserts exactly lines 10–25.
- An invalid range is the hard check `snippet_range_invalid`, which gets a repair call.
- Scripts also give their usage lines from comments as snippets of `kind: usage_from_comment`. For
  the real `m91.sh` that's 11 usage snippets (`./m91.sh invite …`, `./m91.sh alert …`, and so on).
  Indented continuation lines are kept with their call.

**A2, the Reviewer's web limit**
- A `sources_checked` entry whose URL is not in ALLOWED URLS is dropped (with a warning) before
  the gates are computed.
- The prompt line from the brief is in.

**A3, cancels**
- `step.cancelled`, in the run record and in the event.

**B1, a Reviewer pass now ends at `awaiting_human`**
- Draft and brief statuses → `awaiting_human`. The draft gets `awaiting_since` and `review_total`
  in its metadata. Any other waiting draft of the same brief → `superseded`.
- Slack: "📝 Ready for your approval". The optional M91 nudge is sent only if `M91_NOTIFY_ON_AWAITING=true`.
- Events: `step.output` "Awaiting human approval" and `approval.waiting`.
- The run ends `succeeded` with "awaiting human approval (v…, score …)".
- The promo pack no longer runs here.

**B2–B4, run modes**
- `approve`: promo pack → placeholder `designer` and `publisher` steps → Slack.
- `human_revise`: a Writer revision from your feedback, then the Reviewer and the normal routing
  loop (`REREVIEW_AFTER_HUMAN`).
- `reject_topic`: brief and draft → `rejected`, the lead → `discarded`, the reason → a lesson.
  No AI call.

**B5, the Writer**
- One `--- FEEDBACK ---` section; every item has a `source` (`reviewer` or `human`).
- New REVISE line about editor feedback and the HONESTY RULES.

## Interpretations (tell me if any is wrong)

1. **A draft with a decision keeps its status.** Saving a new version no longer supersedes drafts
   that are `changes_requested`, `approved`, `rejected` or `failed_review`, so the history of
   your counter prompts stays visible. Only `drafted`, `drafted_with_issues` and `awaiting_human`
   drafts become `superseded`.
2. **Counter prompts are counted** from drafts that carry `human_feedback` (`MAX_HUMAN_REVISIONS`
   per brief).
3. **A human revision doesn't use up `MAX_WRITER_REVISIONS`.** That limit (and
   `MAX_AI_ROUNDS_PER_POST`) applies to the Reviewer's own loop after the revision.
4. **With `REREVIEW_AFTER_HUMAN=false`,** the revised draft goes straight back to `awaiting_human`
   with "not re-reviewed" instead of a score. Its content checks still run.
5. **Feedback with quotes:** one Writer feedback item per quote, each with your full text. Without
   quotes there is one item with an empty quote.
6. **Every decision needs the brief's newest draft to be `awaiting_human`;** otherwise 409. Feedback
   must be 5–2,000 characters, and every quote must be found in the draft (400 otherwise; case,
   spacing and Markdown don't matter).

## Settings: your `.env` (repo root)

Add (the defaults are built in, so these are optional):

```dotenv
MAX_HUMAN_REVISIONS=5
REREVIEW_AFTER_HUMAN=true
M91_NOTIFY_ON_AWAITING=false
```

## API and commands

| Call | What it does |
|---|---|
| `GET /api/approvals` | Drafts waiting for you: brief_id, version, title, score, waiting since |
| `GET /api/approvals/<brief_id>` | The newest draft in full, its review, its checks, earlier versions |
| `POST /api/approvals/<brief_id>/approve` | Starts an `approve` run → `202 { run_id }` |
| `POST /api/approvals/<brief_id>/revise` | Body `{ "feedback": "…", "quotes": ["…"] }` → `human_revise` run |
| `POST /api/approvals/<brief_id>/reject` | Body `{ "reason": "…" }` (optional) → `reject_topic` run |

All three POST routes return 409 when the draft is no longer waiting or another run is in progress.

```text
npm run approvals -- --list
npm run approve -- --brief-id=<id>
npm run revise -- --brief-id=<id> --feedback "<text>" [--quote "<exact sentence>"]
npm run reject -- --brief-id=<id> [--reason "<text>"]
```

**Low-cost limits as one-run params** (your `.env` stays untouched): `reviewer_max_source_checks`,
`max_writer_revisions`, `max_ai_rounds_per_post`, next to `scout` and `ai_max_retries`.
