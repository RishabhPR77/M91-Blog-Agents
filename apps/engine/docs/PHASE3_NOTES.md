# Phase 3 (Strategist): decisions and differences from the brief

`ai.md` re-fetched 2026-10-17: unchanged.

## Need your answer

1. **`READING_GRADE_INTRO_MAX` / `READING_GRADE_POST_MAX`** were described as "already in .env" but were
   never defined. Defaults set to **6** (intro and TL;DR) and **8** (whole post). Confirm or change.
2. **`M91_CTA_URL`** must be set to a real URL. The CTA is always taken from it.

## Interpretations (tell me if any is wrong)

1. **DRY_RUN pipelines.** In DRY_RUN the Scout saves nothing, so the Strategist would find no facts in Mem0
   and fail. The Scout's result now carries this run's records in memory (`dry_run_records`), and the
   Strategist merges them with Mem0, **only in DRY_RUN**. Without this, a dry pipeline can't get past the Strategist.
2. **Brief metadata.** The store's metadata fields are fixed (`type, brief_id, status, version, topic_group,
   date`). `version` holds `brief_version`; `post_type` and `brief_version` are also in the payload. I didn't
   change the store's public `createRecord` to add extra metadata fields.
3. **Brief status.** New briefs are `new` (the brief). Phase 2's orchestrator used `active` for stub briefs;
   that path now runs only when a stub Strategist is used. On Reviewer pass the brief becomes `approved`.
4. **Gateway timeout.** A sync call that gets a 502 is not re-sent; its answer is read from the thread history
   (Phase 2 change). The client now flags this (`recoveredFromHistory`) and the Strategist reports it as a warning.
5. **Message size.** viaSocket refuses messages over 50,000 characters. The Strategist's message trims, in
   order: other stories → already-covered lines → tutorials → clusters, with a warning.
6. **"Lead is open."** Inputs contain only open leads (plus, in re-brief mode, the leads the brief being
   revised already uses), so "not in the inputs" and "not open" are reported as one problem.
7. **Fact matching.** "Word overlap ≥ 0.6" = the share of the brief fact's words (3+ letters, common
   words skipped) that appear in one `can`, `cannot` or `integrations` entry.
8. **Discard vs reopen on re-brief.** The old lead is `discarded` when the feedback mentions "duplicate",
   "too weak", "weak topic" or "already covered"; otherwise it goes back to `open`.
9. **Story-based posts** also mark a cluster `used` when its main question appears in the brief's `questions`.
10. **Reviewer feedback as strings** (the stub) becomes `{ area: "general", problem: <text> }`.
11. **CLI arguments** accept `--key value` as well as `--key=value`, so `npm run pin -- --topic "…" --date …`
    works as written in the brief. `src/cli.js` now runs only when executed directly (so tests can import it).
12. **Pin in DRY_RUN.** `npm run pin` follows the DRY_RUN rule: if `.env` has `DRY_RUN=true`, nothing is saved.

## Credits

The Strategist makes 1 call per plan (+ at most 1 repair), sync, no web search, about 10–25k characters of
input. The smoke test makes about 6 calls.
