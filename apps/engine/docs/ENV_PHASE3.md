# Phase 3 keys to add to `.env.example` and `.env`

> **Superseded:** every key now lives in `env.example` at the repo root (Phase 3.5). This file is kept for history.

Copy this block into **both** files yourself (Claude can't write either). Every key has the same default
built in, so nothing breaks if a line is missing.

```dotenv
# --- Phase 3: Strategist ---
# Repair calls allowed when a brief fails the code checks
STRATEGIST_MAX_REPAIRS=1
# How many recent briefs count for topic-group balance
RECENT_BRIEFS_WINDOW=10
TITLE_MAX_CHARS=70
OUTLINE_MIN_SECTIONS=4
OUTLINE_MAX_SECTIONS=8
# At least this many H2 headings must be questions (end with "?")
MIN_QUESTION_HEADINGS=3
LESSONS_LIMIT=5
# Stays false until publishing exists
ALLOW_UPDATE_BRIEFS=false

# Named in the Phase 3 brief as "already in .env", but they were never defined. Defaults chosen by Claude; please confirm:
READING_GRADE_INTRO_MAX=6
READING_GRADE_POST_MAX=8
```

**Also needed:** `M91_CTA_URL` must be set to a real https URL (the brief's call-to-action link).
If it's empty, `cta.url` is empty and the checker can't verify it.
