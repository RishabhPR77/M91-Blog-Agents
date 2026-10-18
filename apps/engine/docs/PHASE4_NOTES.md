# Phase 4 (Writer): decisions and differences from the brief

`ai.md` re-fetched on 2026-10-18: unchanged.

**Mem0 size check:** a 22,796-character draft record saved and read back intact (8 s). A full draft
fits in one memory, so drafts are stored as planned.

## Names and keys

1. **`AI_RTLAYER_POLL_MS`** in the brief already exists as **`AI_POLL_INTERVAL_MS`**; the existing name is used.
2. **`SLACK_CHUNK_CHARS`** was described as "already in .env", but the limit was a fixed 2,800. It's now
   a key (default 2800, 500–3900) used by `notify.slack`.
3. **`TUTORIAL_SOURCE_MAX_CHARS`** may be at most 48000: the tutorial text travels inside the message,
   which viaSocket caps at 50,000 characters. If the whole message is still too long, the tutorial text
   is trimmed first, and `tutorial_code_verbatim` checks against exactly the text that was sent.
4. **`WRITER_FALLBACK_SERVICE` + `WRITER_FALLBACK_MODEL`**: both or neither; the model must be in
   `ai.md`'s list for that service.
5. **`REVIEWER_STUB_MODE`** (pass | fail_once | fail_always) is temporary; remove it in Phase 5.

## Interpretations (tell me if any is wrong)

1. **Retries vs fallback.** With a fallback configured, an unusable answer gets 2 tries on the main model,
   then 1 on the fallback (brief §4). Without one: 1 + `AI_MAX_RETRIES` tries (§10.2), then the run fails.
2. **Tutorial source text.** Besides M91 docs pages and the skill repo README (as written), a step URL
   pointing at a **file in the skill repository** (`…/m91-skill/blob/main/scripts/m91.sh`) fetches that
   file through the GitHub contents API. The Scout's tutorial steps cite those files, and the code to copy
   verbatim lives there, not in the README. Step URLs on other hosts may be linked but give no code.
3. **JSON auto-fixes** (strip fences, extract the first `{…}`) live in the shared AI client, so every agent
   benefits; the client reports them back and the Writer logs them as auto-fixes.
4. **Draft versions** number per brief across brief versions (v1, v2, … even after a re-brief); each draft
   also stores its `brief_version`.
5. **Quoted excerpts** match the quote against the paragraph as it reads (link markup and `*`/`_` ignored),
   since reviewers quote rendered text.
6. **`npm run checks -- --file`** on a bare Markdown file skips `schema` and `seo_lengths` (a file has no
   JSON answer or SEO fields) and checks links live.
7. **`ai.call` events** now carry the call name (`new | revise | repair`) when the agent passes one.
8. **Brief statuses:** `new` → `drafted` (first draft) → `approved` (Reviewer pass); drafts:
   `drafted | drafted_with_issues | superseded`.

## Your `.env`

All have the same default built in; add them to override:

```dotenv
WRITER_MAX_REPAIRS=1
WRITER_REVISION_INPUT=context
TUTORIAL_SOURCE_MAX_CHARS=40000
SLACK_POST_DRAFTS=false
READING_GRADE_HARD_MARGIN=2
WORDS_HARD_MARGIN_PCT=20
SLACK_CHUNK_CHARS=2800
REVIEWER_STUB_MODE=pass
# Optional fallback (keep commented out unless you want it):
# WRITER_FALLBACK_SERVICE=anthropic
# WRITER_FALLBACK_MODEL=claude-sonnet-4-6
```

If your `.env` has `WRITER_FALLBACK_MODEL` set **without** `WRITER_FALLBACK_SERVICE`, config now stops
with a clear message: set both, or comment both out.
