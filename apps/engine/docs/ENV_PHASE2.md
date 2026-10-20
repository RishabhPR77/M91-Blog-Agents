# Phase 2 keys to add to `.env.example` and `.env`

> **Superseded:** every key now lives in `env.example` at the repo root (Phase 3.5). This file is kept for history.

Claude can't write either file (deny rules), so copy this block into **both** yourself.
All values are non-secret defaults. If a key is missing, the config uses the same default, so these
lines are for visibility and for overriding.

```dotenv
# --- Phase 2: Scout ---
# Delivery for calls that use web search (questions, stories, style, sources). SCOUT_DELIVERY stays for no-web calls.
SCOUT_RESEARCH_DELIVERY=rtlayer
# Max AI calls per research run, retries included (10 planned calls + room for ~4 retries).
SCOUT_MAX_CALLS=14
SCOUT_REUSE_HOURS=24
SCOUT_MIN_OPEN_CLUSTERS=5
SCOUT_QUESTIONS_PER_GROUP=8
STORY_LOOKBACK_DAYS=30
RAPID_RESPONSE_DAYS=7
STYLE_REUSE_DAYS=14
DOCS_MAX_PAGES=15
# At most 48000: viaSocket refuses a message over 50,000 characters (the brief's 150000 can't work).
DOCS_MAX_CHARS=45000
# Comma-separated hosts; only doc links on these are fetched.
M91_DOCS_HOSTS=m91-api.msg91.com,m91.msg91.com
# (Since 2026-10-20 the docs are on m91-api.msg91.com: see PHASE8_NOTES.md.)
DEDUPE_SIMILARITY=0.85
URL_CHECK_TIMEOUT_MS=10000

# Named in the Phase 2 brief as "already in .env", but they were not in Phase 1's list:
M91_SKILL_REPO_URL=https://github.com/MSG91/m91-skill
COMPETITORS=withHuman, PagerDuty, Opsgenie, Twilio A2H, Pushover
# HTTP retries per AI call (429/500/502), always within SCOUT_MAX_CALLS for the Scout.
AI_MAX_RETRIES=3
```

Optional, already supported since Phase 1 (defaults shown): `AI_RTLAYER_TIMEOUT_MS=300000`,
`AI_POLL_INTERVAL_MS=3000`, `PROMO_DELIVERY=sync`, `PORT=8080`.
